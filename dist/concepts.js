export function conceptIssue(p, concept) {
  if (!concept) return 'Оберіть концепцію для створення зображень.';
  const palette = concept.palette || p.palette;
  if (!palette?.length || palette.some(id => !p.palette.includes(id))) return 'Концепція використовує морилки поза поточною палітрою. Поверніться до палітри або створіть новий набір.';
  if (p.layers === 1 && (palette.length !== 1 || concept.frame === 'cut')) return 'Концепція потребує інкрустації. Змініть конструкцію або створіть новий набір.';
  return null;
}

export function selectConcept(p, id) {
  const concept = p.concepts.find(c => c.id === id);
  if (!concept || conceptIssue(p, concept)) return false;
  if (p.selected === id) return false;
  p.selected = id;
  p.frame = concept.frame;
  return true;
}

export function conceptScreen(p, { esc, colors }) {
  const selected = p.concepts.find(c => c.id === p.selected);
  const issue = conceptIssue(p, selected);
  const working = ['running', 'queued'].includes(p.aiJob?.status);
  const frameLabel = frame => frame === 'cut' ? 'Окрема фарбована рамка ≥ 2 мм' : frame === 'none' ? 'Без рамки' : 'Чорна гравійована обводка';
  return `${p.conceptSetOutdated?'<div class="note">Задум або палітру змінено після створення цього набору. Можна використати сумісну концепцію з оновленими параметрами або створити новий набір.</div>':''}<div class="concept-overview"><p>${p.concepts.length} збережених текстових концепцій для «${esc(p.title)}». Оберіть одну — після цього можна створити зображення.</p><button class="btn tiny" data-action="concepts" ${working ? 'disabled' : ''}>Створити новий набір</button></div><div class="concept-selection" role="region" aria-label="Обрана концепція"><div aria-live="polite"><strong>${selected ? `Обрано: ${esc(selected.title)}` : 'Концепцію ще не обрано'}</strong><p>${selected && issue ? esc(issue) : selected ? 'Створимо декор, вигляд виробу та перевіримо зображення.' : 'Порівняйте композицію, кольори та обрамлення нижче.'}</p></div><button class="btn primary" data-action="generate-concept" ${working || issue ? 'disabled' : ''}>${working ? 'Завдання виконується…' : 'Створити зображення'}</button></div><div class="concepts concept-choice-grid" aria-label="Збережений набір концепцій">${p.concepts.map((c, i) => {
    const problem = conceptIssue(p, c), chosen = c.id === p.selected;
    return `<button type="button" class="concept concept-choice ${chosen ? 'selected' : ''}" data-concept="${esc(c.id)}" aria-pressed="${chosen}" ${working || problem ? 'disabled' : ''}><div class="concept-choice-heading"><span class="concept-index">${String(i + 1).padStart(2, '0')}</span><span class="concept-choice-state">${chosen ? '✓ Обрано' : problem ? 'Потребує оновлення' : 'Обрати'}</span></div><strong>${esc(c.title)}</strong><p>${esc(c.description)}</p><div class="concept-colors">${(c.palette || p.palette).map(id => {
      const color = colors.find(value => value.id === id);
      return color ? `<span><i class="palette-dot" style="background:${color.hex}" aria-hidden="true"></i>${esc(color.name)}</span>` : '';
    }).join('')}</div><div class="concept-frame">${frameLabel(c.frame)}</div>${problem ? `<p>${esc(problem)}</p>` : ''}</button>`;
  }).join('')}</div><div class="concept-bottom"><button class="btn" data-step="palette">Назад: палітра</button><p class="hint">Відкриття набору та вибір картки не запускають ШІ. Попередні зображення залишаться доступними до отримання нового результату.</p></div>`;
}
