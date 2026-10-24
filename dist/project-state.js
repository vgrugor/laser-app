import { ensureRoute, ROUTE_VERSION } from './project-route.js';
import { validatePanels } from './panels.js';

export const STATE_VERSION = 2;
export const ROUTE_BACKUP_KEY = 'state-before-route-v2';

// Upgrade only metadata and missing defaults. Images, approval, IDs and dates stay intact.
function upgradeProject(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw Error('Некоректні дані проєкту.');
  validatePanels(p);
  if (p.route?.version > ROUTE_VERSION) throw Error('Цей проєкт збережений новішою версією застосунку.');
  let changed = p.route?.version !== ROUTE_VERSION;
  const defaults = { layers: 2, pendingAssetsUpdate: [], assets: { master: null, preview: null },
    concepts: [], selected: null, notes: [], locks: [], palette: [], versions: [],
    reviews: { engraving: 'unknown', palette: 'unknown', parts: 'unknown', composition: 'unknown' } };
  for (const [key, value] of Object.entries(defaults)) {
    if (!Object.hasOwn(p, key) || (p[key] == null && value !== null)) { p[key] = value; changed = true; }
  }
  if (!Array.isArray(p.versions)) throw Error('Некоректна історія проєкту.');
  for (const version of p.versions) {
    if (!version?.data || version.data.versions?.length) throw Error('Некоректна збережена версія.');
    changed = upgradeProject(version.data) || changed;
  }
  ensureRoute(p);
  return changed;
}

export function migrateStoredState(source) {
  if (!source || !Array.isArray(source.projects)) throw Error('Некоректне локальне сховище.');
  if (source.schemaVersion > STATE_VERSION) throw Error('Локальне сховище створено новішою версією застосунку.');
  const state = structuredClone(source);
  let migrated = state.schemaVersion !== STATE_VERSION;
  for (const p of state.projects) migrated = upgradeProject(p) || migrated;
  if (!state.projects.some(p => p.id === state.active)) {
    const active = state.projects[0]?.id || null;
    migrated = state.active !== active || migrated;
    state.active = active;
  }
  state.schemaVersion = STATE_VERSION;
  return { state, migrated };
}

export function importedConceptSelection(source, colorIds) {
  const concepts = source.concepts ?? [];
  if (!Array.isArray(concepts) || concepts.length > 10) throw Error('Некоректний набір концепцій.');
  const ids = new Set();
  for (const c of concepts) {
    if (!c || typeof c.id !== 'string' || !c.id || c.id.length > 200 || ids.has(c.id)
      || typeof c.title !== 'string' || !c.title.trim() || c.title.length > 500
      || typeof c.description !== 'string' || c.description.length > 8000
      || !['engraved', 'cut', 'none'].includes(c.frame)
      || (c.palette !== undefined && (!Array.isArray(c.palette) || !c.palette.length
        || c.palette.length > 4 || new Set(c.palette).size !== c.palette.length
        || c.palette.some(id => !colorIds.includes(id))))) throw Error('Некоректна концепція.');
    ids.add(c.id);
  }
  if (source.selected != null && !ids.has(source.selected)) throw Error('Обрана концепція відсутня в наборі.');
  return { concepts: structuredClone(concepts), selected: source.selected ?? null,
    prepared: source.prepared === undefined ? Boolean(source.assets?.master || source.assets?.preview) : Boolean(source.prepared) };
}

// Both writes commit together. Quota errors or aborts leave the original state untouched.
export function writeAppState(db, state, { backup } = {}) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('app', 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error || Error('Запис у локальне сховище перервано.'));
    try {
      const store = tx.objectStore('app');
      if (backup !== undefined) store.put(structuredClone(backup), ROUTE_BACKUP_KEY);
      store.put(structuredClone(state), 'state');
    } catch (error) {
      tx.abort();
      reject(error);
    }
  });
}
