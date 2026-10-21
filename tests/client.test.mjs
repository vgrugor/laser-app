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
  assert.equal(p.route.current,'concepts');
});
test('navigation during inference neither invalidates the result nor changes project inputs',async t=>{
  const {ai,p}=setup(t,p=>{p.route={version:1,current:'brief'};return {id:'job1',status:'completed',stage:'concepts',result:{concepts}};});
  await ai.start('concepts');
  assert.equal(p.aiJob.status,'completed');assert.equal(p.concepts.length,10);assert.equal(p.route.current,'concepts');
});
test('early steps expose progress and concept failure without showing future generation actions',t=>{
  const {ai,p}=setup(t,()=>({}));p.route={version:2,current:'brief'};
  assert.equal(ai.panel(p),'');
  p.aiJob={id:'job',action:'concepts',status:'running',stage:'concepts'};
  assert.match(ai.panel(p),/ai-cancel/);assert.doesNotMatch(ai.panel(p),/ai-generate|ai-review|ai-edit/);
  p.route.current='palette';p.aiJob.status='failed';p.aiJob.error='Тестова помилка';
  assert.match(ai.panel(p),/Тестова помилка/);assert.doesNotMatch(ai.panel(p),/ai-generate|ai-review|ai-edit/);
});
test('a late reply cannot overwrite a project changed during inference',async t=>{
  const {ai,p,snapshots}=setup(t,p=>{p.brief='Новий задум';return {id:'job1',status:'completed',stage:'concepts',result:{concepts}};});
  await ai.start('concepts');assert.equal(p.concepts.length,0);assert.equal(p.brief,'Новий задум');assert.equal(p.aiJob.status,'stale');assert.equal(snapshots.length,0);
});
test('client displays failure and allows retry instead of leaving a running job',async t=>{
  const {ai,p}=setup(t,()=>({id:'job1',status:'failed',stage:'plan',error:'Потрібен Terminal',result:null}));
  await ai.start('generate');assert.equal(p.aiJob.status,'failed');assert.equal(p.aiJob.error,'Потрібен Terminal');assert.equal(p.assets.master,'old');
});
test('one-click concept generation sends its colors while retaining the source set and old images on failure',async t=>{
  const {ai,p}=setup(t,()=>({id:'job1',status:'failed',stage:'plan',error:'Тестова помилка',result:null}));
  p.palette=['clear','pine','black'];p.selected='chosen';
  p.concepts=[{id:'chosen',title:'Силует',palette:['clear','black'],frame:'cut'}, {id:'other',title:'Стежка',palette:['pine'],frame:'engraved'}];
  p.resultDraft={text:'Ще не застосований текст',open:true};
  const original=structuredClone(p);let sent;
  const request=globalThis.fetch;globalThis.fetch=(path,options)=>{if(path==='/api/jobs')sent=JSON.parse(options.body);return request(path,options);};
  await ai.start('generate');
  assert.equal(sent.action,'generate');assert.deepEqual(sent.project.palette,['clear','black']);assert.equal(sent.project.frame,'cut');
  assert.equal(sent.project.resultDraft,undefined);
  assert.deepEqual(p.palette,original.palette);assert.deepEqual(p.concepts,original.concepts);assert.deepEqual(p.assets,original.assets);
  assert.equal(p.route.current,'generation');assert.equal(p.aiJob.status,'failed');
});
test('a review never grants user approval, findings become explicit revision notes',async t=>{
  const review={disposition:'changes_required',findings:[{severity:'blocker',location:'Край',observation:'Світле гравіювання',suggested_action:'Зробити чорним'}],manual_checks:['Геометрія']};
  const {ai,p}=setup(t,()=>({id:'job1',status:'completed',stage:'review',result:{review}}));
  p.aiData={plan:{summary:'Погоджена конструкція'},prompts:{master:'Промпт декору'},assets:{master:'master.png'}};
  await ai.start('review');assert.equal(p.approved,false);assert.equal(p.aiReport.disposition,'changes_required');
  assert.equal(p.aiData.prompts.master,'Промпт декору');assert.equal(p.aiData.plan.summary,'Погоджена конструкція');
  await ai.action('use-findings');assert.equal(p.notes.length,1);assert.deepEqual(p.pendingAssetsUpdate,['master','preview']);
});

test('reconnecting polls the same job, cancellation is sent once, and no duplicate generation starts',async t=>{
  let offline=false;
  const {ai,p}=setup(t,()=>{if(offline)throw Error('Offline');return {id:'job1',status:'running',stage:'preview',result:{assets:{master:'master.png'}}};});
  let starts=0,cancels=0;
  const request=globalThis.fetch;globalThis.fetch=(path,options)=>{if(path==='/api/jobs')starts++;if(path.endsWith('/cancel'))cancels++;return request(path,options);};
  await ai.start('generate');assert.deepEqual(p.aiJob.availableAssets,['master']);assert.equal(p.aiJob.stage,'preview');
  offline=true;await ai.action('reconnect');
  assert.equal(p.aiJob.status,'running');assert.match(ai.generation(p),/Зв’язок із сервером перервано/);
  offline=false;await ai.action('reconnect');assert.equal(starts,1);assert.equal(p.aiJob.id,'job1');
  await ai.action('cancel');await ai.action('cancel');
  assert.equal(cancels,1);assert.equal(p.aiJob.status,'running');assert.equal(p.aiJob.cancelRequested,true);
  assert.match(ai.generation(p),/Очікуємо зупинки/);
});

test('job creation errors remain visible on the generation screen and preserve existing images',async t=>{
  const {ai,p}=setup(t,()=>({}));
  const request=globalThis.fetch;globalThis.fetch=(path,options)=>path==='/api/jobs'?Promise.resolve({ok:false,json:async()=>({error:'Сервер зайнятий'})}):request(path,options);
  await ai.start('generate');assert.equal(p.aiJob,undefined);assert.equal(p.route.current,'generation');
  assert.equal(p.aiLaunchError,'Сервер зайнятий');
  assert.equal(p.assets.master,'old');assert.match(ai.generation(p),/Сервер зайнятий/);
  assert.match(ai.generation(p),/Повторити генерацію/);
});

test('a partial new master opens the result, keeps the old preview marked outdated and snapshots the previous pair',async t=>{
  const {ai,p,snapshots}=setup(t,()=>({id:'job1',status:'failed',stage:'preview',error:'Вигляд не створено',result:{assets:{master:'master.png'},plan:{summary:'Новий план'}}}));
  const oldReader=globalThis.FileReader;t.after(()=>globalThis.FileReader=oldReader);
  globalThis.FileReader=class { readAsDataURL(){this.result='data:image/png;base64,bmV3';this.onload();} };
  const request=globalThis.fetch;globalThis.fetch=(path,options)=>path.startsWith('/api/assets/')?Promise.resolve({ok:true,blob:async()=>new Blob(['new'])}):request(path,options);
  await ai.start('generate');
  assert.equal(p.assets.master,'data:image/png;base64,bmV3');assert.equal(p.assets.preview,'old');
  assert.deepEqual(p.pendingAssetsUpdate,['preview']);assert.deepEqual(p.aiJob.appliedAssets,['master']);
  assert.equal(p.route.current,'result');assert.equal(p.aiJob.status,'failed');
  assert.equal(snapshots[0].assets.master,'old');assert.equal(snapshots[0].assets.preview,'old');
});

test('retrying an edit whose job could not be created preserves editing mode',async t=>{
  const {ai,p}=setup(t,()=>({id:'job1',status:'failed',stage:'plan',error:'Test',result:null}));
  p.notes=['Змінити рамку'];p.aiJob={id:'old',action:'generate',status:'completed'};
  const request=globalThis.fetch,actions=[];
  globalThis.fetch=(path,options)=>{
    if(path==='/api/jobs'){actions.push(JSON.parse(options.body).action);if(actions.length===1)return Promise.resolve({ok:false,json:async()=>({error:'Тимчасова помилка'})});}
    return request(path,options);
  };
  await ai.start('edit');await ai.action('retry-generation');
  assert.deepEqual(actions,['edit','edit']);assert.equal(p.assets.master,'old');
});

test('launch preflight can redirect work to a variant without changing the accepted source',async t=>{
  const originalFetch=globalThis.fetch,originalDocument=globalThis.document;
  t.after(()=>{globalThis.fetch=originalFetch;globalThis.document=originalDocument;});
  globalThis.document={querySelector:()=>null};
  const parent={id:'parent',title:'Оригінал',approved:true,assets:{master:'old',preview:'old'},palette:['clear'],notes:[],concepts:[],versions:[]};
  const child={...structuredClone(parent),id:'child',approved:false};let active=parent,sent;
  globalThis.fetch=async(path,options)=>({ok:true,json:async()=>path==='/api/status'?{provider:'codex-sdk',token:'test'}:path==='/api/jobs'?(sent=JSON.parse(options.body),{id:'job-child'}):{id:'job-child',status:'failed',stage:'plan',error:'test',result:null}});
  const before=structuredClone(parent),ai=createAI({prepareStart:async()=>{active=child;return child;},current:()=>active,projects:()=>[parent,child],persist:async()=>{},snapshot:async()=>{},render:()=>{},toast:()=>{},esc:String,validate:()=>true});
  await ai.start('generate');assert.deepEqual(parent,before);assert.equal(sent.project.id,'child');assert.equal(child.aiJob.status,'failed');
});
test('cancelled preflight creates no job or generation state',async t=>{
  const {p}=setup(t,()=>({}));const before=structuredClone(p);let calls=0;
  const ai=createAI({prepareStart:async()=>null,current:()=>p,projects:()=>[p],persist:async()=>{calls++;},snapshot:async()=>{},render:()=>{},toast:()=>{},esc:String,validate:()=>true});
  await ai.start('generate');assert.deepEqual(p,before);assert.equal(calls,0);
});

test('concept launch failures remain inline and do not masquerade as image generation failures',async t=>{
  const {ai,p}=setup(t,()=>({}));p.route={version:2,current:'palette'};
  const request=globalThis.fetch;globalThis.fetch=(path,options)=>path==='/api/jobs'?Promise.resolve({ok:false,json:async()=>({error:'Сервер зайнятий'})}):request(path,options);
  await ai.start('concepts');assert.equal(p.aiJob,undefined);assert.equal(p.aiLaunchErrorAction,'concepts');assert.equal(p.aiLaunchError,'Сервер зайнятий');assert.match(ai.panel(p),/Не вдалося розпочати створення концепцій/);assert.match(ai.panel(p),/Сервер зайнятий/);
  assert.doesNotMatch(ai.generation(p),/Не вдалося розпочати генерацію/);
});
test('connection loss on early steps offers reconnection to the same task',async t=>{
  const {ai,p}=setup(t,()=>{throw Error('offline');});p.route={version:2,current:'palette'};
  await ai.start('concepts');assert.equal(p.aiJob.status,'running');assert.match(ai.panel(p),/Зв’язок із сервером перервано/);assert.match(ai.panel(p),/data-action="ai-reconnect"/);
});

test('failed review launch keeps its error visible and preserves the previous image retry mode',async t=>{
  const {ai,p}=setup(t,()=>({}));p.aiLaunchAction='edit';p.aiJob={action:'edit',status:'failed',stage:'preview'};
  const request=globalThis.fetch;globalThis.fetch=(path,options)=>path==='/api/jobs'?Promise.resolve({ok:false,json:async()=>({error:'Спробуйте пізніше'})}):request(path,options);
  await ai.start('review');assert.equal(p.aiLaunchAction,'edit');assert.equal(ai.resultContext().reviewLaunchError,'Спробуйте пізніше');
  const {resultInspector}=await import('../dist/result.js');assert.match(resultInspector(p,{esc:String,...ai.resultContext()}),/Не вдалося розпочати перевірку: Спробуйте пізніше/);
});

test('starting concepts opens their step before connecting, and stays there while the job runs or fails',async t=>{
  const {paletteSignature}=await import('../dist/palette-confirmation.js');
  const {ai,p}=setup(t,()=>({id:'job1',status:'running',stage:'concepts',result:null}));
  p.approved=false;p.concepts=[];p.assets={master:null,preview:null};p.route={version:2,current:'palette'};p.paletteConfirmation={signature:paletteSignature(p)};
  const request=globalThis.fetch;let release,arrived;
  const connecting=new Promise(resolve=>arrived=resolve);
  globalThis.fetch=(path,options)=>path==='/api/status'?new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({provider:'codex-sdk',token:'test'})});arrived();}):request(path,options);
  const start=ai.start('concepts');await connecting;
  assert.equal(p.route.current,'concepts');assert.equal(p.aiJob,undefined);assert.equal(ai.isLaunching(p),true);
  release();await start;assert.equal(p.route.current,'concepts');assert.equal(p.aiJob.status,'running');assert.equal(ai.isLaunching(p),false);
  globalThis.fetch=(path,options)=>path==='/api/status'?request(path,options):path==='/api/jobs/job1'?Promise.resolve({ok:true,json:async()=>({id:'job1',status:'failed',stage:'concepts',error:'Test',result:null})}):request(path,options);
  await ai.action('reconnect');assert.equal(p.route.current,'concepts');assert.equal(p.aiJob.status,'failed');
});
