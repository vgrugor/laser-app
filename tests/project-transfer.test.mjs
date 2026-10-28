import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { importProject, prepareProjectExport, restoreProjectVersion } from '../dist/project-transfer.js';
import { migrateStoredState } from '../dist/project-state.js';
import { panelState, choosePanel, ensurePanels, captureSinglePanel, syncPrimaryPanel, panelsChosen, bindProductPreview, productPreviewStatus, panelView, safePanelImage } from '../dist/panels.js';
import { backfillPanelHistory, rememberPanelVariant, restorePanelVariant } from '../dist/panel-history.js';
import { tracingFingerprint, refreshTracingFreshness } from '../dist/tracing.js';
import { projectRoute } from '../dist/project-route.js';
const a='assets/magnolia-master.png',b='assets/bird-master.png',c='assets/tits-master.png';
const at='2026-10-28T10:00:00.000Z';
const options={types:['Шкатулка'],colors:[{id:'clear'},{id:'pine'}],seed:()=>({createdAt:at,updatedAt:at,reviews:{},approved:false})};
const embed=async src=>src.startsWith('data:')?src:'data:image/png;base64,'+(await readFile(new URL('../dist/'+src,import.meta.url))).toString('base64');
function legacy(){return {id:'old',title:'Box',brief:'Forest',type:'Шкатулка',width:200,height:150,layers:2,frame:'engraved',palette:['clear','pine'],assets:{master:a,preview:'assets/magnolia-preview.png'},pendingAssetsUpdate:[],concepts:[{id:'concept',title:'Forest',description:'Trees',palette:['clear','pine'],frame:'engraved'}],selected:'concept',notes:[],locks:[],versions:[],reviews:{},approved:true,createdAt:at,updatedAt:at};}
function multi(){const p=legacy();ensurePanels(p);p.panels[0].id='lid';p.panels[0].name='Lid';p.panels.push({id:'wall',name:'Wall',width:200,height:60,brief:'Trees',assets:{master:b},notes:[],locks:[],pendingAssetsUpdate:[]});p.activePanelId='wall';for(const part of p.panels)choosePanel(p,part.id);p.previewProvenance=bindProductPreview(p);backfillPanelHistory(p);return p;}
async function roundtrip(p){return importProject(JSON.parse(JSON.stringify((await prepareProjectExport(p,{embed})).project)),options);}

test('old one-image-pair projects and named versions round-trip without invented panel choices',async()=>{
  const p=legacy(),saved=structuredClone(p);p.versions=[{id:'v1',number:7,label:'Favourite',reason:'Saved',savedAt:at,data:saved}];
  const before=structuredClone(p),loaded=migrateStoredState({projects:[p],active:p.id}).state.projects[0];
  assert.equal(projectRoute(loaded).current,'saved');assert.equal(loaded.panels,undefined);assert.equal(loaded.selection,undefined);
  const imported=await roundtrip(p);
  assert.equal(imported.panels,undefined);assert.equal(panelState(imported),'variant');assert.equal(imported.approved,false);
  assert.equal(imported.versions[0].number,7);assert.equal(imported.versions[0].label,'Favourite');assert.equal(imported.versions[0].data.selected,'concept');
  assert.ok(imported.assets.master.startsWith('data:'));assert.deepEqual(p,before);
});

test('explicit singleton import preserves a preview-only stale flag without marking its master outdated',async()=>{
  const p=legacy();ensurePanels(p);p.pendingAssetsUpdate=['preview'];choosePanel(p,'primary');captureSinglePanel(p);
  const restored=await roundtrip(p);
  assert.deepEqual(restored.pendingAssetsUpdate,['preview']);assert.deepEqual(restored.panels[0].pendingAssetsUpdate,['preview']);
  assert.equal(panelState(restored.panels[0]),'selected');assert.equal(restored.panels[0].assets.master,restored.assets.master);
  p.pendingAssetsUpdate=['master'];captureSinglePanel(p);assert.equal(panelState((await roundtrip(p)).panels[0]),'outdated');
});

test('multi-panel export/import/reload preserves chosen images, source binding, cache, history and fresh outlines',async()=>{
  const p=multi();p.aiData={sharedPlan:{signature:'shared',summary:'Forest'}};p.panels[1].aiData={plan:{parts:[]},preparedCache:{plan:{parts:[]},planning:{signature:'prepared'}}};
  p.panels[1].tracing={assets:{outline:c},sourceFingerprint:await tracingFingerprint(panelView(p,'wall')),outdated:false};
  rememberPanelVariant(p,'wall',{fresh:true});p.previewProvenance=bindProductPreview(p);
  const before=structuredClone(p),imported=await roundtrip(p);
  assert.equal(imported.activePanelId,'wall');assert.equal(imported.approved,false);assert.equal(panelsChosen(imported),true);assert.equal(productPreviewStatus(imported),'current');
  assert.equal(imported.aiData.sharedPlan.signature,'shared');assert.equal(imported.panels[1].aiData.preparedCache.planning.signature,'prepared');
  await refreshTracingFreshness(panelView(imported,'wall'));assert.equal(imported.panels[1].tracing.outdated,false);
  assert.equal(imported.panels[1].imageHistory.length,1);assert.ok(imported.panels[1].imageHistory[0].data.tracing.assets.outline.startsWith('data:'));
  const reloaded=migrateStoredState(JSON.parse(JSON.stringify({schemaVersion:2,projects:[imported],active:imported.id}))).state.projects[0];backfillPanelHistory(reloaded);
  assert.equal(panelsChosen(reloaded),true);assert.equal(productPreviewStatus(reloaded),'current');assert.equal(reloaded.panels[1].imageHistory.length,1);assert.deepEqual(p,before);
});

test('stale or legacy source bindings remain honest across portable export, and failed export leaves live data untouched',async()=>{
  const p=multi();p.panels[1].assets.master=c;choosePanel(p,'wall');
  assert.equal(productPreviewStatus(await roundtrip(p)),'outdated');
  p.previewProvenance=null;p.panels.forEach(x=>x.selection=null);const imported=await roundtrip(p);
  assert.equal(productPreviewStatus(imported),'legacy');assert.equal(panelsChosen(imported),false);
  const before=structuredClone(p);await assert.rejects(prepareProjectExport(p,{embed:async()=>{throw Error('Offline');}}),/Offline/);assert.deepEqual(p,before);
});

test('embedding a local reference keeps matching panel history restorable without hiding stale historical recipes',async()=>{
  const p=multi();p.reference='assets/bird-preview.png';p.panels[0].imageHistory=[];rememberPanelVariant(p,'lid');
  p.palette=['clear'];p.panels[0].assets.master=c;rememberPanelVariant(p,'lid');
  const imported=await roundtrip(p);const [old,current]=imported.panels[0].imageHistory;
  assert.equal(restorePanelVariant(imported,'lid',old.id).stale,true);
  assert.equal(restorePanelVariant(imported,'lid',current.id).stale,false);
});

test('whole-version restore clears later job errors and absent metadata while preserving stable IDs, variants and accumulated history',()=>{
  const p=multi(),version=structuredClone(p);p.versions=[{id:'v',data:version}];p.versionCounter=10;
  p.panels[0].assets.master=c;rememberPanelVariant(p,'lid');
  const history=p.versions;p.aiLaunchError='Failed';p.aiLaunchErrorAction='generate';p.aiLaunchAction='edit';p.aiLaunchTarget='panel';p.aiLaunchPanelId='wall';p.aiJob={status:'failed'};
  version.aiLaunchError='Historical failure';version.aiJob={status:'running'};
  restoreProjectVersion(p,version,{at});
  assert.equal(p.id,'old');assert.equal(p.versions,history);assert.equal(p.versionCounter,10);assert.equal(panelsChosen(p),true);assert.equal(productPreviewStatus(p),'current');assert.equal(p.panels[0].imageHistory.length,2);
  for(const key of ['aiJob','aiLaunchAction','aiLaunchTarget','aiLaunchPanelId','aiLaunchError','aiLaunchErrorAction'])assert.equal(p[key],undefined);
  const old=legacy();p.variantOf={projectId:'parent',title:'Parent'};restoreProjectVersion(p,old);
  assert.equal(p.aiData,null);assert.equal(p.aiReport,null);assert.equal(p.previewProvenance,null);assert.equal(p.panels,undefined);assert.equal(p.selection,null);assert.equal(p.approved,false);assert.equal(p.variantOf.projectId,'parent');assert.equal(old.approved,true);
});

test('portable import rejects broken histories, bad sources and invalid panel links before returning a project',()=>{
  for(const mutate of [p=>p.panels[1].imageHistory[0].data.assets.master='https://example.com/image.png',p=>p.panels[1].sameDesignAs='missing',p=>p.panels[0].id='wall',p=>p.panels[1].imageHistory.push({...p.panels[1].imageHistory[0]})]){
    const p=multi();mutate(p);assert.throws(()=>importProject(p,options));
  }
  const p=multi();p.previewProvenance.origin='invalid';const imported=importProject(p,options);assert.equal(productPreviewStatus(imported),'outdated');
  assert.equal(safePanelImage('javascript:alert(1)'), '');
});
