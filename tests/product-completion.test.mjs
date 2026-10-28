import test from 'node:test';
import assert from 'node:assert/strict';
import { panelList, choosePanel, clearPanelSelection, panelsChosen, bindProductPreview, productPreviewStatus, importedPreviewProvenance, validatePanelOperation } from '../dist/panels.js';
import { productCompletion } from '../dist/product-completion.js';
import { approvalBlocker, createApproval } from '../dist/approval.js';
import { projectRoute } from '../dist/project-route.js';
const a='assets/magnolia-master.png',b='assets/bird-master.png',c='assets/tits-master.png';
function project(){
  const p={id:'p',title:'Box',type:'Шкатулка',brief:'Flowers',palette:['clear','pine'],frame:'engraved',layers:2,width:200,height:150,notes:[],locks:[],concepts:[{id:'c',title:'Flowers'}],selected:'c',assets:{master:a,preview:'assets/magnolia-preview.png'},pendingAssetsUpdate:[],reviews:{},approved:false,
    panels:[{id:'lid',name:'Lid',width:200,height:150,brief:'',assets:{master:a},notes:[],locks:[]},{id:'wall',name:'Wall',width:200,height:60,brief:'',assets:{master:b},notes:[],locks:[]}]};
  for(const part of p.panels)choosePanel(p,part.id);p.previewProvenance=bindProductPreview(p,{origin:'generated'});return p;
}
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');

test('preview binding detects source, construction and image changes independently of stale flags',()=>{
  for(const change of ['image','source','dimensions','palette','brief','layers']){
    const p=project();assert.equal(productPreviewStatus(p),'current');
    if(change==='image')p.assets.preview=c;
    if(change==='source')p.panels[1].assets.master=c;
    if(change==='dimensions')p.panels[1].width=220;
    if(change==='palette')p.palette=['clear'];
    if(change==='brief')p.brief='Different';
    if(change==='layers')p.layers=1;
    assert.equal(productPreviewStatus(p),'outdated');assert.ok(p.assets.preview);
  }
});

test('choices do not invalidate an unchanged view, but all choices are required for a new generation or acceptance',()=>{
  const p=project();clearPanelSelection(p,'wall');assert.equal(productPreviewStatus(p),'current');assert.equal(panelsChosen(p),false);
  assert.throws(()=>validatePanelOperation({...p,generationTarget:'preview'},'generate'),/оберіть результат/);assert.match(approvalBlocker(p),/оберіть результат/);
  choosePanel(p,'wall');assert.equal(approvalBlocker(p),null);
  p.panels[1].assets.master=c;choosePanel(p,'wall');assert.equal(productPreviewStatus(p),'outdated');assert.match(approvalBlocker(p),/поточними панелями/);
  assert.throws(()=>validatePanelOperation(p,'review'),/актуальний загальний/);
  assert.doesNotThrow(()=>validatePanelOperation({...p,scopePanelId:'wall'},'review'));
});

test('historic accepted sets remain accessible without fabricating panel choices or a source binding',()=>{
  const p=project();p.previewProvenance=null;for(const part of p.panels)part.selection=null;p.approved=true;p.route={version:2,current:'saved'};
  assert.equal(productPreviewStatus(p),'legacy');assert.equal(projectRoute(p).current,'saved');assert.ok(panelList(p).every(x=>!x.selection));
  assert.equal(approvalBlocker(p),null);assert.equal(p.previewProvenance,null);
  p.previewProvenance=bindProductPreview(p);p.assets.preview=c;assert.equal(projectRoute(p).steps.find(x=>x.id==='saved').available,false);
});

test('completion screen distinguishes missing, current and outdated view, keeping old images visible',()=>{
  const p=project();let html=productCompletion(p,{esc,safeImage:x=>x});assert.match(html,/Актуальний вигляд/);assert.match(html,/Перевірити весь комплект/);assert.match(html,/Створити контури всіх панелей/);
  p.panels[1].assets.master=c;html=productCompletion(p,{esc,safeImage:x=>x});assert.match(html,/Показано попередній/);assert.match(html,/Оновити загальний вигляд/);assert.match(html,/src="assets\/magnolia-preview.png"/);
  p.assets.preview=null;html=productCompletion(p,{esc,safeImage:x=>x});assert.match(html,/Згенерувати загальний вигляд/);assert.doesNotMatch(html,/<img/);
});

test('legacy appearance can be explicitly accepted without requiring AI; choices are rechecked at confirmation',async t=>{
  const previous=globalThis.document;t.after(()=>{globalThis.document=previous;});const nodes=new Map();
  globalThis.document={querySelector:key=>{if(!nodes.has(key))nodes.set(key,{disabled:false,textContent:'',value:''});return nodes.get(key);}};
  const approval=createApproval({esc,modal(){},close(){},toast(){},persist:async()=>{},snapshot:async()=>{},render(){},getTypeRevision:()=>1});
  const p=project();p.previewProvenance=null;await approval.open(p);clearPanelSelection(p,'wall');await nodes.get('#confirm-appearance').onclick();
  assert.equal(p.approved,false);assert.match(nodes.get('#approval-message').textContent,/оберіть результат/);
  choosePanel(p,'wall');await approval.open(p);await nodes.get('#confirm-appearance').onclick();assert.ok(p.approved);assert.equal(p.previewProvenance.origin,'user-confirmed');assert.equal(productPreviewStatus(p),'current');
});

test('portable provenance accepts only its bounded supported metadata shape',()=>{
  const p=project();assert.deepEqual(importedPreviewProvenance(p.previewProvenance),p.previewProvenance);
  assert.equal(importedPreviewProvenance({...p.previewProvenance,origin:'other'}),null);
  assert.equal(importedPreviewProvenance({...p.previewProvenance,sourceKey:'x'.repeat(151)}),null);
});
