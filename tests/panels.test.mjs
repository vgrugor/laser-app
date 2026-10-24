import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { workflow, schemas } from '../server/workflow.mjs';
import { formatReviewSchema, createFormatTemplate } from '../server/master-format.mjs';
import { tracingReviewSchema } from '../server/tracing.mjs';
import { panelList, multiPanel, activePanel, panelView, ensurePanels, syncPrimaryPanel, validatePanels, addPanel, removePanel, updatePanelMetadata, panelsReady, panelNavigation, panelsOverview, replacePanelMaster } from '../dist/panels.js';
import { applyPanelResult, embedPanelResult } from '../dist/panel-results.js';
import { approvalSignature, approvalBlocker } from '../dist/approval.js';
import { tracingFingerprint } from '../dist/tracing.js';
import { createAI } from '../dist/ai.js';
import { createVariant } from '../dist/variants.js';
import { migrateStoredState } from '../dist/project-state.js';
import { versionEntries } from '../dist/versions.js';
import { panelArchive } from '../dist/panel-files.js';
import { passportText } from '../dist/saved.js';
import { flatComposition, passingCompositionChecks } from './fixtures/composition.mjs';

const root=resolve(import.meta.dirname,'..'),png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1cAAAAASUVORK5CYII=';
const report=()=>({disposition:'pass_visual',findings:[],manual_checks:['Геометрія у CAD'],composition_checks:passingCompositionChecks()});
const project=()=>({id:'set',title:'Лісова шкатулка',type:'Шкатулка',brief:'Нічний ліс і місяць. Узгоджені панелі.',width:200,height:150,layers:2,frame:'engraved',palette:['clear','pine'],notes:[],locks:[],concepts:[{id:'c1',title:'Ліс',description:'Кришка з місяцем, стінки з ялинками',palette:['clear','pine'],frame:'engraved'}],selected:'c1',assets:{master:null,preview:null},pendingAssetsUpdate:[],versions:[],reviews:{},approved:false,panels:[
  {id:'lid',name:'Кришка',width:200,height:150,brief:'Місяць і зорі',assets:{},notes:[],locks:[]},
  {id:'front',name:'Передня',width:200,height:60,brief:'Ялинки',assets:{},notes:[],locks:[]},
  {id:'back',name:'Задня',width:200,height:60,sameDesignAs:'front',brief:'',assets:{},notes:[],locks:[]},
  {id:'left',name:'Ліва',width:150,height:60,brief:'Продовження лісу',assets:{},notes:[],locks:[]},
  {id:'right',name:'Права',width:150,height:60,sameSizeAs:'left',brief:'Ліс',assets:{},notes:[],locks:[]}
]});
async function temp(t){const path=await mkdtemp(resolve(tmpdir(),'panel-set-'));t.after(()=>rm(path,{recursive:true,force:true}));return path;}
async function fixture(t,{p=project(),action='generate',failPanel=null,failPreview=false}={}){
  const directory=await temp(t),calls=[],stages=[],partials=[];let stage;
  const run=async input=>{
    const name=stage.stage||stage,part=stage.panelId;calls.push({name,part,...input});
    if(name==='master'&&part===failPanel)throw Error('Panel unavailable');
    if(name==='preview'&&failPreview)throw Error('Preview unavailable');
    if(input.schema===schemas.plan)return {parts:[{name:'Мотив',finish_id:'clear',quantity:2,layer:'top'}],spatial_composition:flatComposition};
    if(input.schema===schemas.prompts)return {master:'Декор цієї панелі',preview:'Весь виріб'};
    if(input.schema===formatReviewSchema)return {verdict:'pass',panel_bounds:{left:.04,top:.04,right:.96,bottom:.96},observation:'Пропорції збігаються',suggested_action:''};
    if(input.schema===schemas.review)return report();
    if(input.schema===tracingReviewSchema)return {disposition:'pass_visual',findings:[],manual_checks:['Масштаб у CAD']};
    let bytes;
    if(name==='outline')bytes=await readFile(input.images[0]);
    else if(name==='preview')bytes=await readFile(input.images[0]);
    else bytes=await readFile(resolve(input.directory,'format-template.png'));
    const path=resolve(input.directory,'fake-'+name+'.png');await writeFile(path,bytes);return 'GENERATED_IMAGE '+path;
  };
  const args={root,directory,action,project:p,run,signal:new AbortController().signal,stage:async s=>{stage=s;stages.push(s);},save:{event(){},file:async()=>{},partial:async r=>partials.push(structuredClone(r))}};
  const readAssets=async result=>({panels:await Promise.all(result.panels.map(async x=>({...x,assets:Object.fromEntries(await Promise.all(Object.entries(x.assets).map(async([kind,name])=>[kind,'data:image/png;base64,'+(await readFile(resolve(directory,name))).toString('base64')])))}))),assets:Object.fromEntries(await Promise.all(Object.entries(result.assets).map(async([kind,name])=>[kind,'data:image/png;base64,'+(await readFile(resolve(directory,name))).toString('base64')])))});
  return {directory,p,calls,stages,partials,args,readAssets};
}
async function prepared(t){const f=await fixture(t),result=await workflow(f.args);f.p.aiJob={id:'generated',action:'generate',conceptId:'c1'};applyPanelResult(f.p,{id:'generated',result},await f.readAssets(result));return f.p;}

test('legacy products remain a virtual single panel without mutating saved approval or images',()=>{
  const p={...project(),panels:undefined,approved:true,assets:{master:png,preview:png}},before=structuredClone(p);
  assert.equal(multiPanel(p),false);assert.equal(panelList(p).length,1);assert.equal(panelView(p),p);assert.deepEqual(p,before);
  ensurePanels(p);assert.equal(p.panels[0].assets.master,png);assert.equal(p.approved,true);assert.doesNotThrow(()=>validatePanels(p));
});
test('panel links enforce matching dimensions and propagate transitively without allowing cycles or oversize stock',()=>{
  const p=project();validatePanels(p);updatePanelMetadata(p,'front','width',220);assert.equal(p.panels[2].width,220);
  assert.throws(()=>updatePanelMetadata(p,'back','width',180),/відв’яжіть/);assert.throws(()=>removePanel(p,'front'),/відв’яжіть/);
  const bad=project();bad.panels[0].sameSizeAs='front';assert.throws(()=>validatePanels(bad),/попередньою/);
  bad.panels[0].sameSizeAs=null;bad.panels[4].width=401;bad.panels[4].height=301;assert.throws(()=>validatePanels(bad),/не вміщується/);
  const added=addPanel(p);assert.ok(added.id);removePanel(p,added.id);assert.equal(p.panels.length,5);
});
test('manual master replacement updates exact copies and their tracing freshness without touching other panels',()=>{
  const p=project();for(const part of p.panels){part.assets.master='old';part.tracing={outdated:false};part.aiData={plan:{summary:part.name}};}syncPrimaryPanel(p);
  replacePanelMaster(p,'front','new');assert.equal(p.panels[1].assets.master,'new');assert.equal(p.panels[2].assets.master,'new');assert.equal(p.panels[2].tracing.outdated,true);
  assert.equal(p.panels[0].assets.master,'old');assert.equal(p.panels[0].tracing.outdated,false);assert.equal(p.aiData.plan.summary,'Кришка');assert.deepEqual(p.pendingAssetsUpdate,['preview']);
});
test('each unique panel gets its own master and aspect review, identical decor reuses bytes, preview sees the whole set',async t=>{
  const f=await fixture(t),before=structuredClone(f.p),result=await workflow(f.args);
  assert.deepEqual(f.p,before);assert.equal(result.panels.length,5);
  assert.deepEqual(f.calls.filter(x=>x.name==='master').map(x=>x.part),['lid','front','left','right']);
  assert.equal(f.calls.filter(x=>x.name==='master-check').length,4);
  assert.equal(f.calls.filter(x=>x.name==='preview').length,1);assert.equal(f.calls.find(x=>x.name==='preview').images.length,5);
  for(const call of f.calls.filter(x=>x.name==='master'))assert.match(call.text,/тільки вибрана панель/);
  assert.deepEqual(await readFile(resolve(f.directory,result.panels[1].assets.master)),await readFile(resolve(f.directory,result.panels[2].assets.master)));
  assert.equal(result.review.disposition,'pass_visual');assert.equal(result.assets.preview,'preview.png');
});
test('failure after an earlier panel preserves partial files, while incomplete panels block project acceptance',async t=>{
  const f=await fixture(t,{failPanel:'front'});await assert.rejects(workflow(f.args),/Panel unavailable/);
  const result=f.partials.at(-1);assert.equal(result.panels.length,1);assert.equal(result.assets.preview,undefined);assert.equal(result.review.disposition,'not_checked');
  f.p.aiJob={action:'generate'};applyPanelResult(f.p,{id:'partial',result},await f.readAssets(result));assert.ok(f.p.panels[0].assets.master);assert.equal(panelsReady(f.p),false);assert.match(approvalBlocker(f.p),/усіх панелей/);
});
test('editing one source regenerates only that panel and the product preview, updating exact dependent copies',async t=>{
  const p=await prepared(t),before=structuredClone(p);p.scopePanelId='front';p.panels[1].notes=['Збільшити ялинку'];
  const f=await fixture(t,{p,action:'edit'}),result=await workflow(f.args);
  assert.deepEqual(f.calls.filter(x=>x.name==='master').map(x=>x.part),['front']);assert.equal(f.calls.filter(x=>x.name==='preview').length,1);
  assert.deepEqual(result.panels.map(x=>x.id),['front','back']);
  p.aiJob={action:'edit',conceptId:'c1'};applyPanelResult(p,{id:'edit',result},await f.readAssets(result));
  assert.deepEqual(p.panels[0].assets,before.panels[0].assets);assert.deepEqual(p.panels[3].assets,before.panels[3].assets);assert.equal(p.panels[1].assets.master,p.panels[2].assets.master);assert.deepEqual(p.pendingAssetsUpdate,[]);
});
test('review and tracing work for selected panels; tracing preserves whole-product approval and the captured review',async t=>{
  const p=await prepared(t);p.approved=true;p.appearanceApproval={at:'2026-10-24T10:00:00Z'};p.scopePanelId='right';p.activePanelId='right';
  const before=await approvalSignature(p,1),review=structuredClone(p.aiReport),f=await fixture(t,{p,action:'tracing'}),result=await workflow(f.args);
  assert.deepEqual(f.calls.filter(x=>x.image).map(x=>x.name),['outline']);assert.deepEqual(result.panels.map(x=>x.id),['right']);
  p.aiJob={action:'tracing',panelFingerprints:{right:await tracingFingerprint(panelView(p,'right'))}};applyPanelResult(p,{id:'trace',result},await f.readAssets(result));
  assert.ok(p.panels[4].tracing.assets.outline);assert.equal(p.panels[0].tracing,undefined);assert.equal(p.approved,true);assert.deepEqual(p.aiReport,review);assert.equal(await approvalSignature(p,1),before);
  const check=await fixture(t,{p,action:'review'});await workflow(check.args);assert.ok(check.calls.every(x=>!x.image));assert.deepEqual(check.calls.filter(x=>x.name==='master-check').map(x=>x.part),['right']);
});
test('generation failure in the whole-product preview keeps all panel masters without treating an old preview as current',async t=>{
  const f=await fixture(t,{failPreview:true});await assert.rejects(workflow(f.args),/Preview unavailable/);
  const result=f.partials.at(-1);f.p.assets.preview=png;f.p.aiJob={action:'generate'};applyPanelResult(f.p,{id:'failed',result},await f.readAssets(result));
  assert.equal(panelsReady(f.p),true);assert.deepEqual(f.p.pendingAssetsUpdate,['preview']);assert.ok(approvalBlocker(f.p));
});
test('versions distinguish changes in any panel, and concept variants clear every panel image',()=>{
  const p=project();for(const part of p.panels)part.assets.master=png;syncPrimaryPanel(p);
  const first=structuredClone(p),second=structuredClone(p);second.panels[4].assets.master='different';
  assert.equal(versionEntries([{data:first},{data:second}]).length,2);
  const variant=createVariant(p,[p],{mode:'concepts',id:'child'});assert.ok(variant.panels.every(x=>!x.assets.master));assert.equal(p.panels[4].assets.master,png);
  const state=migrateStoredState({schemaVersion:2,projects:[p],active:p.id}).state;assert.equal(state.projects[0].panels.length,5);assert.equal(state.projects[0].panels[4].assets.master,png);
});
test('panel UI escapes metadata, and passport includes dimensions for every component',()=>{
  const p=project();p.panels[0].name='<script>bad</script>';const esc=x=>String(x).replaceAll('<','&lt;');
  assert.doesNotMatch(panelNavigation(p,{esc}),/<script>/);assert.doesNotMatch(panelsOverview(p,{esc,safeImage:String}),/<script>/);
  const text=passportText(p,[]);assert.match(text,/Передня: 200 × 60 мм/);assert.match(text,/Права: 150 × 60 мм/);
});
test('ZIP contains individual available files and readable UTF-8 metadata, validated by a standard ZIP reader',async t=>{
  const p=project();p.panels[0].assets.master=png;p.panels[0].tracing={assets:{outline:png}};
  const blob=await panelArchive(p,{safeImage:x=>x===png?x:'',passport:'Паспорт',fetchImage:async()=>new Response(Buffer.from(png.split(',')[1],'base64'),{headers:{'Content-Type':'image/png'}})});
  const dir=await temp(t),path=resolve(dir,'panels.zip');await writeFile(path,new Uint8Array(await blob.arrayBuffer()));
  const output=execFileSync('python3',['-c','import sys,zipfile,json; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; m=json.loads(z.read("panels.json")); assert len(m["panels"])==5; assert any(n.endswith("/outline.png") for n in z.namelist()); print("ZIP_OK")',path],{encoding:'utf8'});assert.match(output,/ZIP_OK/);
});
test('switching selected panel during inference does not stale a result or redirect it to another panel',async t=>{
  const original={fetch:globalThis.fetch,document:globalThis.document,FileReader:globalThis.FileReader};t.after(()=>Object.assign(globalThis,original));
  const p=project();p.activePanelId='lid';globalThis.document={querySelector:()=>null};globalThis.FileReader=class{readAsDataURL(){this.result=png;this.onload();}};
  globalThis.fetch=async(path,options)=>{
    if(path==='/api/status')return Response.json({provider:'codex-sdk',token:'t'});
    if(path==='/api/jobs'){const body=JSON.parse(options.body);assert.equal(body.project.panels.length,5);return Response.json({id:'job'});}
    if(path.startsWith('/api/assets/'))return new Response(new Blob(['png']));
    p.activePanelId='right';return Response.json({id:'job',status:'failed',stage:'master',result:{panels:[{id:'lid',name:'Кришка',assets:{master:'panel-1-master.png'}}],assets:{master:'panel-1-master.png'},review:{disposition:'not_checked',findings:[],manual_checks:[]}}});
  };
  const ai=createAI({current:()=>p,projects:()=>[p],persist:async()=>{},snapshot:async()=>{},render(){},toast(){},esc:String,validate:()=>true});await ai.start('generate');
  assert.equal(p.activePanelId,'right');assert.equal(p.panels[0].assets.master,png);assert.equal(p.panels[4].assets.master,undefined);assert.equal(p.aiJob.status,'failed');
});
