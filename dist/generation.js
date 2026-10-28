import { panelHistoryHTML } from './panel-history.js';
import { multiPanel, activePanel, panelList, panelNavigation } from './panels.js';
export const GENERATION_STAGES = Object.freeze([
  { id: 'plan', label: 'План деталей', description: 'Узгоджуємо композицію, конструкцію та поділ на деталі.' },
  { id: 'prompts', label: 'Підготовка описів зображень', description: 'Переносимо задум і правила у завдання для створення зображень.' },
  { id: 'master', label: 'Декор для обведення', description: 'Створюємо фронтальне зображення декоративних частин.' },
  { id: 'preview', label: 'Вигляд усього виробу', description: 'Показуємо виріб із тим самим декором і кольорами.' },
  { id: 'review', label: 'Перевірка результату', description: 'Перевіряємо технологію, композицію та відповідність двох зображень.' },
]);

export function generationState(p, { connected = true, connectionError = '', launching = false, launchError = '' } = {}) {
  const job = ['generate', 'edit'].includes(p.aiJob?.action) ? p.aiJob : null;
  const running = Boolean(job && ['queued', 'running'].includes(job.status));
  const formatStages={'master-check':{label:'Перевірка пропорцій декору',description:'Звіряємо формат PNG та зовнішні габарити декору з шаблоном.'},'master-correct':{label:'Виправлення пропорцій декору',description:'Одна спроба перебудувати композицію у потрібному форматі без розтягування.'},'master-recheck':{label:'Повторна перевірка пропорцій',description:'Перевіряємо результат виправлення перед створенням вигляду виробу.'}};
  const target=(launching&&!running?p.aiLaunchTarget:null)||job?.generationTarget||(job?'all':multiPanel(p)?'panel':'all');
  const separate=Boolean(job?.generationTarget)||!job&&multiPanel(p);
  const stages=GENERATION_STAGES.map(step=>step.id==='review'&&target==='panel'?{...step,description:'Перевіряємо лише поточну панель: технологію, композицію й гравіювання.'}:step).filter(step=>separate?target==='preview'?step.id==='preview':!['preview','review'].includes(step.id):true);
  const preparationStages={'shared-plan':{id:'plan',label:'Спільний задум комплекту',description:'Узгоджуємо стиль, кольори та зв’язки панелей.'},'plan-cache':{id:'plan',label:'Використовуємо збережений план',description:'Параметри плану актуальні. Повторний виклик конструктора не потрібен.'},'prompts-cache':{id:'prompts',label:'Використовуємо збережені промпти',description:'Промпти відповідають поточному плану й референсам.'}};
  const index = stages.findIndex(step => step.id === (formatStages[job?.stage]?'master':preparationStages[job?.stage]?.id||job?.stage));
  const outdated = !running && (!job || job.status === 'completed') && Boolean(target==='panel'?panelList(p).find(x=>x.id===(job?.scopePanelId||p.activePanelId))?.pendingAssetsUpdate?.length:p.pendingAssetsUpdate?.length);
  const status = launching && !running ? 'starting' : launchError ? 'start_failed'
    : running && connectionError ? 'disconnected' : running && job.cancelRequested ? 'cancelling'
    : running ? 'running' : outdated ? 'outdated' : job?.status || 'ready';
  const applied = job?.appliedAssets || [];
  const pairApplied = ['master', 'preview'].every(kind => applied.includes(kind)) && !p.pendingAssetsUpdate?.length;
  return { job, target, status, running, connected, connectionError, launchError,
    canReviewOnly: !launchError && !launching && job?.stage === 'review' && pairApplied && Boolean(p.aiData?.plan) && ['failed', 'interrupted'].includes(job.status),
    stages: stages.map((step, i) => ({ ...step,
      state: ['starting','start_failed','outdated'].includes(status) ? 'waiting' : job?.status === 'completed' ? 'done' : i < index ? 'done' : i === index ? running ? 'active' : 'stopped' : 'waiting' })),
    current: formatStages[job?.stage]||preparationStages[job?.stage]||stages[index], availableAssets: ['starting','start_failed','outdated'].includes(status) ? [] : job?.availableAssets || [],
  };
}

export function generationScreen(p, { esc, ...options }) {
  const state = generationState(p, options), { job, status } = state;
  const titles = { ready: 'Усе готово до запуску', starting: 'Підключаємося до майстерні',
    outdated: 'Зображення потрібно оновити',
    running: (job?.panelName?`Панель ${job.panelIndex}/${job.panelCount}: ${job.panelName} · `:'')+(state.current?.label || 'Починаємо роботу'), cancelling: 'Очікуємо зупинки завдання',
    disconnected: ['completed','failed','cancelled','interrupted'].includes(job?.serverStatus) ? 'Не вдалося отримати результат' : 'Зв’язок із сервером перервано', start_failed: 'Не вдалося розпочати генерацію',
    completed: 'Зображення створено', failed: 'Генерацію зупинено через помилку',
    cancelled: 'Завдання скасовано', interrupted: 'Завдання перервано', stale: 'Проєкт змінився під час виконання' };
  const descriptions = { ready: 'Створимо декор, вигляд виробу та виконаємо перевірку.',
    outdated: 'Параметри змінилися після створення зображень. Новий запуск використає оновлене завдання; попередній результат залишиться доступним у проєкті та версіях.',
    starting: 'Перевіряємо підключення й створюємо завдання.',
    running: state.current?.description || 'Готуємо запуск. Це може зайняти кілька хвилин.',
    cancelling: 'Запит надіслано. Дочекайтеся підтвердження зупинки; доступні результати буде збережено.',
    disconnected: ['completed','failed','cancelled','interrupted'].includes(job?.serverStatus) ? 'Завдання на сервері завершилося, але результат ще не отримано. Відновіть зв’язок, щоб отримати його без повторної генерації.' : 'Завдання могло продовжити роботу на сервері. Відновіть зв’язок, щоб дізнатися його стан.',
    start_failed: 'Перевірте підключення й повторіть запуск. Попередні зображення залишаються у проєкті.',
    completed: 'Перегляньте зображення та зауваження перевірки. Рішення про прийняття — за вами.',
    failed: 'Можна переглянути доступні зображення або повторити запуск. Повторна генерація починається з першого етапу.',
    cancelled: 'Автоматичного повторного запуску не буде. Продовжуйте, коли будете готові.',
    interrupted: 'Перевірте доступні результати. Новий запуск генерації починається з першого етапу.',
    stale: 'Відповідь не застосовано до зміненого проєкту. Перегляньте параметри перед новим запуском.' };
  const button = (action, text, primary = false, disabled = false) => `<button class="btn ${primary ? 'primary' : ''}" data-action="ai-${action}" ${disabled ? 'disabled' : ''}>${text}</button>`;
  let actions;
  if (status === 'starting') actions = button('generate', 'Підключення…', true, true);
  else if (status === 'disconnected') actions = button('reconnect', 'Відновити зв’язок', true);
  else if (state.running) actions = button('cancel', job.cancelRequested ? 'Запит на скасування надіслано' : 'Скасувати завдання', false, job.cancelRequested);
  else if (state.canReviewOnly) actions = button('review', 'Повторити лише перевірку', true) + button('retry-generation', 'Згенерувати заново');
  else if (status === 'completed') actions = '';
  else if(multiPanel(p)&&['ready','outdated'].includes(status))actions='';
  else actions = button(['ready','outdated'].includes(status)?'generate':'retry-generation', status === 'ready' ? 'Створити зображення' : status === 'outdated' ? 'Оновити зображення' : 'Повторити генерацію', true);
  if (!state.running && status !== 'starting' && (p.assets?.master || p.assets?.preview || multiPanel(p)&&panelList(p).some(x=>x.assets?.master))) actions += '<button class="btn" data-step="result">Переглянути доступний результат</button>';
  if(state.target==='panel'){descriptions.ready='Створимо лише вибрану панель і перевіримо пропорції. Повна перевірка ШІ, загальний вигляд та контури запускаються окремо.';descriptions.completed='Декор панелі збережено. Перегляньте його, оберіть або спробуйте інший варіант.';}
  if(state.target==='all'&&job?.generationTarget){descriptions.ready='Створимо всі незалежні панелі. Вибір результатів, загальний вигляд і повна перевірка запускаються окремо.';descriptions.completed='Панелі збережено. Оберіть потрібні результати перед створенням загального вигляду.';}
  if(state.target==='preview'){descriptions.ready='Створимо лише загальний вигляд за готовими панелями.';descriptions.completed='Загальний вигляд збережено. Декор панелей залишився незмінним.';}
  const stopped = ['failed', 'cancelled', 'interrupted', 'stale', 'start_failed'].includes(status);
  return `<section id="generation-screen" class="generation-screen">${multiPanel(p)?panelNavigation(p,{esc,busy:options.launching,history:panelHistoryHTML(p,activePanel(p).id,{esc,busy:options.launching})}):''}<div class="panel generation-status"><div role="status" aria-live="polite"><h3>${esc(titles[status] || 'Стан завдання')}</h3><p>${descriptions[status] || ''}</p></div>${status === 'start_failed' || status === 'disconnected' ? `<div class="note">${esc(state.launchError || state.connectionError)}</div>` : ''}<ol class="generation-stages" aria-label="Етапи генерації">${state.stages.map((step, i) => `<li data-generation-state="${step.state}"><span class="generation-marker" aria-hidden="true">${step.state === 'done' ? '✓' : i + 1}</span><div><strong>${step.label}</strong><small>${step.state === 'done' ? 'Завершено' : step.state === 'active' ? status === 'disconnected' ? 'Останній відомий етап' : 'Виконується' : step.state === 'stopped' ? 'Не завершено' : 'Очікує'}</small></div></li>`).join('')}</ol>${state.availableAssets.length ? `<p class="generation-saved">У завданні збережено: ${state.availableAssets.map(kind => kind === 'master' ? 'декор' : 'вигляд виробу').join(', ')}.</p>` : ''}<div class="generation-actions">${actions}</div>${job && stopped && status!=='start_failed' ? `<details class="project-extra"><summary>Подробиці зупинки</summary><p class="generation-error">${esc(job.error || job.message || descriptions[status])}</p><p class="hint">Номер завдання: ${esc(job.id)}</p></details>` : ''}</div></section>`;
}
