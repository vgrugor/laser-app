import { resultViewer } from './result.js';
import { approvedWithAiRemarks } from './approval.js';

const layerNames = {backing:'Підкладка',top:'Інкрустація',body:'Корпус'};
const frameNames = {cut:'Окрема фарбована рамка ≥ 2 мм',engraved:'Чорна гравійована обводка',none:'Без рамки'};
const strings = value => Array.isArray(value) ? value.filter(x=>typeof x==='string') : [];
const reviewFindings = review => Array.isArray(review?.findings) ? review.findings.filter(x=>x&&typeof x==='object') : [];
function savedPlan(p) {
  const plan=p.aiData?.plan;
  return {parts:Array.isArray(plan?.parts)?plan.parts.filter(part=>part&&typeof part.name==='string'&&typeof part.finish_id==='string'&&Number.isInteger(part.quantity)&&part.quantity>0):[],engraving:strings(plan?.engraving),manual_checks:strings(plan?.manual_checks)};
}
const finishName = (id,colors) => colors.find(c=>c.id===id)?.name || id || 'Не вказано';
export const approvalDate = p => {
  const at=p.appearanceApproval?.at || p.approvedAt;
  return at && Number.isFinite(Date.parse(at)) ? new Date(at).toLocaleString('uk-UA',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : 'Дату погодження не записано';
};
export const savedReview = p => p.appearanceApproval && Object.hasOwn(p.appearanceApproval,'aiReview') ? p.appearanceApproval.aiReview : p.aiReport;
export function savedFinishes(p) {
  const parts=savedPlan(p).parts;
  if(parts?.length)return {ids:[...new Set(parts.map(part=>part.finish_id).filter(Boolean))],label:'Морилки за планом деталей'};
  const concept=p.concepts?.find(c=>c.id===p.selected);
  return concept?.palette?.length ? {ids:concept.palette,label:'Морилки обраної концепції'} : {ids:p.palette||[],label:'Доступні морилки проєкту'};
}
export function savedManualChecks(p) {
  return [...new Set([...savedPlan(p).manual_checks,...strings(savedReview(p)?.manual_checks)])];
}
export function passportText(p,colors) {
  const finishes=savedFinishes(p),plan=savedPlan(p),review=savedReview(p),checks=savedManualChecks(p);
  return [`ПАСПОРТ ВИРОБУ: ${p.title}`,`ID: ${p.id}`,`Погоджено користувачем: ${approvalDate(p)}`,
    `Тип: ${p.type}${p.type==='Годинник'?p.clockMount==='wall'?' · настінний':p.clockMount==='stand'?' · на підставці':' · кріплення не визначене':''}`,
    `Розмір декору: ${p.width} × ${p.height} мм`,`Матеріал: фанера 3 мм; лист 300 × 400 мм`,
    `Конструкція: ${p.layers===1?'один шар без інкрустації':'підкладка та інкрустація'}`,`Обрамлення: ${frameNames[p.frame]||'Не вказано'}`,
    `Задум: ${p.brief}`,`Концепція: ${p.concepts?.find(c=>c.id===p.selected)?.title||'Не записана'}`,
    `${finishes.label}: ${finishes.ids.map(id=>finishName(id,colors)).join(', ')||'Не записано'}`,
    'Чистий — фанера без морилки. Гравіювання та кромки лише чорні. Одна морилка на фізичну деталь.',
    '', 'ОРІЄНТОВНИЙ ПЛАН ШІ — перевірити у кресленні',
    ...(plan?.parts?.length?plan.parts.map(part=>`${part.name} · ${part.quantity} шт. · ${layerNames[part.layer]||part.layer} · ${finishName(part.finish_id,colors)}`):['План деталей не збережено. Поділ і кольори визначте за погодженими зображеннями.']),
    ...(plan?.engraving?.length?['','Гравіювання:',...plan.engraving.map(x=>`- ${x}`)]:[]),
    '', approvedWithAiRemarks(p)?'Прийнято попри зауваження ШІ.':review?.disposition==='pass_visual'?'Візуальну перевірку ШІ пройдено.':review?.disposition==='changes_required'?'Звіт ШІ містить зауваження.':'Повну візуальну перевірку ШІ не зафіксовано.',
    ...(p.appearanceApproval?.comment?[`Коментар користувача: ${p.appearanceApproval.comment}`]:[]),
    ...reviewFindings(review).map(f=>`- ${f.location}: ${f.observation} ${f.suggested_action}`),
    '', 'ПЕРЕД ВИГОТОВЛЕННЯМ',
    'Обведіть декор у SolidWorks; перевірте масштаб, перемички й рамки ≥ 2 мм та кріплення. Експортуйте креслення в LightBurn.',
    ...checks.map(x=>`- ${x}`),
    'Зображення є орієнтиром для креслення. Погоджено зовнішній вигляд; це не готовий файл для різання.',
    ...(p.notes?.length?['','Збережені побажання:',...p.notes.map(x=>`- ${x}`)]:[]),
    ...(p.variantOf?[`\nВихідний проєкт: ${p.variantOf.title} (${p.variantOf.projectId})`]:[]),
  ].join('\n');
}

export function savedScreen(p,{esc,icon,safeImage,view,colors,versions,tracingUI}) {
  const finishes=savedFinishes(p),plan=savedPlan(p),review=savedReview(p),checks=savedManualChecks(p);
  return `<section class="saved-confirmation" aria-label="Погоджений виріб"><div><span class="badge green">${icon('check')}Вигляд погоджено вами${approvedWithAiRemarks(p)?' · із зауваженнями ШІ':''}</span><p>${esc(approvalDate(p))} · Збережено в цьому браузері</p></div><button class="btn primary" data-action="export">${icon('down')}Резервна копія проєкту</button></section><div class="saved-downloads" aria-label="Файли для повторного виготовлення"><button class="btn primary" data-download="master" ${!p.assets?.master?'disabled':''}>${icon('down')}Завантажити декор</button><button class="btn" data-download="preview" ${!p.assets?.preview?'disabled':''}>${icon('down')}Завантажити вигляд</button><button class="btn" data-action="passport">${icon('file')}Паспорт виробу · TXT</button></div><div class="saved-product-grid"><div>${resultViewer(p,{esc,icon,safeImage,view,tracingUI})}</div><section class="panel saved-specification" aria-label="Паспорт виробу"><h3>Для повторного виготовлення</h3><dl class="project-facts"><dt>Тип і габарити декору</dt><dd>${esc(p.type)} · ${p.width} × ${p.height} мм${p.type==='Годинник'?`<small>${p.clockMount==='wall'?'Настінний':p.clockMount==='stand'?'На підставці':'Кріплення не визначене'}</small>`:''}</dd><dt>Матеріал і конструкція</dt><dd>Фанера 3 мм<small>${p.layers===1?'Один шар, без інкрустації':'Підкладка та інкрустація'} · лист 300 × 400 мм</small></dd><dt>Обрамлення</dt><dd>${esc(frameNames[p.frame]||'Не вказано')}</dd><dt>${finishes.label}</dt><dd class="saved-finishes">${finishes.ids.map(id=>{const color=colors.find(c=>c.id===id);return `<span>${color?`<i class="palette-dot" style="background:${color.hex}" aria-hidden="true"></i>`:''}${esc(finishName(id,colors))}</span>`;}).join('')||'Не записано'}</dd></dl><p class="hint">«Чистий» — фанера без морилки. Гравіювання та кромки чорні.</p></section></div><section class="panel saved-next"><h3>Наступний крок — креслення в SolidWorks</h3><p>Обведіть декор, перевірте масштаб, перемички й рамки від 2 мм та кріплення. Потім експортуйте креслення в LightBurn.</p><p class="hint">Погоджено зовнішній вигляд. Зображення — орієнтир для обведення, геометрію ще потрібно перевірити.</p>${checks.length?`<details class="project-extra"><summary>Додатково перевірити · ${checks.length}</summary><ul>${checks.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>`:''}</section><details class="project-extra saved-parts"><summary>Орієнтовний план деталей ШІ${plan?.parts?.length?` · ${plan.parts.reduce((n,part)=>n+(Number(part.quantity)||0),0)} шт.`:''}</summary><p class="hint">Це пропозиція ШІ. Звірте назви, кількість, поділ і морилки з погодженими зображеннями під час підготовки креслення.</p>${plan?.parts?.length?`<div class="saved-table-scroll"><table><caption>План деталей</caption><thead><tr><th scope="col">Деталь</th><th scope="col">Кількість</th><th scope="col">Шар</th><th scope="col">Морилка</th></tr></thead><tbody>${plan.parts.map(part=>`<tr><td>${esc(part.name)}</td><td>${esc(part.quantity)}</td><td>${esc(layerNames[part.layer]||part.layer)}</td><td>${esc(finishName(part.finish_id,colors))}</td></tr>`).join('')}</tbody></table></div>`:'<p>План деталей не збережено. Визначте поділ і кольори за погодженими зображеннями.</p>'}${plan?.engraving?.length?`<h4>Чорне гравіювання</h4><ul>${plan.engraving.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}</details><details class="project-extra saved-approval"><summary>${approvedWithAiRemarks(p)?'Прийняті зауваження ШІ':'Погодження та звіт ШІ'}</summary>${approvedWithAiRemarks(p)?'<p>Ви свідомо прийняли цей вигляд попри зауваження ШІ.</p>':review?.disposition==='pass_visual'?'<p>Візуальну перевірку ШІ пройдено.</p>':'<p>Повну візуальну перевірку ШІ не зафіксовано. Рішення про прийняття вигляду — ваше.</p>'}${p.appearanceApproval?.comment?`<p>Ваш коментар: ${esc(p.appearanceApproval.comment)}</p>`:''}${reviewFindings(review).map(f=>`<div class="result-finding"><strong>${esc(f.location)}</strong><p>${esc(f.observation)}</p><small>${esc(f.suggested_action)}</small></div>`).join('')}</details><details class="project-extra"><summary>Задум і збережені побажання</summary><p>${esc(p.brief)}</p>${p.notes?.length?`<ul>${p.notes.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}</details><details class="project-extra" id="result-versions"><summary>Історія версій · ${p.versions.length}</summary>${versions}</details><section class="saved-variants"><h3>Хочете інший вигляд?</h3><p>Створіть окремий варіант. Погоджений виріб залишиться у колекції.</p><div class="variant-actions"><button class="btn" data-action="variant">Створити окремий варіант</button>${p.concepts?.length?'<button class="btn" data-action="variant-concepts">Інша концепція з цього набору</button>':''}<button class="btn" data-page="projects">До моїх проєктів</button></div></section>`;
}
