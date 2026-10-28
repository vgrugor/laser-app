import { prepareProjectExport, importProject } from '../dist/project-transfer.js';
import { embedPanelHistories, rememberPanelVariant, importedPanelHistory, restorePanelVariant, backfillPanelHistory } from '../dist/panel-history.js';
import { sharedPlanSchema } from '../server/planning.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { workflow, schemas } from '../server/workflow.mjs';
import { formatReviewSchema, createFormatTemplate } from '../server/master-format.mjs';
import { tracingReviewSchema } from '../server/tracing.mjs';
import { panelList, multiPanel, activePanel, panelView, ensurePanels, syncPrimaryPanel, validatePanels, addPanel, removePanel, updatePanelMetadata, panelsReady, panelNavigation, panelsOverview, replacePanelMaster, choosePanel, clearPanelSelection, panelImageKey, panelState, refreshPanelSelections, markPanelOutdated, captureSinglePanel, importedPanelSelection, validatePanelOperation, productPreviewStatus, bindProductPreview, panelsChosen } from '../dist/panels.js';
import { applyPanelResult, embedPanelResult } from '../dist/panel-results.js';
import { approvalSignature, approvalBlocker } from '../dist/approval.js';
import { refreshTracingFreshness, TRACING_KINDS, tracingFingerprint } from '../dist/tracing.js';
import { generationState } from '../dist/generation.js';
import { projectRoute } from '../dist/project-route.js';
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
async function fixture(t,{p=project(),action='generate',failPanel=null,failPreview=false,imageVariant=0}={}){
  const directory=await temp(t),calls=[],stages=[],partials=[];let stage;
  const run=async input=>{
    const name=stage.stage||stage,part=stage.panelId;calls.push({name,part,...input});
    if(name==='master'&&part===failPanel)throw Error('Panel unavailable');
    if(name==='preview'&&failPreview)throw Error('Preview unavailable');
    if(input.schema===sharedPlanSchema)return {summary:'Спільний задум',style:'Природні силуети й чорне гравіювання',coordination:'Узгоджені мотиви',panels:p.panels.map(x=>({id:x.id,description:x.brief||x.name}))};
    if(input.schema===schemas.plan)return {parts:[{name:'Мотив',finish_id:'clear',quantity:2,layer:'top'}],spatial_composition:flatComposition};
    if(input.schema===schemas.prompts)return {master:'Декор цієї панелі',preview:'Весь виріб'};
    if(input.schema===formatReviewSchema)return {verdict:'pass',panel_bounds:{left:.04,top:.04,right:.96,bottom:.96},observation:'Пропорції збігаються',suggested_action:''};
    if(input.schema===schemas.review)return report();
    if(input.schema===tracingReviewSchema)return {disposition:'pass_visual',findings:[],manual_checks:['Масштаб у CAD']};
    let bytes;
    if(name==='outline')bytes=await readFile(input.images[0]);
    else if(name==='preview')bytes=await readFile(input.images[0]);
    else {
      if(imageVariant){const part=p.panels.find(x=>x.id===stage.panelId);await createFormatTemplate(input.directory,{...part,width:part.width+imageVariant*.3});}
      bytes=await readFile(resolve(input.directory,'format-template.png'));
    }
    const path=resolve(input.directory,'fake-'+name+'.png');await writeFile(path,bytes);return 'GENERATED_IMAGE '+path;
  };
  const args={root,directory,action,project:p,run,signal:new AbortController().signal,stage:async s=>{stage=s;stages.push(s);},save:{event(){},file:async()=>{},partial:async r=>partials.push(structuredClone(r))}};
  const readAssets=async result=>({panels:await Promise.all(result.panels.map(async x=>({...x,assets:Object.fromEntries(await Promise.all(Object.entries(x.assets).map(async([kind,name])=>[kind,'data:image/png;base64,'+(await readFile(resolve(directory,name))).toString('base64')])))}))),assets:Object.fromEntries(await Promise.all(Object.entries(result.assets).map(async([kind,name])=>[kind,'data:image/png;base64,'+(await readFile(resolve(directory,name))).toString('base64')])))});
  return {directory,p,calls,stages,partials,args,readAssets};
}
async function prepared(t){
  const f=await fixture(t),result=await workflow(f.args);await applyFixture(f,result);
  for(const part of f.p.panels)choosePanel(f.p,part.id);f.p.generationTarget='preview';
  const preview=await fixture(t,{p:f.p});await applyFixture(preview,await workflow(preview.args));delete f.p.generationTarget;
  const check=await fixture(t,{p:f.p,action:'review'});await applyFixture(check,await workflow(check.args));return f.p;
}

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
test('each unique panel gets its own master and aspect review; a separately requested preview sees the whole set',async t=>{
  const f=await fixture(t),before=structuredClone(f.p),result=await workflow(f.args);
  assert.deepEqual(f.p,before);assert.equal(result.panels.length,5);
  assert.deepEqual(f.calls.filter(x=>x.name==='master').map(x=>x.part),['lid','front','left','right']);
  assert.equal(f.calls.filter(x=>x.name==='master-check').length,4);
  assert.equal(f.calls.filter(x=>x.name==='preview').length,0);
  for(const call of f.calls.filter(x=>x.name==='master'))assert.match(call.text,/тільки вибрана панель/);
  assert.deepEqual(await readFile(resolve(f.directory,result.panels[1].assets.master)),await readFile(resolve(f.directory,result.panels[2].assets.master)));
  assert.equal(result.review.disposition,'not_checked');assert.equal(result.assets.preview,undefined);
  await applyFixture(f,result);for(const part of f.p.panels)choosePanel(f.p,part.id);f.p.generationTarget='preview';const view=await fixture(t,{p:f.p});await workflow(view.args);assert.equal(view.calls[0].images.length,5);
});
test('failure after an earlier panel preserves partial files, while incomplete panels block project acceptance',async t=>{
  const f=await fixture(t,{failPanel:'front'});await assert.rejects(workflow(f.args),/Panel unavailable/);
  const result=f.partials.at(-1);assert.equal(result.panels.filter(x=>x.assets.master).length,1);assert.ok(result.panels.find(x=>x.id==='front')?.planning);assert.equal(result.assets.preview,undefined);assert.equal(result.review.disposition,'not_checked');
  f.p.aiJob={action:'generate'};applyPanelResult(f.p,{id:'partial',result},await f.readAssets(result));assert.ok(f.p.panels[0].assets.master);assert.equal(panelsReady(f.p),false);assert.match(approvalBlocker(f.p),/усіх панелей/);
});
test('editing one source updates exact copies and marks the retained product preview outdated',async t=>{
  const p=await prepared(t),before=structuredClone(p);p.scopePanelId='front';p.panels[1].notes=['Збільшити ялинку'];
  const f=await fixture(t,{p,action:'edit'}),result=await workflow(f.args);
  assert.deepEqual(f.calls.filter(x=>x.name==='master').map(x=>x.part),['front']);assert.equal(f.calls.filter(x=>x.name==='preview').length,0);
  assert.deepEqual(result.panels.map(x=>x.id),['front','back']);
  p.aiJob={action:'edit',conceptId:'c1'};applyPanelResult(p,{id:'edit',result},await f.readAssets(result));
  assert.deepEqual(p.panels[0].assets,before.panels[0].assets);assert.deepEqual(p.panels[3].assets,before.panels[3].assets);assert.equal(p.panels[1].assets.master,p.panels[2].assets.master);assert.deepEqual(p.pendingAssetsUpdate,['preview']);
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
  const f=await fixture(t);const result=await workflow(f.args);f.p.assets.preview=png;await applyFixture(f,result);
  for(const part of f.p.panels)choosePanel(f.p,part.id);f.p.generationTarget='preview';const broken=await fixture(t,{p:f.p,failPreview:true});await assert.rejects(workflow(broken.args),/Preview unavailable/);
  assert.equal(panelsReady(f.p),true);assert.deepEqual(f.p.pendingAssetsUpdate,['preview']);assert.ok(approvalBlocker(f.p));assert.equal(f.p.assets.preview,png);
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


test('panel choice is explicit, independent of AI review and whole-set completion',async()=>{
  const p=project(),lid=p.panels[0];assert.equal(panelState(lid),'empty');
  assert.throws(()=>choosePanel(p,'lid'),/актуальне/);
  lid.assets.master=png;lid.aiReport={disposition:'changes_required',findings:['Test']};
  assert.equal(panelState(lid),'variant');const before=await approvalSignature(p);
  choosePanel(p,'lid','2026-10-28T10:00:00.000Z');
  assert.equal(panelState(lid),'selected');assert.equal(panelState(p.panels[1]),'empty');
  assert.equal(p.approved,false);assert.equal(lid.aiReport.disposition,'changes_required');
  assert.equal(await approvalSignature(p),before);assert.match(approvalBlocker(p),/усіх панелей/);
  lid.aiReport={disposition:'pass_visual'};lid.tracing={assets:{outline:png}};
  refreshPanelSelections(p);assert.equal(panelState(lid),'selected');
  p.activePanelId='front';assert.equal(panelState(lid),'selected');
  clearPanelSelection(p,'lid');assert.equal(panelState(lid),'variant');assert.equal(lid.assets.master,png);
});

test('new image or stale inputs reset only affected choices, with no resurrection',()=>{
  const p=project();for(const part of p.panels)part.assets.master=png;
  choosePanel(p,'lid');choosePanel(p,'front');choosePanel(p,'back');
  replacePanelMaster(p,'front',png+'other');
  assert.equal(panelState(p.panels[0]),'selected');
  assert.equal(panelState(p.panels[1]),'variant');assert.equal(panelState(p.panels[2]),'variant');
  replacePanelMaster(p,'front',png);assert.equal(panelState(p.panels[1]),'variant');
  markPanelOutdated(p,'lid');assert.equal(panelState(p.panels[0]),'outdated');
  p.panels[0].pendingAssetsUpdate=[];assert.equal(panelState(p.panels[0]),'variant');
  choosePanel(p,'lid');p.panels[0].width++;assert.equal(panelState(p.panels[0]),'variant');
  refreshPanelSelections(p);p.panels[0].width--;assert.equal(panelState(p.panels[0]),'variant');
});

test('choices survive storage and snapshots; legacy images and malformed choices are not auto-selected',()=>{
  const p=project();p.panels[0].assets.master=png;choosePanel(p,'lid');
  const saved=structuredClone(p);p.panels[0].assets.master=png+'new';refreshPanelSelections(p);
  assert.equal(panelState(p.panels[0]),'variant');assert.equal(panelState(saved.panels[0]),'selected');
  const {state}=migrateStoredState(JSON.parse(JSON.stringify({projects:[saved],active:saved.id})));
  assert.equal(panelState(state.projects[0].panels[0]),'selected');
  assert.deepEqual(importedPanelSelection(saved.panels[0]),saved.panels[0].selection);
  assert.equal(importedPanelSelection(saved.panels[0],{...saved.panels[0].selection,at:'invalid'}),null);
  const legacy={width:200,height:150,assets:{master:png,preview:null},pendingAssetsUpdate:['preview'],approved:true};
  assert.equal(panelState(panelList(legacy)[0]),'variant');choosePanel(legacy,'primary');captureSinglePanel(legacy);
  assert.equal(panelState(panelList(legacy)[0]),'selected');assert.equal(legacy.approved,true);
  const fresh=createVariant(saved,[saved],{mode:'concepts'});assert.equal(fresh.panels[0].selection,null);
});

test('selection controls distinguish variants from selected and stale panels',()=>{
  const p=project(),esc=s=>String(s).replaceAll('<','&lt;');p.panels[0].assets.master=png;
  let html=panelNavigation(p,{esc});assert.match(html,/Є варіант/);assert.match(html,/data-action="panel-choose-next"/);
  choosePanel(p,'lid');html=panelNavigation(p,{esc});assert.match(html,/Обрана/);assert.match(html,/data-action="panel-unchoose"/);
  p.aiJob={status:'running'};assert.throws(()=>choosePanel(p,'front'),/Дочекайтеся/);
  assert.match(panelNavigation(p,{esc}),/data-action="panel-unchoose" disabled/);
});


test('portable project export keeps choices after embedding paths, including archived concept panels',async()=>{
  let output;
  const embed=async()=>png;
  const run=async p=>{output=await prepareProjectExport(p,{projects:[{conceptRuns:[{id:'r',projectId:'set',assets:{},panels:[{assets:{master:'assets/magnolia-master.png'}}]}]}],embed});};
  const p=project();p.panels[0].assets.master='assets/magnolia-master.png';choosePanel(p,'lid');rememberPanelVariant(p,'lid');await run(p);
  assert.equal(panelState(output.project.panels[0]),'selected');assert.ok(importedPanelSelection(output.project.panels[0]));assert.equal(importedPanelHistory(output.project.panels[0].imageHistory).length,1);assert.ok(output.project.panels[0].imageHistory[0].data.assets.master.startsWith('data:'));
  assert.ok(output.project.conceptRuns[0].panels[0].assets.master.startsWith('data:'));
  assert.equal(p.panels[0].assets.master,'assets/magnolia-master.png');
  for(const part of p.panels){part.assets.master='assets/magnolia-master.png';choosePanel(p,part.id);}p.assets.preview='assets/magnolia-preview.png';p.pendingAssetsUpdate=[];p.previewProvenance=bindProductPreview(p);await run(p);assert.equal(productPreviewStatus(output.project),'current');
  const legacy={id:'set',width:200,height:150,assets:{master:'assets/magnolia-master.png'},versions:[],concepts:[]};
  const before=await approvalSignature(legacy);choosePanel(legacy,'primary');assert.equal(await approvalSignature(legacy),before);await run(legacy);
  assert.equal(panelState(output.project),'selected');assert.ok(importedPanelSelection(output.project));
});


test('standalone panel generation succeeds with empty siblings and never creates preview or tracing',async t=>{
  const p=project();p.scopePanelId='left';p.generationTarget='panel';
  const f=await fixture(t,{p}),result=await workflow(f.args);
  assert.deepEqual(result.panels.map(x=>x.id),['left']);assert.equal(result.assets.preview,undefined);
  assert.deepEqual(f.calls.filter(x=>x.image).map(x=>x.name),['master']);
  p.aiJob={action:'generate',generationTarget:'panel',scopePanelId:'left',status:'completed'};
  applyPanelResult(p,{id:'left-only',result},await f.readAssets(result));
  assert.equal(p.assets.master,null);assert.ok(p.panels[3].assets.master);
  assert.equal(projectRoute(p).steps.find(x=>x.id==='result').available,true);
  assert.deepEqual(p.pendingAssetsUpdate,['master','preview']);
  assert.ok(p.panels.filter(x=>x.id!=='left').every(x=>!x.assets?.master));
  assert.deepEqual(generationState(p).stages.map(x=>x.id),['plan','prompts','master']);
});

test('scoped generation and edit preserve other panels and old preview; exact repeats update without image calls',async t=>{
  for(const action of ['generate','edit']){
    const p=await prepared(t);p.scopePanelId='front';p.generationTarget='panel';p.panels[1].notes=['Збільшити ялинку'];
    const before=structuredClone(p);const f=await fixture(t,{p,action}),result=await workflow(f.args);
    assert.deepEqual(f.calls.filter(x=>x.image).map(x=>x.name),['master']);
    assert.deepEqual(result.panels.map(x=>x.id),['front','back']);
    p.aiJob={action,generationTarget:'panel'};applyPanelResult(p,{id:'only-'+action,result},await f.readAssets(result));
    assert.deepEqual(p.panels[0],before.panels[0]);assert.deepEqual(p.panels[3],before.panels[3]);
    assert.equal(p.assets.preview,before.assets.preview);assert.equal(p.panels[1].assets.master,p.panels[2].assets.master);
    assert.deepEqual(p.pendingAssetsUpdate,['preview']);assert.equal(p.aiData.setPreviewReview,null);
  }
});

test('preview-only generation uses existing masters, skips all panel work and preserves selections',async t=>{
  const p=await prepared(t);for(const part of p.panels)choosePanel(p,part.id);
  p.generationTarget='preview';p.pendingAssetsUpdate=['preview'];const before=structuredClone(p.panels);
  const f=await fixture(t,{p}),result=await workflow(f.args);
  assert.deepEqual(f.calls.map(x=>x.name),['preview']);assert.equal(f.calls[0].images.length,5);assert.deepEqual(result.panels,[]);
  p.aiJob={action:'generate',generationTarget:'preview',status:'completed'};applyPanelResult(p,{id:'preview-only',result},await f.readAssets(result));
  assert.deepEqual(p.panels,before);assert.deepEqual(p.pendingAssetsUpdate,[]);
  assert.deepEqual(generationState(p).stages.map(x=>x.id),['preview']);
  p.aiLaunchTarget='panel';assert.equal(generationState(p,{launching:true}).target,'panel');
});

test('invalid preview targets fail before model calls; copying a saved source has zero model calls',async t=>{
  const p=project();p.generationTarget='preview';const f=await fixture(t,{p});await assert.rejects(workflow(f.args),/актуальні/);assert.equal(f.calls.length,0);
  assert.throws(()=>validatePanelOperation({...p,generationTarget:'other'},'generate'),/ціль/);
  assert.throws(()=>validatePanelOperation({...p,generationTarget:'panel',scopePanelId:'missing'},'generate'),/Невідома панель/);
  assert.throws(()=>validatePanelOperation({...p,generationTarget:'panel',scopePanelId:'back'},'generate'),/вихідну/);
  const ready=await prepared(t);ready.scopePanelId='back';ready.generationTarget='panel';
  const copy=await fixture(t,{p:ready}),result=await workflow(copy.args);
  assert.equal(copy.calls.length,0);assert.deepEqual(result.panels.map(x=>x.id),['back']);
  assert.equal((await copy.readAssets(result)).panels[0].assets.master,ready.panels[1].assets.master);
});

test('failed standalone run retains partial master and later preview failure never discards panels',async t=>{
  const p=project();p.scopePanelId='lid';p.generationTarget='panel';const f=await fixture(t,{p});
  const run=f.args.run;f.args.run=async input=>{if(input.schema===formatReviewSchema)throw Error('Format check failed');return run(input);};
  const partial=await workflow(f.args);assert.equal(partial.panels[0].masterFormat.checks[0].status,'not_checked');assert.equal(partial.panels.length,1);
  p.aiJob={action:'generate',generationTarget:'panel'};applyPanelResult(p,{id:'partial-lid',result:partial},await f.readAssets(partial));assert.ok(p.panels[0].assets.master);
  const ready=await prepared(t);for(const part of ready.panels)choosePanel(ready,part.id);const before=structuredClone(ready.panels);ready.generationTarget='preview';
  const broken=await fixture(t,{p:ready,failPreview:true});await assert.rejects(workflow(broken.args),/Preview unavailable/);
  assert.deepEqual(ready.panels,before);assert.ok(broken.calls.every(x=>x.name==='preview'));
});


test('client launch and retry retain panel or preview scope even after navigation',async t=>{
  const original={fetch:globalThis.fetch,document:globalThis.document};t.after(()=>Object.assign(globalThis,original));
  const p=project(),requests=[];p.activePanelId='left';globalThis.document={querySelector:()=>null};
  globalThis.fetch=async(path,options)=>{
    if(path==='/api/status')return Response.json({provider:'codex-sdk',token:'t'});
    if(path==='/api/jobs'){requests.push(JSON.parse(options.body));return Response.json({id:'job-'+requests.length});}
    return Response.json({id:p.aiJob.id,status:'failed',stage:'master',result:null,error:'Test interruption'});
  };
  const ai=createAI({current:()=>p,projects:()=>[p],persist:async()=>{},snapshot:async()=>{},render(){},toast(){},esc:String,validate:()=>true});
  await ai.action('panel-generate');assert.equal(requests[0].project.generationTarget,'panel');assert.equal(requests[0].project.scopePanelId,'left');
  p.activePanelId='lid';await ai.action('retry-generation');assert.equal(requests[1].project.scopePanelId,'left');
  for(const part of p.panels)part.assets.master=png;syncPrimaryPanel(p);for(const part of p.panels)choosePanel(p,part.id);
  await ai.action('preview');assert.equal(requests[2].project.generationTarget,'preview');assert.equal(requests[2].project.scopePanelId,null);
  p.activePanelId='right';await ai.action('retry-generation');assert.equal(requests[3].project.generationTarget,'preview');assert.equal(requests[3].project.scopePanelId,null);
  await ai.action('generate-all');assert.equal(requests[4].project.generationTarget,'all');assert.equal(requests[4].project.scopePanelId,null);
});

async function applyFixture(f,result){f.p.aiJob={id:'test-job',action:f.args.action,status:'completed',conceptId:'c1',generationTarget:f.p.generationTarget,scopePanelId:f.p.scopePanelId};applyPanelResult(f.p,{id:'test-job',result},await f.readAssets(result));return f.p;}
test('repeat panel generation reuses common plan, local plan and prompts, including after JSON roundtrip',async t=>{
  const p=project();p.generationTarget='panel';p.scopePanelId='lid';
  const first=await fixture(t,{p}),r1=await workflow(first.args);await applyFixture(first,r1);
  assert.equal(first.calls.filter(x=>x.name==='shared-plan').length,1);assert.ok(p.aiData.sharedPlan);
  syncPrimaryPanel(p);assert.ok(p.aiData.sharedPlan);
  const next=await fixture(t,{p:JSON.parse(JSON.stringify(p))}),r2=await workflow(next.args);
  assert.deepEqual(next.calls.map(x=>x.name),['master','master-check']);
  assert.equal(r2.panels[0].preparation.planReused,true);assert.equal(r2.panels[0].preparation.promptsReused,true);assert.equal(r2.panels[0].preparation.sharedPlanReused,true);
  assert.ok(next.stages.some(x=>x.stage==='plan-cache'));assert.ok(next.stages.some(x=>x.stage==='prompts-cache'));
});

test('selected panel images reach planning and generation as style references without being copied',async t=>{
  const p=project();p.generationTarget='panel';p.scopePanelId='lid';
  const first=await fixture(t,{p});await applyFixture(first,await workflow(first.args));choosePanel(p,'lid');
  p.scopePanelId='front';const front=await fixture(t,{p}),r=await workflow(front.args);
  assert.equal(front.calls.some(x=>x.name==='shared-plan'),false);
  assert.deepEqual(r.panels[0].preparation.styleReferences.map(x=>x.id),['lid']);
  for(const name of ['plan','prompts','master']){
    const call=front.calls.find(x=>x.name===name);assert.ok(call.images.some(path=>path.endsWith('style-1.png')));assert.match(call.text,/Не копіюй мотиви/);
  }
  assert.equal(front.calls.filter(x=>x.image).length,1);assert.equal(r.panels.find(x=>x.id==='back').assets.master,'panel-3-master.png');
  await applyFixture(front,r);const next=await fixture(t,{p}),r2=await workflow(next.args);assert.equal(r2.panels[0].preparation.planReused,true);
  // A current choice with different bytes changes only this panel's preparation, not the common plan.
  p.panels[3].assets.master=png;choosePanel(p,'left');const changed=await fixture(t,{p}),r3=await workflow(changed.args);
  assert.equal(changed.calls.some(x=>x.name==='shared-plan'),false);assert.ok(changed.calls.some(x=>x.name==='plan'));assert.equal(r3.panels[0].preparation.styleReferences.length,2);
});

test('local edits and damaged caches rebuild only necessary preparation; shared configuration changes rebuild common plan',async t=>{
  const p=project();p.generationTarget='panel';p.scopePanelId='lid';const first=await fixture(t,{p});await applyFixture(first,await workflow(first.args));
  p.panels[0].aiData.prompts.master='Damaged';const badPrompts=await fixture(t,{p}),r1=await workflow(badPrompts.args);
  assert.equal(r1.panels[0].preparation.planReused,true);assert.equal(r1.panels[0].preparation.promptsReused,false);assert.equal(badPrompts.calls.some(x=>x.name==='shared-plan'),false);
  p.panels[0].notes=['Збільшити мотив'];const notes=await fixture(t,{p}),r2=await workflow(notes.args);assert.equal(r2.panels[0].preparation.planReused,false);assert.equal(r2.sharedPlanReused,true);
  p.brief+=' Додати орнамент.';const common=await fixture(t,{p}),r3=await workflow(common.args);assert.equal(r3.sharedPlanReused,false);assert.equal(r3.panels[0].preparation.planReused,false);
});

test('partial preparation survives master failure and avoids repeated planning on retry',async t=>{
  const p=project();p.generationTarget='panel';p.scopePanelId='lid';const first=await fixture(t,{p,failPanel:'lid'});
  await assert.rejects(workflow(first.args),/Panel unavailable/);const partial=first.partials.at(-1);assert.ok(partial.sharedPlan);assert.ok(partial.panels[0].planning.promptsHash);
  await applyFixture(first,partial);assert.equal(p.panels[0].assets.master,undefined);
  const retry=await fixture(t,{p});await workflow(retry.args);assert.deepEqual(retry.calls.map(x=>x.name),['master','master-check']);
});

test('failed new preparation does not replace the plan belonging to a retained master',async t=>{
  const p=project();p.generationTarget='panel';p.scopePanelId='lid';const initial=await fixture(t,{p});await applyFixture(initial,await workflow(initial.args));
  const oldPlan=structuredClone(p.panels[0].aiData.plan),oldMaster=p.panels[0].assets.master;
  p.panels[0].notes=['Different motif'];const failed=await fixture(t,{p,failPanel:'lid'}),run=failed.args.run;
  failed.args.run=async input=>{const answer=await run(input);if(input.schema===schemas.plan)answer.parts[0].name='New motif';return answer;};
  await assert.rejects(workflow(failed.args),/Panel unavailable/);await applyFixture(failed,failed.partials.at(-1));
  assert.equal(p.panels[0].assets.master,oldMaster);assert.deepEqual(p.panels[0].aiData.plan,oldPlan);
  assert.equal(p.panels[0].aiData.preparedCache.plan.parts[0].name,'New motif');
  const retry=await fixture(t,{p}),result=await workflow(retry.args);assert.equal(result.panels[0].preparation.planReused,true);
  await applyFixture(retry,result);assert.equal(p.panels[0].aiData.preparedCache,null);assert.equal(p.panels[0].aiData.plan.parts[0].name,'New motif');
});

test('client submits chosen panels and common cache, and rejects results after a style selection changes',async t=>{
  const original={fetch:globalThis.fetch,document:globalThis.document};t.after(()=>Object.assign(globalThis,original));
  const p=project();p.panels[0].assets.master=png;choosePanel(p,'lid');p.activePanelId='front';p.aiData={sharedPlan:{content:{summary:'Saved common plan'}}};
  globalThis.document={querySelector:()=>null};let request;
  globalThis.fetch=async(path,options)=>{
    if(path==='/api/status')return Response.json({provider:'codex-sdk',token:'t'});
    if(path==='/api/jobs'){request=JSON.parse(options.body);return Response.json({id:'style-job'});}
    if(path.startsWith('/api/assets/'))throw Error('Stale style result must not be downloaded');
    p.panels[0].selection=null;
    return Response.json({id:'style-job',status:'completed',stage:'master',result:{panels:[{id:'front',assets:{master:'panel-2-master.png'}}],assets:{}}});
  };
  const ai=createAI({current:()=>p,projects:()=>[p],persist:async()=>{},snapshot:async()=>{},render(){},toast(){},esc:String,validate:()=>true});
  await ai.start('generate');assert.equal(request.project.panels[0].selection.actor,'user');assert.equal(request.project.sharedPlan.content.summary,'Saved common plan');
  assert.equal(p.aiJob.status,'stale');assert.equal(p.panels[1].assets.master,undefined);
});


test('completion preview requires explicit choices and never starts a full visual review',async t=>{
  const p=await prepared(t);p.panels[1].selection=null;p.generationTarget='preview';const blocked=await fixture(t,{p});
  await assert.rejects(workflow(blocked.args),/оберіть результат/);assert.equal(blocked.calls.length,0);
  for(const part of p.panels)choosePanel(p,part.id);const preview=await fixture(t,{p}),result=await workflow(preview.args);
  assert.deepEqual(preview.calls.map(x=>x.name),['preview']);assert.equal(result.previewReview,null);assert.ok(result.previewProvenance);
  await applyFixture(preview,result);assert.equal(productPreviewStatus(p),'current');assert.equal(p.aiReport.disposition,'not_checked');
  assert.ok(panelsChosen(p));assert.equal(approvalBlocker(p),null);
});

test('explicit bulk generation creates panel images without bypassing final selection or generating preview',async t=>{
  const p=project();p.generationTarget='all';p.assets.preview=png;
  const f=await fixture(t,{p}),result=await workflow(f.args);
  assert.equal(result.panels.length,5);assert.equal(result.assets.preview,undefined);
  assert.ok(f.calls.every(x=>x.name!=='preview'&&x.schema!==schemas.review));
  await applyFixture(f,result);assert.equal(p.assets.preview,png);assert.equal(productPreviewStatus(p),'outdated');assert.equal(panelsChosen(p),false);
});

test('full review and full outlines are explicit; identical copies reuse outline files and preserve accepted appearance',async t=>{
  const p=await prepared(t);for(const part of p.panels)choosePanel(p,part.id);
  const images=p.panels.map(x=>x.assets.master),choices=p.panels.map(x=>structuredClone(x.selection));
  const check=await fixture(t,{p,action:'review'}),review=await workflow(check.args);assert.ok(check.calls.every(x=>!x.image));
  assert.equal(check.calls.filter(x=>x.schema===schemas.review).length,6);
  await applyFixture(check,review);assert.equal(productPreviewStatus(p),'current');assert.deepEqual(p.panels.map(x=>x.assets.master),images);assert.deepEqual(p.panels.map(x=>x.selection),choices);
  p.approved=true;p.appearanceApproval={at:'2026-10-28T10:00:00Z'};const before=await approvalSignature(p);
  const outlines=await fixture(t,{p,action:'tracing'}),result=await workflow(outlines.args);
  assert.equal(outlines.calls.filter(x=>x.image).length,4);assert.deepEqual(result.panels.map(x=>x.id),['lid','front','back','left','right']);
  p.aiJob={action:'tracing',status:'completed',panelFingerprints:Object.fromEntries(await Promise.all(p.panels.map(async x=>[x.id,await tracingFingerprint(panelView(p,x.id))])))};
  applyPanelResult(p,{id:'outlines',result},await outlines.readAssets(result));
  assert.equal(p.panels[1].tracing.assets.outline,p.panels[2].tracing.assets.outline);assert.ok(p.approved);assert.equal(await approvalSignature(p),before);
});

test('full review rejects stale source bindings before model calls, while a local review remains available',async t=>{
  const p=await prepared(t);p.panels[1].assets.master=png;
  assert.equal(productPreviewStatus(p),'outdated');const full=await fixture(t,{p,action:'review'});
  await assert.rejects(workflow(full.args),/актуальний загальний/);assert.equal(full.calls.length,0);
  p.scopePanelId='front';const local=await fixture(t,{p,action:'review'});const result=await workflow(local.args);
  assert.deepEqual(result.panels.map(x=>x.id),['front']);assert.ok(local.calls.every(x=>!x.image));assert.equal(result.assets.preview,undefined);
});

test('sequential box lifecycle: lid attempts, choices, interrupted wall, reload, final view, portable backup and local restore',async t=>{
  let p=project();p.panels=p.panels.slice(0,4);p.generationTarget='panel';p.scopePanelId='lid';
  const attempts=[];
  for(let i=0;i<3;i++){
    const f=await fixture(t,{p,imageVariant:i});await applyFixture(f,await workflow(f.args));attempts.push(f);
    assert.equal(f.calls.filter(x=>x.image).length,1);assert.equal(p.assets.preview,null);
    assert.equal(p.panels.slice(1).some(x=>x.assets?.master),false);
  }
  assert.equal(p.panels[0].imageHistory.length,3);const first=p.panels[0].imageHistory[0];
  assert.deepEqual(attempts[1].calls.map(x=>x.name),['master','master-check']);
  choosePanel(p,'lid');const chosenLid=structuredClone(p.panels[0]);
  p.scopePanelId='front';const front=await fixture(t,{p});await applyFixture(front,await workflow(front.args));
  assert.deepEqual(p.panels[0],chosenLid);assert.equal(p.panels[1].assets.master,p.panels[2].assets.master);assert.equal(front.calls.filter(x=>x.image).length,1);
  choosePanel(p,'front');choosePanel(p,'back');const wall=structuredClone(p.panels[1]);
  p.scopePanelId='left';const stopped=await fixture(t,{p,failPanel:'left'});await assert.rejects(workflow(stopped.args),/Panel unavailable/);await applyFixture(stopped,stopped.partials.at(-1));
  p.aiJob.status='interrupted';assert.deepEqual(p.panels[0],chosenLid);assert.deepEqual(p.panels[1],wall);assert.equal(p.panels[3].assets?.master,undefined);
  p=migrateStoredState(JSON.parse(JSON.stringify({projects:[p],active:p.id}))).state.projects[0];backfillPanelHistory(p);
  assert.equal(panelState(p.panels[0]),'selected');assert.equal(panelState(p.panels[1]),'selected');assert.equal(panelState(p.panels[3]),'empty');
  const retry=await fixture(t,{p});await applyFixture(retry,await workflow(retry.args));assert.deepEqual(retry.calls.map(x=>x.name),['master','master-check']);choosePanel(p,'left');
  assert.equal(panelsChosen(p),true);assert.equal(p.assets.preview,null);
  p.generationTarget='preview';delete p.scopePanelId;const preview=await fixture(t,{p});await applyFixture(preview,await workflow(preview.args));
  assert.deepEqual(preview.calls.map(x=>x.name),['preview']);assert.equal(productPreviewStatus(p),'current');assert.equal(approvalBlocker(p),null);
  const options={types:['Шкатулка'],colors:[{id:'clear'},{id:'pine'}],seed:()=>({reviews:{},approved:false})};
  p=importProject(JSON.parse(JSON.stringify((await prepareProjectExport(p,{embed:async src=>src})).project)),options);
  assert.equal(panelsChosen(p),true);assert.equal(productPreviewStatus(p),'current');assert.equal(p.panels[0].imageHistory.length,3);
  const beforeOther=structuredClone(p.panels.slice(1)),oldPreview=p.assets.preview;
  assert.equal(restorePanelVariant(p,'lid',first.id).stale,false);
  assert.deepEqual(p.panels.slice(1),beforeOther);assert.equal(p.assets.preview,oldPreview);assert.equal(productPreviewStatus(p),'outdated');assert.equal(panelState(p.panels[0]),'variant');
  choosePanel(p,'lid');p.generationTarget='preview';const updated=await fixture(t,{p});await applyFixture(updated,await workflow(updated.args));
  assert.deepEqual(updated.calls.map(x=>x.name),['preview']);assert.equal(productPreviewStatus(p),'current');assert.equal(approvalBlocker(p),null);
  assert.equal([...attempts,front,stopped,retry,preview,updated].some(f=>f.calls.some(x=>['review','outline'].includes(x.name))),false);
});
