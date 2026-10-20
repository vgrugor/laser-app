const STORAGE='plywood-flow-type-assistant-v1';
export function draftToType(result){
  const d=result.draft;
  const section=(heading,items)=>`## ${heading}\n${items.length?items.map(item=>'- '+item).join('\n'):'Не визначено.'}`;
  const rules=[`# ${d.name}`,section('Підтверджені вимоги',d.requirements),section('Рекомендації',d.recommendations),section('Непідтверджені припущення',result.assumptions),`## Вигляд усього виробу\n${d.previewInstructions}`,`## Фронтальний декор для обведення\n${d.masterInstructions}`,section('Невідомі значення та ручні перевірки',d.unknowns)].join('\n\n');
  return {name:d.name,description:d.description,rules};
}
export function createTypeAssistant({esc,modal,getCatalog,useDraft,openExisting}){
  const empty=()=>({description:'',answers:[],pendingAnswers:{},result:null,job:null,error:'',catalogRevision:null});
  let state=empty(),polling=false,timer=null;
  try{const saved=JSON.parse(localStorage.getItem(STORAGE));if(saved&&typeof saved.description==='string'&&Array.isArray(saved.answers)&&saved.answers.length<=24&&(!saved.job||/^[a-f0-9-]{36}$/.test(saved.job.id))&&(!saved.result||['questions','draft'].includes(saved.result.status)&&['questions','similarTypes','assumptions'].every(k=>Array.isArray(saved.result[k]))))state={...empty(),...saved};}catch{}
  const busy=()=>state.job?.status==='running';
  function persist(){try{localStorage.setItem(STORAGE,JSON.stringify(state));}catch{state.error='Не вдалося зберегти чернетку в браузері. Залиште вікно відкритим до завершення.';}}
  async function post(path,data){const status=await fetch('/api/status');if(!status.ok)throw Error('Локальний сервер недоступний');const {token}=await status.json();const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Plywood-Token':token},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw Error(result.error==='Невідома дія'?'Перезапустіть сервер оновленою командою sh scripts/start.command, щоб підключити помічника.':result.error||'Помилка запиту');return result;}
  function content(){
    const r=state.result,working=busy(),similar=r?.similarTypes||[];
    return `<p class="hint">Помічник використовує поточний вхід ChatGPT та ліміти підписки. Він готує чернетку; каталог змінюється лише після вашого збереження в редакторі.</p><div class="field"><label for="assistant-description">Який тип виробу хочете додати?</label><textarea id="assistant-description" maxlength="4000" ${working||r?'readonly':''} placeholder="Наприклад: настінний органайзер для канцелярії…">${esc(state.description)}</textarea></div>${state.answers.length?`<details><summary>Надані відповіді (${state.answers.length})</summary>${state.answers.map(a=>`<p><strong>${esc(a.question)}</strong><br>${esc(a.answer)}</p>`).join('')}</details>`:''}${working?'<p class="note" role="status">Помічник працює: перевіряє типи та готує питання або правила…</p><button class="btn" id="assistant-cancel">Скасувати запит</button>':''}${state.error?`<p class="note" role="alert">${esc(state.error)}</p>`:''}${similar.length?`<h3>Схожі типи</h3>${similar.map(t=>{const type=getCatalog().types.find(type=>type.id===t.id);return `<div class="note"><strong>${esc(type?.name||t.id)}</strong><p>${esc(t.reason)}</p>${type?`<button class="btn tiny" data-assistant-existing="${esc(t.id)}" ${working?'disabled':''}>Переглянути цей тип</button>`:''}</div>`;}).join('')}`:''}${r?.status==='questions'?`<h3>Уточніть вимоги</h3>${r.questions.map((q,i)=>`<div class="field"><label for="assistant-answer-${i}">${esc(q.prompt)}</label><textarea id="assistant-answer-${i}" maxlength="4000" ${working?'disabled':''} placeholder="Можна відповісти «Не знаю» — це залишиться невідомим значенням.">${esc(state.pendingAnswers[q.id]||'')}</textarea></div>`).join('')}`:''}${r?.assumptions.length?`<div class="note"><strong>Припущення, які ще не підтверджені</strong>${r.assumptions.map(a=>`<p>${esc(a)}</p>`).join('')}</div>`:''}${r?.status==='draft'?`<h3>Чернетка: ${esc(r.draft.name)}</h3><p>${esc(r.draft.description)}</p><pre class="assistant-draft">${esc(draftToType(r).rules)}</pre><p class="hint">У редакторі можна змінити назву, опис і правила. Тип ще не доданий.</p>`:''}<div class="dialog-actions assistant-actions">${!working?`<button class="btn" id="assistant-reset">Почати іншу чернетку</button>${r?.status==='draft'?'<button class="btn primary" id="assistant-use">Переглянути й редагувати перед збереженням</button>':`<button class="btn" id="assistant-draft">Підготувати чернетку з невідомими значеннями</button><button class="btn primary" id="assistant-send">${r?'Надіслати відповіді':'Почати з уточнень'}</button>`}`:''}</div>`;
  }
  function render(){
    const target=document.querySelector('#type-assistant-content');if(!target)return;
    target.innerHTML=content();
    const on=(id,event,fn)=>{const el=document.querySelector(id);if(el)el[event]=fn;};
    on('#assistant-description','oninput',e=>{state.description=e.target.value;persist();});
    for(const [i,q] of (state.result?.questions||[]).entries())on('#assistant-answer-'+i,'oninput',e=>{state.pendingAnswers[q.id]=e.target.value;persist();});
    on('#assistant-send','onclick',()=>start(false));on('#assistant-draft','onclick',()=>start(true));
    on('#assistant-cancel','onclick',async()=>{try{await post(`/api/jobs/${state.job.id}/cancel`,{});await poll();}catch(e){state.error=e.message;render();}});
    on('#assistant-reset','onclick',()=>{state=empty();persist();render();});
    on('#assistant-use','onclick',()=>useDraft(draftToType(state.result),state.catalogRevision));
    for(const button of target.querySelectorAll('[data-assistant-existing]'))button.onclick=()=>openExisting(button.dataset.assistantExisting);
  }
  async function poll(){
    if(polling||!busy())return;polling=true;
    try{
      const id=state.job.id,response=await fetch(`/api/jobs/${id}`);if(!response.ok){if(response.status===404)state.job.status='interrupted';throw Error(response.status===404?'Завдання вже недоступне. Відповіді збережено; повторіть запит.':'Не вдалося отримати стан завдання');}const job=await response.json();
      if(state.job?.id!==id)return;
      if(job.status==='running')return;
      state.job.status=job.status;
      if(job.status==='completed'&&job.result?.assistant){state.result=job.result.assistant;state.catalogRevision=job.result.catalogRevision;state.pendingAnswers={};state.error='';}
      else state.error=job.error||'Запит не завершено. Відповіді збережені; можна повторити.';
      persist();render();
    }catch(e){state.error=e.message+(busy()?' Перевірте сервер; очікування буде продовжено.':'');persist();render();}
    finally{polling=false;if(busy())timer=setTimeout(poll,1800);}
  }
  async function start(finishWithUnknowns){
    if(busy())return;
    state.error='';
    if(!state.description.trim()){state.error='Опишіть новий тип виробу';render();return;}
    const answers=[...state.answers];
    for(const q of state.result?.questions||[]){
      const answer=(state.pendingAnswers[q.id]||'').trim();
      if(!answer&&!finishWithUnknowns){state.error='Дайте відповіді або виберіть чернетку з невідомими значеннями.';render();return;}
      if(answer){const existing=answers.findIndex(a=>a.question===q.prompt);if(existing<0)answers.push({question:q.prompt,answer});else answers[existing]={question:q.prompt,answer};}
    }
    // Lock the form before the first awaited request to prevent duplicate starts.
    state.job={id:null,status:'running'};render();
    try{
      const job=await post('/api/jobs',{action:'type-assistant',assistant:{description:state.description,answers,finishWithUnknowns}});
      state.answers=answers;state.job={id:job.id,status:'running'};persist();render();clearTimeout(timer);await poll();
    }catch(e){state.job=null;state.error=e.message;persist();render();}
  }
  return {open(){modal('<div class="dialog-head"><h2>Помічник зі створення типу</h2><button class="btn" data-action="close">Закрити</button></div><div id="type-assistant-content"></div>');render();if(busy()&&!polling){clearTimeout(timer);poll();}}};
}
