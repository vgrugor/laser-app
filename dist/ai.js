const labels={concepts:'Створення 10 концепцій',plan:'План деталей',prompts:'Підготовка промптів',master:'Фронтальний декор',preview:'Вигляд виробу',review:'Перевірка зображень'};
export function createAI({current,projects,persist,snapshot,render,toast,esc,validate}){
  let connection=null,connectionError='',polling=false;
  const busy=p=>p?.aiJob&&['running','queued'].includes(p.aiJob.status);
  const fingerprint=async p=>{
    const value=JSON.stringify([p.title,p.type,p.width,p.height,p.brief,p.palette,p.layers,p.frame,p.reference,p.assets,p.notes,p.locks,p.selected,p.concepts]);
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
  };
  async function connect(){
    try{const r=await fetch('/api/status');if(!r.ok)throw Error();const d=await r.json();if(d.provider!=='codex-sdk')throw Error();connection=d;connectionError='';}
    catch{connection=null;connectionError='Запустіть sh scripts/start.command у папці проєкту та відкрийте http://127.0.0.1:8765/.';}
  }
  async function request(path,body){
    const r=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-Plywood-Token':connection.token}:{},...body?{body:JSON.stringify(body)}:{}});
    const data=await r.json();if(!r.ok)throw Error(data.error||'Помилка сервера');return data;
  }
  function panel(p){
    const j=p.aiJob,working=busy(p),report=p.aiReport;
    const jobError=j?.error?.includes('Operation not permitted')?'Codex не зміг запуститися в обмеженому середовищі. Запустіть sh scripts/start.command зі звичайного Terminal.':j?.error;
    const button=(a,text,disabled=false)=>`<button class="btn tiny" data-action="ai-${a}" ${disabled?'disabled':''}>${text}</button>`;
    return `<section id="ai-panel" class="panel ai-panel" aria-label="Генерація через Codex"><div class="panel-title"><h3>Майстерня ШІ · Codex</h3><span class="badge ${connection?'green':''}">${connection?'Сервер підключено':'Сервер недоступний'}</span></div><p class="hint">Поточний вхід ChatGPT · запуски використовують ліміти підписки. Вибір концепції та погодження — за вами.</p>${connectionError?`<div class="note">${esc(connectionError)}</div>`:''}<div class="actions-wrap">${button('concepts','10 концепцій',working||!connection)}${button('generate','Згенерувати декор і виріб',working||!connection||(!p.selected&&!p.prepared))}${button('edit','Застосувати правки',working||!connection||!p.assets.master||!p.notes.length)}${button('review','Перевірити пару',working||!connection||!p.assets.master||!p.assets.preview)}${button('reconnect','Оновити підключення',working)}</div>${j?`<div class="ai-progress" role="status" aria-live="polite"><strong>${working?'Виконується':j.status==='completed'?'Завершено':j.status==='stale'?'Результат попередньої редакції':j.status==='cancelled'?'Скасовано':'Зупинено'}: ${esc(labels[j.stage]||j.stage||'підготовка')}</strong>${working?button('cancel','Скасувати'):''}${jobError?`<p>${esc(jobError)}</p>`:''}${j.message?`<p>${esc(j.message)}</p>`:''}<small>Завдання ${esc(j.id)}</small>${j.status==='stale'?`<p class="hint">Параметри або зображення змінилися під час запуску. Результат не замінив актуальний проєкт; файли залишилися в artifacts/runs/${esc(j.id)}.</p>`:''}</div>`:''}${p.aiData?.plan?`<details class="ai-details"><summary>План деталей і промпти цього результату</summary><pre>${esc(JSON.stringify({plan:p.aiData.plan,prompts:p.aiData.prompts,knowledge:p.aiData.knowledge},null,2))}</pre></details>`:''}${report?`<div class="divider"></div><h3>Зауваження ШІ</h3><p>${report.disposition==='pass_visual'?'Візуальна перевірка пройдена':report.disposition==='changes_required'?'Потрібні правки':'Перевірка неповна'}</p>${report.findings.map(f=>`<div class="note"><strong>${f.severity==='blocker'?'Потрібно виправити':'Рекомендація'} · ${esc(f.location)}</strong><p>${esc(f.observation)}</p><p>${esc(f.suggested_action)}</p></div>`).join('')}${report.manual_checks.length?`<p class="hint">Перевірити вручну: ${report.manual_checks.map(esc).join('; ')}</p>`:''}${button('use-findings','Додати зауваження до правок',working||!report.findings.length)}<p class="hint">Візуальний огляд не підтверджує ширини 2 мм або готовність до різання.</p>`:''}</section>`;
  }
  function refresh(){const p=current(),el=document.querySelector('#ai-panel');if(el&&p)el.outerHTML=panel(p);}
  async function start(action){
    const p=current();if(busy(p))return;if(!validate(p))return;
    await connect();if(!connection){refresh();toast('Для генерації потрібен локальний сервер');return;}
    if(action==='edit'&&!p.notes.length){toast('Спочатку додайте опис правки');return;}
    try{
      // Send only the active revision, never its potentially large version history.
      const {versions,aiJob,aiReport,aiData,...project}=structuredClone(p);
      const revision=await fingerprint(p);
      const response=await request('/api/jobs',{action,project});
      p.aiJob={id:response.id,action,fingerprint:revision,status:'running',stage:'Підготовка'};
      await persist();render();await poll();
    }catch(e){toast(e.message);refresh();}
  }
  async function embed(jobId,kind){
    const r=await fetch(`/api/assets/${jobId}/${kind}.png`);if(!r.ok)throw Error('Не вдалося отримати зображення');
    const b=await r.blob();return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(b);});
  }
  async function poll(){
    if(polling||!connection)return;polling=true;
    try{
      for(const p of projects().filter(busy)){
        const previous=p.aiJob,j=await request(`/api/jobs/${previous.id}`);
        if(p.aiJob!==previous)continue;
        Object.assign(previous,{stage:j.stage,error:j.error});
        if(['running','queued'].includes(j.status)){refresh();continue;}
        if(j.result){
          if(await fingerprint(p)!==previous.fingerprint){previous.status='stale';await persist();render();continue;}
          const assets={};for(const kind of ['master','preview'])if(j.result.assets?.[kind])assets[kind]=await embed(j.id,kind);
          if(await fingerprint(p)!==previous.fingerprint){previous.status='stale';await persist();render();continue;}
          await snapshot(p,false);
          if(j.result.concepts){p.concepts=j.result.concepts.map((c,i)=>({...c,id:`${j.id}-c${i+1}`}));p.selected=null;p.prepared=false;p.conceptSource='codex';p.approved=false;p.aiReport=null;if(p.assets.master||p.assets.preview)p.pendingAssetsUpdate=['master','preview'];}
          if(Object.keys(assets).length){p.assets={...p.assets,...assets};p.example=null;p.prepared=true;p.approved=false;p.reviews={engraving:'unknown',palette:'unknown',parts:'unknown',composition:'unknown'};p.pendingAssetsUpdate=['master','preview'].filter(k=>!assets[k]);p.aiReport=null;}
          if(j.result.review){p.aiReport=j.result.review;p.approved=false;}
          p.aiData=previous.action==='review'?{...p.aiData,review:j.result.review,reviewJobId:j.id,reviewKnowledge:j.result.knowledge}:{...j.result,jobId:j.id};p.updatedAt=new Date().toISOString();
          previous.message=j.status==='completed'?'Результат збережено. Перегляньте зображення й перевірку.':'Збережено доступний частковий результат. Решта етапів не завершена.';
        }
        previous.status=j.status;await persist();render();
      }
    }catch(e){connectionError='Зв’язок із сервером перервано. Результат залишиться на диску; оновіть підключення.';refresh();}
    finally{polling=false;}
  }
  async function action(name){
    if(['concepts','generate','edit','review'].includes(name))return start(name);
    if(name==='reconnect'){await connect();refresh();await poll();}
    if(name==='cancel'){try{await request(`/api/jobs/${current().aiJob.id}/cancel`,{});toast('Запит на скасування надіслано');}catch(e){toast(e.message);}}
    if(name==='use-findings'){
      const p=current();await snapshot(p,false);const notes=p.aiReport.findings.map(f=>`${f.location}: ${f.observation} ${f.suggested_action}`);p.notes.push(...notes.filter(n=>!p.notes.includes(n)).slice(0,100-p.notes.length));p.pendingAssetsUpdate=['master','preview'];p.approved=false;await persist();render();toast('Зауваження додано. Натисніть «Застосувати правки», щоб виконати один цикл виправлення.');
    }
  }
  return {panel,action,start,async init(){await connect();refresh();await poll();setInterval(poll,1800);}};
}
