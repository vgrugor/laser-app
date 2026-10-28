import test from 'node:test';
import assert from 'node:assert/strict';
import { digest, localPlanSignature, sharedPlanSignature, cachedPreparation, styleInputs } from '../server/planning.mjs';
import { validateResult, saveInput } from '../server/workflow.mjs';
import { choosePanel } from '../dist/panels.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { flatComposition } from './fixtures/composition.mjs';
const project={title:'Test',type:'Шкатулка',brief:'Forest',palette:['clear','pine'],layers:2,frame:'none',width:200,height:150,notes:[],locks:[],concept:{id:'c'},panels:[{id:'lid',name:'Lid',width:200,height:150},{id:'wall',name:'Wall',width:200,height:60}]};
const knowledge={text:'Rules',manifestHash:'manifest',paletteHash:'palette'},type={revision:1,rules:'Plywood 3 mm'};

test('cache dependencies cover shared settings, knowledge and local changes without navigation or approval dependence',()=>{
  const shared=p=>sharedPlanSignature(p,knowledge,type,'reference');const original=shared(project);
  for(const change of [{palette:['clear']},{layers:1},{frame:'cut'},{brief:'Other'}, {clockMount:'stand'}])assert.notEqual(shared({...project,...change}),original);
  assert.notEqual(sharedPlanSignature(project,{...knowledge,text:'New rules'},type,'reference'),original);
  assert.notEqual(sharedPlanSignature(project,knowledge,{...type,revision:2},'reference'),original);
  assert.notEqual(sharedPlanSignature(project,knowledge,type,'new-reference'),original);
  assert.equal(shared({...project,activePanelId:'wall',approved:true,notes:['Local only']}),original);
  const local={title:'Lid',brief:'Forest',width:200,height:150,palette:['clear'],layers:2,frame:'none',notes:[],locks:[]};
  const signature=(p=local,options={},action='generate')=>localPlanSignature(p,action,knowledge,type,{sharedSignature:original,...options});
  const key=signature();for(const change of [{notes:['Bigger']},{locks:['Keep shape']},{width:180},{height:100},{palette:['pine']},{layers:1},{frame:'cut'},{brief:'Other'}])assert.notEqual(signature({...local,...change}),key);
  assert.notEqual(signature(local,{styleReferences:[{sha256:'new-style'}]}),key);
  assert.notEqual(signature(local,{sharedSignature:'changed-common'}),key);
  assert.equal(signature(local,{inputMasterHash:'one'}),signature(local,{inputMasterHash:'two'}));
  assert.notEqual(signature(local,{inputMasterHash:'one'},'edit'),signature(local,{inputMasterHash:'two'},'edit'));
});

test('matching hashes cannot bypass validation of cached plans or prompts',()=>{
  const plan={parts:[{name:'Motif',finish_id:'black',quantity:1,layer:'top'}],spatial_composition:flatComposition};
  const prompts={master:'Master',preview:'Preview'};
  const cache={plan,prompts,planning:{version:1,signature:'s',planHash:digest(plan),promptsHash:digest(prompts)}};
  assert.deepEqual(cachedPreparation(cache,'s',{palette:['clear'],layers:2},validateResult),{});
  plan.parts[0].finish_id='clear';cache.planning.planHash=digest(plan);cache.prompts.master='';cache.planning.promptsHash=digest(cache.prompts);
  const result=cachedPreparation(cache,'s',{palette:['clear'],layers:2},validateResult);assert.ok(result.plan);assert.equal(result.prompts,undefined);
});

test('style selection excludes unchosen, stale, self and duplicate images, and caps at three',async t=>{
  const directory=await mkdtemp(resolve(tmpdir(),'planning-style-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const root=resolve(import.meta.dirname,'..');
  const image=async kind=>'data:image/png;base64,'+(await readFile(resolve(root,'dist/assets',kind+'-master.png'))).toString('base64');
  const a=await image('magnolia'),b=await image('bird'),c=await image('tits');
  const p={panels:[['self',a],['copy',a],['first',b],['duplicate',b],['stale',c],['not-chosen',c],['second',c]].map(([id,master])=>({id,name:id,width:100,height:100,assets:{master},pendingAssetsUpdate:[]}))};
  for(const part of p.panels)if(part.id!=='not-chosen')choosePanel(p,part.id);
  p.panels.find(x=>x.id==='stale').pendingAssetsUpdate=['master'];
  const result=await styleInputs({root,directory,project:p,current:p.panels[0],saveInput,readFile});
  assert.deepEqual(result.references.map(x=>x.id),['first','second']);
  assert.equal(result.references[0].sha256,digest(await readFile(result.images[0])));
  // Use no own image to make all three distinct choices eligible.
  const all=await styleInputs({root,directory,project:p,current:{id:'new',assets:{}},saveInput,readFile});
  assert.equal(all.references.length,3);assert.equal(new Set(all.references.map(x=>x.sha256)).size,3);
});
