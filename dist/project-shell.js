import { projectRoute, ROUTE_STATUS_LABELS } from './project-route.js';

export const ROUTE_HINTS = Object.freeze({
  brief: 'Опишіть виріб і задайте габарити.',
  palette: 'Спочатку заповніть задум і коректні габарити.',
  concepts: 'Спочатку підтвердьте палітру або створіть концепції.',
  generation: 'Спочатку оберіть концепцію.',
  result: 'Спочатку отримайте або додайте зображення.',
  saved: 'Спочатку погодьте актуальні вигляд і декор.',
});

export function routeNavigation(p, esc) {
  const route = projectRoute(p);
  return `<nav class="route-steps" aria-label="Маршрут проєкту">${route.steps.map((step, i) => {
    const explanation = step.available ? step.reason || step.label : ROUTE_HINTS[step.id];
    return `<button type="button" class="step ${step.current ? 'active' : step.complete ? 'done' : ''}" data-step="${step.id}" data-route-status="${step.status}" ${step.current ? 'aria-current="step"' : ''} ${!step.available ? 'disabled' : ''} title="${esc(explanation)}"><span>${step.status === 'running' ? '…' : step.complete && !step.current ? '✓' : i + 1}</span><div class="route-step-label">${step.label}<small>${ROUTE_STATUS_LABELS[step.status]}</small></div></button>`;
  }).join('')}</nav>`;
}

export function projectSummary(p, { esc, colors }) {
  const concept = p.concepts?.find(c => c.id === p.selected);
  return `<dl class="project-facts"><dt>Тип виробу</dt><dd>${esc(p.type || 'Ще не обраний')}${p.type === 'Годинник' ? `<small>${p.clockMount === 'wall' ? 'Настінний' : p.clockMount === 'stand' ? 'На підставці' : 'Кріплення ще не обране'}</small>` : ''}</dd><dt>Розмір декору</dt><dd>${esc(p.width)} × ${esc(p.height)} мм</dd><dt>Матеріал</dt><dd>Фанера 3 мм<small>${p.layers === 1 ? 'Один шар' : 'Підкладка та інкрустація'}</small></dd><dt>Доступні морилки</dt><dd class="project-colors">${(p.palette || []).map(id => {
    const color = colors.find(c => c.id === id);
    return color ? `<span><i class="palette-dot" style="background:${color.hex}" aria-hidden="true"></i>${esc(color.name)}</span>` : '';
  }).join('') || 'Ще не обрані'}</dd><dt>Обрана концепція</dt><dd>${esc(concept?.title || 'Ще не обрана')}</dd></dl>`;
}

export function projectStageHeading(p, esc) {
  const { steps } = projectRoute(p), index = steps.findIndex(s => s.current), step = steps[index];
  return `<div class="overline">КРОК ${index + 1} ІЗ ${steps.length}</div><h2>${step.label}</h2>${step.reason ? `<p>${esc(step.reason)}</p>` : ''}`;
}

export function projectShell(p, { esc, colors, content, aiPanel, inspector = '', showContext = true, collapsed = false }) {
  const route = projectRoute(p), index = route.steps.findIndex(s => s.current), step = route.steps[index];
  const open = collapsed ? '' : 'open';
  const running = ['running', 'queued'].includes(p.aiJob?.status);
  return `<div class="project-shell ${!showContext?'saved-layout':inspector?'result-layout':''}"><aside class="project-route" aria-label="Етапи роботи"><details class="route-disclosure" ${open}><summary><span>Маршрут проєкту</span><small>Крок ${index + 1} із ${route.steps.length} · ${step.label}</small></summary>${routeNavigation(p, esc)}</details></aside><section class="project-stage" data-current-step="${route.current}" aria-label="Поточний етап"><header class="project-stage-heading">${projectStageHeading(p, esc)}</header>${aiPanel?`<details class="project-ai-tools" ${route.current === 'generation' || running || p.aiLaunchError || ['failed','cancelled','interrupted','stale'].includes(p.aiJob?.status) ? 'open' : ''}><summary>Генерація та перевірка ШІ${running ? ' · виконується' : ''}</summary>${aiPanel}</details>`:''}${content}</section>${showContext?`<aside class="project-context ${inspector?'result-context':''}" aria-label="${inspector?'Оцінка результату':'Резюме виробу'}">${inspector?`<div id="result-inspector-content" class="panel">${inspector}</div>`:''}<details class="context-disclosure" ${inspector?'':open}><summary>Ваш виріб<small>Параметри та обрані рішення</small></summary><div id="project-context-content">${projectSummary(p, { esc, colors })}</div><p class="hint">Змінити рішення можна на відповідному кроці маршруту.</p></details></aside>`:''}</div>`;
}
