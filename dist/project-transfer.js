import { backfillPanelHistory, importedPanelHistory, embedPanelHistories, inheritPanelHistory } from './panel-history.js';
import { multiPanel, panelList, panelView, validatePanels, syncPrimaryPanel, captureSinglePanel, panelState, panelImageKey, importedPanelSelection, productPreviewStatus, bindProductPreview, importedPreviewProvenance, safePanelImage } from './panels.js';
import { TRACING_KINDS, tracingFingerprint, refreshTracingFreshness, importedTracing } from './tracing.js';
import { conceptRuns, importedConceptRuns } from './concept-history.js';
import { importedConceptSelection } from './project-state.js';
import { ensureRoute } from './project-route.js';

export async function prepareProjectExport(p,{projects=[p],embed}){
  const copy=structuredClone(p);copy.versions||=[];const conceptIds=new Set([...(p.concepts||[]),...(p.versions||[]).flatMap(v=>v.data.concepts||[])].map(c=>c.id));copy.conceptRuns=structuredClone(conceptRuns(projects).filter(r=>conceptIds.has(r.conceptId)||r.projectId===p.id));
  for(const run of copy.conceptRuns){for(const k of ['preview','master'])if(run.assets?.[k])run.assets[k]=await embed(run.assets[k]);for(const part of run.panels||[])if(part.assets?.master)part.assets.master=await embed(part.assets.master);}
  for(const item of [copy,...copy.versions.map(v=>v.data)]){
    const currentPreview=multiPanel(item)&&productPreviewStatus(item)==='current';const previousProvenance=item.previewProvenance;
    if(multiPanel(item)){
      if(item.assets.preview)item.assets.preview=await embed(item.assets.preview);
      for(const part of panelList(item)){
        const chosen=panelState(part)==='selected';const source=panelView(item,part.id);await refreshTracingFreshness(source);const fresh=part.tracing&&!part.tracing.outdated;
        if(part.assets?.master)part.assets.master=await embed(part.assets.master);if(chosen)part.selection.imageKey=panelImageKey(part);
        if(part.tracing){for(const k of TRACING_KINDS)if(part.tracing.assets?.[k])part.tracing.assets[k]=await embed(part.tracing.assets[k]);if(fresh)part.tracing.sourceFingerprint=await tracingFingerprint(panelView(item,part.id));}
      }
      syncPrimaryPanel(item);
    }else{
      const chosen=panelState(panelList(item)[0])==='selected';await refreshTracingFreshness(item);const fresh=item.tracing&&!item.tracing.outdated;
      for(const k of ['preview','master'])if(item.assets[k])item.assets[k]=await embed(item.assets[k]);
      if(item.tracing){for(const k of TRACING_KINDS)if(item.tracing.assets?.[k])item.tracing.assets[k]=await embed(item.tracing.assets[k]);if(fresh)item.tracing.sourceFingerprint=await tracingFingerprint(item);}
      if(chosen){(item.panels?.[0]||item).selection.imageKey=panelImageKey(item);}captureSinglePanel(item);
    }
    const sourceReference=item.reference;if(item.reference)item.reference=await embed(item.reference);
    await embedPanelHistories(item,embed,{sourceReference});if(currentPreview)item.previewProvenance=bindProductPreview(item,previousProvenance);
  }
  return {format:'plywood-flow-project',version:1,project:copy};
}

export function importProject(x,{types:TYPES,colors,seed,kinds={},safeImage=safePanelImage,id=()=>crypto.randomUUID(),date=()=>new Date().toISOString()}){
 function normalizeImported(x,history=true){
  if(!x||typeof x.title!=='string'||typeof x.brief!=='string'||!TYPES.includes(x.type)||!Number.isFinite(x.width)||!Number.isFinite(x.height)||x.width<20||x.height<20||!((x.width<=300&&x.height<=400)||(x.width<=400&&x.height<=300)))throw Error('fields');
  if(!Array.isArray(x.palette)||!x.palette.length||new Set(x.palette).size!==x.palette.length||x.palette.some(k=>!colors.some(c=>c.id===k))||x.palette.length>4||(x.palette.length===4&&!x.palette.includes('black')))throw Error('palette');
  if(!x.assets||['preview','master'].some(k=>x.assets[k]!==null&&x.assets[k]!==undefined&&!safeImage(x.assets[k]))||(x.reference&&!safeImage(x.reference)))throw Error('images');
  const p=seed('magnolia');Object.assign(p,{id:id(),title:x.title.slice(0,100),brief:x.brief.slice(0,4000),type:x.type,clockMount:['wall','stand','unspecified'].includes(x.clockMount)?x.clockMount:'unspecified',width:x.width,height:x.height,palette:[...x.palette],frame:['engraved','cut','none'].includes(x.frame)?x.frame:'engraved',layers:x.layers===1?1:2,example:Object.hasOwn(kinds,x.example)?x.example:null,assets:{preview:x.assets.preview||null,master:x.assets.master||null},reference:x.reference||null,notes:Array.isArray(x.notes)?x.notes.filter(n=>typeof n==='string').slice(0,100).map(n=>n.slice(0,4000)):[],locks:Array.isArray(x.locks)?x.locks.filter(n=>typeof n==='string').slice(0,20).map(n=>n.slice(0,200)):[],concepts:[],selected:null,prepared:true,approved:false,pendingAssetsUpdate:Array.isArray(x.pendingAssetsUpdate)?x.pendingAssetsUpdate.filter(k=>['preview','master'].includes(k)):[],versions:[]});
  p.tracing=importedTracing(x.tracing,safeImage);p.selection=importedPanelSelection(p,x.selection);p.previewProvenance=importedPreviewProvenance(x.previewProvenance);if(x.previewProvenance&&!p.previewProvenance)p.pendingAssetsUpdate=[...new Set([...p.pendingAssetsUpdate,'preview'])];
  if(x.panels!==undefined){validatePanels(x);p.panels=x.panels.map(part=>{
    if(part.assets?.master&&!safeImage(part.assets.master))throw Error('panel image');
    return {imageHistoryBackfilled:part.imageHistoryBackfilled===true||Array.isArray(part.imageHistory),imageHistory:importedPanelHistory(part.imageHistory,safeImage),imageHistoryCounter:Number.isInteger(part.imageHistoryCounter)&&part.imageHistoryCounter>0?part.imageHistoryCounter:0,selection:importedPanelSelection(part),id:part.id,name:part.name,width:part.width,height:part.height,brief:part.brief||'',sameSizeAs:part.sameSizeAs||null,sameDesignAs:part.sameDesignAs||null,assets:{master:part.assets?.master||null},aiData:part.aiData&&typeof part.aiData==='object'?structuredClone(part.aiData):null,aiReport:part.aiReport&&typeof part.aiReport==='object'?structuredClone(part.aiReport):null,tracing:importedTracing(part.tracing,safeImage),notes:Array.isArray(part.notes)?part.notes.filter(v=>typeof v==='string').slice(0,100).map(v=>v.slice(0,4000)):[],locks:Array.isArray(part.locks)?part.locks.filter(v=>typeof v==='string').slice(0,20).map(v=>v.slice(0,200)):[],pendingAssetsUpdate:Array.isArray(part.pendingAssetsUpdate)?part.pendingAssetsUpdate.filter(k=>k==='master'||x.panels.length===1&&k==='preview'):[],resultDraft:part.resultDraft&&typeof part.resultDraft.text==='string'?{text:part.resultDraft.text.slice(0,4000),includeFindings:part.resultDraft.includeFindings===true,open:false}:null};});p.activePanelId=p.panels.some(y=>y.id===x.activePanelId)?x.activePanelId:p.panels[0].id;}
  if(history)p.conceptRuns=importedConceptRuns(x.conceptRuns,safeImage);
  Object.assign(p,importedConceptSelection(x,colors.map(c=>c.id)));
  p.conceptSetOutdated=x.conceptSetOutdated===true;
  if(x.variantOf&&typeof x.variantOf.projectId==='string'&&typeof x.variantOf.title==='string')p.variantOf={projectId:x.variantOf.projectId.slice(0,100),title:x.variantOf.title.slice(0,120),rootId:String(x.variantOf.rootId||x.variantOf.projectId).slice(0,100),rootTitle:String(x.variantOf.rootTitle||x.variantOf.title).slice(0,120),number:Number.isInteger(x.variantOf.number)&&x.variantOf.number>0?x.variantOf.number:1,inheritedImages:x.variantOf.inheritedImages===true};
  if(x.resultDraft&&typeof x.resultDraft==='object')p.resultDraft={text:typeof x.resultDraft.text==='string'?x.resultDraft.text.slice(0,4000):'',includeFindings:x.resultDraft.includeFindings===true,open:x.resultDraft.open===true};
  if([1,2].includes(x.route?.version))p.route={version:x.route.version,current:x.route.current};
  ensureRoute(p);
  if(x.aiData&&typeof x.aiData==='object')p.aiData=structuredClone(x.aiData);if(p.panels)syncPrimaryPanel(p);
  if(p.layers===1&&(p.palette.length!==1||p.frame==='cut'))throw Error('layers');
  if(history){if(!Array.isArray(x.versions)||x.versions.length>20)throw Error('versions');p.versions=x.versions.map(v=>{if(!v||!v.data)throw Error('version');return {id:id(),number:Number.isInteger(v.number)&&v.number>0?v.number:undefined,label:typeof v.label==='string'?v.label.slice(0,120):'',reason:typeof v.reason==='string'?v.reason.slice(0,200):'',savedAt:Number.isNaN(Date.parse(v.savedAt))?date():v.savedAt,data:normalizeImported(v.data,false)};});}
  backfillPanelHistory(p);return p;
}
 return normalizeImported(x);
}

// Restore saved content while retaining durable history and excluding transient job state.
export function restoreProjectVersion(p,source,{at=new Date().toISOString()}={}) {
  const data=structuredClone(source),history=p.versions,counter=p.versionCounter,origin=p.variantOf,runs=p.conceptRuns||[],previousPanels=p.panels;
  Object.assign(p,{approved:false,appearanceApproval:null,approvedAt:null,paletteConfirmation:null,route:null,resultDraft:null,tracing:null,selection:null,previewProvenance:null,aiData:null,aiReport:null,pendingAssetsUpdate:[],conceptSetOutdated:false,panels:undefined,activePanelId:null},data,
    {id:p.id,versions:history,versionCounter:counter,conceptRuns:runs,...origin?{variantOf:origin,approved:false,appearanceApproval:null,approvedAt:null}:{}});
  for(const key of ['aiJob','aiLaunchAction','aiLaunchTarget','aiLaunchPanelId','aiLaunchError','aiLaunchErrorAction','generationTarget','scopePanelId'])delete p[key];
  inheritPanelHistory(p,previousPanels);backfillPanelHistory(p);p.updatedAt=at;
  return p;
}
