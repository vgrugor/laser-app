import test from 'node:test';
import assert from 'node:assert/strict';
import { selectConcept, conceptIssue } from '../dist/concepts.js';

const fixture = () => ({ palette: ['clear', 'pine', 'black'], layers: 2, selected: null, frame: 'engraved',
  assets: { master: 'existing-master', preview: 'existing-preview' },
  concepts: [{ id: 'one', title: 'Ліс', palette: ['clear', 'black'], frame: 'cut' },
    { id: 'two', title: 'Стежка', palette: ['clear', 'pine'], frame: 'engraved' }] });

test('choosing multiple concepts preserves the available palette, saved set and existing images', () => {
  const p = fixture(), original = structuredClone(p);
  assert.equal(selectConcept(p, 'one'), true); assert.equal(p.frame, 'cut');
  assert.equal(selectConcept(p, 'two'), true); assert.equal(p.frame, 'engraved');
  assert.equal(selectConcept(p, 'two'), false);
  assert.deepEqual(p.palette, original.palette); assert.deepEqual(p.concepts, original.concepts);
  assert.deepEqual(p.assets, original.assets); assert.equal(p.selected, 'two');
});

test('concepts incompatible with changed colors or a one-layer construction cannot be selected', () => {
  const p = fixture(); p.palette = ['clear']; const original = structuredClone(p);
  assert.match(conceptIssue(p, p.concepts[0]), /морилки/);
  assert.equal(selectConcept(p, 'one'), false); assert.deepEqual(p, original);
  p.palette = ['clear', 'pine', 'black']; p.layers = 1;
  assert.match(conceptIssue(p, p.concepts[0]), /інкрустації/);
  assert.equal(selectConcept(p, 'missing'), false);
});
