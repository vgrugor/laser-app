import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { panelMetadata, panelState } from '../dist/panels.js';
import { COMPOSITION_GUIDANCE, MASTER_VIEW_GUIDANCE, COMPOSITION_REVIEW_GUIDANCE } from '../dist/composition-guidance.js';

// Increment when planning instructions or preparation schema semantics change.
export const PLANNING_VERSION=1;
export const digest=value=>createHash('sha256').update(typeof value==='string'||ArrayBuffer.isView(value)?value:JSON.stringify(value)).digest('hex');
const text={type:'string'};
export const sharedPlanSchema={type:'object',properties:{summary:text,style:text,coordination:text,panels:{type:'array',items:{type:'object',properties:{id:text,description:text},required:['id','description'],additionalProperties:false}}},required:['summary','style','coordination','panels'],additionalProperties:false};
export function validSharedPlan(content,project){
  const nonempty=s=>typeof s==='string'&&s.trim().length>0&&s.length<=8000;
  return content&&['summary','style','coordination'].every(k=>nonempty(content[k]))&&Array.isArray(content.panels)&&content.panels.length===panelMetadata(project).length&&content.panels.every((x,i)=>x?.id===panelMetadata(project)[i].id&&nonempty(x.description));
}
export function sharedPlanSignature(project,knowledge,type,referenceHash){
  return digest([PLANNING_VERSION,project.title,project.type,project.clockMount,project.brief,project.palette,project.layers,project.frame,project.concepts?.find(c=>c.id===project.selected)||null,panelMetadata(project),referenceHash,type,knowledge.manifestHash,knowledge.paletteHash,digest(knowledge.text),COMPOSITION_GUIDANCE,MASTER_VIEW_GUIDANCE,COMPOSITION_REVIEW_GUIDANCE]);
}
export function reusableSharedPlan(cache,signature,project){
  return cache?.version===PLANNING_VERSION&&cache.signature===signature&&validSharedPlan(cache.content,project)&&cache.contentHash===digest(cache.content);
}
export function localPlanSignature(project,action,knowledge,type,{sharedSignature=null,styleReferences=[],referenceHash=null,inputMasterHash=null,inputPreviewHash=null}={}){
  return digest([PLANNING_VERSION,project,action,sharedSignature,styleReferences,referenceHash,action==='edit'?[inputMasterHash,inputPreviewHash]:null,type,knowledge.manifestHash,knowledge.paletteHash,digest(knowledge.text),COMPOSITION_GUIDANCE,MASTER_VIEW_GUIDANCE,COMPOSITION_REVIEW_GUIDANCE]);
}
export function cachedPreparation(cache,signature,project,validate){
  if(cache?.planning?.version!==PLANNING_VERSION||cache.planning.signature!==signature)return {};
  try{
    if(cache.planning.planHash!==digest(cache.plan))return {};
    const plan=validate('plan',structuredClone(cache.plan),project);
    let prompts;
    try{if(cache.planning.promptsHash===digest(cache.prompts))prompts=validate('prompts',structuredClone(cache.prompts),project);}catch{}
    return {plan,prompts};
  }catch{return {};}
}
// Only explicit, current user choices participate. De-duplicate bytes and omit this panel's image.
export async function styleInputs({root,directory,project,current,saveInput,readFile}){
  const own=current.assets?.master?await saveInput(root,directory,'style-own',current.assets.master):null;
  const seen=new Set(own?[digest(await readFile(own))]:[]),images=[],references=[];
  for(const part of project.panels||[]){
    if(part.id===current.id||panelState(part)!=='selected')continue;
    const path=await saveInput(root,directory,`style-${references.length+1}`,part.assets.master),hash=digest(await readFile(path));
    if(seen.has(hash))continue;
    seen.add(hash);images.push(path);references.push({id:part.id,name:part.name,width:part.width,height:part.height,file:basename(path),sha256:hash});
    if(references.length===3)break;
  }
  return {images,references};
}
