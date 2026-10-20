import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { workflow, validateProject, validateResult, collectImage, saveInput, loadKnowledge } from '../server/workflow.mjs';
import { createApp } from '../server/index.mjs';

const root=resolve(import.meta.dirname,'..');
const project={id:'test-project',title:'Магнолія',type:'Панно',brief:'Квітка з широкими пелюстками',width:160,height:120,layers:2,frame:'engraved',palette:['clear','pine','black'],notes:[],locks:[],concepts:[],assets:{},reference:null};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1cAAAAASUVORK5CYII=','base64');
async function temp(t){const dir=await mkdtemp(resolve(tmpdir(),'plywood-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}

test('reject impossible stock, palettes and construction before inference',()=>{
  assert.ok(validateProject(project));
  for(const patch of [{width:301,height:401},{palette:['white']},{palette:['clear','pine','alder','walnut']},{layers:1},{notes:['x'.repeat(4001)]}])assert.throws(()=>validateProject({...project,...patch}));
  assert.throws(()=>validateResult('concepts',{concepts:[]},project));
  assert.throws(()=>validateResult('plan',{parts:[{finish_id:'white',quantity:1,layer:'top'}]},project));
});
test('knowledge uses actual manifest and palette hashes',async()=>{
  const k=await loadKnowledge(root);assert.equal(k.version,'1.0');assert.match(k.paletteHash,/^[a-f0-9]{64}$/);assert.ok(k.text.includes('Гравіювання'));assert.ok(k.files.includes('об’єкти/людина.md'));
});
test('image paths and bytes must be verified, never trust a model path',async t=>{
  const dir=await temp(t),outside=await temp(t);await writeFile(resolve(dir,'valid.png'),png);await writeFile(resolve(outside,'outside.png'),png);
  assert.equal((await collectImage('GENERATED_IMAGE '+resolve(dir,'valid.png'),dir,resolve(dir,'missing'))).bytes.length,png.length);
  await assert.rejects(collectImage('GENERATED_IMAGE '+resolve(outside,'outside.png'),dir,resolve(dir,'missing')),/поза/);
  await assert.rejects(collectImage('I generated it!',dir),/I generated/);
  await assert.rejects(saveInput(root,dir,'reference','file:///etc/passwd'),/Недозволене/);
  await assert.rejects(saveInput(root,dir,'reference','data:image/png;base64,'+Buffer.from('not a png image').toString('base64')),/формату/);
});
test('generation runs plan → prompts → master → preview → pair review and keeps provenance',async t=>{
  const dir=await temp(t),stages=[],calls=[];
  const run=async options=>{
    calls.push(options);const name=stages.at(-1);
    if(name==='plan')return {summary:'Квітка',parts:[{name:'Пелюстки',finish_id:'clear',quantity:7,layer:'top'}],engraving:['Чорні прожилки'],composition:'Центр',manual_checks:['Ширини у CAD']};
    if(name==='prompts')return {master:'Декор фронтально',preview:'Весь виріб'};
    if(name==='review')return {disposition:'changes_required',findings:[{severity:'blocker',location:'Око',observation:'Світла лінія',suggested_action:'Замінити чорною'}],manual_checks:['2 мм у CAD']};
    const path=resolve(dir,name+'-generated.png');await writeFile(path,png);return 'GENERATED_IMAGE '+path;
  };
  const partials=[];
  const result=await workflow({root,directory:dir,action:'generate',project,run,signal:new AbortController().signal,stage:async n=>stages.push(n),save:{event(){},file:async()=>{},partial:async r=>partials.push(structuredClone(r))}});
  assert.deepEqual(stages,['plan','prompts','master','preview','review']);
  assert.equal(calls[3].images[0],resolve(dir,'master.png'));
  assert.equal(calls[4].images.length,2);assert.equal(result.review.disposition,'changes_required');assert.ok(result.assetMetadata.master.sha256);assert.equal(partials.length,2);
  assert.equal(result.knowledge.manifestHash.length,64);
});
test('edit uses existing master as first reference; failures retain completed master',async t=>{
  const dir=await temp(t),stages=[],partials=[];
  const run=async o=>{
    const name=stages.at(-1);
    if(name==='plan')return {parts:[{finish_id:'clear',quantity:1,layer:'top'}]};
    if(name==='prompts')return {master:'Правка',preview:'Виріб'};
    if(name==='master'){assert.equal(o.images[0],resolve(dir,'input-master.png'));const path=resolve(dir,'edited.png');await writeFile(path,png);return 'EDITED_IMAGE '+path;}
    throw Error('Generator unavailable');
  };
  await assert.rejects(workflow({root,directory:dir,action:'edit',project:{...project,assets:{master:'data:image/png;base64,'+png.toString('base64')}},run,signal:new AbortController().signal,stage:async n=>stages.push(n),save:{event(){},file:async()=>{},partial:async r=>partials.push(structuredClone(r))}}),/unavailable/);
  assert.equal(partials[0].assets.master,'master.png');assert.ok(await readFile(resolve(dir,'master.png')));
});
test('local HTTP lifecycle, anti-CSRF, cancellation and restart recovery',async t=>{
  const dir=await temp(t);await mkdir(resolve(dir,'dist'));await writeFile(resolve(dir,'dist/index.html'),'<h1>Test</h1>');await writeFile(resolve(dir,'dist/product-types.json'),await readFile(resolve(root,'dist/product-types.json')));
  let inference=0;
  const app=await createApp({root:dir,run:()=>{},runWorkflow:async({signal,stage})=>{inference++;await stage('concepts');await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const origin='http://127.0.0.1:'+app.server.address().port;
  const status=await (await fetch(origin+'/api/status')).json();
  assert.equal((await fetch(origin+'/api/jobs',{method:'POST',body:'{}'})).status,403);
  assert.equal((await fetch(origin+'/api/status',{headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(origin+'/.git/config')).status,404);
  const options={method:'POST',headers:{'Content-Type':'application/json','X-Plywood-Token':status.token},body:JSON.stringify({action:'concepts',project})};
  const response=await fetch(origin+'/api/jobs',options);assert.equal(response.status,202);const {id}=await response.json();
  assert.equal((await fetch(origin+'/api/jobs',options)).status,409);
  assert.equal(inference,1);
  await fetch(origin+`/api/jobs/${id}/cancel`,{method:'POST',headers:{'X-Plywood-Token':status.token}});
  let final;for(let i=0;i<20;i++){final=await(await fetch(origin+`/api/jobs/${id}`)).json();if(final.status==='cancelled')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(final.status,'cancelled');
  const disk=JSON.parse(await readFile(resolve(dir,'artifacts/runs',id,'job.json')));assert.equal(disk.status,'cancelled');
  disk.status='running';await writeFile(resolve(dir,'artifacts/runs',id,'job.json'),JSON.stringify(disk));
  const recovered=await createApp({root:dir,run:()=>{}});assert.equal(recovered.jobs.get(id).status,'interrupted');await recovered.close();
});
