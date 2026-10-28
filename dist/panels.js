export const safePanelImage=s=>typeof s==='string'&&(/^(assets\/(magnolia|tits|bird)-(preview|master)\.png)$/.test(s)||/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s))?s:'';
export const MAX_PANELS=12;
// A cached content fingerprint for UI identity, not a security or authenticity check.
const imageKeys=new WeakMap();
export function panelImageKey(part){
  const assets=part.assets,source=assets?.master;if(typeof source!=='string'||!source)return null;
  let cached=imageKeys.get(assets);
  if(cached?.source!==source){
    let a=1779033703,b=3144134277,c=1013904242,d=2773480762;
    for(let i=0;i<source.length;i++){const k=source.charCodeAt(i);a=b^Math.imul(a^k,597399067);b=c^Math.imul(b^k,2869860233);c=d^Math.imul(c^k,951274213);d=a^Math.imul(d^k,2716044179);}
    cached={source,key:[a,b,c,d].map(x=>(x>>>0).toString(16).padStart(8,'0')).join('')+':'+source.length};imageKeys.set(assets,cached);
  }
  return `v1:${cached.key}:${part.width}:${part.height}`;
}
export const PANEL_STATES=Object.freeze({empty:'Ще не створена',variant:'Є варіант',selected:'Обрана',outdated:'Потребує оновлення'});
export function panelState(part){
  if(!part.assets?.master)return 'empty';
  if(part.pendingAssetsUpdate?.includes('master'))return 'outdated';
  return importedPanelSelection(part)?'selected':'variant';
}
export function importedPanelSelection(part,value=part.selection){
  return value?.actor==='user'&&value.imageKey===panelImageKey(part)&&!part.pendingAssetsUpdate?.includes('master')&&typeof value.at==='string'&&Number.isFinite(Date.parse(value.at))?{actor:'user',imageKey:value.imageKey,at:value.at}:null;
}
export function refreshPanelSelections(p){for(const part of p.panels?.length?p.panels:[p])part.selection=importedPanelSelection(part);}
export function choosePanel(p,id,at=new Date().toISOString()){
  if(['running','queued'].includes(p.aiJob?.status))throw Error('Дочекайтеся завершення поточного завдання.');
  const part=p.panels?.length?p.panels.find(x=>x.id===id):id==='primary'?p:null;if(!part)throw Error('Панель не знайдено');
  if(['empty','outdated'].includes(panelState(part)))throw Error('Спочатку отримайте актуальне зображення цієї панелі.');
  part.selection={actor:'user',imageKey:panelImageKey(part),at};return part;
}
export function clearPanelSelection(p,id){const part=p.panels?.length?p.panels.find(x=>x.id===id):id==='primary'?p:null;if(part)part.selection=null;}
export function nextPanel(p,id=activePanel(p).id){
  const list=panelList(p),i=list.findIndex(x=>x.id===id);
  return [...list.slice(i+1),...list.slice(0,i)].find(x=>panelState(x)!=='selected')||null;
}
function panelChoice(p,part,{esc,busy=false}){
  const state=panelState(part);busy=busy||['running','queued'].includes(p.aiJob?.status);
  if(['empty','outdated'].includes(state))return '';
  const next=multiPanel(p)&&nextPanel(p,part.id);
  return `<div class="panel-choice" aria-label="Вибір панелі"><p class="hint">Ваш вибір зображення зберігається окремо від перевірки ШІ та прийняття всього виробу.</p><div class="actions-wrap">${state==='selected'?`${next?`<button class="btn primary" data-action="panel-next">Далі: ${esc(next.name)}</button>`:''}<button class="btn tiny" data-action="panel-unchoose" ${busy?'disabled':''}>Скасувати вибір панелі</button>`:state==='variant'?`<button class="btn primary" data-action="${multiPanel(p)?'panel-choose-next':'panel-choose'}" ${busy?'disabled':''}>${multiPanel(p)?'Обрати й перейти далі':'Панель подобається — обрати'}</button>`:''}</div>${state==='selected'?`<p class="hint">Обрано: ${esc(new Date(part.selection.at).toLocaleString('uk-UA'))}</p>`:''}</div>`;
}
export const panelList=p=>Array.isArray(p.panels)&&p.panels.length?p.panels:[{id:'primary',name:'Основна панель',width:p.width,height:p.height,brief:'',selection:p.selection,assets:p.assets,aiData:p.aiData,aiReport:p.aiReport,tracing:p.tracing,notes:p.notes,locks:p.locks,resultDraft:p.resultDraft,pendingAssetsUpdate:p.pendingAssetsUpdate}];
export const multiPanel=p=>panelList(p).length>1;
export const activePanel=p=>panelList(p).find(x=>x.id===p.activePanelId)||panelList(p)[0];
export function panelView(p,id=activePanel(p).id){
  if(!multiPanel(p))return p;
  const part=panelList(p).find(x=>x.id===id)||activePanel(p);
  return {...p,...part,id:p.id,title:`${p.title} · ${part.name}`,panels:undefined,approved:p.approved,assets:{master:part.assets?.master||null,preview:p.assets?.preview||null},notes:part.notes||[],locks:part.locks||[],pendingAssetsUpdate:part.pendingAssetsUpdate||[],reviews:p.reviews};
}
export function panelMetadata(p){return panelList(p).map(x=>({id:x.id,name:x.name,width:x.width,height:x.height,brief:x.brief||'',sameSizeAs:x.sameSizeAs||null,sameDesignAs:x.sameDesignAs||null}));}
export function panelSources(p){return p.panels?.length?panelList(p).map(x=>({...panelMetadata({panels:[x]})[0],master:x.assets?.master||null,plan:x.aiData?.plan||null,notes:x.notes||[],locks:x.locks||[]})):null;}
export function validatePanels(p){
  if(p.panels===undefined)return;
  if(!Array.isArray(p.panels)||!p.panels.length||p.panels.length>MAX_PANELS)throw Error(`Потрібно від 1 до ${MAX_PANELS} панелей`);
  const seen=new Map();
  for(const x of p.panels){
    if(!x||typeof x.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(x.id)||seen.has(x.id)||typeof x.name!=='string'||!x.name.trim()||x.name.length>100||typeof (x.brief||'')!=='string'||(x.brief||'').length>4000)throw Error('Некоректна назва або ID панелі');
    if(!Number.isFinite(x.width)||!Number.isFinite(x.height)||x.width<20||x.height<20||!((x.width<=300&&x.height<=400)||(x.width<=400&&x.height<=300)))throw Error(`Панель «${x.name}» не вміщується в лист 300 × 400 мм`);
    for(const key of ['sameSizeAs','sameDesignAs'])if(x[key]){const source=seen.get(x[key]);if(!source)throw Error('Панель можна пов’язати лише з попередньою панеллю');if(source.width!==x.width||source.height!==x.height)throw Error('Пов’язані панелі повинні мати однакові габарити');}
    for(const [key,max] of [['notes',100],['locks',20]])if(x[key]!==undefined&&(!Array.isArray(x[key])||x[key].length>max||x[key].some(v=>typeof v!=='string'||v.length>4000)))throw Error('Некоректні побажання панелі');
    seen.set(x.id,x);
  }
}
export function ensurePanels(p){if(!p.panels)p.panels=structuredClone(panelList(p));return p.panels;}
export function captureSinglePanel(p){if(p.panels?.length===1){const x=p.panels[0];for(const key of ['width','height','assets','aiData','aiReport','tracing','notes','locks','resultDraft','pendingAssetsUpdate'])x[key]=p[key];}refreshPanelSelections(p);}
export function validPanelConfiguration(p){try{validatePanels(p);return true;}catch{return false;}}
export function syncPrimaryPanel(p){
  if(!p.panels?.length)return;
  const primary=p.panels[0];p.width=primary.width;p.height=primary.height;
  p.assets={...p.assets,master:primary.assets?.master||null};
  p.notes=primary.notes||[];p.locks=primary.locks||[];p.tracing=primary.tracing||null;
  p.aiData={...primary.aiData,...p.aiData?.sharedPlan?{sharedPlan:p.aiData.sharedPlan}:{},...p.aiData?.setPreviewReview?{setPreviewReview:p.aiData.setPreviewReview}:{}};
}
export function markPanelOutdated(p,id){
  const targets=id?new Set([id]):new Set(panelList(p).map(x=>x.id));
  for(const x of p.panels||[]){if(targets.has(x.sameDesignAs)||targets.has(x.id)){targets.add(x.id);x.selection=null;x.pendingAssetsUpdate=x.assets?.master?['master']:[];if(x.tracing)x.tracing.outdated=true;}}
  p.pendingAssetsUpdate=panelList(p).some(x=>x.assets?.master)||p.assets?.preview?['master','preview']:[];p.aiReport=null;
}
export function updatePanelMetadata(p,id,key,value){
  const list=ensurePanels(p),part=list.find(x=>x.id===id);if(!part)throw Error('Панель не знайдено');
  if(['width','height'].includes(key)&&(part.sameSizeAs||part.sameDesignAs))throw Error('Спочатку відв’яжіть спільні розміри або декор');
  if(['sameSizeAs','sameDesignAs'].includes(key)){
    if(key==='sameSizeAs'&&part.sameDesignAs&&value!==part.sameDesignAs)throw Error('Спочатку відв’яжіть повтор декору');
    if(value){const index=list.indexOf(part),source=list.slice(0,index).find(x=>x.id===value);if(!source)throw Error('Оберіть попередню панель');part.width=source.width;part.height=source.height;}
    part[key]=value||null;if(key==='sameDesignAs'&&value)part.sameSizeAs=value;
  }else if(['name','brief','width','height'].includes(key))part[key]=value;else throw Error('Невідомий параметр панелі');
  for(const x of list){const source=list.find(y=>y.id===(x.sameDesignAs||x.sameSizeAs));if(source){x.width=source.width;x.height=source.height;}}
  syncPrimaryPanel(p);markPanelOutdated(p);return part;
}
export function addPanel(p){
  const list=ensurePanels(p);if(list.length>=MAX_PANELS)throw Error(`Максимум ${MAX_PANELS} панелей`);
  const part={id:crypto.randomUUID(),name:`Панель ${list.length+1}`,width:160,height:120,brief:'',assets:{master:null},notes:[],locks:[],pendingAssetsUpdate:['master']};list.push(part);markPanelOutdated(p);return part;
}
export function removePanel(p,id){
  const list=ensurePanels(p);if(list.length===1)throw Error('У проєкті має залишитися хоча б одна панель');
  if(list.some(x=>x.sameSizeAs===id||x.sameDesignAs===id))throw Error('Спочатку відв’яжіть панелі, які посилаються на цю');
  p.panels=list.filter(x=>x.id!==id);if(p.activePanelId===id)p.activePanelId=p.panels[0].id;syncPrimaryPanel(p);markPanelOutdated(p);
}
export function panelsReady(p){return panelList(p).every(x=>x.assets?.master&&!x.pendingAssetsUpdate?.length);}
export const panelsChosen=p=>panelsReady(p)&&panelList(p).every(x=>panelState(x)==='selected');
const projectImageKeys=new WeakMap();
function projectImageKey(p,key){
  const source=key==='preview'?p.assets?.preview:p.reference;if(!source)return null;
  const cache=projectImageKeys.get(p)||{};if(cache[key]?.source===source)return cache[key].value;
  const value=panelImageKey({assets:{master:source},width:0,height:0});cache[key]={source,value};projectImageKeys.set(p,cache);return value;
}
export function productSourceKey(p){
  const source=JSON.stringify([p.type,p.clockMount||'unspecified',p.brief,p.palette,p.layers,p.frame,projectImageKey(p,'reference'),p.selected,p.concepts?.find(c=>c.id===p.selected)||null,
    panelList(p).map(x=>[x.id,x.name,x.width,x.height,x.brief||'',x.sameDesignAs||null,x.sameSizeAs||null,panelImageKey(x),x.notes||[],x.locks||[]])]);
  return panelImageKey({assets:{master:source},width:0,height:0});
}
export function productPreviewStatus(p){
  if(!p.assets?.preview)return 'missing';
  if(!panelsReady(p)||p.pendingAssetsUpdate?.includes('preview'))return 'outdated';
  if(!p.previewProvenance)return 'legacy';
  return p.previewProvenance.sourceKey===productSourceKey(p)&&p.previewProvenance.imageKey===projectImageKey(p,'preview')?'current':'outdated';
}
export function bindProductPreview(p,{origin='manual',at=new Date().toISOString(),typeRevision}={}){
  if(!p.assets?.preview)return null;
  return {version:1,sourceKey:productSourceKey(p),imageKey:projectImageKey(p,'preview'),at,origin,...typeRevision!==undefined?{typeRevision}:{}};
}
export function importedPreviewProvenance(value){
  if(!value)return null;
  return value.version===1&&['sourceKey','imageKey'].every(k=>typeof value[k]==='string'&&value[k].length<=150)&&typeof value.at==='string'&&value.at.length<=40&&Number.isFinite(Date.parse(value.at))&&['generated','manual','review','user-confirmed'].includes(value.origin)?{version:1,sourceKey:value.sourceKey,imageKey:value.imageKey,at:value.at,origin:value.origin,...Number.isInteger(value.typeRevision)&&value.typeRevision>0?{typeRevision:value.typeRevision}:{}}:null;
}
export function validatePanelOperation(p,action){
  const target=p.generationTarget||'all',parts=panelList(p),part=parts.find(x=>x.id===p.scopePanelId);
  if(p.generationTarget!==undefined&&!['panel','preview','all'].includes(p.generationTarget))throw Error('Невідома ціль генерації');
  if(!['generate','edit'].includes(action)&&p.generationTarget)throw Error('Ціль генерації не застосовується до цієї дії');
  if(p.scopePanelId&&!part)throw Error('Невідома панель для завдання');
  if(p.generationTarget==='all'&&action==='generate'&&p.scopePanelId)throw Error('Для всього комплекту не задається окрема панель');
  if(target==='panel'&&!part)throw Error('Оберіть панель для генерації');
  if(target==='preview'){
    if(action!=='generate'||p.scopePanelId)throw Error('Загальний вигляд запускається окремо від панелей');
    if(!panelsReady(p))throw Error('Спочатку потрібні актуальні зображення всіх панелей комплекту');
    if(!panelsChosen(p))throw Error('Спочатку оберіть результат кожної панелі.');
  }
  if(action==='review'&&p.scopePanelId&&(!part?.assets?.master||part.pendingAssetsUpdate?.length))throw Error('Для перевірки панелі потрібен актуальний декор.');
  if(action==='review'&&!p.scopePanelId&&['missing','outdated'].includes(productPreviewStatus(p)))throw Error('Для перевірки комплекту потрібен актуальний загальний вигляд.');
  if(action==='edit'&&(!part||part.sameDesignAs||!part.assets?.master))throw Error('Для правки потрібна незалежна панель із зображенням');
  if(target==='panel'&&action==='generate'&&part.sameDesignAs){const source=parts.find(x=>x.id===part.sameDesignAs);if(!source?.assets?.master||source.pendingAssetsUpdate?.length)throw Error('Спочатку створіть актуальну вихідну панель для повторення декору');}
  return target;
}
export function panelOperations(p,{esc,busy=false}){
  if(!multiPanel(p))return '';
  const part=activePanel(p);busy=busy||['running','queued'].includes(p.aiJob?.status);
  const source=panelList(p).find(x=>x.id===part.sameDesignAs),copyReady=source?.assets?.master&&!source.pendingAssetsUpdate?.length;
  const state=panelState(part);
  return `<div class="panel-operations"><div class="actions-wrap">${['empty','outdated'].includes(state)?`<button class="btn primary" data-action="ai-panel-generate" ${busy||part.sameDesignAs&&!copyReady?'disabled':''}>${part.sameDesignAs?'Повторити декор вихідної панелі':state==='outdated'?'Оновити панель':'Згенерувати панель'}: ${esc(part.name)}</button>`:''}${part.assets?.master&&!part.sameDesignAs?`<button class="btn" data-action="open-corrections" ${busy?'disabled':''}>Внести правки до панелі</button><button class="btn" data-action="ai-panel-regenerate" ${busy?'disabled':''}>Інший варіант панелі</button>`:''}${part.sameDesignAs?`<button class="btn tiny" data-select-panel="${esc(part.sameDesignAs)}">До вихідної панелі</button>`:''}</div><div class="panel-whole-product">${panelsChosen(p)?`<button class="btn" data-action="panel-finalize">Перейти до загального вигляду</button>`:`<p class="hint">Загальний вигляд стане доступним після вибору всіх панелей. Обрано ${panelList(p).filter(x=>panelState(x)==='selected').length} із ${panelList(p).length}.</p>`}${p.assets?.preview&&productPreviewStatus(p)==='outdated'?'<p class="hint">Попередній загальний вигляд потребує оновлення.</p>':''}</div></div>`;
}
export function replacePanelMaster(p,id,data){
  const targets=new Set([id]);
  for(const part of panelList(p))if(targets.has(part.id)||targets.has(part.sameDesignAs)){
    targets.add(part.id);part.assets={master:data};part.pendingAssetsUpdate=[];part.aiData=null;part.aiReport=null;if(part.tracing)part.tracing.outdated=true;
  }
  refreshPanelSelections(p);p.pendingAssetsUpdate=['preview'];p.aiReport=null;syncPrimaryPanel(p);
}
export function panelEditor(p,{esc}){
  const list=panelList(p);
  return `<section class="panel-editor" aria-label="Декоративні панелі"><h3>Декоративні панелі · ${list.length}</h3><p class="hint">Кожна панель має власні габарити. Палітра та загальний задум спільні для комплекту.</p>${list.map((x,i)=>`<fieldset class="panel-settings"><legend>Панель ${i+1}</legend><label>Назва<input aria-label="Назва панелі ${i+1}" data-panel-field="name" data-panel-id="${esc(x.id)}" maxlength="100" value="${esc(x.name)}"></label><div class="form-grid"><label>Ширина, мм<input aria-label="Ширина панелі ${i+1}" type="number" min="20" max="400" data-panel-field="width" data-panel-id="${esc(x.id)}" value="${esc(x.width)}" ${x.sameSizeAs||x.sameDesignAs?'disabled':''}></label><label>Висота, мм<input aria-label="Висота панелі ${i+1}" type="number" min="20" max="400" data-panel-field="height" data-panel-id="${esc(x.id)}" value="${esc(x.height)}" ${x.sameSizeAs||x.sameDesignAs?'disabled':''}></label></div><label>Сюжет або побажання для цієї панелі<textarea aria-label="Опис панелі ${i+1}" data-panel-field="brief" data-panel-id="${esc(x.id)}" maxlength="4000">${esc(x.brief||'')}</textarea></label>${i?`<div class="form-grid">${[['sameSizeAs','Однакові розміри з'],['sameDesignAs','Той самий декор, що й']].map(([key,label])=>`<label>${label}<select aria-label="${label} · панель ${i+1}" data-panel-field="${key}" data-panel-id="${esc(x.id)}"><option value="">Незалежна панель</option>${list.slice(0,i).map(y=>`<option value="${esc(y.id)}" ${x[key]===y.id?'selected':''}>${esc(y.name)}</option>`).join('')}</select></label>`).join('')}</div>`:''}${list.length>1?`<button class="btn tiny" data-remove-panel="${esc(x.id)}">Прибрати панель</button>`:''}</fieldset>`).join('')}<button class="btn" data-action="panel-add" ${list.length>=MAX_PANELS?'disabled':''}>Додати панель</button><p class="hint">З’єднання, пази й посадки підготуйте у SolidWorks. Ліміт 300 × 400 мм застосовується до кожної панелі окремо.</p></section>`;
}
export function panelPreparation(part,{esc}){
  const prep=part.aiData?.preparation;if(!prep)return '';
  const refs=Array.isArray(prep.styleReferences)?prep.styleReferences.filter(x=>typeof x?.name==='string').slice(0,3):[];
  return `<details class="panel-preparation"><summary>Підготовка останнього запуску</summary><p class="hint">Спільний задум: ${prep.sharedPlanReused?'повторно використано':'підготовлено'}. План панелі: ${prep.planReused?'повторно використано':'підготовлено'}. Промпти: ${prep.promptsReused?'повторно використано':'підготовлено'}.</p><p class="hint">${refs.length?'Референси стилю: '+refs.map(x=>esc(x.name)).join(', '):'Обрані панелі як референси стилю не використовувалися.'}</p></details>`;
}
export function panelChecks(p,{busy=false}={}){
  const part=activePanel(p);if(!multiPanel(p)||!part.assets?.master)return '';
  busy=busy||['running','queued'].includes(p.aiJob?.status);const stale=part.pendingAssetsUpdate?.length;
  return `<details class="panel-check-tools"><summary>Перевірка та контур цієї панелі</summary><div class="actions-wrap"><button class="btn" data-action="ai-panel-review" ${busy||stale?'disabled':''}>Перевірити цю панель</button><button class="btn" data-action="ai-tracing" ${busy||stale?'disabled':''}>${part.tracing?.assets?.outline?'Оновити':'Створити'} контур цієї панелі</button>${part.tracing?.assets?.outline?'<button class="btn tiny" data-view="tracing">Переглянути контур</button>':''}</div><p class="hint">Ці дії обробляють лише активну панель. Загальний вигляд залишається збереженим.</p></details>`;
}
export function panelDecision(p,{esc,history='',busy=false}){
  if(!multiPanel(p))return '';
  const selected=activePanel(p);
  return `${panelChoice(p,selected,{esc,busy})}${panelOperations(p,{esc,busy})}${panelChecks(p,{busy})}${history}${panelPreparation(selected,{esc})}<details class="panel-set-tools"><summary>Додаткові дії та файли комплекту</summary><div class="actions-wrap"><button class="btn tiny" data-action="panels-overview">Огляд комплекту</button><button class="btn tiny" data-action="panels-zip">Завантажити всі файли · ZIP</button><button class="btn tiny" data-action="panels-sheet">Аркуш комплекту · PNG</button><button class="btn tiny" data-action="ai-trace-all" ${busy||['running','queued'].includes(p.aiJob?.status)||!panelsReady(p)?'disabled':''}>Контури всього комплекту</button></div><p class="hint">Пакетний запуск заново створить усі незалежні панелі. Загальний вигляд і перевірки запускаються окремо.</p><button class="btn tiny" data-action="ai-generate-all" ${busy||['running','queued'].includes(p.aiJob?.status)?'disabled':''}>Згенерувати всі панелі</button></details>`;
}
export function panelNavigation(p,{esc,safeImage=safePanelImage,history='',busy=false,compact=false,wholeProduct=false}){
  const selected=activePanel(p);
  if(!multiPanel(p))return panelChoice(p,selected,{esc,busy});
  const list=panelList(p),i=list.findIndex(x=>x.id===selected.id),state=panelState(selected),count=list.filter(x=>panelState(x)==='selected').length;
  const hint={empty:'Почніть із генерації цієї панелі.',outdated:'Оновіть панель за поточними вимогами або перегляньте попередні варіанти.',variant:'Перегляньте зображення. Можна внести правки, спробувати інший варіант або обрати результат.',selected:nextPanel(p,selected.id)?'Результат обрано. Переходьте до наступної панелі або поверніться до будь-якої зі списку.':'Усі панелі обрані. Можна створити загальний вигляд виробу.'}[state];
  return `<section class="panel-navigation panel-workspace" aria-label="Панелі комплекту"><div class="panel-route-heading"><h3>Панелі виробу</h3><span role="status">Обрано ${count} із ${list.length}</span></div><ol class="panel-route">${list.map((x,n)=>{const src=safeImage(x.assets?.master);return `<li><button class="panel-route-card ${!wholeProduct&&selected.id===x.id?'active':''} panel-state-${panelState(x)}" data-select-panel="${esc(x.id)}" aria-pressed="${!wholeProduct&&selected.id===x.id}">${src?`<img src="${src}" alt="Декор: ${esc(x.name)}" loading="lazy">`:'<span class="panel-route-placeholder" aria-hidden="true">'+(n+1)+'</span>'}<span class="panel-route-name">${n+1}. ${esc(x.name)}</span><span class="panel-route-status">${PANEL_STATES[panelState(x)]}</span></button></li>`;}).join('')}<li><button class="panel-route-card panel-final-card ${wholeProduct?'active':''}" data-action="panel-finalize" aria-pressed="${wholeProduct}" ${!panelsChosen(p)&&!p.assets?.preview?'disabled':''}><span class="panel-route-placeholder" aria-hidden="true">✓</span><span class="panel-route-name">Загальний вигляд</span><span class="panel-route-status">${p.approved&&['current','legacy'].includes(productPreviewStatus(p))?'Виріб прийнято':!panelsChosen(p)?'Оберіть усі панелі':productPreviewStatus(p)==='missing'?'Готовий до створення':productPreviewStatus(p)==='outdated'?'Потребує оновлення':'Є зображення'}</span></button></li></ol>${wholeProduct?'':`<div class="panel-step-heading"><h3>Панель ${i+1} із ${list.length} · ${esc(selected.name)}</h3><span class="badge">${PANEL_STATES[state]}</span></div><p class="panel-step-hint">${hint}</p><p class="hint">${selected.width} × ${selected.height} мм${selected.sameDesignAs?' · точний повтор вихідної панелі':''}</p>${compact?'':panelDecision(p,{esc,history,busy})}`}</section>`;
}
export function panelsOverview(p,{esc,safeImage}){
  return `<div class="panel-overview-grid">${panelList(p).map(x=>`<figure>${x.assets?.master?`<img src="${safeImage(x.assets.master)}" alt="${esc(x.name)}">`:'<div class="panel-placeholder">Зображення ще немає</div>'}<figcaption><strong>${esc(x.name)}</strong><br>${x.width} × ${x.height} мм · ${PANEL_STATES[panelState(x)]}</figcaption></figure>`).join('')}</div><p class="hint">Огляд складено зі збережених панелей. Масштаб зображень на аркуші не є виробничим масштабом.</p>`;
}
