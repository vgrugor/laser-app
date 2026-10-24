import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { workflow } from '../server/workflow.mjs';
import { createApp } from '../server/index.mjs';
import { tracingFingerprint, refreshTracingFreshness, importedTracing, tracingPanel } from '../dist/tracing.js';
import { approvalSignature } from '../dist/approval.js';
import { createVariant } from '../dist/variants.js';

const root=resolve(import.meta.dirname,'..');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1cAAAAASUVORK5CYII=','base64');
const image='data:image/png;base64,'+png.toString('base64');
const project=()=>({id:'source',title:'Квітка',brief:'Магнолія',type:'Панно',width:160,height:120,layers:2,frame:'cut',palette:['clear','pine'],notes:[],locks:[],concepts:[],assets:{master:image,preview:image},pendingAssetsUpdate:[],versions:[],approved:true,appearanceApproval:{at:'2026-10-24T10:00:00Z'},aiData:{plan:{parts:[{name:'Пелюстка',finish_id:'clear',quantity:7,layer:'top'}],engraving:['Прожилки']}}});
async function directory(t){const dir=await mkdtemp(resolve(tmpdir(),'tracing-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
const report=()=>({disposition:'pass_visual',findings:[],manual_checks:['Масштаб, суміщення і перемички від 2 мм у SolidWorks']});
function inference(dir,stages,{failAt,mismatch=false}={}){
  return async options=>{
    const name=stages.at(-1);
    if(name===failAt)throw Error('Test unavailable');
    if(name==='tracing-review'){assert.equal(options.images.length,2);return report();}
    assert.equal(options.image,true);assert.equal(options.schema,null);assert.equal(options.images[0],resolve(dir,'input-master.png'));
    assert.match(options.text,/ПОХІДНИЙ РИСУНОК/);assert.match(options.text,/Пелюстка/);assert.match(options.text,/без заливки/i);
    assert.equal(options.images.length,1);
    const bytes=Buffer.from(png);if(mismatch&&name==='outline')bytes.writeUInt32BE(2,16);
    const path=resolve(dir,name+'-generated.png');await writeFile(path,bytes);return 'GENERATED_IMAGE '+path;
  };
}
async function generate(t,options={}){
  const dir=await directory(t),stages=[],partials=[],p=project();p.designPlan=p.aiData.plan;
  const args={root,directory:dir,project:p,action:'tracing',run:inference(dir,stages,options),signal:new AbortController().signal,stage:async name=>stages.push(name),save:{event(){},file:async()=>{},partial:async result=>partials.push(structuredClone(result))}};
  return {dir,stages,partials,args};
}

test('tracing derives one combined outline from the existing master and plan, with independent review and provenance',async t=>{
  const {dir,stages,partials,args}=await generate(t),before=structuredClone(args.project),result=await workflow(args);
  assert.deepEqual(stages,['outline','tracing-review']);assert.deepEqual(result.assets,{outline:'outline.png'});
  assert.equal(partials.length,1);assert.equal(partials[0].assets.engraving,undefined);assert.equal(result.review,undefined);assert.equal(result.plan,undefined);
  assert.match(result.sourceMasterHash,/^[a-f0-9]{64}$/);assert.match(result.assetMetadata.outline.sha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(result.tracingReview,report());assert.deepEqual(args.project,before);assert.deepEqual(await readFile(resolve(dir,'input-master.png')),png);
});
test('failure during generation or review preserves only the available combined outline',async t=>{
  for(const failAt of ['outline','tracing-review']){
    const {partials,args}=await generate(t,{failAt});await assert.rejects(workflow(args),/Test unavailable/);
    if(failAt==='outline')assert.equal(partials.length,0);
    else{assert.deepEqual(partials.at(-1).assets,{outline:'outline.png'});assert.equal(partials.at(-1).tracingReview,undefined);}
  }
});
test('different output canvas dimensions prevent an unqualified visual pass',async t=>{
  const {args}=await generate(t,{mismatch:true}),result=await workflow(args);
  assert.equal(result.tracingReview.disposition,'changes_required');assert.match(result.tracingReview.findings.join(' '),/пікселях/);
});
test('missing or outdated source cannot start tracing inference',async t=>{
  for(const patch of [{assets:{}},{pendingAssetsUpdate:['master']}]){
    const {args}=await generate(t);Object.assign(args.project,patch);let calls=0;args.run=async()=>{calls++;};
    await assert.rejects(workflow(args),/декор/);assert.equal(calls,0);
  }
});
test('source signature follows geometry, master and parts plan, excluding approval, preview and tracing itself',async()=>{
  const p=project(),signature=await tracingFingerprint(p),approval=await approvalSignature(p,1);
  p.tracing={assets:{contour:image},sourceFingerprint:signature};await refreshTracingFreshness(p);assert.equal(p.tracing.outdated,false);
  assert.equal(await approvalSignature(p,1),approval);p.assets.preview='new preview';assert.equal(await tracingFingerprint(p),signature);
  for(const patch of [{width:170},{layers:1},{frame:'engraved'},{assets:{master:'new'}},{aiData:{plan:{parts:[]}}}]){
    const changed={...structuredClone(p),...patch};await refreshTracingFreshness(changed);assert.equal(changed.tracing.outdated,true);
  }
  const imported=importedTracing(p.tracing,x=>x.startsWith('data:')?x:'');assert.equal(imported.assets.contour,image);
  await refreshTracingFreshness({...p,tracing:imported});assert.equal(imported.outdated,false);
  assert.throws(()=>importedTracing({assets:{contour:'file:///etc/passwd'}},()=>''));
  assert.equal(createVariant(p,[p],{mode:'concepts',id:'variant'}).tracing,null);
});
test('tracing UI offers one combined file and keeps legacy data portable without presenting it as combined',()=>{
  const p=project(),options={esc:s=>String(s).replaceAll('<','&lt;'),safeImage:String};
  p.tracing={assets:{outline:image},outdated:true,review:{disposition:'changes_required',findings:['<script>bad</script>'],manual_checks:[]}};
  const html=tracingPanel(p,options);assert.match(html,/Потрібно оновити/);assert.match(html,/data-tracing-download="outline"/);assert.doesNotMatch(html,/data-tracing-download="engraving"|data-tracing-download="contour"|<script>/);
  p.tracing.assets={contour:image,engraving:image};
  const legacy=tracingPanel(p,options);assert.match(legacy,/попередній розділений формат/);assert.doesNotMatch(legacy,/data-tracing-download=/);
  assert.deepEqual(importedTracing(p.tracing,String).assets,p.tracing.assets);
  p.aiJob={action:'tracing',status:'running',stage:'outline',availableAssets:['outline']};
  assert.match(tracingPanel(p,{...options,connectionError:'Offline'}),/ai-reconnect/);assert.match(tracingPanel(p,options),/ai-cancel/);
});
test('HTTP accepts tracing with CSRF protection and serves only the allowed derived PNG paths',async t=>{
  const dir=await directory(t);await mkdir(resolve(dir,'dist'));await writeFile(resolve(dir,'dist/product-types.json'),await readFile(resolve(root,'dist/product-types.json')));
  let finish;const done=new Promise(r=>finish=r);
  const app=await createApp({root:dir,run:()=>{},runWorkflow:async({directory,action})=>{assert.equal(action,'tracing');await writeFile(resolve(directory,'outline.png'),png);finish();return {assets:{outline:'outline.png'}};}});
  t.after(()=>app.close());app.server.address=()=>({port:8765});
  const request=(url,method='GET',data,headers={})=>new Promise(resolve=>{
    const req=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[]);Object.assign(req,{url,method,headers:{host:'127.0.0.1:8765',...headers}});
    const res={setHeader(){},writeHead(status){this.status=status;},end(body){resolve({status:this.status,body});}};app.server.emit('request',req,res);
  });
  const token=JSON.parse((await request('/api/status')).body).token,body={action:'tracing',project:project()},headers={'x-plywood-token':token};
  assert.equal((await request('/api/jobs','POST',body)).status,403);
  assert.equal((await request('/api/jobs','POST',{...body,project:{...body.project,assets:{}}},headers)).status,400);
  const response=await request('/api/jobs','POST',body,headers);assert.equal(response.status,202);const {id}=JSON.parse(response.body);await done;
  assert.deepEqual((await request(`/api/assets/${id}/outline.png`)).body,png);
  assert.equal((await request(`/api/assets/${id}/request.json`)).status,404);
  // Let job persistence finish before removing its temporary directory.
  for(let i=0;i<100&&app.jobs.get(id).status==='running';i++)await new Promise(r=>setTimeout(r,5));
});
