import { multiPanel, panelList, panelsReady, panelsChosen, productPreviewStatus, validPanelConfiguration } from './panels.js';
import { paletteIsConfirmed } from './palette-confirmation.js';

export const ROUTE_STEPS = Object.freeze([
  { id: 'brief', label: 'Задум' },
  { id: 'palette', label: 'Палітра' },
  { id: 'concepts', label: 'Концепція' },
  { id: 'generation', label: 'Генерація' },
  { id: 'result', label: 'Результат' },
  { id: 'saved', label: 'Збережений виріб' },
]);

export const ROUTE_VERSION = 2;
export const ROUTE_STATUS_LABELS = Object.freeze({
  not_started: 'Не розпочато', ready: 'Готовий',
  running: 'Виконується', needs_attention: 'Потребує уваги',
});

export function briefIsReady(p) {
  return Boolean(validPanelConfiguration(p) && p.type?.trim() && p.brief?.trim()
    && Number.isFinite(p.width) && Number.isFinite(p.height)
    && p.width >= 20 && p.height >= 20
    && ((p.width <= 300 && p.height <= 400) || (p.width <= 400 && p.height <= 300)));
}

// Navigation is independent of prepared, images, approval and AI input fingerprints.
export function projectRoute(p) {
  const hasConcepts = Boolean(p.concepts?.length);
  const selected = Boolean(p.selected && p.concepts?.some(c => c.id === p.selected));
  const hasImage = Boolean(p.assets?.master || p.assets?.preview || multiPanel(p)&&panelList(p).some(x=>x.assets?.master));
  const pair = Boolean(p.assets?.master && p.assets?.preview && (!multiPanel(p)||panelsReady(p)));
  const job = p.aiJob;
  const imageJob = ['generate', 'edit'].includes(job?.action);
  const running = ['queued', 'running'].includes(job?.status);
  const historical = hasConcepts || hasImage || selected;
  const brief = briefIsReady(p);
  const palette = paletteIsConfirmed({ ...p, palette: p.palette || [] });
  const previewCurrent=!multiPanel(p)||['current','legacy'].includes(productPreviewStatus(p));
  const approved = Boolean(p.approved && pair && previewCurrent && !p.pendingAssetsUpdate?.length);
  const available = {
    brief: true,
    palette: brief || historical,
    concepts: hasConcepts || (job?.action === 'concepts' && Boolean(job.id)) || (brief && palette),
    generation: selected || hasImage || (imageJob && Boolean(job?.id)),
    result: hasImage,
    saved: approved,
  };
  const complete = {
    brief,
    palette: palette || historical,
    concepts: selected,
    generation: pair && previewCurrent && (!multiPanel(p)||p.approved||panelsChosen(p)) && !p.pendingAssetsUpdate?.length && !(running && imageJob),
    result: approved,
    saved: approved,
  };
  const statuses = Object.fromEntries(ROUTE_STEPS.map(step => [step.id, {
    status: complete[step.id] ? 'ready' : 'not_started', reason: '',
  }]));
  const attention = (step, reason) => { statuses[step] = { status: 'needs_attention', reason }; };
  if (!brief && (p.brief?.trim() || p.width || p.height)) attention('brief', 'Уточніть опис, тип і габарити виробу.');
  if (!palette && !historical && brief) attention('palette', 'Підтвердьте доступні морилки.');
  if (hasConcepts && !selected) attention('concepts', 'Оберіть одну зі збережених концепцій.');
  if (p.aiLaunchErrorAction === 'concepts' && p.aiLaunchError) attention('concepts', 'Не вдалося розпочати створення концепцій. Повторіть запуск.');
  if (p.pendingAssetsUpdate?.length) attention('generation', multiPanel(p)?'Продовжуйте окремі запуски панелей і загального вигляду.':'Зображення потрібно оновити після змін.');
  if (hasImage && !approved) {
    if(multiPanel(p)&&panelsReady(p)&&!panelsChosen(p)){attention('result','Оберіть результат кожної панелі перед завершенням виробу.');}
    else if(multiPanel(p)&&panelsChosen(p)&&!['current','legacy'].includes(productPreviewStatus(p))){attention('result','Створіть або оновіть загальний вигляд за обраними панелями.');}
    else attention('result', !pair ? multiPanel(p)?'Продовжуйте роботу з панелями, а потім створіть загальний вигляд.':'Потрібні обидва зображення: вигляд і декор.'
      : p.pendingAssetsUpdate?.length ? multiPanel(p)?'Окремо створіть або оновіть загальний вигляд за актуальними панелями.':'Поточні зображення відповідають попередньому завданню.'
      : Object.values(p.reviews || {}).includes('fail') ? 'У ручній перевірці є позначки «Потрібна правка».'
      : p.aiReport?.disposition === 'changes_required' ? 'Перегляньте зауваження ШІ та прийміть рішення.'
      : 'Перегляньте результат і погодьте вигляд або додайте правки.');
  }
  const jobStep = job?.action === 'concepts' ? 'concepts' : imageJob ? 'generation' : job?.action === 'review' ? 'result' : null;
  if (jobStep && running) statuses[jobStep] = { status: 'running', reason: jobStep==='generation'?'Стежте за створенням зображень нижче.':'Завдання виконується.' };
  else if (jobStep && ['failed', 'cancelled', 'interrupted', 'stale'].includes(job?.status)
    && (!approved || (jobStep === 'generation' && p.route?.current === 'generation'))) {
    const reasons = { failed: 'Завдання завершилося помилкою. Можна повторити запуск.',
      cancelled: 'Завдання скасовано. Можна повторити запуск.',
      interrupted: 'Завдання перервано. Перегляньте наявні результати перед повторним запуском.',
      stale: 'Проєкт змінився під час виконання. Відповідь не застосована.' };
    attention(jobStep, reasons[job.status]);
  }
  const fallback = running && imageJob ? 'generation'
    : running && job?.action === 'concepts' ? 'concepts'
    : approved ? 'saved' : hasImage ? 'result'
    : imageJob && job?.id ? 'generation'
    : selected && p.prepared ? 'generation' : hasConcepts ? 'concepts'
    : brief && palette ? 'concepts' : 'brief';
  const requested = [1, ROUTE_VERSION].includes(p.route?.version) ? p.route.current : null;
  const current = ROUTE_STEPS.some(step => step.id === requested) && available[requested] ? requested : fallback;
  return {
    current,
    steps: ROUTE_STEPS.map(step => ({ ...step, ...statuses[step.id], available: available[step.id],
      current: step.id === current, complete: complete[step.id] && statuses[step.id].status === 'ready' })),
  };
}

export function ensureRoute(p) {
  const { current, steps } = projectRoute(p);
  p.route = { version: ROUTE_VERSION, current,
    steps: Object.fromEntries(steps.map(({ id, status, reason }) => [id, { status, reason }])) };
  return current;
}

export function moveToRoute(p, step) {
  if (!projectRoute(p).steps.some(item => item.id === step && item.available)) return false;
  p.route = { version: ROUTE_VERSION, current: step };
  ensureRoute(p);
  return true;
}

export function routeAfterJob(p, action, status) {
  if (action === 'concepts' && status === 'completed' && p.concepts?.length) {
    moveToRoute(p, 'concepts');
  } else if (['generate', 'edit'].includes(action) && ['completed', 'failed', 'cancelled', 'interrupted'].includes(status)) {
    const newImages = Boolean(p.aiJob?.appliedAssets?.length||p.aiJob?.appliedPanels?.length);
    const completedWithImages = status === 'completed' && Boolean(p.assets?.master || p.assets?.preview || multiPanel(p)&&panelList(p).some(x=>x.assets?.master));
    moveToRoute(p, newImages || completedWithImages ? 'result' : 'generation');
  }
}
