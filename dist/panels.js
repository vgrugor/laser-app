export const MAX_PANELS=12;
export const panelList=p=>Array.isArray(p.panels)&&p.panels.length?p.panels:[{id:'primary',name:'Основна панель',width:p.width,height:p.height,brief:'',assets:p.assets,aiData:p.aiData,aiReport:p.aiReport,tracing:p.tracing,notes:p.notes,locks:p.locks,resultDraft:p.resultDraft,pendingAssetsUpdate:p.pendingAssetsUpdate}];
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
export function captureSinglePanel(p){if(p.panels?.length===1){const x=p.panels[0];for(const key of ['width','height','assets','aiData','aiReport','tracing','notes','locks','resultDraft','pendingAssetsUpdate'])x[key]=p[key];}}
export function validPanelConfiguration(p){try{validatePanels(p);return true;}catch{return false;}}
export function syncPrimaryPanel(p){
  if(!p.panels?.length)return;
  const primary=p.panels[0];p.width=primary.width;p.height=primary.height;
  p.assets={...p.assets,master:primary.assets?.master||null};
  p.notes=primary.notes||[];p.locks=primary.locks||[];p.tracing=primary.tracing||null;
  p.aiData={...primary.aiData,...p.aiData?.setPreviewReview?{setPreviewReview:p.aiData.setPreviewReview}:{}};
}
export function markPanelOutdated(p,id){
  const targets=id?new Set([id]):new Set(panelList(p).map(x=>x.id));
  for(const x of p.panels||[]){if(targets.has(x.sameDesignAs)||targets.has(x.id)){targets.add(x.id);x.pendingAssetsUpdate=x.assets?.master?['master']:[];if(x.tracing)x.tracing.outdated=true;}}
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
export function replacePanelMaster(p,id,data){
  const targets=new Set([id]);
  for(const part of panelList(p))if(targets.has(part.id)||targets.has(part.sameDesignAs)){
    targets.add(part.id);part.assets={master:data};part.pendingAssetsUpdate=[];part.aiData=null;part.aiReport=null;if(part.tracing)part.tracing.outdated=true;
  }
  p.pendingAssetsUpdate=['preview'];p.aiReport=null;syncPrimaryPanel(p);
}
export function panelEditor(p,{esc}){
  const list=panelList(p);
  return `<section class="panel-editor" aria-label="Декоративні панелі"><h3>Декоративні панелі · ${list.length}</h3><p class="hint">Кожна панель має власні габарити. Палітра та загальний задум спільні для комплекту.</p>${list.map((x,i)=>`<fieldset class="panel-settings"><legend>Панель ${i+1}</legend><label>Назва<input aria-label="Назва панелі ${i+1}" data-panel-field="name" data-panel-id="${esc(x.id)}" maxlength="100" value="${esc(x.name)}"></label><div class="form-grid"><label>Ширина, мм<input aria-label="Ширина панелі ${i+1}" type="number" min="20" max="400" data-panel-field="width" data-panel-id="${esc(x.id)}" value="${esc(x.width)}" ${x.sameSizeAs||x.sameDesignAs?'disabled':''}></label><label>Висота, мм<input aria-label="Висота панелі ${i+1}" type="number" min="20" max="400" data-panel-field="height" data-panel-id="${esc(x.id)}" value="${esc(x.height)}" ${x.sameSizeAs||x.sameDesignAs?'disabled':''}></label></div><label>Сюжет або побажання для цієї панелі<textarea aria-label="Опис панелі ${i+1}" data-panel-field="brief" data-panel-id="${esc(x.id)}" maxlength="4000">${esc(x.brief||'')}</textarea></label>${i?`<div class="form-grid">${[['sameSizeAs','Однакові розміри з'],['sameDesignAs','Той самий декор, що й']].map(([key,label])=>`<label>${label}<select aria-label="${label} · панель ${i+1}" data-panel-field="${key}" data-panel-id="${esc(x.id)}"><option value="">Незалежна панель</option>${list.slice(0,i).map(y=>`<option value="${esc(y.id)}" ${x[key]===y.id?'selected':''}>${esc(y.name)}</option>`).join('')}</select></label>`).join('')}</div>`:''}${list.length>1?`<button class="btn tiny" data-remove-panel="${esc(x.id)}">Прибрати панель</button>`:''}</fieldset>`).join('')}<button class="btn" data-action="panel-add" ${list.length>=MAX_PANELS?'disabled':''}>Додати панель</button><p class="hint">З’єднання, пази й посадки підготуйте у SolidWorks. Ліміт 300 × 400 мм застосовується до кожної панелі окремо.</p></section>`;
}
export function panelNavigation(p,{esc}){
  if(!multiPanel(p))return '';
  const selected=activePanel(p);
  return `<section class="panel-navigation" aria-label="Панелі комплекту"><div class="actions-wrap">${panelList(p).map(x=>`<button class="btn tiny ${selected.id===x.id?'primary':''}" data-select-panel="${esc(x.id)}" aria-pressed="${selected.id===x.id}">${esc(x.name)}${x.pendingAssetsUpdate?.length?' · оновити':x.assets?.master?' · ✓':''}</button>`).join('')}</div><p class="hint">${esc(selected.name)} · ${selected.width} × ${selected.height} мм${selected.sameDesignAs?' · декор повторює іншу панель':''}</p><div class="actions-wrap"><button class="btn tiny" data-action="panels-overview">Огляд комплекту</button><button class="btn tiny" data-action="panels-zip">Завантажити всі файли · ZIP</button><button class="btn tiny" data-action="panels-sheet">Аркуш комплекту · PNG</button><button class="btn tiny" data-action="ai-trace-all" ${['running','queued'].includes(p.aiJob?.status)||!panelsReady(p)?'disabled':''}>Контури всього комплекту</button></div></section>`;
}
export function panelsOverview(p,{esc,safeImage}){
  return `<div class="panel-overview-grid">${panelList(p).map(x=>`<figure>${x.assets?.master?`<img src="${safeImage(x.assets.master)}" alt="${esc(x.name)}">`:'<div class="panel-placeholder">Зображення ще немає</div>'}<figcaption><strong>${esc(x.name)}</strong><br>${x.width} × ${x.height} мм${x.pendingAssetsUpdate?.length?' · потребує оновлення':''}</figcaption></figure>`).join('')}</div><p class="hint">Огляд складено зі збережених панелей. Масштаб зображень на аркуші не є виробничим масштабом.</p>`;
}
