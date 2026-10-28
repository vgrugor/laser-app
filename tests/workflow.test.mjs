import { flatComposition, passingCompositionChecks } from './fixtures/composition.mjs';
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
    if(name==='plan')return {summary:'Квітка',parts:[{name:'Пелюстки',finish_id:'clear',quantity:7,layer:'top'}],engraving:['Чорні прожилки'],composition:'Центр',spatial_composition:flatComposition,manual_checks:['Ширини у CAD']};
    if(name==='prompts')return {master:'Декор фронтально',preview:'Весь виріб'};
    if(name==='master-check')return {verdict:'pass',panel_bounds:{left:.04,top:.04,right:.96,bottom:.96},observation:'Пропорції відповідають шаблону',suggested_action:''};
    if(name==='review')return {disposition:'changes_required',findings:[{severity:'blocker',location:'Око',observation:'Світла лінія',suggested_action:'Замінити чорною'}],composition_checks:passingCompositionChecks(),manual_checks:['2 мм у CAD']};
    const path=resolve(dir,name+'-generated.png');await writeFile(path,await readFile(resolve(dir,'format-template.png')));return 'GENERATED_IMAGE '+path;
  };
  const partials=[];
  const result=await workflow({root,directory:dir,action:'generate',project,run,signal:new AbortController().signal,stage:async n=>stages.push(n),save:{event(){},file:async()=>{},partial:async r=>partials.push(structuredClone(r))}});
  assert.deepEqual(stages,['plan','prompts','master','master-check','preview','review']);
  assert.equal(calls[4].images[0],resolve(dir,'master.png'));
  assert.equal(calls[5].images.length,2);assert.equal(result.review.disposition,'changes_required');assert.ok(result.assetMetadata.master.sha256);assert.equal(partials.filter(x=>x.assets.master).length,3);assert.ok(partials[0].planning?.planHash);assert.ok(partials[1].planning?.promptsHash);
  assert.equal(result.knowledge.manifestHash.length,64);
});
test('edit uses existing master as first reference; failures retain completed master',async t=>{
  const dir=await temp(t),stages=[],partials=[];
  const run=async o=>{
    const name=stages.at(-1);
    if(name==='plan')return {parts:[{name:'Мотив',finish_id:'clear',quantity:1,layer:'top'}],spatial_composition:flatComposition};
    if(name==='prompts')return {master:'Правка',preview:'Виріб'};
    if(name==='master-check')return {verdict:'pass',panel_bounds:{left:.04,top:.04,right:.96,bottom:.96},observation:'Пропорції відповідають',suggested_action:''};
    if(name==='master'){assert.equal(o.images[0],resolve(dir,'input-master.png'));const path=resolve(dir,'edited.png');await writeFile(path,await readFile(resolve(dir,'format-template.png')));return 'EDITED_IMAGE '+path;}
    throw Error('Generator unavailable');
  };
  await assert.rejects(workflow({root,directory:dir,action:'edit',project:{...project,assets:{master:'data:image/png;base64,'+png.toString('base64')}},run,signal:new AbortController().signal,stage:async n=>stages.push(n),save:{event(){},file:async()=>{},partial:async r=>partials.push(structuredClone(r))}}),/unavailable/);
  assert.equal(partials.find(x=>x.assets.master)?.assets.master,'master.png');assert.ok(await readFile(resolve(dir,'master.png')));
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

test('in-process panel job preserves partial files, scope and preparation across cancellation and server recovery',async t=>{
  const {Readable}=await import('node:stream');
  const directory=await temp(t);await mkdir(resolve(directory,'dist'));
  await writeFile(resolve(directory,'dist/product-types.json'),await readFile(resolve(root,'dist/product-types.json')));
  const input={...structuredClone(project),generationTarget:'panel',scopePanelId:'wall',panels:[
    {id:'lid',name:'Кришка',width:160,height:120,assets:{master:'data:image/png;base64,'+png.toString('base64')}},
    {id:'wall',name:'Стінка',width:160,height:60,assets:{master:null}}
  ]};
  const partial={generationTarget:'panel',scopePanelId:'wall',assets:{},sharedPlan:{signature:'shared',content:{summary:'Keep this plan'}},panels:[{id:'wall',assets:{master:'panel-2-master.png'},plan:{parts:[]},planning:{signature:'local'}}]};
  let executions=0;
  const app=await createApp({root:directory,run:()=>{throw Error('No real inference');},runWorkflow:async({directory,signal,stage,save})=>{
    executions++;await stage({stage:'master-check',panelId:'wall',panelName:'Стінка',panelIndex:2,panelCount:2});
    await writeFile(resolve(directory,'panel-2-master.png'),png);await save.partial(partial);
    await new Promise((resolve,reject)=>{if(signal.aborted)reject(Error('Cancelled'));else signal.addEventListener('abort',()=>reject(Error('Cancelled')),{once:true});});
  }});
  t.after(()=>app.close());app.server.address=()=>({port:8765});
  function request(path,method='GET',data,headers={}){
    const req=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[]);Object.assign(req,{url:path,method,headers:{host:'127.0.0.1:8765',...headers}});
    return new Promise(resolve=>app.server.emit('request',req,{status:200,setHeader(){},writeHead(status){this.status=status;},end(body){resolve({status:this.status,body,data:body&&String(body).startsWith('{')?JSON.parse(body):null});}}));
  }
  const token=(await request('/api/status')).data.token,headers={'x-plywood-token':token},body={action:'generate',project:input};
  assert.equal((await request('/api/jobs','POST',body)).status,403);assert.equal((await request('/api/jobs','POST',body,{...headers,origin:'https://evil.example'})).status,403);
  const submitted=await request('/api/jobs','POST',body,headers);assert.equal(submitted.status,202);const {id}=submitted.data;
  assert.equal((await request('/api/jobs','POST',body,headers)).status,409);
  let job;for(let i=0;i<100;i++){job=(await request('/api/jobs/'+id)).data;if(job.result)break;await new Promise(r=>setTimeout(r,5));}
  assert.equal(executions,1);assert.equal(job.panelId,'wall');assert.deepEqual(job.result,partial);
  assert.deepEqual((await request('/api/assets/'+id+'/panel-2-master.png')).body,png);
  const savedRequest=JSON.parse(await readFile(resolve(directory,'artifacts/runs',id,'request.json')));
  assert.equal(savedRequest.project.scopePanelId,'wall');assert.equal(savedRequest.project.generationTarget,'panel');
  assert.equal((await request('/api/jobs/'+id+'/cancel','POST',null,headers)).status,200);
  let disk;for(let i=0;i<100;i++){disk=JSON.parse(await readFile(resolve(directory,'artifacts/runs',id,'job.json')));if(disk.status==='cancelled')break;await new Promise(r=>setTimeout(r,5));}
  assert.equal(disk.status,'cancelled');assert.deepEqual(disk.result,partial);
  disk.status='running';await writeFile(resolve(directory,'artifacts/runs',id,'job.json'),JSON.stringify(disk));
  const recovered=await createApp({root:directory,run:()=>{throw Error('No inference on recovery');}});t.after(()=>recovered.close());
  assert.equal(recovered.jobs.get(id).status,'interrupted');assert.deepEqual(recovered.jobs.get(id).result,partial);
  assert.deepEqual(await readFile(resolve(directory,'artifacts/runs',id,'panel-2-master.png')),png);
});
