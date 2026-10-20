import test from 'node:test';
import assert from 'node:assert/strict';
import { revisionNotes, resultActions } from '../dist/result.js';

test('revision submission combines explicit text with chosen AI findings without mutating the project', () => {
  const p = { notes: ['Зберегти форму'], aiReport: { findings: [{ location:'Рамка', observation:'Вузька', suggested_action:'Розширити' }] } };
  const original=structuredClone(p);
  assert.deepEqual(revisionNotes(p,'Змінити гілку',false),['Зберегти форму','Змінити гілку']);
  assert.deepEqual(revisionNotes(p,'Зберегти форму',true),['Зберегти форму','Рамка: Вузька Розширити']);
  assert.deepEqual(p,original);
});

test('empty revisions and excessive instructions do not silently start editing or discard old instructions', () => {
  assert.throws(()=>revisionNotes({notes:[]},' ',false),/Опишіть/);
  const p={notes:Array.from({length:100},(_,i)=>`Правка ${i}`)};
  assert.throws(()=>revisionNotes(p,'Нова правка',false),/100/);assert.equal(p.notes.length,100);
});

test('AI findings allow explicit acceptance while missing, outdated or actively changing images block it', () => {
  const p={assets:{master:'one',preview:'two'},notes:[],aiReport:{disposition:'changes_required'}};
  const html=resultActions(p,{esc:String});assert.match(html,/data-action="approve" >Прийняти/);
  for(const changed of [{...p,assets:{master:'one'}},{...p,pendingAssetsUpdate:['master']},{...p,aiJob:{status:'running'}}]) {
    assert.match(resultActions(changed,{esc:String}),/data-action="approve" disabled/);
  }
});
