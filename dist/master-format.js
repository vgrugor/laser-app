export const FORMAT_TOLERANCE = Object.freeze({canvas:0.01,panel:0.03});
export function masterFormatSpec(p) {
  const width=Number(p.width),height=Number(p.height);
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('Некоректні габарити декору');
  const gcd=(a,b)=>b?gcd(b,a%b):a,w=Math.round(width*1000),h=Math.round(height*1000),d=gcd(w,h);
  return {width,height,ratio:width/height,label:`${w/d}:${h/d}`,orientation:width===height?'квадратна':width>height?'горизонтальна':'вертикальна'};
}
export function masterFormatGuidance(p) {
  const s=masterFormatSpec(p);
  return `ФОРМАТ ДЕКОРУ: ширина ${s.width} мм, висота ${s.height} мм; ШИРИНА:ВИСОТА строго ${s.label}, орієнтація ${s.orientation}. І полотно master, і габаритний прямокутник зовнішнього силуету самого декору повинні мати це співвідношення. Усі частини декору мають вміщуватися повністю. Залишай однакові відносні поля зліва/справа та зверху/знизу; не ховай неправильну форму виробу у зайвих білих полях. Не розтягуй людей, кола, рослини й інші мотиви: адаптуй композицію та відступи до потрібної форми. Шаблон показує лише габарити, його прямокутник не задає форму виробу чи обов’язкову рамку. Для preview перспективний вигляд виробу дозволений, але фізичні пропорції його декору мають відповідати master; співвідношення всього preview не обмежується.`;
}
export function masterFormatNotice(p,{esc}) {
  let spec;try{spec=masterFormatSpec(p);}catch{return '<p class="note">Уточніть габарити панелі на кроці «Задум».</p>';}const report=p.aiData?.masterFormat,last=Array.isArray(report?.checks)?report.checks.at(-1):null,hash=p.aiData?.assetMetadata?.master?.sha256,check=hash&&last?.sourceSha256!==hash?null:last;
  const outdated=p.pendingAssetsUpdate?.length||report&&(report.target?.width!==p.width||report.target?.height!==p.height);
  const status=outdated?'outdated':check?.status||'not_checked';
  const title={pass:'Пропорції перевірено',changes_required:'Пропорції потребують виправлення',not_checked:'Пропорції ще не підтверджено',outdated:'Декор відповідає попереднім параметрам'}[status]||'Пропорції ще не підтверджено';
  const dims=check?.canvas?.dimensions,dimensions=Array.isArray(dims)&&dims.length===2&&dims.every(v=>Number.isFinite(v)&&v>0)?dims:null;
  return `<section class="master-format-note ${status==='changes_required'?'format-warning':''}" aria-label="Пропорції кольорового декору"><strong>${esc(title)}</strong><p>Задано: ${spec.width} × ${spec.height} мм · ${spec.label} · ${spec.orientation} орієнтація.</p>${!outdated&&check?`<p>${dimensions?`PNG: ${dimensions.join(' × ')} px. `:''}${esc(check.observation||'')}${report.correctionAttempted?' Виконано одну спробу виправлення.':''}</p>`:''}<small>Формат PNG перевіряється програмно, габарити самого декору — за візуальною оцінкою ШІ. Масштаб і точну геометрію перевірте у SolidWorks.</small></section>`;
}
