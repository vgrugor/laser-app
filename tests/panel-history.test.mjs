import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { panelState, choosePanel, nextPanel, panelNavigation, panelView, syncPrimaryPanel } from '../dist/panels.js';
import { rememberPanelVariant, rememberPanelGroup, backfillPanelHistory, restorePanelVariant, importedPanelHistory, embedPanelHistories, panelHistoryHTML, inheritPanelHistory, PANEL_HISTORY_LIMIT } from '../dist/panel-history.js';
import { createVariant } from '../dist/variants.js';
import { applyPanelResult } from '../dist/panel-results.js';
import { tracingFingerprint } from '../dist/tracing.js';
import { ensureRoute } from '../dist/project-route.js';
const a='assets/magnolia-master.png',b='assets/bird-master.png',c='assets/tits-master.png';
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const part=(id,master,width=200,height=150)=>({id,name:id,width,height,brief:'',selection:null,notes:[],locks:[],assets:{master},pendingAssetsUpdate:[],aiData:{plan:{summary:id},knowledge:{productType:{revision:1}}},aiReport:{disposition:'not_checked',findings:[],manual_checks:[]}});
function project(){const p={id:'p',title:'Box',type:'Шкатулка',width:200,height:150,brief:'Forest',palette:['clear'],frame:'none',layers:2,selected:'concept',concepts:[{id:'concept',title:'Forest'}],notes:[],locks:[],assets:{master:a,preview:a},reviews:{},versions:[],panels:[part('lid',a),part('wall',b,200,60),{...part('repeat',a),sameDesignAs:'lid',sameSizeAs:'lid'}]};syncPrimaryPanel(p);return p;}

test('automatic image application records distinct local variants without growing on text-only reviews',()=>{
  const p=project(),other=structuredClone(p.panels[1]);
  for(const master of [b,c,c]){
    p.aiJob={action:'generate'};applyPanelResult(p,{id:'job',result:{panels:[],review:null}},{panels:[{id:'lid',assets:{master},plan:{summary:master}}],assets:{}});
  }
  assert.equal(p.panels[0].imageHistory.length,3);assert.deepEqual(p.panels[1],other);
  const before=p.panels[0].imageHistory.length;p.aiJob={action:'review'};
  applyPanelResult(p,{id:'review',result:{}},{panels:[{id:'lid',assets:{},review:{disposition:'not_checked'}}],assets:{}});
  assert.equal(p.panels[0].imageHistory.length,before);assert.equal(p.panels[0].imageHistory[0].data.imageHistory,undefined);
});

test('restoring a local variant preserves independent panels and preview while updating exact copies',async()=>{
  const p=project();p.panels[0].tracing={assets:{outline:b},outdated:false,sourceFingerprint:await tracingFingerprint(panelView(p,'lid'))};
  const old=rememberPanelVariant(p,'lid');rememberPanelGroup(p,'lid');
  p.panels[0].assets={master:c};p.panels[0].notes=['New note'];p.panels[2].assets={master:c};rememberPanelGroup(p,'lid');
  choosePanel(p,'wall');const wall=structuredClone(p.panels[1]),preview=p.assets.preview;p.approved=true;
  const restored=restorePanelVariant(p,'lid',old.id,{typeRevision:1});
  assert.equal(restored.stale,false);assert.deepEqual(restored.updatedPanelIds,['lid','repeat']);
  assert.equal(p.panels[0].assets.master,a);assert.equal(p.panels[2].assets.master,a);assert.deepEqual(p.panels[0].notes,[]);
  assert.deepEqual(p.panels[1],wall);assert.equal(panelState(p.panels[1]),'selected');
  assert.equal(p.assets.preview,preview);assert.deepEqual(p.pendingAssetsUpdate,['preview']);assert.equal(p.approved,false);
  assert.equal(p.panels[0].selection,null);assert.equal(p.panels[0].tracing.outdated,false);assert.equal(p.aiData.setPreviewReview,null);
});

test('changed dimensions, palette and product rules cannot silently make a historic image current',()=>{
  for(const changed of ['size','palette','rules']){
    const p=project(),old=rememberPanelVariant(p,'lid');p.panels[0].assets={master:c};
    if(changed==='size'){p.panels[0].width=220;p.panels[2].width=220;syncPrimaryPanel(p);}
    if(changed==='palette')p.palette=['pine'];
    const result=restorePanelVariant(p,'lid',old.id,{typeRevision:changed==='rules'?2:1});
    assert.equal(result.stale,true);assert.equal(panelState(p.panels[0]),'outdated');assert.equal(p.panels[0].width,changed==='size'?220:200);
  }
});

test('backfill uses stable panel IDs, and whole-version restoration preserves durable local history',()=>{
  const p=project(),older=structuredClone(p);older.panels[0].assets.master=c;older.panels.reverse();
  p.versions=[{savedAt:'2026-10-28T10:00:00Z',reason:'Previous',data:older}];backfillPanelHistory(p);
  assert.equal(p.panels[0].imageHistory.length,2);assert.equal(p.panels[0].imageHistory[0].data.assets.master,c);
  assert.equal(p.panels[1].imageHistory.length,1);const count=p.panels[0].imageHistory.length;backfillPanelHistory(p);assert.equal(p.panels[0].imageHistory.length,count);
  const restored=structuredClone(older);inheritPanelHistory(restored,p.panels);assert.equal(restored.panels.find(x=>x.id==='lid').imageHistory.length,2);
});

test('bounded history can restore the oldest selected entry even when archiving current image evicts it',()=>{
  const p=project();
  for(let i=0;i<PANEL_HISTORY_LIMIT;i++){p.panels[0].assets.master='data:image/png;base64,'+Buffer.from('image-'+i).toString('base64');rememberPanelVariant(p,'lid');}
  const oldest=structuredClone(p.panels[0].imageHistory[0]);p.panels[0].assets.master=c;
  restorePanelVariant(p,'lid',oldest.id);assert.equal(p.panels[0].imageHistory.length,PANEL_HISTORY_LIMIT);
  assert.equal(p.panels[0].assets.master,oldest.data.assets.master);assert.ok(p.panels[0].imageHistory.some(x=>x.id===oldest.id));
  p.aiJob={status:'running'};assert.throws(()=>restorePanelVariant(p,'lid',oldest.id),/Дочекайтеся/);
  p.aiJob=null;rememberPanelVariant(p,'repeat');assert.throws(()=>restorePanelVariant(p,'repeat',p.panels[2].imageHistory[0].id),/вихідної/);
});

test('history export embeds images and tracing, and import rejects unsafe or oversized history',async()=>{
  const p=project();p.panels[0].tracing={assets:{outline:b},outdated:false,sourceFingerprint:await tracingFingerprint(panelView(p,'lid'))};rememberPanelVariant(p,'lid');
  const embed=async src=>src.startsWith('data:')?src:'data:image/png;base64,'+(await readFile(new URL('../dist/'+src,import.meta.url))).toString('base64');
  await embedPanelHistories(p,embed);const history=p.panels[0].imageHistory;
  assert.ok(history[0].data.assets.master.startsWith('data:'));assert.ok(history[0].data.tracing.assets.outline.startsWith('data:'));
  const imported=importedPanelHistory(JSON.parse(JSON.stringify(history)));assert.equal(imported.length,1);
  const image={...p,...imported[0].data,width:200,height:150};assert.equal(imported[0].data.tracing.sourceFingerprint,await tracingFingerprint(image));
  assert.throws(()=>importedPanelHistory(Array(PANEL_HISTORY_LIMIT+1).fill(history[0])),/історія/);
  const bad=structuredClone(history);bad[0].data.assets.master='javascript:alert(1)';assert.throws(()=>importedPanelHistory(bad),/варіант/);
  const report=structuredClone(history);report[0].data.aiReport.findings='invalid';assert.throws(()=>importedPanelHistory(report),/перевірка/);
  const invalid=structuredClone(history);invalid[0].data.aiData='x';assert.throws(()=>importedPanelHistory(invalid),/дані/);
});

test('panel workspace exposes stage-specific primary actions, thumbnails and escaped local history',()=>{
  const p=project();p.activePanelId='lid';const variant=rememberPanelVariant(p,'lid',{label:'<script>bad</script>'});
  let html=panelNavigation(p,{esc,history:panelHistoryHTML(p,'lid',{esc})});
  assert.match(html,/panel-route-card active/);assert.match(html,/Обрати й перейти далі/);assert.match(html,/Внести правки до панелі/);assert.match(html,/&lt;script>/);assert.doesNotMatch(html,/<script>/);
  choosePanel(p,'lid');assert.equal(nextPanel(p,'lid').id,'wall');choosePanel(p,'wall');choosePanel(p,'repeat');assert.equal(nextPanel(p,'lid'),null);
  html=panelNavigation(p,{esc});assert.match(html,/Усі панелі обрані/);assert.match(html,/data-action="panel-finalize"/);
  assert.equal(variant.data.assets.master,a);
});

test('whole-project snapshot does not duplicate the accumulated image history',async()=>{
  const p=project();rememberPanelVariant(p,'lid');const app=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
  const definition=app.match(/async function snapshot[^\n]+/)[0];
  const snapshot=new Function('ensureRoute','ensureVersions','id','date','persist','toast',`return (${definition})`)(ensureRoute,p=>{p.versions||=[];p.versionCounter||=0;},()=>crypto.randomUUID(),()=>new Date().toISOString(),async()=>{},()=>{});
  await snapshot(p,false);assert.equal(p.versions[0].data.panels[0].imageHistory,undefined);assert.equal(p.panels[0].imageHistory.length,1);
});


test('parameter variants preserve local history; fresh-concept variants do not inherit images through history',()=>{
  const p=project();rememberPanelVariant(p,'lid');
  const variant=createVariant(p,[p]);assert.equal(variant.panels[0].imageHistory.length,1);
  const fresh=createVariant(p,[p],{mode:'concepts'});assert.deepEqual(fresh.panels[0].imageHistory,[]);assert.equal(fresh.panels[0].imageHistoryCounter,0);
  assert.equal(p.panels[0].imageHistory.length,1);
});


test('reload does not replay evicted project snapshots into a full durable panel history',()=>{
  const p=project();backfillPanelHistory(p);const older=structuredClone(p);
  for(let i=0;i<PANEL_HISTORY_LIMIT+3;i++){p.panels[0].assets.master='data:image/png;base64,'+Buffer.from('new-'+i).toString('base64');rememberPanelVariant(p,'lid');}
  const before=p.panels[0].imageHistory.map(x=>[x.id,x.number,x.imageKey]);const counter=p.panels[0].imageHistoryCounter;
  p.versions=[{data:older,savedAt:'2026-10-28T10:00:00Z'}];backfillPanelHistory(p);
  assert.deepEqual(p.panels[0].imageHistory.map(x=>[x.id,x.number,x.imageKey]),before);assert.equal(p.panels[0].imageHistoryCounter,counter);
});
