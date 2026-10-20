import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaletteConfirmation,paletteIsConfirmed,paletteSignature } from '../dist/palette-confirmation.js';
import { createAI } from '../dist/ai.js';

const colors=[{id:'clear',name:'Чистий',hex:'#BAA687'},{id:'pine',name:'Сосна',hex:'#C19F42'},{id:'alder',name:'Вільха',hex:'#916634'},{id:'walnut',name:'Горіх',hex:'#9E805D'},{id:'black',name:'Чорна',hex:'#2A2725'}];
function setup(t){
  const old=globalThis.document;t.after(()=>{globalThis.document=old;});
  const buttons=colors.map(c=>({dataset:{paletteChoice:c.id}})),nodes=new Map();
  globalThis.document={querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',textContent:'',disabled:false,querySelectorAll:()=>buttons});return nodes.get(selector);}};
  const dialog=new EventTarget();dialog.open=false;
  const p={id:'p',palette:['clear','pine'],layers:2};let html='',changes=0;
  const controller=createPaletteConfirmation({colors,esc:String,modal:text=>{html=text;dialog.open=true;},dialog,close:()=>{dialog.open=false;dialog.dispatchEvent(new Event('close'));},current:()=>p,persist:async()=>{},render(){},onChange(){changes++;}});
  return {controller,p,dialog,nodes,buttons,get html(){return html;},get changes(){return changes;}};
}
test('first confirmation is explicit, repeat is skipped and changed palette needs confirmation',async t=>{
  const s=setup(t),promise=s.controller.ensure(s.p);assert.equal(paletteIsConfirmed(s.p),false);assert.ok(s.html.includes('Агент може використати лише частину'));
  await s.nodes.get('#confirm-concept-palette').onclick();assert.equal(await promise,true);assert.equal(paletteIsConfirmed(s.p),true);assert.equal(await s.controller.ensure(s.p),true);
  s.p.palette=['clear'];assert.equal(paletteIsConfirmed(s.p),false);assert.notEqual(s.p.paletteConfirmation.signature,paletteSignature(s.p));
});
test('cancel discards draft colors and does not confirm or change project',async t=>{
  const s=setup(t),promise=s.controller.ensure(s.p);s.buttons.find(b=>b.dataset.paletteChoice==='pine').onclick();
  s.dialog.dispatchEvent(new Event('cancel'));assert.equal(await promise,false);assert.deepEqual(s.p.palette,['clear','pine']);assert.equal(paletteIsConfirmed(s.p),false);assert.equal(s.changes,0);
});
test('selected colors are committed only on confirmation and invalidate old images via callback',async t=>{
  const s=setup(t),promise=s.controller.ensure(s.p);s.buttons.find(b=>b.dataset.paletteChoice==='pine').onclick();assert.deepEqual(s.p.palette,['clear','pine']);
  await s.nodes.get('#confirm-concept-palette').onclick();assert.equal(await promise,true);assert.deepEqual(s.p.palette,['clear']);assert.equal(s.changes,1);
});
test('palette count rules and one-layer selection are enforced inside the dialog',async t=>{
  const s=setup(t);s.p.palette=['clear','pine','alder'];let promise=s.controller.ensure(s.p);
  s.buttons.find(b=>b.dataset.paletteChoice==='walnut').onclick();assert.ok(s.nodes.get('#palette-message').textContent.includes('четвертим'));
  s.buttons.find(b=>b.dataset.paletteChoice==='black').onclick();await s.nodes.get('#confirm-concept-palette').onclick();assert.equal(await promise,true);assert.deepEqual(s.p.palette,['clear','pine','alder','black']);
  s.p.layers=1;s.p.palette=['clear'];promise=s.controller.ensure(s.p);s.buttons.find(b=>b.dataset.paletteChoice==='pine').onclick();await s.nodes.get('#confirm-concept-palette').onclick();await promise;assert.deepEqual(s.p.palette,['pine']);
});
test('queued close event of a previous modal does not cancel the palette modal',async t=>{
  const s=setup(t),promise=s.controller.ensure(s.p);s.dialog.dispatchEvent(new Event('close'));assert.equal(s.dialog.open,true);
  await s.nodes.get('#confirm-concept-palette').onclick();assert.equal(await promise,true);
});
test('all AI concept entry points wait for confirmation; cancellation never reaches SDK',async t=>{
  const oldFetch=globalThis.fetch,oldDocument=globalThis.document;t.after(()=>{globalThis.fetch=oldFetch;globalThis.document=oldDocument;});
  globalThis.document={querySelector:()=>null};let requests=0,resolve;
  globalThis.fetch=async()=>{requests++;throw Error('Must not reach network');};
  const confirmation=new Promise(done=>resolve=done),p={id:'p',palette:['clear'],layers:2};
  const ai=createAI({confirmPalette:()=>confirmation,current:()=>p,projects:()=>[p],persist:async()=>{},snapshot:async()=>{},render(){},toast(){},esc:String,validate:()=>true});
  const first=ai.start('concepts'),second=ai.action('concepts');assert.equal(requests,0);resolve(false);await Promise.all([first,second]);assert.equal(requests,0);
});
