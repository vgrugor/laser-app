import { rememberPanelVariant } from './panel-history.js';
import { panelList, panelView, panelsReady, refreshPanelSelections, syncPrimaryPanel } from './panels.js';
import { invalidateApproval } from './approval.js';
import { markTracingOutdated } from './tracing.js';

export async function embedPanelResult(job,embed){
  const panels=[];
  for(const entry of job.result.panels||[]){
    const assets={};for(const kind of ['master','outline'])if(entry.assets?.[kind])assets[kind]=await embed(job.id,kind,entry.assets[kind]);
    panels.push({...entry,assets});
  }
  const assets={};for(const kind of ['master','preview'])if(job.result.assets?.[kind])assets[kind]=await embed(job.id,kind,job.result.assets[kind]);
  return {panels,assets};
}
export function applyPanelResult(p,job,embedded){
  const previous=p.aiJob,trace=previous.action==='tracing';
  previous.appliedPanels=[];
  for(const entry of embedded.panels){
    const part=panelList(p).find(x=>x.id===entry.id);if(!part)continue;
    if(trace){
      if(entry.assets.outline)part.tracing={assets:{outline:entry.assets.outline},sourceFingerprint:previous.panelFingerprints?.[part.id]||'',outdated:Boolean(part.pendingAssetsUpdate?.length),jobId:job.id,createdAt:job.finishedAt||new Date().toISOString(),review:entry.tracingReview||null,assetMetadata:entry.assetMetadata||{},sourceMasterHash:entry.sourceMasterHash||null,knowledge:entry.knowledge||null};
    }else{
      if(entry.assets.master)rememberPanelVariant(p,part.id);
      const {id,name,assets,...data}=entry;
      if(['generate','edit'].includes(previous.action)&&!entry.assets.master&&entry.plan){part.aiData={...part.aiData,preparedCache:{plan:entry.plan,prompts:entry.prompts,planning:entry.planning,preparation:entry.preparation}};}else part.aiData={...part.aiData,...data,...entry.assets.master?{preparedCache:null}:{},jobId:job.id};
      if(entry.review)part.aiReport=entry.review;
      if(entry.assets.master){part.assets={master:entry.assets.master};part.pendingAssetsUpdate=[];markTracingOutdated(part);previous.appliedPanels.push(part.id);rememberPanelVariant(p,part.id,{at:job.finishedAt||new Date().toISOString(),label:previous.action==='edit'?'Правки панелі':'Генерація панелі',fresh:true});}
    }
  }
  if(!trace){
    if(embedded.assets.preview)p.assets.preview=embedded.assets.preview;
    if(job.result.previewProvenance)p.previewProvenance=structuredClone(job.result.previewProvenance);
    if(job.result.review)p.aiReport=job.result.review;
    if(previous.action!=='review')p.pendingAssetsUpdate=[...panelsReady(p)?[]:['master'],...embedded.assets.preview?[]:previous.appliedPanels.length||p.pendingAssetsUpdate?.includes('preview')||!p.assets.preview?['preview']:[]];
    p.prepared=true;p.example=null;invalidateApproval(p);p.reviews={engraving:'unknown',palette:'unknown',parts:'unknown',composition:'unknown'};
  }
  refreshPanelSelections(p);syncPrimaryPanel(p);
  if(!trace){p.aiData={...p.aiData,...job.result.sharedPlan?{sharedPlan:job.result.sharedPlan}:{},jobId:job.id,setPreviewReview:job.result.previewReview||(!previous.appliedPanels.length&&!embedded.assets.preview?p.aiData?.setPreviewReview:null)||null,sourceConceptId:previous.conceptId||null};previous.appliedAssets=Object.keys(embedded.assets);}
  p.updatedAt=new Date().toISOString();
}
