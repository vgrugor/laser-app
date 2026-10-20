import test from 'node:test';
import assert from 'node:assert/strict';
import { generationState, GENERATION_STAGES } from '../dist/generation.js';

const fixture = (status = 'running', stage = 'preview') => ({
  assets: { master: 'old', preview: 'old' }, pendingAssetsUpdate: [],
  aiJob: { id: 'job', action: 'generate', status, stage, availableAssets: ['master'] },
});

test('progress reflects sequential server stages without assuming the active stage is complete', () => {
  const state = generationState(fixture());
  assert.deepEqual(GENERATION_STAGES.map(s => s.id), ['plan', 'prompts', 'master', 'preview', 'review']);
  assert.deepEqual(state.stages.map(s => s.state), ['done', 'done', 'done', 'active', 'waiting']);
  assert.deepEqual(state.availableAssets, ['master']);
  const failed = generationState(fixture('failed'));
  assert.deepEqual(failed.stages.map(s => s.state), ['done', 'done', 'done', 'stopped', 'waiting']);
});

test('connection loss preserves the running job and cancellation waits for server confirmation', () => {
  const p = fixture(); p.aiJob.cancelRequested = true;
  assert.equal(generationState(p).status, 'cancelling');
  assert.equal(generationState(p, { connectionError: 'Немає зв’язку' }).status, 'disconnected');
  assert.equal(p.aiJob.status, 'running');
  p.aiJob.status = 'cancelled'; assert.equal(generationState(p).status, 'cancelled');
});

test('review-only recovery requires images applied from this job, not an older pair', () => {
  const p = fixture('failed', 'review'); p.aiData = { plan: { summary: 'План' } };
  assert.equal(generationState(p).canReviewOnly, false);
  p.aiJob.appliedAssets = ['master', 'preview'];
  assert.equal(generationState(p).canReviewOnly, true);
  p.pendingAssetsUpdate = ['preview']; assert.equal(generationState(p).canReviewOnly, false);
});

test('new launch attempts never display previous completed stages as progress of a new job', () => {
  const p = fixture('completed', 'review');
  assert.ok(generationState(p).stages.every(s => s.state === 'done'));
  assert.ok(generationState(p, { launching: true }).stages.every(s => s.state === 'waiting'));
  const failed = generationState(p, { launchError: 'Немає сервера' });
  assert.equal(failed.status, 'start_failed'); assert.ok(failed.stages.every(s => s.state === 'waiting'));
});

test('completed jobs become an explicit update action after source changes, without reusing their old progress', async () => {
  const {generationScreen}=await import('../dist/generation.js');
  const p=fixture('completed','review');p.pendingAssetsUpdate=['master','preview'];
  const state=generationState(p);assert.equal(state.status,'outdated');assert.ok(state.stages.every(s=>s.state==='waiting'));assert.deepEqual(state.availableAssets,[]);
  const html=generationScreen(p,{esc:String});assert.match(html,/Оновити зображення/);assert.match(html,/data-action="ai-generate"/);assert.doesNotMatch(html,/Зображення створено/);
  assert.equal(p.aiJob.status,'completed');assert.equal(p.assets.master,'old');
  p.aiJob.status='failed';assert.equal(generationState(p).status,'failed');
  p.aiJob=null;assert.equal(generationState(p).status,'outdated');
});
