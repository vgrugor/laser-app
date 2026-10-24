import { masterFormatNotice } from './master-format.js';
import { approvalBlocker, approvedWithAiRemarks } from './approval.js';
import { compositionReviewHTML } from './composition-guidance.js';
import { tracingPanel } from './tracing.js';

export function resultActions(p, { esc }) {
  const busy = ['running','queued'].includes(p.aiJob?.status);
  const blocker = approvalBlocker(p);
  return `<div class="result-decision"><button class="btn primary" data-action="approve" ${busy || blocker || p.approved ? 'disabled' : ''}>${p.approved?'Виріб прийнято':'Прийняти виріб'}</button><button class="btn" data-action="open-corrections" ${busy || !p.assets?.master ? 'disabled' : ''}>Внести правки</button>${blocker?`<p class="hint">${esc(blocker)}</p>`:''}</div>`;
}

export function revisionNotes(p, text, includeFindings) {
  const additions = [String(text || '').trim().slice(0,4000)];
  if (includeFindings) additions.push(...(p.aiReport?.findings || []).map(f=>`${f.location}: ${f.observation} ${f.suggested_action}`.slice(0,4000)));
  const notes = [...(p.notes || [])];
  for (const note of additions.filter(Boolean)) if (!notes.includes(note)) notes.push(note);
  if (!notes.length) throw Error('Опишіть правку або оберіть зауваження ШІ.');
  if (notes.length > 100) throw Error('Досягнуто обмеження у 100 правок. Створіть новий варіант проєкту.');
  return notes;
}

export function resultInspector(p, { esc, connectionError = '', reviewLaunchError = '' }) {
  const report = p.aiReport, busy = ['running','queued'].includes(p.aiJob?.status);
  const findings = report?.findings || [];
  const title = p.approved ? approvedWithAiRemarks(p)?'Прийнято попри зауваження ШІ':'Ви прийняли цей вигляд'
    : busy ? p.aiJob.action==='review'?'ШІ перевіряє зображення':p.aiJob.action==='tracing'?'Створюється контурний рисунок':'Зображення ще створюються'
    : report?.disposition==='pass_visual'?'Візуальну перевірку пройдено'
    : report?.disposition==='changes_required'?`Є зауваження · ${findings.length}`
    : report ? 'Перевірка неповна' : 'Перевірку ШІ ще не виконано';
  const stopped = ['failed','cancelled','interrupted','stale'].includes(p.aiJob?.status);
  const findingHTML = f=>`<div class="result-finding"><strong>${esc(f.location)}</strong><p>${esc(f.observation)}</p><small>${esc(f.suggested_action)}</small></div>`;
  return `<div class="result-inspector-status" role="status"><h3>${title}</h3>${!p.approved&&!busy?'<p>Перегляньте вигляд. Ви можете внести правки або прийняти результат.</p>':''}${approvedWithAiRemarks(p)&&p.appearanceApproval.comment?`<p>${esc(p.appearanceApproval.comment)}</p>`:''}</div><div class="result-desktop-actions">${resultActions(p,{esc})}</div>${reviewLaunchError?`<div class="note" role="status">Не вдалося розпочати перевірку: ${esc(reviewLaunchError)}. Повторіть перевірку кнопкою нижче.</div>`:''}${connectionError?`<div class="note">${esc(connectionError)}<button class="btn tiny" data-action="ai-reconnect">Відновити зв’язок</button></div>`:''}${busy?`<button class="btn full" data-action="ai-cancel" ${p.aiJob.cancelRequested?'disabled':''}>${p.aiJob.cancelRequested?'Очікуємо скасування':'Скасувати поточне завдання'}</button>${['generate','edit'].includes(p.aiJob.action)?'<button class="btn full" data-step="generation">До процесу генерації</button>':''}`:''}${stopped&&!busy?`<details class="result-job-note"><summary>Останнє завдання не завершено</summary><p>${esc(p.aiJob.error||p.aiJob.message||'Доступні файли збережено.')}</p>${['generate','edit'].includes(p.aiJob.action)?'<button class="btn tiny" data-step="generation">До процесу генерації</button>':''}</details>`:''}${findings.slice(0,2).map(findingHTML).join('')}${findings.length>2?`<details class="result-more-findings"><summary>Ще зауваження · ${findings.length-2}</summary>${findings.slice(2).map(findingHTML).join('')}</details>`:''}${report?.disposition==='changes_required'&&!p.approved?'<p class="hint">Зауваження ШІ можна свідомо прийняти. Рішення буде збережено разом зі звітом.</p>':''}${compositionReviewHTML(report,esc)}${report?.manual_checks?.length?`<details class="result-manual-checks"><summary>Що перевірити в кресленні</summary><ul>${report.manual_checks.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></details>`:''}<button class="btn full" data-action="ai-review" ${busy||!p.assets?.master||!p.assets?.preview||p.pendingAssetsUpdate?.length?'disabled':''}>${report?'Повторити перевірку ШІ':'Перевірити зображення'}</button>`;
}

export function resultScreen(p, { esc, icon, safeImage, view, versions, manualReview, technical, tracingUI }) {
  const draft = p.resultDraft || {}, busy = ['running','queued'].includes(p.aiJob?.status);
  return `${p.pendingAssetsUpdate?.length?'<div class="note">Ці зображення ще відповідають попередньому завданню. Перед прийняттям потрібно отримати актуальну пару.</div>':''}${resultViewer(p,{esc,icon,safeImage,view,tracingUI})}<div class="result-mobile-actions">${resultActions(p,{esc})}</div><div class="variant-actions"><button class="btn" data-action="variant">Створити окремий варіант</button>${p.concepts?.length?'<button class="btn" data-action="variant-concepts">Інша концепція з цього набору</button>':''}</div><details class="project-extra result-corrections" id="result-corrections" ${draft.open?'open':''}><summary>Правки до зображення</summary><label class="field" for="change-note">Що потрібно змінити?</label><textarea id="change-note" maxlength="4000" placeholder="Наприклад: збільшити рамку та зберегти композицію…" aria-label="Опис правки">${esc(draft.text||'')}</textarea>${p.aiReport?.findings?.length?`<label class="result-checkbox"><input id="use-ai-findings" type="checkbox" ${draft.includeFindings?'checked':''}>Врахувати всі зауваження ШІ</label>`:''}<div class="result-checkbox"><input id="lock-composition" type="checkbox" data-lock="Композиція та пропорції" ${p.locks.includes('Композиція та пропорції')?'checked':''} ${busy?'disabled':''}><label for="lock-composition">Зберігати композицію та пропорції</label></div><div class="result-checkbox"><input id="lock-hardware" type="checkbox" data-lock="Форма й розташування фурнітури" ${p.locks.includes('Форма й розташування фурнітури')?'checked':''} ${busy?'disabled':''}><label for="lock-hardware">Зберігати фурнітуру</label></div>${p.notes.length?`<details><summary>Збережені побажання · ${p.notes.length}</summary><ul class="result-saved-notes">${p.notes.map(note=>`<li>${esc(note)}</li>`).join('')}</ul></details>`:''}<p class="hint">Застосуємо новий опис, обрані зауваження та збережені побажання до декору, потім оновимо вигляд виробу й перевірку.</p><button class="btn primary" data-action="apply-result-edit" ${busy||!p.assets?.master?'disabled':''}>Застосувати правки</button></details><details class="project-extra" id="result-versions"><summary>Історія версій · ${p.versions.length}</summary><button class="btn tiny" data-action="save">Зберегти поточну версію</button>${versions}</details><details class="project-extra"><summary>Власна перевірка результату</summary>${manualReview}</details><details class="project-extra"><summary>Файли та технічні дані</summary>${technical}</details><details class="project-extra"><summary>Змінити параметри виробу</summary><div class="actions-wrap"><button class="btn" data-step="brief">Задум і конструкція</button><button class="btn" data-step="palette">Палітра й обрамлення</button></div></details>`;
}

export function resultViewer(p,{esc,icon,safeImage,view,tracingUI}) {
  const tracing=view==='tracing',path=tracing?null:p.assets?.[view];
  const tabs=[['preview','Увесь виріб'],['master','Кольоровий декор'],['tracing','Контурний рисунок для обведення']];
  return `<div class="viewer ${tracing?'tracing-view':''}"><div class="viewer-toolbar"><div class="segmented" role="group" aria-label="Види виробу">${tabs.map(([key,label])=>`<button data-view="${key}" aria-pressed="${view===key}" class="${view===key?'active':''}">${label}</button>`).join('')}</div>${tracing?'':`<button class="iconbtn" data-action="expand" aria-label="Відкрити зображення" ${!path?'disabled':''}>${icon('expand')}</button>`}</div>${tracing?tracingPanel(p,{esc,safeImage,...tracingUI}):`<div class="canvas ${view==='master'?'master':''}">${path?`<img src="${safeImage(path)}" alt="${view==='master'?'Фронтальний декор':'Вигляд готового виробу'} — ${esc(p.title)}">`:'<div class="empty"><h3>Цього зображення ще немає</h3><p>Перегляньте доступний вид або додайте файл у розділі нижче.</p></div>'}</div>`}${view==='master'?masterFormatNotice(p,{esc}):''}<div class="viewer-bottom"><span>${p.approved?'Прийнято вами':p.example?'Збережений приклад':'Чернетка'}</span><span>${p.width} × ${p.height} мм · фанера 3 мм</span></div></div>`;
}
