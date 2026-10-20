import test from 'node:test';
import assert from 'node:assert/strict';
import { briefIsReady, ensureRoute, moveToRoute, projectRoute, routeAfterJob, ROUTE_STEPS } from '../dist/project-route.js';
import { paletteSignature } from '../dist/palette-confirmation.js';

const draft = () => ({ type: 'Панно', brief: 'Лісова композиція', width: 200, height: 300,
  layers: 2, palette: ['clear', 'black'], concepts: [], selected: null, prepared: false,
  assets: { master: null, preview: null }, pendingAssetsUpdate: [], approved: false });
const available = p => projectRoute(p).steps.filter(s => s.available).map(s => s.id);

test('six stages have explicit prerequisites; entering one never starts work', () => {
  const p = draft();
  assert.deepEqual(ROUTE_STEPS.map(s => s.id), ['brief', 'palette', 'concepts', 'generation', 'result', 'saved']);
  assert.equal(ensureRoute(p), 'brief');
  assert.deepEqual(available(p), ['brief', 'palette']);
  assert.equal(moveToRoute(p, 'generation'), false);
  assert.equal(moveToRoute(p, 'saved'), false);
  p.paletteConfirmation = { signature: paletteSignature(p) };
  assert.equal(moveToRoute(p, 'concepts'), true);
  assert.equal(p.aiJob, undefined);
  p.concepts = [{ id: 'one' }]; p.selected = 'one';
  assert.equal(moveToRoute(p, 'generation'), true);
  assert.equal(moveToRoute(p, 'result'), false);
});

test('brief prerequisites use manufacturing bounds and reject incomplete input', () => {
  const p = draft(); p.brief = ' ';
  assert.equal(briefIsReady(p), false); assert.deepEqual(available(p), ['brief']);
  p.brief = 'Ліс'; p.width = 400; p.height = 300;
  assert.equal(briefIsReady(p), true);
  p.height = 301; assert.equal(briefIsReady(p), false);
});

test('returning to earlier stages changes only route and survives a persisted round trip', () => {
  const p = draft(); Object.assign(p, { prepared: true, selected: 'one', concepts: [{ id: 'one' }],
    assets: { master: 'master', preview: 'preview' }, approved: true, notes: ['Ширша рамка'] });
  const original = structuredClone(p);
  assert.equal(ensureRoute(p), 'saved');
  for (const step of ['concepts', 'palette', 'brief', 'result']) {
    assert.equal(moveToRoute(p, step), true);
    const { route, ...content } = p;
    assert.deepEqual(content, original);
    const restored = structuredClone(p);
    assert.equal(ensureRoute(restored), step);
  }
  assert.equal(moveToRoute(p, 'unknown'), false);
});

test('old projects infer a useful stage without requiring historical palette confirmation', () => {
  const p = draft();
  p.concepts = [{ id: 'one' }]; assert.equal(ensureRoute(p), 'concepts');
  delete p.route; p.selected = 'one'; p.prepared = true;
  assert.equal(ensureRoute(p), 'generation');
  delete p.route; p.assets.master = 'partial';
  assert.equal(ensureRoute(p), 'result'); assert.equal(moveToRoute(p, 'concepts'), true);
  assert.equal(moveToRoute(p, 'saved'), false);
});

test('approval requires a current pair; unavailable or invalid saved stage falls back safely', () => {
  const p = draft(); p.assets = { master: 'a', preview: 'b' }; p.approved = true;
  assert.equal(ensureRoute(p), 'saved');
  p.pendingAssetsUpdate = ['master']; assert.equal(ensureRoute(p), 'result');
  p.route.current = 'toString'; assert.equal(ensureRoute(p), 'result');
  p.route = { version: 99, current: 'brief' }; assert.equal(ensureRoute(p), 'result');
  p.assets.preview = null; assert.equal(moveToRoute(p, 'saved'), false);
});

test('job outcomes distinguish empty failures, partial results, concepts and review-only work', () => {
  const p = draft(); p.aiJob = { id: 'job', action: 'generate', status: 'running' };
  assert.equal(ensureRoute(p), 'generation');
  assert.equal(projectRoute(p).steps.find(s => s.id === 'generation').complete, false);
  p.aiJob.status = 'failed'; routeAfterJob(p, 'generate', 'failed');
  assert.equal(p.route.current, 'generation');
  p.assets.master = 'partial'; p.aiJob.appliedAssets = ['master']; routeAfterJob(p, 'generate', 'failed');
  assert.equal(p.route.current, 'result'); assert.equal(moveToRoute(p, 'saved'), false);
  p.concepts = [{ id: 'new' }]; routeAfterJob(p, 'concepts', 'completed');
  assert.equal(p.route.current, 'concepts');
  moveToRoute(p, 'brief'); routeAfterJob(p, 'review', 'completed');
  assert.equal(p.route.current, 'brief');
});

test('launch failures and interrupted jobs are expanded in the shell instead of hiding actionable feedback',async()=>{
  const {projectShell}=await import('../dist/project-shell.js');
  const p=draft();p.route={version:2,current:'palette'};p.aiLaunchError='Сервер зайнятий';
  const html=projectShell(p,{esc:String,colors:[],content:'Палітра',aiPanel:'Помилка запуску'});assert.match(html,/<details class="project-ai-tools" open>/);
});
