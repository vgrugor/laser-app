import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { workflow } from '../server/workflow.mjs';
import { createFormatTemplate, assessMasterFormat, applyFormatReview, inspectMasterFormat, formatReviewSchema } from '../server/master-format.mjs';
import { masterFormatSpec, masterFormatNotice } from '../dist/master-format.js';
import { generationState } from '../dist/generation.js';
import { flatComposition, passingCompositionChecks } from './fixtures/composition.mjs';

const root=resolve(import.meta.dirname,'..');
const project=()=>({id:'format',title:'Квітка',type:'Панно',brief:'Магнолія',width:200,height:300,layers:2,frame:'engraved',palette:['clear','pine'],notes:[],locks:[],assets:{},concepts:[]});
const visual=(patch={})=>({verdict:'pass',panel_bounds:{left:.04,top:.04,right:.96,bottom:.96},observation:'Габарити декору відповідають шаблону',suggested_action:'',...patch});
const report=()=>({disposition:'pass_visual',findings:[],manual_checks:[],composition_checks:passingCompositionChecks()});
async function temp(t){const dir=await mkdtemp(resolve(tmpdir(),'master-format-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}

async function runFixture(t,{firstCanvasWrong=false,firstPanelWrong=false,stillWrong=false,unknown=false,correctionFailure=false,reviewFailure=false,action='generate'}={}) {
  const directory=await temp(t),p=project(),stages=[],calls=[],partials=[];
  const good=await readFile(await createFormatTemplate(directory,p));
  const square=await readFile(await createFormatTemplate(directory,{...p,width:200,height:200}));
  if(action==='review')p.assets={master:'data:image/png;base64,'+square.toString('base64'),preview:'data:image/png;base64,'+good.toString('base64')};
  const run=async input=>{
    const name=stages.at(-1);calls.push({name,...input});
    if(name==='plan')return {parts:[{name:'Пелюстки',finish_id:'clear',quantity:7,layer:'top'}],spatial_composition:flatComposition};
    if(name==='prompts')return {master:'Фронтальна магнолія',preview:'Вигляд виробу'};
    if(input.schema===formatReviewSchema){
      if(unknown)return visual({verdict:'not_checked',panel_bounds:null,observation:'Зовнішні межі не вдалося визначити'});
      return visual((name==='master-check'&&firstPanelWrong)||stillWrong?{panel_bounds:{left:.2,top:.3,right:.8,bottom:.7},observation:'Декор надто широкий',suggested_action:'Перебудувати композицію під вертикальне панно'}:{});
    }
    if(name==='review'){if(reviewFailure)throw Error('Pair review unavailable');return report();}
    if(name==='master-correct'&&correctionFailure)throw Error('Correction unavailable');
    const bytes=(name==='master'&&firstCanvasWrong)||(name==='master-correct'&&stillWrong)?square:good;
    const file=resolve(directory,name+'-fake.png');await writeFile(file,bytes);return 'GENERATED_IMAGE '+file;
  };
  const args={root,directory,project:p,action,run,signal:new AbortController().signal,stage:async n=>stages.push(n),save:{event(){},file:async()=>{},partial:async r=>partials.push(structuredClone(r))}};
  return {p,directory,stages,calls,partials,args,good,square};
}

test('geometry guide is a valid opaque PNG with proportional bounds for portrait, landscape and decimal sizes',async t=>{
  const dir=await temp(t);
  for(const [width,height] of [[200,300],[300,200],[100,100],[75.5,121.25],[400,20]]){
    const data=await readFile(await createFormatTemplate(dir,{width,height}));
    assert.deepEqual(data.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
    const w=data.readUInt32BE(16),h=data.readUInt32BE(20),chunks=[];
    assert.ok(Math.abs((w/h)/(width/height)-1)<.01);
    for(let at=8;at<data.length;){const n=data.readUInt32BE(at),kind=data.toString('ascii',at+4,at+8);if(kind==='IDAT')chunks.push(data.subarray(at+8,at+8+n));at+=n+12;}
    const raw=inflateSync(Buffer.concat(chunks));assert.equal(raw.length,(w*3+1)*h);assert.equal(raw[0],0);assert.equal(raw[1],255);
  }
  assert.equal(masterFormatSpec({width:200,height:300}).label,'2:3');
});
test('canvas and actual panel bounds are checked independently, including wrong orientation and unknown bounds',()=>{
  const p=project();
  assert.equal(assessMasterFormat(p,{pixel_dimensions:[1024,1536]},visual()).status,'pass');
  const inside=assessMasterFormat(p,{pixel_dimensions:[1024,1536]},visual({panel_bounds:{left:.2,top:.3,right:.8,bottom:.7}}));
  assert.equal(inside.canvas.status,'pass');assert.equal(inside.panel.status,'changes_required');
  const canvas=assessMasterFormat(p,{pixel_dimensions:[1536,1024]},visual({panel_bounds:{left:.3,top:.05,right:.7,bottom:.95}}));
  assert.equal(canvas.canvas.status,'changes_required');assert.equal(canvas.panel.status,'pass');
  assert.equal(assessMasterFormat(p,{pixel_dimensions:[1024,1536]},visual({verdict:'not_checked',panel_bounds:null})).status,'not_checked');
  assert.throws(()=>assessMasterFormat(p,{pixel_dimensions:[1024,1536]},visual({panel_bounds:{left:1,top:0,right:0,bottom:1}})),/межі/);
});
test('valid generation attaches template, checks proportions once and preserves final master as preview reference',async t=>{
  const f=await runFixture(t),result=await workflow(f.args);
  assert.deepEqual(f.stages,['plan','prompts','master','master-check','preview','review']);
  assert.equal(f.calls.find(c=>c.name==='master').images[0],resolve(f.directory,'format-template.png'));
  assert.match(f.calls.find(c=>c.name==='master').text,/строго 2:3/);
  assert.equal(f.calls.find(c=>c.name==='preview').images[0],resolve(f.directory,'master.png'));
  assert.equal(result.masterFormat.correctionAttempted,false);assert.equal(result.masterFormat.checks[0].status,'pass');
  assert.equal(result.review.disposition,'pass_visual');
});
test('wrong canvas or wrong panel triggers exactly one correction and a second independent check',async t=>{
  for(const patch of [{firstCanvasWrong:true},{firstPanelWrong:true}]){
    const f=await runFixture(t,patch),result=await workflow(f.args);
    assert.deepEqual(f.stages,['plan','prompts','master','master-check','master-correct','master-recheck','preview','review']);
    const fix=f.calls.find(c=>c.name==='master-correct');assert.equal(fix.images[0],resolve(f.directory,'master-before-format-fix.png'));assert.equal(fix.images[1],resolve(f.directory,'format-template.png'));
    assert.match(fix.text,/не розтягуй зображення механічно/);assert.equal(result.masterFormat.checks.length,2);
    assert.equal(result.masterFormat.checks[0].status,'changes_required');assert.equal(result.masterFormat.checks[1].status,'pass');
    assert.deepEqual(await readFile(resolve(f.directory,'master.png')),f.good);
    assert.equal(result.review.disposition,'pass_visual');
  }
});
test('a second bad result stops correction attempts and cannot be hidden by a positive pair review',async t=>{
  const f=await runFixture(t,{firstCanvasWrong:true,stillWrong:true}),result=await workflow(f.args);
  assert.equal(f.stages.filter(s=>s==='master-correct').length,1);assert.equal(result.masterFormat.checks.at(-1).status,'changes_required');
  assert.equal(result.review.disposition,'changes_required');assert.ok(result.review.findings.some(f=>f.location==='Пропорції кольорового декору'));
});
test('uncertain visual check remains unconfirmed without an automatic blind correction',async t=>{
  const f=await runFixture(t,{unknown:true}),result=await workflow(f.args);
  assert.equal(result.masterFormat.checks[0].status,'not_checked');assert.equal(result.masterFormat.correctionAttempted,false);assert.equal(result.review.disposition,'not_checked');
});
test('correction failure retains the original master, format finding and source on disk',async t=>{
  const f=await runFixture(t,{firstCanvasWrong:true,correctionFailure:true});await assert.rejects(workflow(f.args),/Correction unavailable/);
  assert.equal(f.partials.at(-1).masterFormat.correctionAttempted,true);assert.equal(f.partials.at(-1).masterFormat.checks[0].status,'changes_required');
  assert.deepEqual(await readFile(resolve(f.directory,'master.png')),f.square);assert.deepEqual(await readFile(resolve(f.directory,'master-before-format-fix.png')),f.square);
  assert.ok(!f.stages.includes('preview'));
});
test('review-only validates actual source and reports wrong proportions without generating or correcting images',async t=>{
  const f=await runFixture(t,{action:'review'}),result=await workflow(f.args);
  assert.deepEqual(f.stages,['master-check','review']);assert.ok(f.calls.every(c=>!c.image));assert.equal(result.review.disposition,'changes_required');assert.deepEqual(result.assets,{});
});
test('format findings survive a failed pair review instead of leaving an older positive report in place',async t=>{
  const f=await runFixture(t,{action:'review',reviewFailure:true});await assert.rejects(workflow(f.args),/Pair review unavailable/);
  assert.equal(f.partials.at(-1).review.disposition,'changes_required');assert.ok(f.partials.at(-1).review.findings.some(f=>f.location==='Пропорції кольорового декору'));
});
test('progress keeps format checking and correction inside the active master stage',()=>{
  for(const stage of ['master-check','master-correct','master-recheck']){
    const state=generationState({aiJob:{action:'generate',status:'running',stage}});
    assert.deepEqual(state.stages.map(s=>s.state),['done','done','active','waiting','waiting']);assert.match(state.current.label,/пропорцій/);
  }
});
test('format notice reports limitations and cannot reuse a check for a different image or changed dimensions',()=>{
  const p=project(),check=assessMasterFormat(p,{pixel_dimensions:[1000,1000],sha256:'old'},visual());
  p.aiData={masterFormat:{target:masterFormatSpec(p),checks:[check],correctionAttempted:true},assetMetadata:{master:{sha256:'old'}}};
  assert.match(masterFormatNotice(p,{esc:String}),/потребують виправлення/);assert.match(masterFormatNotice(p,{esc:String}),/одну спробу/);
  p.aiData.assetMetadata.master.sha256='new';assert.match(masterFormatNotice(p,{esc:String}),/ще не підтверджено/);
  p.width=250;assert.match(masterFormatNotice(p,{esc:String}),/попереднім параметрам/);
  const positive=report();applyFormatReview(positive,{target:masterFormatSpec(project()),checks:[check]});assert.equal(positive.disposition,'changes_required');
  p.width=200;p.aiData={masterFormat:{target:masterFormatSpec(p),checks:{}}};assert.doesNotThrow(()=>masterFormatNotice(p,{esc:String}));
  p.aiData.masterFormat.checks=[{status:'pass',observation:'',canvas:{dimensions:['<img src=x>',100]}}];assert.doesNotMatch(masterFormatNotice(p,{esc:String}),/<img/);
});

test('visual reviewer failures preserve pixel checks while cancellation is never converted into a retry',async()=>{
  const args={project:project(),artifact:{pixel_dimensions:[1024,1024]},master:'master.png',template:'template.png',ask:async()=>{throw Error('Reviewer unavailable');}};
  const checked=await inspectMasterFormat(args);assert.equal(checked.canvas.status,'changes_required');assert.equal(checked.panel.status,'not_checked');assert.match(checked.observation,/Reviewer unavailable/);
  const controller=new AbortController();controller.abort();await assert.rejects(inspectMasterFormat({...args,signal:controller.signal}),/Reviewer unavailable/);
});
