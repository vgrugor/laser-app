import test from 'node:test';
import assert from 'node:assert/strict';
import {createVariant,mustForkForChange,needsSourceCheckpoint,markSourceChanged,generationBasis,variantNotice} from '../dist/variants.js';
const source=()=>({id:'parent',title:'Ліс',type:'Панно',brief:'Ліс',width:200,height:200,layers:2,palette:['clear'],frame:'engraved',approved:true,approvedAt:'yesterday',appearanceApproval:{signature:'accepted'},assets:{master:'old-master',preview:'old-preview'},concepts:[{id:'one',title:'Ліс',palette:['clear'],frame:'engraved'}],selected:'one',notes:['Зберегти дерево'],locks:[],reviews:{composition:'pass'},versions:[{id:'old'}],aiJob:{id:'old',status:'completed'},route:{version:2,current:'saved'}});
test('parameter variant is independent and preserves the accepted source and inherited images',()=>{
 const p=source(),before=structuredClone(p),child=createVariant(p,[p],{id:'child'});
 assert.deepEqual(p,before);assert.equal(child.approved,false);assert.equal(child.appearanceApproval,null);assert.equal(child.aiJob,null);assert.deepEqual(child.versions,[]);assert.deepEqual(child.assets,p.assets);assert.equal(child.variantOf.inheritedImages,true);
 child.notes.push('Правка');child.assets.master='new';assert.deepEqual(p,before);
});
test('another concept starts separately with the original set but without old images or selection',()=>{
 const p=source(),child=createVariant(p,[p],{id:'child',mode:'concepts'});
 assert.deepEqual(child.concepts,p.concepts);assert.equal(child.selected,null);assert.deepEqual(child.assets,{master:null,preview:null});assert.deepEqual(child.notes,[]);assert.equal(child.route.current,'concepts');assert.equal(p.selected,'one');
});
test('variant numbering continues across siblings and descendants',()=>{
 const p=source(),a=createVariant(p,[p],{id:'a'}),b=createVariant(a,[p,a],{id:'b'}),c=createVariant(p,[p,a,b],{id:'c'});
 assert.equal(b.title,'Ліс · варіант 2');assert.equal(c.title,'Ліс · варіант 3');assert.equal(b.variantOf.projectId,'a');assert.equal(b.variantOf.rootId,p.id);
});
test('accepted or in-flight source forks; changed drafts need only one source checkpoint',()=>{
 const p=source();assert.equal(mustForkForChange(p),true);p.approved=false;p.aiJob.status='running';assert.equal(mustForkForChange(p),true);p.aiJob.status='completed';assert.equal(mustForkForChange(p),false);
 assert.equal(needsSourceCheckpoint(p),true);markSourceChanged(p);p.pendingAssetsUpdate=['master','preview'];assert.equal(needsSourceCheckpoint(p),false);assert.equal(p.conceptSetOutdated,true);assert.equal(p.conceptReuseConfirmation,null);
});
test('generation acknowledgement follows source inputs but ignores navigation and draft typing',async()=>{
 const p=source(),before=await generationBasis(p);p.route.current='brief';p.resultDraft={text:'Незастосована правка'};assert.equal(await generationBasis(p),before);p.width++;assert.notEqual(await generationBasis(p),before);
});
test('parent links appear only when the source is available locally',()=>{
 const child=createVariant(source(),[],{id:'child'});assert.doesNotMatch(variantNotice(child,{esc:String}),/data-open/);assert.match(variantNotice(child,{esc:String,parentExists:true}),/data-open="parent"/);
});
