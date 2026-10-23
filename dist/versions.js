import { approvedWithAiRemarks } from './approval.js';

// Images stay in their master/preview roles. Group across the entire history,
// preserving its newest entry for each exact pair, including partial results.
export function versionEntries(versions, mode = 'images', imageKey = src => src || null) {
  const newestFirst = [...versions].reverse();
  if (mode === 'all') return newestFirst.map(version => ({ version, count: 1 }));
  const entries = [], pairs = new Map();
  for (const version of newestFirst) {
    const master = imageKey(version.data?.assets?.master) || null;
    const preview = imageKey(version.data?.assets?.preview) || null;
    if (!master && !preview) continue;
    let previews = pairs.get(master);
    if (!previews) pairs.set(master, previews = new Map());
    const previous = previews.get(preview);
    if (previous) previous.count++;
    else {
      const entry = { version, count: 1 };
      previews.set(preview, entry);entries.push(entry);
    }
  }
  return entries;
}

export function versionHistory(versions, { mode = 'images', esc, safeImage, icon, label, time, concept }) {
  const entries = versionEntries(versions, mode, safeImage);
  const empty = !versions.length ? 'Збережіть поточну версію, щоб повернутися до неї пізніше.'
    : 'У збережених версіях ще немає зображень. Оберіть «Усі версії», щоб переглянути задум і параметри.';
  return `<div id="version-history-content"><div class="version-filter" role="group" aria-label="Відображення історії версій">${[['images','Лише різні зображення'],['all','Усі версії']].map(([key,text])=>`<button type="button" class="btn tiny ${mode===key?'active':''}" data-version-mode="${key}" aria-pressed="${mode===key}">${text}</button>`).join('')}</div><p class="hint" role="status">Показано: ${entries.length} · усього версій: ${versions.length}. ${mode==='images'?'Для кожної пари зображень показано найновішу версію.':'Збережені стани проєкту · новіші зверху · до 20 версій.'}</p><p class="hint">Натисніть картку, щоб переглянути, назвати або відновити.</p><div class="versions">${entries.length?entries.map(({version:v,count})=>{
    const preview=safeImage(v.data.assets?.preview)||safeImage(v.data.assets?.master);
    return `<button class="version" data-version-id="${esc(v.id)}">${preview?`<img src="${preview}" alt="">`:icon('file')}<span class="version-info"><strong>v${v.number} · ${esc(label(v))}</strong><small>${esc(time(v))}</small><small>${esc(concept(v)||'Без обраної концепції')} · ${approvedWithAiRemarks(v.data)?'Погоджено із зауваженнями ШІ':v.data.approved?'Погоджено':'Чернетка'}</small><small>${esc(v.reason||'Раніше збережений стан')}</small>${count>1?`<small>Збережень із цими зображеннями: ${count}</small>`:''}</span></button>`;
  }).join(''):`<span class="hint">${empty}</span>`}</div></div>`;
}
