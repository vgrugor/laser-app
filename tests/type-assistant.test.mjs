import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { validateAssistantRequest,validateAssistantResult,runTypeAssistant } from '../server/type-assistant.mjs';
import { loadCatalog } from '../server/catalog.mjs';
import { createApp } from '../server/index.mjs';
import { draftToType,createTypeAssistant } from '../dist/type-assistant.js';

const root=resolve(import.meta.dirname,'..');
const questions={status:'questions',similarTypes:[{id:'panel',reason:'Може бути варіантом панно'}],questions:[{id:'mount',prompt:'Як встановлюється виріб?'}],draft:null,assumptions:[]};
const draft={status:'draft',similarTypes:[],questions:[],assumptions:['Можливий підвіс'],draft:{name:'Органайзер',description:'Для канцелярії',requirements:['Фанера 3 мм'],recommendations:['Зберегти баланс'],unknowns:['Розмір кріплень'],previewInstructions:'Показати весь виріб',masterInstructions:'Показати лише декор'}};
async function fixture(t){const dir=await mkdtemp(resolve(tmpdir(),'plywood-assistant-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(resolve(dir,'dist'));await writeFile(resolve(dir,'dist/product-types.json'),await readFile(resolve(root,'dist/product-types.json')));return dir;}

test('assistant validates questions and refuses fabricated existing IDs or incomplete drafts',async()=>{
  const catalog=await loadCatalog(root);assert.ok(validateAssistantResult(questions,catalog));assert.ok(validateAssistantResult(draft,catalog));
  assert.throws(()=>validateAssistantResult({...questions,similarTypes:[{id:'invented',reason:'Щось'}]},catalog));
  assert.throws(()=>validateAssistantResult({...questions,questions:[]},catalog));
  assert.throws(()=>validateAssistantResult({...draft,draft:null},catalog));
  assert.throws(()=>validateAssistantRequest({description:'',answers:[]}));
  assert.throws(()=>validateAssistantRequest({description:'Тип',answers:[{question:'Питання',answer:''}]}));
});
test('assistant sends prior answers and never publishes its result into the catalog',async t=>{
  const directory=await fixture(t),catalog=await loadCatalog(root),before=await readFile(resolve(directory,'dist/product-types.json'));
  let options;
  const result=await runTypeAssistant({root,directory,catalog,assistant:{description:'Органайзер для канцелярії',answers:[{question:'Як встановлюється?',answer:'На стіні'}],finishWithUnknowns:true},run:async input=>{options=input;return draft;},signal:new AbortController().signal,stage:async()=>{},save:{event(){},file:async()=>{}}});
  assert.ok(options.text.includes('На стіні'));assert.ok(options.schema);assert.equal(result.assistant.status,'draft');assert.equal(result.catalogRevision,catalog.revision);assert.ok(before.equals(await readFile(resolve(directory,'dist/product-types.json'))));
  const card=draftToType(result.assistant);assert.ok(card.rules.includes('Непідтверджені припущення'));assert.ok(card.rules.includes('Розмір кріплень'));assert.equal(card.id,undefined);
});
test('explicit finish-with-unknowns cannot silently return another question loop',async t=>{
  const directory=await fixture(t),catalog=await loadCatalog(root);
  await assert.rejects(runTypeAssistant({root,directory,catalog,assistant:{description:'Органайзер',answers:[],finishWithUnknowns:true},run:async()=>questions,signal:new AbortController().signal,stage:async()=>{},save:{event(){},file:async()=>{}}}),/не підготував/);
});
test('job API routes assistant separately from product generation and leaves catalog unchanged',async t=>{
  const directory=await fixture(t),knowledge=resolve(directory,'docs');await mkdir(knowledge,{recursive:true});
  // The real assistant loads general rules; use the verified project knowledge as a fixture.
  const {cp}=await import('node:fs/promises');await cp(resolve(root,'docs/база-знань-v1'),resolve(directory,'docs/база-знань-v1'),{recursive:true});
  const before=await readFile(resolve(directory,'dist/product-types.json'));
  const app=await createApp({root:directory,run:async()=>draft});t.after(()=>app.close());app.server.address=()=>({port:8765});
  function request(path,method='GET',data,headers={}){const req=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[]);Object.assign(req,{url:path,method,headers:{host:'127.0.0.1:8765',...headers}});return new Promise(resolve=>app.server.emit('request',req,{status:200,setHeader(){},writeHead(status){this.status=status;},end(bytes){resolve({status:this.status,data:JSON.parse(bytes)});}}));}
  const health=await request('/api/status');const headers={'x-plywood-token':health.data.token};
  assert.equal((await request('/api/jobs','POST',{action:'type-assistant',assistant:{description:'',answers:[]}},headers)).status,400);
  const response=await request('/api/jobs','POST',{action:'type-assistant',assistant:{description:'Органайзер',answers:[],finishWithUnknowns:true}},headers);assert.equal(response.status,202);
  const id=response.data.id;
  for(let i=0;i<100&&app.jobs.get(id).status==='running';i++)await new Promise(resolve=>setTimeout(resolve,5));
  const job=(await request('/api/jobs/'+id)).data;assert.equal(job.status,'completed');assert.equal(job.result.assistant.draft.name,'Органайзер');assert.equal(job.projectId,null);
  assert.ok(before.equals(await readFile(resolve(directory,'dist/product-types.json'))));
});

test('wizard keeps answers across rounds and reloads; opening the editor is a separate user action',async t=>{
  const original={document:globalThis.document,localStorage:globalThis.localStorage,fetch:globalThis.fetch};
  t.after(()=>{for(const [key,value] of Object.entries(original))globalThis[key]=value;});
  const storage=new Map(),nodes=new Map();
  globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  globalThis.document={querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',querySelectorAll:()=>[]});return nodes.get(selector);}};
  const sent=[];let round=0,used=null;
  globalThis.fetch=async(path,options)=>({ok:true,json:async()=>{
    if(path==='/api/status')return {token:'test'};
    if(path==='/api/jobs'){sent.push(JSON.parse(options.body));round++;return {id:'12345678-1234-1234-1234-123456789012'};}
    return {status:'completed',result:{assistant:round===1?questions:draft,catalogRevision:1}};
  }});
  const catalog=await loadCatalog(root);const args={esc:String,modal(){},getCatalog:()=>catalog,useDraft:(type,revision)=>{used={type,revision};},openExisting(){}};
  const wizard=createTypeAssistant(args);wizard.open();
  nodes.get('#assistant-description').oninput({target:{value:'Органайзер для канцелярії'}});
  const send=nodes.get('#assistant-send').onclick;await Promise.all([send(),send()]);assert.equal(sent.length,1);
  assert.ok(nodes.get('#type-assistant-content').innerHTML.includes('Як встановлюється виріб?'));
  nodes.get('#assistant-answer-0').oninput({target:{value:'На стіні'}});await nodes.get('#assistant-send').onclick();
  assert.equal(sent[1].assistant.answers[0].answer,'На стіні');assert.equal(used,null);
  const restored=createTypeAssistant(args);restored.open();assert.ok(nodes.get('#type-assistant-content').innerHTML.includes('Чернетка: Органайзер'));
  nodes.get('#assistant-use').onclick();assert.equal(used.type.name,'Органайзер');assert.equal(used.revision,1);
});
