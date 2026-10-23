const IMAGE_KINDS = ['master','preview'];
const STATUSES = ['running','queued','completed','failed','cancelled','interrupted','stale'];
export const imageAction = action => ['generate','edit'].includes(action);
export function recordConceptRun(project, run) {
  if (!run?.conceptId || !run.id || !imageAction(run.action)) return;
  project.conceptRuns ??= [];
  const existing=project.conceptRuns.find(item=>item.id===run.id);
  if (existing) Object.assign(existing,run);
  else project.conceptRuns.push({...run});
}
export function conceptRuns(projects) {
  const runs=new Map();
  for(const p of projects) for(const run of p.conceptRuns||[]) {
    const previous=runs.get(run.id);
    if(!previous || Date.parse(run.finishedAt||run.startedAt||0)>=Date.parse(previous.finishedAt||previous.startedAt||0))runs.set(run.id,run);
  }
  return [...runs.values()].sort((a,b)=>Date.parse(b.startedAt||0)-Date.parse(a.startedAt||0));
}
export function conceptUsage(conceptId, runs) {
  const matches=runs.filter(run=>run.conceptId===conceptId);
  const running=matches.find(run=>['running','queued'].includes(run.status));
  const complete=matches.find(run=>IMAGE_KINDS.every(k=>run.assets?.[k]));
  const partial=matches.find(run=>IMAGE_KINDS.some(k=>run.assets?.[k]));
  const latest=matches[0];
  const result=complete||partial;
  return {matches,latest,result,state:running?'running':complete?'completed':partial?'partial':latest?'failed':null,
    label:running?'Створюється…':complete?'Зображення вже створювалися':partial?'Є частковий результат':latest?'Невдала або скасована спроба':null};
}
export function importedConceptRuns(value, safeImage) {
  if(value==null)return [];
  if(!Array.isArray(value))throw Error('Некоректна історія генерацій');
  const ids=new Set();
  return value.map(run=>{
    if(!run||['id','conceptId','projectId'].some(k=>typeof run[k]!=='string'||!run[k]||run[k].length>200)||ids.has(run.id)||!STATUSES.includes(run.status)||!imageAction(run.action)||!Number.isFinite(Date.parse(run.startedAt)))throw Error('Некоректна спроба генерації');
    ids.add(run.id);
    const assets={};for(const kind of IMAGE_KINDS)if(run.assets?.[kind]){if(!safeImage(run.assets[kind]))throw Error('Некоректне зображення генерації');assets[kind]=run.assets[kind];}
    return {id:run.id,jobId:typeof run.jobId==='string'?run.jobId.slice(0,200):null,conceptId:run.conceptId,projectId:run.projectId,projectTitle:String(run.projectTitle||'').slice(0,120),conceptTitle:String(run.conceptTitle||'').slice(0,500),action:run.action,status:['running','queued'].includes(run.status)?'interrupted':run.status,startedAt:run.startedAt,finishedAt:Number.isFinite(Date.parse(run.finishedAt))?run.finishedAt:null,assets,error:typeof run.error==='string'?run.error.slice(0,2000):null};
  });
}
export function conceptRunPreview(run,{esc,safeImage}) {
  return `<div class="dialog-head"><h2>${esc(run.conceptTitle||'Результат концепції')}</h2><button class="btn" data-action="close">Закрити</button></div><p>${esc(run.projectTitle)} · ${esc(new Date(run.startedAt).toLocaleString('uk-UA'))}</p>${run.error?`<p class="hint">${esc(run.error)}</p>`:''}<div class="version-preview">${['preview','master'].map(kind=>`<figure>${safeImage(run.assets?.[kind])?`<img src="${safeImage(run.assets[kind])}" alt="${kind==='preview'?'Вигляд виробу':'Декор'}">`:'<p>Цього зображення не отримано в цій спробі.</p>'}<figcaption>${kind==='preview'?'Вигляд виробу':'Декор для обведення'}</figcaption></figure>`).join('')}</div><p class="hint">Збережений результат цієї спроби. Перегляд не змінює поточний проєкт і не запускає генерацію.</p>`;
}
