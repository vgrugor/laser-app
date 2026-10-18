import test from 'node:test';
import assert from 'node:assert/strict';
import { createAI } from '../dist/ai.js';

function setup(t,respond){
  const originalFetch=globalThis.fetch,originalDocument=globalThis.document;
  t.after(()=>{globalThis.fetch=originalFetch;globalThis.document=originalDocument;});
  globalThis.document={querySelector:()=>null};
  const p={id:'p1',title:'Лис',type:'Панно',width:160,height:120,brief:'Лис у лісі',palette:['clear','pine'],layers:2,frame:'engraved',reference:null,assets:{master:'old',preview:'old'},notes:[],locks:[],selected:null,concepts:[],versions:[],approved:true};
  const snapshots=[],messages=[];let renders=0;
  globalThis.fetch=async (path,options)=>({ok:true,json:async()=>path==='/api/status'?{provider:'codex-sdk',token:'test'}:path==='/api/jobs'?{id:'job1'}:respond(p,path,options)});
  const ai=createAI({current:()=>p,projects:()=>[p],persist:async()=>{},snapshot:async x=>snapshots.push(structuredClone(x)),render:()=>renders++,toast:m=>messages.push(m),esc:String,validate:()=>true});
  return {ai,p,snapshots,messages,get renders(){return renders;}};
}
const concepts=Array.from({length:10},(_,i)=>({title:`Ідея ${i}`,description:'Лис',frame:'engraved',palette:['clear']}));
test('client applies concepts, snapshots previous revision and resets approval',async t=>{
  const {ai,p,snapshots}=setup(t,()=>({id:'job1',status:'completed',stage:'concepts',result:{concepts}}));
  await ai.start('concepts');assert.equal(p.concepts.length,10);assert.equal(p.approved,false);assert.equal(p.aiJob.status,'completed');assert.equal(snapshots.length,1);assert.deepEqual(p.pendingAssetsUpdate,['master','preview']);
});
test('a late reply cannot overwrite a project changed during inference',async t=>{
  const {ai,p,snapshots}=setup(t,p=>{p.brief='Новий задум';return {id:'job1',status:'completed',stage:'concepts',result:{concepts}};});
  await ai.start('concepts');assert.equal(p.concepts.length,0);assert.equal(p.brief,'Новий задум');assert.equal(p.aiJob.status,'stale');assert.equal(snapshots.length,0);
});
test('client displays failure and allows retry instead of leaving a running job',async t=>{
  const {ai,p}=setup(t,()=>({id:'job1',status:'failed',stage:'plan',error:'Потрібен Terminal',result:null}));
  await ai.start('generate');assert.equal(p.aiJob.status,'failed');assert.equal(p.aiJob.error,'Потрібен Terminal');assert.equal(p.assets.master,'old');
});
test('a review never grants user approval, findings become explicit revision notes',async t=>{
  const review={disposition:'changes_required',findings:[{severity:'blocker',location:'Край',observation:'Світле гравіювання',suggested_action:'Зробити чорним'}],manual_checks:['Геометрія']};
  const {ai,p}=setup(t,()=>({id:'job1',status:'completed',stage:'review',result:{review}}));
  p.aiData={plan:{summary:'Погоджена конструкція'},prompts:{master:'Промпт декору'},assets:{master:'master.png'}};
  await ai.start('review');assert.equal(p.approved,false);assert.equal(p.aiReport.disposition,'changes_required');
  assert.equal(p.aiData.prompts.master,'Промпт декору');assert.equal(p.aiData.plan.summary,'Погоджена конструкція');
  await ai.action('use-findings');assert.equal(p.notes.length,1);assert.deepEqual(p.pendingAssetsUpdate,['master','preview']);
});
