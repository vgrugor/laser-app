import { ensureRoute } from './project-route.js';

export function createVariant(source, projects, { mode = 'parameters', id = crypto.randomUUID(), at = new Date().toISOString() } = {}) {
  const rootId = source.variantOf?.rootId || source.id;
  const rootTitle = source.variantOf?.rootTitle || source.title;
  const number = Math.max(0, ...projects.filter(p => p.variantOf?.rootId === rootId).map(p => Number(p.variantOf.number) || 0)) + 1;
  const p = structuredClone(source);
  Object.assign(p, { id, title: `${rootTitle.slice(0,80)} · варіант ${number}`, createdAt: at, updatedAt: at,
    approved: false, approvedAt: null, appearanceApproval: null, versions: [], versionCounter: 0,
    aiJob: null, aiLaunchAction: null, aiLaunchError: null, aiLaunchErrorAction: null, resultDraft: null, example: null,
    conceptReuseConfirmation: null,
    variantOf: { projectId: source.id, title: source.title, rootId, rootTitle, number,
      inheritedImages: Boolean(source.assets?.master || source.assets?.preview) } });
  if (mode === 'concepts') {
    Object.assign(p, { assets: { master: null, preview: null }, pendingAssetsUpdate: [], selected: null,
      prepared: false, aiData: null, aiReport: null, notes: [], locks: [],
      reviews: { engraving: 'unknown', palette: 'unknown', parts: 'unknown', composition: 'unknown' } });
    p.variantOf.inheritedImages = false;
    p.route = { version: 2, current: p.concepts?.length ? 'concepts' : 'brief' };
  }
  ensureRoute(p);
  return p;
}

export const hasSourceResult = p => Boolean(p.assets?.master || p.assets?.preview);
export const mustForkForChange = p => Boolean(p.approved || ['running','queued'].includes(p.aiJob?.status));
export const needsSourceCheckpoint = p => hasSourceResult(p) ? !p.pendingAssetsUpdate?.length : Boolean(p.concepts?.length && !p.conceptSetOutdated);

export async function generationBasis(p) {
  const value = JSON.stringify([p.type,p.clockMount,p.width,p.height,p.layers,p.frame,p.brief,p.palette,p.reference,
    p.selected,p.concepts?.find(c=>c.id===p.selected),p.notes,p.locks,p.assets]);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
}

export function markSourceChanged(p) {
  p.conceptSetOutdated = Boolean(p.concepts?.length);
  p.conceptReuseConfirmation = null;
}

export function variantNotice(p, { esc, parentExists = false }) {
  if (p.variantOf) return `<div class="variant-notice"><div><strong>Окремий варіант виробу</strong><p>На основі «${esc(p.variantOf.title)}».${p.variantOf.inheritedImages?' Зображення успадковані з вихідного проєкту; їх можна використати для правок.':''}</p></div>${parentExists?`<button class="btn tiny" data-open="${esc(p.variantOf.projectId)}">Відкрити вихідний виріб</button>`:''}</div>`;
  if (p.approved) return '<div class="variant-notice"><p>Цей вигляд прийнято. Зміни параметрів, правки чи інша концепція створять окремий варіант, а вихідний виріб залишиться у колекції.</p></div>';
  return '';
}
