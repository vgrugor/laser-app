import { TRACING_KINDS, tracingFingerprint, markTracingOutdated } from './tracing.js';
import { imageAction, recordConceptRun } from './concept-history.js';
import { generationScreen } from './generation.js';
import { conceptIssue } from './concepts.js';
import { moveToRoute, routeAfterJob, projectRoute } from './project-route.js';
import { invalidateApproval } from './approval.js';
const labels={concepts:'Створення 10 концепцій',plan:'План деталей',prompts:'Підготовка промптів',master:'Фронтальний декор',preview:'Вигляд виробу',review:'Перевірка зображень'};
export function createAI({prepareStart=async p=>p,getTypeRevision=()=>undefined,confirmPalette=async()=>true,paletteSummary=()=>'',refreshContext=()=>{},onImagesApplied=()=>{},current,projects,persist,snapshot,render,toast,esc,validate}){
  let connection=null,connectionError='',polling=false;
  const launching=new Set(),launchErrors=new Map();
  const busy=p=>p?.aiJob&&['running','queued'].includes(p.aiJob.status);
  const fingerprint=async p=>{
    const value=JSON.stringify([getTypeRevision(p),p.title,p.type,p.clockMount||'unspecified',p.width,p.height,p.brief,p.palette,p.layers,p.frame,p.reference,p.assets,p.notes,p.locks,p.selected,p.concepts]);
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
    const j=p.aiJob,working=busy(p);
    const jobError=j?.error?.includes('Operation not permitted')?'Codex не зміг запуститися в обмеженому середовищі. Запустіть sh scripts/start.command зі звичайного Terminal.':j?.error;
    const step=projectRoute(p).current;
    if(['generation','result','saved'].includes(step))return '';
    if(['brief','palette','concepts'].includes(step)){
      const starting=launching.has(p.id)&&p.aiLaunchErrorAction==='concepts'&&!working;
      const launchError=p.aiLaunchErrorAction==='concepts'&&p.aiLaunchError;
      const stopped=['palette','concepts'].includes(step)&&j?.action==='concepts'&&['failed','cancelled','interrupted','stale'].includes(j.status);
      if(!working&&!stopped&&!starting&&!launchError)return '';
      const disconnected=working&&connectionError;
      const title=disconnected?'Зв’язок із сервером перервано':starting?'Підключаємося для створення концепцій':working?'Виконується: '+esc(labels[j.stage]||j.stage||'Підготовка'):launchError?'Не вдалося розпочати створення концепцій':'Створення концепцій зупинено';
      const description=disconnected?esc(connectionError):starting?'Перевіряємо підключення й створюємо завдання.':working?'Дочекайтеся результату або скасуйте запуск.':esc(launchError||jobError||'Перегляньте палітру та повторіть запуск, коли будете готові.');
      return `<section id="ai-panel" class="panel ai-panel" aria-label="Поточне завдання ШІ"><div role="status" aria-live="polite"><strong>${title}</strong><p class="hint">${description}</p></div>${disconnected?'<button class="btn tiny" data-action="ai-reconnect">Відновити зв’язок</button>':''}${working?`<button class="btn tiny" data-action="ai-cancel" ${!connection?'disabled':''}>Скасувати завдання</button>`:''}</section>`;
    }
    return '';
  }
  function generation(p){return generationScreen(p,{esc,connected:Boolean(connection),connectionError,launching:launching.has(p.id),launchError:['generate','edit'].includes(p.aiLaunchErrorAction||p.aiLaunchAction)?launchErrors.get(p.id)||p.aiLaunchError||'':''});}
  function refresh(){const p=current();if(!p)return;const el=document.querySelector('#ai-panel'),screen=document.querySelector('#generation-screen');if(el)el.outerHTML=panel(p);if(screen)screen.outerHTML=generation(p);refreshContext();}

  async function start(action){
    let p=current();if(!p||busy(p)||launching.has(p.id))return;
    let sourceConcept=null,attemptAt=null,submitted=null;
    const ownerId=p.id;launching.add(ownerId);launchErrors.delete(ownerId);
    try{
      const prepared=await prepareStart(p,action);if(!prepared)return;p=prepared;launching.add(p.id);
      if(current()!==p||busy(p))return;
      if(action==='concepts'&&!await confirmPalette(p))return;
      if(current()!==p||busy(p)||!validate(p))return;
      if(action==='tracing'&&(!p.assets?.master||p.pendingAssetsUpdate?.length)){toast('Спочатку отримайте актуальний кольоровий декор');return;}
      if(imageAction(action)){sourceConcept=p.concepts?.find(c=>c.id===p.selected)||null;attemptAt=new Date().toISOString();}
      p.aiLaunchErrorAction=action;p.aiLaunchError=null;
      if(['generate','edit'].includes(action))p.aiLaunchAction=action;
      if(['generate','edit'].includes(action))moveToRoute(p,'generation');
      if(action==='concepts')moveToRoute(p,'concepts');
      await persist();render();
      await connect();if(!connection){launchErrors.set(p.id,connectionError);p.aiLaunchError=connectionError;failedLaunch(p,sourceConcept,action,attemptAt,connectionError);await persist();render();toast('Для генерації потрібен локальний сервер');return;}
      if(action==='edit'&&!p.notes.length){toast('Спочатку додайте опис правки');return;}
      const {versions,aiJob,aiReport,aiData,resultDraft,aiLaunchAction,aiLaunchError,aiLaunchErrorAction,conceptRuns,tracing,...project}=structuredClone(p);
      project.typeRevision=getTypeRevision(p);
      if(action==='generate'&&p.selected){const concept=p.concepts.find(c=>c.id===p.selected),issue=conceptIssue(p,concept);if(issue){toast(issue);return;}project.palette=[...(concept.palette||p.palette)];project.frame=concept.frame;}
      if(['review','tracing'].includes(action)&&aiData?.plan)project.designPlan=aiData.plan;
      if(imageAction(action))sourceConcept=project.concepts?.find(c=>c.id===project.selected)||null;
      const revision=action==='tracing'?await tracingFingerprint(p):await fingerprint(p);
      const response=await request('/api/jobs',{action,project});
      submitted=response.id;p.aiJob={id:response.id,action,conceptId:sourceConcept?.id||null,conceptTitle:sourceConcept?.title||'',startedAt:attemptAt,fingerprint:revision,status:'running',stage:'Підготовка'};
      recordConceptRun(p,{id:response.id,jobId:response.id,conceptId:sourceConcept?.id,conceptTitle:sourceConcept?.title||'',projectId:p.id,projectTitle:project.title,action,status:'running',startedAt:attemptAt,assets:{}});
      if(action!=='tracing')moveToRoute(p,action==='concepts'?'concepts':['generate','edit'].includes(action)?'generation':'result');
      await persist();render();await poll();return response.id;
    }catch(e){if(!submitted)failedLaunch(p,sourceConcept,action,attemptAt,e.message);launchErrors.set(p.id,e.message);p.aiLaunchError=e.message;await persist();toast(e.message);render();}
    finally{launching.delete(ownerId);launching.delete(p.id);refresh();}
  }
  function failedLaunch(p,concept,action,startedAt,error){
    if(!concept||conceptIssue(p,concept))return;
    recordConceptRun(p,{id:'launch-'+crypto.randomUUID(),jobId:null,conceptId:concept.id,conceptTitle:concept.title,projectId:p.id,projectTitle:p.title,action,status:'failed',startedAt,finishedAt:new Date().toISOString(),assets:{},error});
  }
  function finishRun(p,job){
    if(!job.conceptId)return;
    const assets={};for(const kind of job.appliedAssets||[])if(p.assets[kind])assets[kind]=p.assets[kind];
    recordConceptRun(p,{id:job.id,jobId:job.id,conceptId:job.conceptId,conceptTitle:job.conceptTitle||'',projectId:p.id,projectTitle:p.conceptRuns?.find(r=>r.id===job.id)?.projectTitle||p.title,action:job.action,status:job.status,startedAt:job.startedAt||new Date().toISOString(),finishedAt:job.finishedAt||new Date().toISOString(),assets,error:job.error||null});
  }
  async function embed(jobId,kind){
    const r=await fetch(`/api/assets/${jobId}/${kind}.png`);if(!r.ok)throw Error('Не вдалося отримати зображення');
    const b=await r.blob();return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(b);});
  }
  async function restoreConceptRuns(){
    if(!connection)return;
    const known=new Set(projects().flatMap(p=>(p.conceptRuns||[]).map(r=>r.id))),candidates=new Map();
    for(const p of projects())for(const data of [p,...(p.versions||[]).map(v=>v.data)]){
      for(const id of [data?.aiData?.jobId,imageAction(data?.aiJob?.action)?data.aiJob.id:null])if(id&&!known.has(id)&&!candidates.has(id))candidates.set(id,p);
    }
    let changed=false;
    for(const [id,p] of candidates){try{
      const job=await request(`/api/jobs/${id}`);if(!job.conceptId||!imageAction(job.action))continue;
      const assets={};if(!['running','queued'].includes(job.status))for(const kind of ['master','preview'])if(job.result?.assets?.[kind])assets[kind]=await embed(job.id,kind);
      recordConceptRun(p,{id:job.id,jobId:job.id,conceptId:job.conceptId,conceptTitle:job.conceptTitle||'',projectId:job.projectId||p.id,projectTitle:job.projectTitle||p.title,action:job.action,status:job.status,startedAt:job.createdAt||new Date().toISOString(),finishedAt:job.finishedAt||null,assets,error:job.error||null});changed=true;
    }catch{/* Missing historical files never prevent opening the current project. */}}
    if(changed){await persist();render();}
  }
  async function poll(){
    if(polling||!connection)return;polling=true;
    try{
      for(const p of projects().filter(busy)){
        const previous=p.aiJob,j=await request(`/api/jobs/${previous.id}`);
        if(p.aiJob!==previous)continue;
        if(!previous.conceptId&&j.conceptId){previous.conceptId=j.conceptId;previous.conceptTitle=j.conceptTitle||'';previous.startedAt=j.createdAt;}
        connectionError='';
        const availableAssets=Object.keys(j.result?.assets||{}).filter(kind=>(previous.action==='tracing'?TRACING_KINDS:['master','preview']).includes(kind));
        const changed=previous.stage!==j.stage||JSON.stringify(previous.availableAssets||[])!==JSON.stringify(availableAssets);
        Object.assign(previous,{stage:j.stage,error:j.error,availableAssets,serverStatus:j.status});
        if(['running','queued'].includes(j.status)){if(changed)await persist();refresh();continue;}
        if(previous.action==='tracing'){
          // Never mix derived files into the colour pair or replace its approval/report.
          if(j.result&&availableAssets.length){
            if(await tracingFingerprint(p)!==previous.fingerprint){previous.status='stale';previous.message='Декор змінився під час створення контурів. Повторіть запуск.';await persist();render();continue;}
            const assets={};for(const kind of availableAssets)assets[kind]=await embed(j.id,kind);
            if(p.aiJob!==previous)continue;
            if(await tracingFingerprint(p)!==previous.fingerprint){previous.status='stale';previous.message='Декор змінився під час створення контурів. Повторіть запуск.';await persist();render();continue;}
            await snapshot(p,false,'Перед оновленням контурного рисунка');
            p.tracing={assets,sourceFingerprint:previous.fingerprint,outdated:Boolean(p.pendingAssetsUpdate?.length),jobId:j.id,createdAt:j.finishedAt||new Date().toISOString(),review:j.result.tracingReview||null,assetMetadata:j.result.assetMetadata||{},sourceMasterHash:j.result.sourceMasterHash||null,knowledge:j.result.knowledge||null};
            previous.appliedAssets=Object.keys(assets);
          }
          previous.status=j.status;previous.finishedAt=j.finishedAt||null;previous.cancelRequested=false;
          await persist();render();continue;
        }
        if(j.result){
          if(await fingerprint(p)!==previous.fingerprint){previous.status='stale';finishRun(p,previous);await persist();render();continue;}
          const assets={};for(const kind of ['master','preview'])if(j.result.assets?.[kind])assets[kind]=await embed(j.id,kind);
          if(await fingerprint(p)!==previous.fingerprint){previous.status='stale';finishRun(p,previous);await persist();render();continue;}
          await snapshot(p,false,previous.action==='concepts'?'Перед оновленням концепцій':previous.action==='review'?'Перед повторною перевіркою':previous.action==='edit'?'Перед застосуванням правок ШІ':'Перед додаванням результату генерації');
          if(j.result.concepts){p.conceptSetOutdated=false;p.conceptReuseConfirmation=null;p.concepts=j.result.concepts.map((c,i)=>({...c,id:`${j.id}-c${i+1}`}));p.selected=null;p.prepared=false;p.conceptSource='codex';invalidateApproval(p);p.aiReport=null;if(p.assets.master||p.assets.preview)p.pendingAssetsUpdate=['master','preview'];}
          if(Object.keys(assets).length){previous.appliedAssets=Object.keys(assets);p.assets={...p.assets,...assets};markTracingOutdated(p);p.example=null;p.prepared=true;invalidateApproval(p);p.reviews={engraving:'unknown',palette:'unknown',parts:'unknown',composition:'unknown'};p.pendingAssetsUpdate=['master','preview'].filter(k=>!assets[k]);p.aiReport=null;onImagesApplied(p,assets);}
          if(j.result.review){p.aiReport=j.result.review;invalidateApproval(p);}
          p.aiData=previous.action==='review'?{...p.aiData,review:j.result.review,reviewJobId:j.id,reviewKnowledge:j.result.knowledge}:{...j.result,jobId:j.id};p.updatedAt=new Date().toISOString();
          if(Object.keys(assets).length)p.aiData.sourceConceptId=previous.conceptId||null;
          previous.message=j.status==='completed'?'Результат збережено. Перегляньте зображення й перевірку.':'Збережено доступний частковий результат. Решта етапів не завершена.';
        }
        previous.status=j.status;previous.finishedAt=j.finishedAt||null;previous.cancelRequested=false;finishRun(p,previous);routeAfterJob(p,previous.action,j.status);await persist();render();
      }
    }catch(e){connectionError='Зв’язок із сервером перервано. Результат залишиться на диску; оновіть підключення.';refresh();}
    finally{polling=false;}
  }
  async function action(name){
    if(['concepts','generate','edit','review','tracing'].includes(name))return start(name);
    if(name==='retry-generation')return start((current()?.aiLaunchAction||current()?.aiJob?.action)==='edit'?'edit':'generate');
    if(name==='reconnect'){await connect();refresh();await poll();}
    if(name==='cancel'){const p=current(),job=p?.aiJob;if(!busy(p)||job.cancelRequested)return;try{await request(`/api/jobs/${job.id}/cancel`,{});job.cancelRequested=true;await persist();refresh();toast('Запит на скасування надіслано');}catch(e){toast(e.message);}}
    if(name==='use-findings'){
      const p=current();await snapshot(p,false,'Перед додаванням зауважень ШІ');const notes=p.aiReport.findings.map(f=>`${f.location}: ${f.observation} ${f.suggested_action}`);p.notes.push(...notes.filter(n=>!p.notes.includes(n)).slice(0,100-p.notes.length));p.pendingAssetsUpdate=['master','preview'];invalidateApproval(p);await persist();render();toast('Зауваження додано. Натисніть «Застосувати правки», щоб виконати один цикл виправлення.');
    }
  }
  return {panel,generation,action,start,tracingContext:(p=current())=>({starting:Boolean(p&&launching.has(p.id)&&p.aiLaunchErrorAction==='tracing'),connectionError}),isLaunching:p=>launching.has(p.id),resultContext:()=>({connectionError,reviewLaunchError:current()?.aiLaunchErrorAction==='review'?current().aiLaunchError||'':''}),async init(){await connect();await restoreConceptRuns();refresh();await poll();setInterval(poll,1800);}};
}
