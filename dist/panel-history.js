import { importedTracing } from './tracing.js';
import { panelList, multiPanel, panelImageKey, syncPrimaryPanel, panelsReady, safePanelImage } from './panels.js';

export const PANEL_HISTORY_LIMIT = 20;
const fields = ['aiData', 'aiReport', 'tracing', 'notes', 'locks'];
function imageData(part) {
  const data = { assets: { master: part.assets?.master || null } };
  for (const key of fields) data[key] = structuredClone(part[key] ?? (['notes','locks'].includes(key) ? [] : null));
  if (data.aiData) { delete data.aiData.sharedPlan; delete data.aiData.preparedCache; }
  return data;
}
function basis(p, part) {
  const source = JSON.stringify([p.type,p.clockMount||'unspecified',p.brief,p.palette,p.layers,p.frame,
    p.selected,p.concepts?.find(c=>c.id===p.selected)||null,
    panelImageKey({assets:{master:p.reference},width:0,height:0}),
    part.id,part.width,part.height,part.brief||'',part.sameDesignAs||null,part.sameSizeAs||null,part.notes||[],part.locks||[]]);
  return panelImageKey({assets:{master:source},width:0,height:0});
}
export function rememberPanelVariant(p, id, {part = panelList(p).find(x=>x.id===id), sourceProject = p,
  at = new Date().toISOString(), label = 'Збережений варіант', fresh = false} = {}) {
  const owner = p.panels?.find(x=>x.id===id);
  if (!owner || !part?.assets?.master || !safePanelImage(part.assets.master)) return;
  owner.imageHistory ||= [];
  const key = panelImageKey(part), signature = basis(sourceProject, part);
  const existing = owner.imageHistory.find(x=>x.imageKey===key);
  if (existing) {
    if (fresh || existing.basis===signature && !part.pendingAssetsUpdate?.length) {
      Object.assign(existing, {data:imageData(part), basis:signature, outdated:Boolean(part.pendingAssetsUpdate?.length)});
    }
    return existing;
  }
  owner.imageHistoryCounter = Math.max(owner.imageHistoryCounter||0,...owner.imageHistory.map(x=>x.number||0)) + 1;
  const record = {id:crypto.randomUUID(),number:owner.imageHistoryCounter,imageKey:key,basis:signature,
    width:part.width,height:part.height,at,label:String(label).slice(0,200),outdated:Boolean(part.pendingAssetsUpdate?.length),data:imageData(part)};
  owner.imageHistory.push(record);
  if (owner.imageHistory.length>PANEL_HISTORY_LIMIT) owner.imageHistory.splice(0,owner.imageHistory.length-PANEL_HISTORY_LIMIT);
  return record;
}
export function backfillPanelHistory(p) {
  if (!multiPanel(p)) return;
  for (const current of p.panels) {
    if(!current.imageHistoryBackfilled)for (const v of p.versions||[]) {
      const source = v.data?.panels?.find(x=>x.id===current.id) || (current.id==='primary'&&!v.data?.panels ? {...v.data,id:'primary',brief:''} : null);
      if (source) rememberPanelVariant(p,current.id,{part:source,sourceProject:v.data,at:v.savedAt,label:v.reason||'З історії проєкту'});
    }
    current.imageHistoryBackfilled=true;
    rememberPanelVariant(p,current.id,{at:p.updatedAt||new Date().toISOString(),label:'Поточний результат'});
  }
}
export function restorePanelVariant(p, id, variantId, {typeRevision} = {}) {
  if (['running','queued'].includes(p.aiJob?.status)) throw Error('Дочекайтеся завершення поточного завдання.');
  const part=p.panels?.find(x=>x.id===id), record=part?.imageHistory?.find(x=>x.id===variantId);
  if (!part || !record || !safePanelImage(record.data?.assets?.master)) throw Error('Варіант панелі не знайдено.');
  if (part.sameDesignAs) throw Error('Відновіть варіант вихідної панелі або відв’яжіть повтор декору.');
  // Copy before recording the current image: the bounded history may evict an older record.
  const source=structuredClone(record);rememberPanelVariant(p,id);
  Object.assign(part,structuredClone(source.data),{selection:null,resultDraft:null});
  if (part.aiData) part.aiData.preparedCache=null;
  const recordedRevision=part.aiData?.knowledge?.productType?.revision;
  const stale=source.outdated || source.basis!==basis(p,part)
    || typeRevision!==undefined && recordedRevision!==undefined && typeRevision!==recordedRevision;
  part.pendingAssetsUpdate=stale?['master']:[];
  if(!part.imageHistory.some(x=>x.id===source.id)){part.imageHistory.push(source);if(part.imageHistory.length>PANEL_HISTORY_LIMIT)part.imageHistory.shift();}
  if(stale&&part.tracing)part.tracing.outdated=true;
  const targets=new Set([id]);
  for(const copy of p.panels)if(targets.has(copy.sameDesignAs)) {
    rememberPanelVariant(p,copy.id);targets.add(copy.id);
    copy.assets={master:part.assets.master};copy.aiData=structuredClone(part.aiData);copy.aiReport=structuredClone(part.aiReport);
    copy.tracing=structuredClone(part.tracing);copy.selection=null;copy.pendingAssetsUpdate=stale?['master']:[];copy.resultDraft=null;
    rememberPanelVariant(p,copy.id,{fresh:true,label:'Повтор відновленого декору'});
  }
  p.assets={...p.assets};p.pendingAssetsUpdate=[...panelsReady(p)?[]:['master'],'preview'];
  p.aiReport=null;p.approved=false;p.approvedAt=null;p.appearanceApproval=null;
  p.reviews={engraving:'unknown',palette:'unknown',parts:'unknown',composition:'unknown'};
  syncPrimaryPanel(p);if(p.aiData)p.aiData.setPreviewReview=null;
  p.updatedAt=new Date().toISOString();p.activePanelId=id;
  return {stale,updatedPanelIds:[...targets]};
}
export function importedPanelHistory(value, safeImage=safePanelImage) {
  if (value===undefined) return [];
  if (!Array.isArray(value) || value.length>PANEL_HISTORY_LIMIT) throw Error('Некоректна історія панелі.');
  const seen=new Set();
  return value.map(x=>{
    if(!x||typeof x.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(x.id)||seen.has(x.id)
      ||!Number.isFinite(x.width)||!Number.isFinite(x.height)||x.width<20||x.width>400||x.height<20||x.height>400
      ||!Number.isFinite(Date.parse(x.at))||typeof x.basis!=='string'||x.basis.length>150
      ||!x.data?.assets?.master||!safeImage(x.data.assets.master))throw Error('Некоректний варіант панелі.');
    seen.add(x.id);
    for(const key of ['notes','locks'])if(x.data[key]!==null&&x.data[key]!==undefined&&(!Array.isArray(x.data[key])||x.data[key].length>(key==='notes'?100:20)||x.data[key].some(s=>typeof s!=='string'||s.length>4000)))throw Error('Некоректні побажання варіанта.');
    if(x.data.tracing?.assets&&Object.values(x.data.tracing.assets).some(src=>src&&!safeImage(src)))throw Error('Некоректний контурний файл варіанта.');
    for(const key of ['aiData','aiReport','tracing'])if(x.data[key]!==null&&x.data[key]!==undefined&&(typeof x.data[key]!=='object'||Array.isArray(x.data[key])))throw Error('Некоректні дані варіанта.');
    const data=imageData(x.data);
    if(data.aiReport){
      if(!['pass_visual','changes_required','not_checked'].includes(data.aiReport.disposition)||['findings','manual_checks','composition_checks'].some(key=>data.aiReport[key]!==undefined&&!Array.isArray(data.aiReport[key])))throw Error('Некоректна перевірка варіанта.');
      data.aiReport.findings||=[];data.aiReport.manual_checks||=[];
    }
    if(data.aiData?.plan&&['parts','engraving','manual_checks'].some(key=>data.aiData.plan[key]!==undefined&&!Array.isArray(data.aiData.plan[key])))throw Error('Некоректний план варіанта.');
    data.tracing=importedTracing(data.tracing,safeImage);
    return {id:x.id,number:Number.isInteger(x.number)&&x.number>0?x.number:1,
      imageKey:panelImageKey({assets:data.assets,width:x.width,height:x.height}),basis:x.basis,
      width:x.width,height:x.height,at:x.at,label:typeof x.label==='string'?x.label.slice(0,200):'Варіант',outdated:x.outdated===true,data};
  });
}
export function panelHistoryHTML(p, id, {esc,safeImage=safePanelImage,busy=false}) {
  const part=p.panels?.find(x=>x.id===id);if(!part)return '';
  const entries=[...(part.imageHistory||[])].reverse(),current=panelImageKey(part);
  if(!entries.length)return '';
  return `<details class="panel-image-history"><summary>Варіанти цієї панелі · ${entries.length}</summary><p class="hint">Відновлюється лише ця панель та її точні повтори. Загальний вигляд потрібно буде оновити окремо.</p>${part.sameDesignAs?'<p class="hint">Для повторюваного декору відновіть вихідну панель.</p>':''}<div class="panel-history-grid">${entries.map(x=>`<article class="panel-history-card"><img src="${safeImage(x.data.assets.master)}" alt="Варіант ${x.number} — ${esc(part.name)}" loading="lazy"><strong>Варіант ${x.number}${x.imageKey===current?' · поточний':''}</strong><small>${esc(new Date(x.at).toLocaleString('uk-UA'))}</small><p>${esc(x.label)} · ${x.width} × ${x.height} мм${x.outdated?' · потребує оновлення':''}</p><button class="btn tiny" data-restore-panel="${esc(part.id)}" data-panel-variant="${esc(x.id)}" ${busy||['running','queued'].includes(p.aiJob?.status)||part.sameDesignAs||x.imageKey===current&&!part.pendingAssetsUpdate?.length&&x.basis===basis(p,part)?'disabled':''}>Використати цей варіант</button></article>`).join('')||'<p class="hint">Варіанти з’являться після генерації або додавання зображення.</p>'}</div></details>`;
}

export function rememberPanelGroup(p,id,options={}) {
  const targets=new Set([id]);
  for(const part of p.panels||[])if(targets.has(part.id)||targets.has(part.sameDesignAs)) {
    targets.add(part.id);rememberPanelVariant(p,part.id,options);
  }
}
export function inheritPanelHistory(p,previousPanels) {
  for(const part of p.panels||[]) {
    const previous=previousPanels?.find(x=>x.id===part.id);if(!previous)continue;
    const combined=[...(previous.imageHistory||[]),...(part.imageHistory||[])],seen=new Set();
    part.imageHistoryBackfilled=previous.imageHistoryBackfilled===true||Boolean(previous.imageHistory?.length);
    part.imageHistory=combined.filter(x=>!seen.has(x.imageKey)&&seen.add(x.imageKey)).slice(-PANEL_HISTORY_LIMIT);
    part.imageHistoryCounter=Math.max(previous.imageHistoryCounter||0,part.imageHistoryCounter||0,...part.imageHistory.map(x=>x.number));
  }
}
export async function embedPanelHistories(p,embed,{sourceReference=p.reference}={}) {
  const {refreshTracingFreshness,tracingFingerprint,TRACING_KINDS}=await import('./tracing.js');
  for(const part of p.panels||[])for(const record of part.imageHistory||[]) {
    const originalPart={...part,...record.data,width:record.width,height:record.height};
    // Rebind only a provably matching recipe when a local reference path is embedded.
    // Older recipes with unknown settings keep their original, conservative freshness check.
    if(sourceReference!==p.reference&&record.basis===basis({...p,reference:sourceReference},originalPart))record.basis=basis(p,originalPart);
    const historic={...p,...record.data,width:record.width,height:record.height,panels:undefined,pendingAssetsUpdate:record.outdated?['master']:[]};
    await refreshTracingFreshness(historic);const fresh=historic.tracing&&!historic.tracing.outdated;
    record.data.assets.master=await embed(record.data.assets.master);
    record.imageKey=panelImageKey({assets:record.data.assets,width:record.width,height:record.height});
    if(record.data.tracing) {
      for(const key of TRACING_KINDS)if(record.data.tracing.assets?.[key])record.data.tracing.assets[key]=await embed(record.data.tracing.assets[key]);
      if(fresh)record.data.tracing.sourceFingerprint=await tracingFingerprint({...historic,assets:record.data.assets});
    }
  }
}
