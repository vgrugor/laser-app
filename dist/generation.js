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
  const index = GENERATION_STAGES.findIndex(step => step.id === (formatStages[job?.stage]?'master':job?.stage));
  const outdated = !running && (!job || job.status === 'completed') && Boolean(p.pendingAssetsUpdate?.length);
  const status = launching && !running ? 'starting' : launchError ? 'start_failed'
    : running && connectionError ? 'disconnected' : running && job.cancelRequested ? 'cancelling'
    : running ? 'running' : outdated ? 'outdated' : job?.status || 'ready';
  const applied = job?.appliedAssets || [];
  const pairApplied = ['master', 'preview'].every(kind => applied.includes(kind)) && !p.pendingAssetsUpdate?.length;
  return { job, status, running, connected, connectionError, launchError,
    canReviewOnly: !launchError && !launching && job?.stage === 'review' && pairApplied && Boolean(p.aiData?.plan) && ['failed', 'interrupted'].includes(job.status),
    stages: GENERATION_STAGES.map((step, i) => ({ ...step,
      state: ['starting','start_failed','outdated'].includes(status) ? 'waiting' : job?.status === 'completed' ? 'done' : i < index ? 'done' : i === index ? running ? 'active' : 'stopped' : 'waiting' })),
    current: formatStages[job?.stage]||GENERATION_STAGES[index], availableAssets: ['starting','start_failed','outdated'].includes(status) ? [] : job?.availableAssets || [],
  };
}

export function generationScreen(p, { esc, ...options }) {
  const state = generationState(p, options), { job, status } = state;
  const titles = { ready: 'Усе готово до запуску', starting: 'Підключаємося до майстерні',
    outdated: 'Зображення потрібно оновити',
    running: state.current?.label || 'Починаємо роботу', cancelling: 'Очікуємо зупинки завдання',
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
  else actions = button(['ready','outdated'].includes(status)?'generate':'retry-generation', status === 'ready' ? 'Створити зображення' : status === 'outdated' ? 'Оновити зображення' : 'Повторити генерацію', true);
  if (!state.running && status !== 'starting' && (p.assets?.master || p.assets?.preview)) actions += '<button class="btn" data-step="result">Переглянути доступний результат</button>';
  const stopped = ['failed', 'cancelled', 'interrupted', 'stale', 'start_failed'].includes(status);
  return `<section id="generation-screen" class="generation-screen"><div class="panel generation-status"><div role="status" aria-live="polite"><h3>${titles[status] || 'Стан завдання'}</h3><p>${descriptions[status] || ''}</p></div>${status === 'start_failed' || status === 'disconnected' ? `<div class="note">${esc(state.launchError || state.connectionError)}</div>` : ''}<ol class="generation-stages" aria-label="Етапи генерації">${state.stages.map((step, i) => `<li data-generation-state="${step.state}"><span class="generation-marker" aria-hidden="true">${step.state === 'done' ? '✓' : i + 1}</span><div><strong>${step.label}</strong><small>${step.state === 'done' ? 'Завершено' : step.state === 'active' ? status === 'disconnected' ? 'Останній відомий етап' : 'Виконується' : step.state === 'stopped' ? 'Не завершено' : 'Очікує'}</small></div></li>`).join('')}</ol>${state.availableAssets.length ? `<p class="generation-saved">У завданні збережено: ${state.availableAssets.map(kind => kind === 'master' ? 'декор' : 'вигляд виробу').join(', ')}.</p>` : ''}<div class="generation-actions">${actions}</div>${job && stopped && status!=='start_failed' ? `<details class="project-extra"><summary>Подробиці зупинки</summary><p class="generation-error">${esc(job.error || job.message || descriptions[status])}</p><p class="hint">Номер завдання: ${esc(job.id)}</p></details>` : ''}</div></section>`;
}
