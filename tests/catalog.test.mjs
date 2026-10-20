import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,readdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { loadCatalog,createCatalogStore,catalogHash } from '../server/catalog.mjs';
import { validateProject,workflow } from '../server/workflow.mjs';
import { validateCatalog } from '../dist/product-types.js';
import { createApp } from '../server/index.mjs';
import { Readable } from 'node:stream';

const root=resolve(import.meta.dirname,'..');
const project={title:'Виріб',type:'Панно',brief:'Листя',width:200,height:200,palette:['clear'],frame:'engraved',layers:1,notes:[],locks:[],assets:{}};
async function fixture(t){const directory=await mkdtemp(resolve(tmpdir(),'plywood-catalog-'));t.after(()=>rm(directory,{recursive:true,force:true}));await mkdir(resolve(directory,'dist'));await writeFile(resolve(directory,'dist/product-types.json'),await readFile(resolve(root,'dist/product-types.json')));return directory;}

test('catalog supports legacy projects and mounting variants without a separate server list',async()=>{
  const catalog=await loadCatalog(root);
  for(const type of catalog.types)assert.equal(validateProject({...project,type:type.name},catalog).type,type.name);
  assert.equal(validateProject({...project,type:'Годинник',clockMount:'stand'},catalog).product_parameters.clockMount,'stand');
  assert.throws(()=>validateProject({...project,type:'Годинник',clockMount:'digital'},catalog));
});
test('new type persists with backup and is immediately valid for generation',async t=>{
  const directory=await fixture(t),store=createCatalogStore(directory),catalog=await store.read();
  const next=await store.save({expectedRevision:catalog.revision,type:{id:'lamp',name:'Світильник',description:'Настільний',rules:'Підтверджено: абажур із фанери. Невідомо: розміри фурнітури.'}});
  assert.equal(next.revision,catalog.revision+1);assert.equal(validateProject({...project,type:'Світильник'},await store.read()).type,'Світильник');
  const files=await readdir(resolve(directory,'artifacts/catalog-history'));assert.equal(files.length,1);assert.deepEqual(JSON.parse(await readFile(resolve(directory,'artifacts/catalog-history',files[0]))),catalog);
});
test('conflicting edits, duplicate names and renaming used types cannot overwrite the catalog',async t=>{
  const directory=await fixture(t),store=createCatalogStore(directory),catalog=await store.read(),type=catalog.types[0];
  await store.save({expectedRevision:catalog.revision,type:{...type,rules:'Оновлені правила'}});
  await assert.rejects(store.save({expectedRevision:catalog.revision,type}),/уже змінено/);
  let current=await store.read();
  await assert.rejects(store.save({expectedRevision:current.revision,type:{...type,name:'Нова назва'}}),/Назву/);
  await assert.rejects(store.save({expectedRevision:current.revision,type:{...type,id:'duplicate'}}),/вже існує/);
  assert.equal((await store.read()).revision,current.revision);
  const edits=await Promise.allSettled([store.save({expectedRevision:current.revision,type:{...type,rules:'A'}}),store.save({expectedRevision:current.revision,type:{...type,rules:'B'}})]);
  assert.equal(edits.filter(x=>x.status==='fulfilled').length,1);
});
test('catalog rejects executable-field names and empty rules',async()=>{
  const catalog=await loadCatalog(root);
  for(const patch of [{rules:''},{fields:[{key:'__proto__'}]},{id:'../../file'}])assert.throws(()=>validateCatalog({...catalog,types:[{...catalog.types[0],...patch}]}));
});
test('workflow captures the exact selected type rules and rejects an obsolete client revision',async t=>{
  const catalog=await loadCatalog(root),directory=await fixture(t),type=catalog.types.find(t=>t.name==='Панно');
  type.rules='SELECTED_TYPE_RULES';type.revision=2;
  assert.throws(()=>validateProject({...project,typeRevision:1},catalog),/Правила типу змінено/);
  let prompt='';const result=await workflow({root,directory,action:'concepts',project:{...project,typeRevision:2},catalog,signal:new AbortController().signal,stage:async()=>{},save:{event(){},file:async()=>{}},run:async options=>{prompt=options.text;return {concepts:Array.from({length:10},()=>({title:'Листя',description:'Композиція',frame:'engraved',palette:['clear']}))};}});
  assert.ok(prompt.includes('SELECTED_TYPE_RULES'));assert.equal(result.knowledge.productType.revision,2);assert.equal(result.knowledge.productType.rules,type.rules);assert.equal(result.knowledge.catalogHash,catalogHash(catalog));assert.ok(!result.knowledge.files.some(path=>path.startsWith('вироби/')));
});

test('catalog API requires local origin and write token and serves committed changes',async t=>{
  const directory=await fixture(t),app=await createApp({root:directory,run:async()=>{throw Error('Inference must not run');}});
  t.after(()=>app.close());app.server.address=()=>({port:8765});
  function request(path,method='GET',data,headers={}){
    const req=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[]);req.url=path;req.method=method;req.headers={host:'127.0.0.1:8765',...headers};
    return new Promise(resolve=>{const res={status:200,setHeader(){},writeHead(status){this.status=status;},end(bytes){resolve({status:this.status,data:JSON.parse(bytes)});}};app.server.emit('request',req,res);});
  }
  const status=await request('/api/status'),before=await request('/api/product-types');
  const input={expectedRevision:before.data.revision,type:{id:'test-type',name:'Тестовий тип',description:'Для тесту',rules:'Невідомі розміри уточнюються.'}};
  assert.equal((await request('/api/product-types','POST',input)).status,403);
  assert.equal((await request('/api/product-types','POST',input,{'x-plywood-token':status.data.token,origin:'https://evil.example'})).status,403);
  const saved=await request('/api/product-types','POST',input,{'x-plywood-token':status.data.token});assert.equal(saved.status,200);assert.ok(saved.data.types.some(t=>t.name==='Тестовий тип'));
  assert.equal((await request('/api/product-types')).data.revision,before.data.revision+1);
});
