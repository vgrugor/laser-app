// Derived raster guides live outside the approved colour pair and its AI report.
// Legacy keys remain portable; new runs produce only outline.
export const TRACING_KINDS = ['outline', 'contour', 'engraving'];
export const TRACING_LABELS = {outline:'Спільний контурний рисунок',contour:'Контури різання (попередній формат)',engraving:'Рисунок гравіювання (попередній формат)','tracing-review':'Перевірка контурного рисунка'};

export async function tracingFingerprint(p) {
  const source=JSON.stringify([p.assets?.master||null,p.width,p.height,p.layers,p.frame,p.aiData?.plan||null]);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source))),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function refreshTracingFreshness(p) {
  if(p.tracing)p.tracing.outdated=Boolean(p.tracing.outdated||p.pendingAssetsUpdate?.length||p.tracing.sourceFingerprint!==await tracingFingerprint(p));
}
export function markTracingOutdated(p) { if(p.tracing)p.tracing.outdated=true; }

export function importedTracing(value,safeImage) {
  if(!value)return null;
  if(typeof value!=='object'||!value.assets||TRACING_KINDS.some(k=>value.assets[k]&&!safeImage(value.assets[k])))throw Error('tracing images');
  return {assets:Object.fromEntries(TRACING_KINDS.filter(k=>value.assets[k]).map(k=>[k,value.assets[k]])),
    sourceFingerprint:typeof value.sourceFingerprint==='string'?value.sourceFingerprint.slice(0,64):'',outdated:value.outdated===true,
    createdAt:typeof value.createdAt==='string'?value.createdAt.slice(0,40):null,
    jobId:typeof value.jobId==='string'?value.jobId.slice(0,100):null,
    sourceMasterHash:typeof value.sourceMasterHash==='string'&&/^[a-f0-9]{64}$/.test(value.sourceMasterHash)?value.sourceMasterHash:null,
    knowledge:value.knowledge&&typeof value.knowledge==='object'?structuredClone(value.knowledge):null,
    review:value.review&&['pass_visual','changes_required','not_checked'].includes(value.review.disposition)?{
      disposition:value.review.disposition,findings:Array.isArray(value.review.findings)?value.review.findings.filter(x=>typeof x==='string').slice(0,50).map(x=>x.slice(0,4000)):[],
      manual_checks:Array.isArray(value.review.manual_checks)?value.review.manual_checks.filter(x=>typeof x==='string').slice(0,50).map(x=>x.slice(0,4000)):[]}:null,
    assetMetadata:value.assetMetadata&&typeof value.assetMetadata==='object'?structuredClone(value.assetMetadata):{}};
}

export function tracingPanel(p,{esc,safeImage,starting=false,connectionError=''}={}) {
  const t=p.tracing,job=p.aiJob,working=['running','queued'].includes(job?.status),ownJob=job?.action==='tracing',busy=working||starting;
  const assets=t?.assets||{},hasFiles=Boolean(assets.outline),legacy=Boolean(!hasFiles&&(assets.contour||assets.engraving));
  const stale=hasFiles&&(t.outdated||p.pendingAssetsUpdate?.length);
  const launchError=p.aiLaunchErrorAction==='tracing'&&p.aiLaunchError;
  const stopped=ownJob&&['failed','cancelled','interrupted','stale'].includes(job.status);
  const status=starting?'Підключаємося для створення контурного рисунка…':working&&ownJob?TRACING_LABELS[job.stage]||'Готуємо контурний рисунок…':stale?'Потрібно оновити — декор або його параметри змінилися':hasFiles?'Контурний рисунок збережено':legacy?'Збережено попередній розділений формат — створіть спільний рисунок':'Ще не створено';
  return `<section id="tracing-panel" class="panel tracing-panel" aria-label="Контурний рисунок для обведення"><div class="tracing-heading"><div><h3>Контурний рисунок для обведення</h3><p>Один спільний PNG на основі кольорового декору: контури деталей та лінії гравіювання разом. Білий фон, чорні лінії, без заливки й тіней.</p></div><button class="btn ${hasFiles?'':'primary'}" data-action="ai-tracing" ${busy||!p.assets?.master||p.pendingAssetsUpdate?.length?'disabled':''}>${hasFiles?'Оновити контурний рисунок':'Створити контурний рисунок'}</button></div><p class="hint ${stale?'tracing-stale':''}" role="status" aria-live="polite">${esc(status)}</p>${p.pendingAssetsUpdate?.length?'<p class="hint">Спочатку оновіть кольоровий декор за поточним завданням.</p>':''}${launchError?`<p class="note">Не вдалося розпочати: ${esc(launchError)}</p>`:''}${stopped?`<p class="note">Контурний рисунок не завершено. ${esc(job.error||job.message||'Повторіть запуск, щоб отримати контурний рисунок.')}</p>`:''}${working&&ownJob?`<p class="hint">${job.availableAssets?.length?'Створено: '+job.availableAssets.map(k=>esc(TRACING_LABELS[k]||k)).join(', ')+'. ':''}Кольорові зображення збережено.</p>${connectionError?`<p class="note">${esc(connectionError)}<button class="btn tiny" data-action="ai-reconnect">Відновити зв’язок</button></p>`:''}<button class="btn tiny" data-action="ai-cancel" ${job.cancelRequested?'disabled':''}>${job.cancelRequested?'Очікуємо скасування':'Скасувати створення контурів'}</button>`:''}${hasFiles?`<div class="tracing-files">${['outline'].map(kind=>`<figure>${assets[kind]?`<img src="${safeImage(assets[kind])}" alt="${TRACING_LABELS[kind]} — ${esc(p.title)}"><figcaption><strong>${TRACING_LABELS[kind]}</strong><div class="actions-wrap"><button class="btn tiny" data-tracing-expand="${kind}" aria-label="Збільшити: ${TRACING_LABELS[kind]}">Збільшити</button><button class="btn tiny" data-tracing-download="${kind}" aria-label="Завантажити: ${TRACING_LABELS[kind]} · PNG${stale?' (попередній)':''}">Завантажити PNG${stale?' (попередній)':''}</button></div></figcaption>`:`<div class="tracing-missing">${TRACING_LABELS[kind]} ще не створено</div>`}</figure>`).join('')}</div><details class="project-extra"><summary>Перевірка контурного рисунка</summary>${t.review?`<p>${t.review.disposition==='pass_visual'?'Візуальне порівняння ШІ пройдено.':t.review.disposition==='changes_required'?'ШІ знайшов розбіжності. Звірте контури з кольоровим декором.':'Повне порівняння ШІ не виконано.'}</p>${[...(t.review.findings||[]),...(t.review.manual_checks||[])].length?`<ul>${[...(t.review.findings||[]),...(t.review.manual_checks||[])].map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}`:'<p>Перевірка ШІ не завершена. Звірте рисунок із кольоровим декором.</p>'}${t.createdAt?`<p class="hint">Створено: ${esc(new Date(t.createdAt).toLocaleString('uk-UA'))}</p>`:''}</details>`:''}<p class="hint">Растровий орієнтир для SolidWorks. Перевірте збіг із декором, масштаб, замкненість контурів і перемички від 2 мм. Після обведення вручну призначте лініям операції різання або гравіювання.</p></section>`;
}
