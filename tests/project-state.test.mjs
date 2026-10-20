import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureRoute, projectRoute } from '../dist/project-route.js';
import { migrateStoredState, importedConceptSelection, writeAppState, ROUTE_BACKUP_KEY } from '../dist/project-state.js';

const project = () => ({ id: 'one', title: 'Ліс', type: 'Панно', brief: 'Ліс у колі', width: 200, height: 200,
  layers: 2, palette: ['clear'], concepts: [{ id: 'c1', title: 'Галявина', description: 'Дерева перекриваються', frame: 'cut', palette: ['clear'] }],
  selected: 'c1', prepared: true, assets: { master: 'data:image/png;base64,YQ==', preview: 'assets/bird-preview.png' },
  pendingAssetsUpdate: [], notes: ['Широка рамка'], locks: ['Композиція'], reference: 'data:image/png;base64,Yg==',
  versions: [], approved: true, appearanceApproval: { actor: 'user', aiRemarksAccepted: true },
  aiReport: { disposition: 'changes_required', findings: ['Збережений звіт'] },
  createdAt: '2026-10-01', updatedAt: '2026-10-02', customData: { keep: true } });
const stages = p => Object.fromEntries(projectRoute(p).steps.map(s => [s.id, s]));

test('migration preserves old content, named versions, approval and original source; it is idempotent', () => {
  const p = project(); const historical = project(); historical.approved = false;
  p.versions = [{ id: 'v1', number: 7, label: 'Широка рамка', savedAt: '2026-10-01', data: historical }];
  const source = { projects: [p], active: p.id, customSetting: 'keep' };
  const before = structuredClone(source);
  const result = migrateStoredState(source);
  assert.equal(result.migrated, true); assert.equal(result.state.schemaVersion, 2);
  assert.equal(result.state.projects[0].route.current, 'saved');
  for (const key of Object.keys(p).filter(k => k !== 'versions')) assert.deepEqual(result.state.projects[0][key], p[key]);
  const v = result.state.projects[0].versions[0];
  assert.equal(v.label, 'Широка рамка'); assert.equal(v.number, 7);
  for (const key of Object.keys(historical)) assert.deepEqual(v.data[key], historical[key]);
  assert.equal(v.data.route.current, 'result');
  assert.deepEqual(source, before);
  const again = migrateStoredState(result.state);
  assert.equal(again.migrated, false); assert.deepEqual(again.state, result.state);
});

test('v1 navigation is retained independently for each project and caches are recomputed', () => {
  const a = project(), b = project(); b.id = 'two';
  a.route = { version: 1, current: 'brief' }; b.route = { version: 1, current: 'result' };
  const { state } = migrateStoredState({ projects: [a, b], active: 'two' });
  assert.equal(state.active, 'two'); assert.equal(state.projects[0].route.current, 'brief');
  assert.equal(state.projects[1].route.current, 'result');
  const p = state.projects[1]; p.approved = false; p.pendingAssetsUpdate = ['master'];
  ensureRoute(p);
  assert.equal(p.route.steps.result.status, 'needs_attention');
  assert.match(p.route.steps.result.reason, /попередньому/);
  assert.equal(p.route.steps.saved.status, 'not_started');
});

test('status derivation handles partial results, AI findings, manual failures and explicit acceptance', () => {
  const p = project(); p.approved = false;
  assert.equal(stages(p).result.status, 'needs_attention'); assert.match(stages(p).result.reason, /ШІ/);
  p.reviews = { parts: 'fail' }; assert.match(stages(p).result.reason, /ручній/);
  p.assets.preview = null; assert.match(stages(p).result.reason, /обидва/);
  p.assets.preview = 'restored'; p.reviews = {}; p.approved = true;
  assert.equal(stages(p).result.status, 'ready'); assert.equal(stages(p).saved.status, 'ready');
  assert.equal(p.aiReport.disposition, 'changes_required');
});

test('running, failed, cancelled, interrupted and stale jobs are assigned to their actual step', () => {
  const p = project(); p.approved = false;
  for (const [action, step] of [['concepts', 'concepts'], ['generate', 'generation'], ['edit', 'generation'], ['review', 'result']]) {
    p.aiJob = { id: 'job', action, status: 'running' };
    assert.equal(stages(p)[step].status, 'running');
    for (const status of ['failed', 'cancelled', 'interrupted', 'stale']) {
      p.aiJob.status = status;
      assert.equal(stages(p)[step].status, 'needs_attention'); assert.ok(stages(p)[step].reason);
    }
  }
  p.approved = true;
  assert.equal(stages(p).saved.status, 'ready');
});

test('old drafts, active jobs and missing active IDs open a meaningful stage without losing a project', () => {
  const p = project(); p.approved = false; p.assets = {}; p.concepts = []; p.selected = null;
  p.aiJob = { id: 'job', action: 'generate', status: 'interrupted' };
  let upgraded = migrateStoredState({ projects: [p], active: 'missing' }).state;
  assert.equal(upgraded.active, p.id); assert.equal(upgraded.projects[0].route.current, 'generation');
  delete p.aiJob; p.prepared = false;
  upgraded = migrateStoredState({ projects: [p], active: p.id }).state;
  assert.equal(upgraded.projects[0].route.current, 'brief');
  assert.equal(upgraded.projects.length, 1);
  assert.throws(() => migrateStoredState({ schemaVersion: 999, projects: [p] }), /новішою/);
});

test('JSON import preserves the full concept set and selection while rejecting invalid references', () => {
  const p = project(); const result = importedConceptSelection(p, ['clear', 'black']);
  assert.deepEqual(result.concepts, p.concepts); assert.equal(result.selected, 'c1');
  result.concepts[0].title = 'Changed'; assert.equal(p.concepts[0].title, 'Галявина');
  assert.throws(() => importedConceptSelection({ ...p, selected: 'missing' }, ['clear']));
  assert.throws(() => importedConceptSelection({ ...p, concepts: [p.concepts[0], p.concepts[0]] }, ['clear']));
  assert.throws(() => importedConceptSelection({ ...p, concepts: [{ ...p.concepts[0], palette: ['invented'] }] }, ['clear']));
});

function memoryDB(initial, fail = false) {
  const committed = new Map([['state', structuredClone(initial)]]);
  return { committed, transaction() {
    const pending = new Map(committed); let aborted = false;
    const tx = { error: null, abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); },
      objectStore() { return { put(value, key) { if (fail && key === 'state') throw Error('Quota'); pending.set(key, value); } }; } };
    queueMicrotask(() => { if (!aborted) { committed.clear(); for (const [k, v] of pending) committed.set(k, v); tx.oncomplete?.(); } });
    return tx;
  } };
}

test('backup and upgraded data commit atomically; failed migration writes preserve the old store', async () => {
  const old = { projects: [project()], active: 'one' }, next = migrateStoredState(old).state;
  const db = memoryDB(old);
  await writeAppState(db, next, { backup: old });
  assert.deepEqual(db.committed.get(ROUTE_BACKUP_KEY), old); assert.deepEqual(db.committed.get('state'), next);
  const blocked = memoryDB(old, true);
  await assert.rejects(writeAppState(blocked, next, { backup: old }), /Quota/);
  assert.deepEqual(blocked.committed.get('state'), old); assert.equal(blocked.committed.has(ROUTE_BACKUP_KEY), false);
});
