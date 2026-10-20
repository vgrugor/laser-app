import test from 'node:test';
import assert from 'node:assert/strict';
import { createApproval,approvalBlocker,invalidateApproval,approvedWithAiRemarks } from '../dist/approval.js';

function setup(t){
  const oldDocument=globalThis.document;t.after(()=>{globalThis.document=oldDocument;});
  const nodes=new Map();globalThis.document={querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,{value:'',textContent:'',disabled:false});return nodes.get(selector);}};
  const report={disposition:'changes_required',findings:[{severity:'blocker',location:'Рамка',observation:'Тонкий фрагмент',suggested_action:'Спростити'}],manual_checks:['Ширини у CAD']};
  const p={id:'project',type:'Панно',assets:{master:'image-one',preview:'image-two'},palette:['clear'],notes:[],locks:[],concepts:[],pendingAssetsUpdate:[],reviews:{engraving:'unknown'},aiReport:report,approved:false};
  let html='',closed=false;const messages=[],snapshots=[];
  const approval=createApproval({esc:String,modal:value=>html=value,close:()=>{closed=true;},toast:value=>messages.push(value),persist:async()=>{},snapshot:async(project,notify,reason)=>snapshots.push({data:structuredClone(project),reason}),render(){},getTypeRevision:()=>1});
  return {p,report,nodes,messages,snapshots,approval,get html(){return html;},get closed(){return closed;}};
}
test('AI remarks can be accepted explicitly without changing the AI report',async t=>{
  const s=setup(t);await s.approval.open(s.p);assert.ok(s.html.includes('Погодити попри зауваження ШІ'));assert.equal(s.p.approved,false);
  globalThis.document.querySelector('#approval-reason').value='Виправлю під час обведення';
  await s.nodes.get('#confirm-appearance').onclick();
  assert.equal(s.p.approved,true);assert.equal(approvedWithAiRemarks(s.p),true);assert.equal(s.p.aiReport,s.report);assert.equal(s.p.aiReport.disposition,'changes_required');
  assert.equal(s.p.appearanceApproval.comment,'Виправлю під час обведення');assert.equal(s.p.appearanceApproval.actor,'user');assert.equal(s.p.appearanceApproval.scope,'appearance');
  assert.match(s.p.appearanceApproval.revisionSignature,/^[a-f0-9]{64}$/);assert.equal(s.snapshots[0].data.appearanceApproval.aiRemarksAccepted,true);assert.ok(s.snapshots[0].reason.includes('попри'));assert.equal(s.closed,true);
});
test('normal approval does not invent an AI override or require a comment',async t=>{
  const s=setup(t);s.p.aiReport={disposition:'pass_visual',findings:[],manual_checks:[]};await s.approval.open(s.p);assert.ok(!s.html.includes('approval-reason'));
  await s.nodes.get('#confirm-appearance').onclick();assert.equal(s.p.approved,true);assert.equal(s.p.appearanceApproval.aiRemarksAccepted,false);
});
test('changed images or AI report invalidate the open confirmation',async t=>{
  const s=setup(t);await s.approval.open(s.p);s.p.assets.master='new-image';await s.nodes.get('#confirm-appearance').onclick();assert.equal(s.p.approved,false);assert.equal(s.snapshots.length,0);
  await s.approval.open(s.p);s.p.aiReport={...s.report,findings:[]};await s.nodes.get('#confirm-appearance').onclick();assert.equal(s.p.approved,false);assert.equal(s.snapshots.length,0);
});
test('missing images, outdated assets and user-entered failures still require resolution',async t=>{
  const s=setup(t);
  for(const p of [{...s.p,pendingAssetsUpdate:['master']},{...s.p,assets:{master:null,preview:'image'}},{...s.p,reviews:{parts:'fail'}}])assert.ok(approvalBlocker(p));
  assert.equal(approvalBlocker(s.p),null);
});
test('new edits clear both approval and the AI-remarks acceptance record',async t=>{
  const s=setup(t);await s.approval.open(s.p);await s.nodes.get('#confirm-appearance').onclick();const saved=structuredClone(s.p);invalidateApproval(s.p);
  assert.equal(s.p.approved,false);assert.equal(s.p.appearanceApproval,null);assert.equal(s.p.approvedAt,null);assert.equal(approvedWithAiRemarks(s.p),false);assert.equal(saved.appearanceApproval.aiRemarksAccepted,true);
});
