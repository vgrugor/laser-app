import { createTypeAssistant } from './type-assistant.js';
import { validateCatalog, findProductType } from './product-types.js';

export function createTypeCatalog({esc,modal,close,render,toast,download,onChange}){
  let catalog={schemaVersion:1,revision:1,types:[]},editable=false,message='';
  const assistant=createTypeAssistant({esc,modal,getCatalog:()=>catalog,useDraft:(draft,revision)=>editor(draft,true,revision),openExisting:id=>{const type=catalog.types.find(t=>t.id===id);if(type)editor(type);}});
  async function load(){
    editable=false;
    try{const response=await fetch('/api/product-types');if(!response.ok)throw Error();catalog=validateCatalog(await response.json());editable=true;message='';}
    catch{
      try{const response=await fetch('product-types.json');if(!response.ok)throw Error();catalog=validateCatalog(await response.json());message='Каталог доступний для перегляду. Для редагування перезапустіть локальний сервер оновленою командою запуску.';}
      catch{message='Не вдалося завантажити каталог типів. Запустіть локальний сервер та оновіть сторінку.';}
    }
    return catalog;
  }
  function page(){return `<div class="heading"><div><h1>Типи виробів</h1><p>Правила кожного типу · каталог редакції ${catalog.revision}</p></div><div class="actions-wrap"><button class="btn" data-action="catalog-refresh">Оновити</button><button class="btn" data-action="catalog-export">Експорт каталогу</button><button class="btn primary" data-action="catalog-assistant" ${editable?'':'disabled'}>Створити тип з помічником</button><button class="btn" data-action="catalog-new" ${editable?'':'disabled'}>Додати тип виробу</button></div></div>${message?`<div class="note">${esc(message)}</div>`:''}<p class="hint">Тут задаються особливості виробу. Загальні правила фанери, палітри й технології продовжують діяти для всіх типів.</p><div class="projects-grid">${catalog.types.map(type=>`<article class="panel"><h2>${esc(type.name)}</h2><p>${esc(type.description)}</p><p class="hint">Редакція правил ${type.revision}</p><button class="btn" data-action="catalog-edit:${esc(type.id)}">${editable?'Правила й редагування':'Переглянути правила'}</button></article>`).join('')}</div>`;}
  function editor(type,fromDraft=false,revision=catalog.revision){
    const isNew=!type||fromDraft,id=isNew?'type-'+crypto.randomUUID():type.id;
    modal(`<div class="dialog-head"><h2>${isNew?'Новий тип виробу':esc(type.name)}</h2><button class="btn" data-action="close">Закрити</button></div><div class="field"><label for="type-name">Назва типу</label><input id="type-name" maxlength="80" value="${esc(type?.name||'')}" ${isNew&&editable?'':'readonly'}></div>${!isNew?'<p class="hint">Назва залишається сталою, оскільки її використовують збережені проєкти.</p>':''}<div class="field"><label for="type-description">Короткий опис</label><textarea id="type-description" maxlength="500" ${editable?'':'readonly'}>${esc(type?.description||'')}</textarea></div><div class="field"><label for="type-rules">Правила для агентів</label><textarea id="type-rules" class="type-rules" maxlength="24000" ${editable?'':'readonly'} placeholder="Підтверджені вимоги: …&#10;Рекомендації з дизайну: …&#10;Варіанти конструкції: …&#10;Що показувати на вигляді виробу й декорі: …&#10;Невідомі розміри та ручні перевірки: …">${esc(type?.rules||'')}</textarea></div><p class="hint">Відокремлюйте обов’язкові вимоги, рекомендації та невідомі значення. Не додавайте вигадані розміри фурнітури. Тип стане доступним після натискання «Зберегти тип».</p><p class="hint" id="type-editor-message" role="status"></p>${editable?'<div class="dialog-actions"><button class="btn primary" id="save-product-type">Зберегти тип</button></div>':''}`);
    if(!editable)return;
    document.querySelector('#save-product-type').onclick=async()=>{
      const button=document.querySelector('#save-product-type'),status=document.querySelector('#type-editor-message');
      const data={id,name:document.querySelector('#type-name').value.trim(),description:document.querySelector('#type-description').value.trim(),rules:document.querySelector('#type-rules').value.trim()};
      try{
        button.disabled=true;status.textContent='Зберігаємо…';
        const health=await fetch('/api/status');if(!health.ok)throw Error('Локальний сервер недоступний');const {token}=await health.json();
        const response=await fetch('/api/product-types',{method:'POST',headers:{'Content-Type':'application/json','X-Plywood-Token':token},body:JSON.stringify({expectedRevision:revision,type:data})});
        const result=await response.json();if(!response.ok)throw Error(result.error||'Не вдалося зберегти тип');
        const previous=catalog;catalog=validateCatalog(result);await onChange(catalog,isNew?null:data.name,previous);close();render();toast('Тип виробу збережено');
      }catch(e){status.textContent=e.message;button.disabled=false;}
    };
  }
  return {
    load,page,get data(){return catalog;},names:()=>catalog.types.map(t=>t.name),find:name=>findProductType(catalog,name),
    fields(project){const type=findProductType(catalog,project.type);return type?.fields.map(field=>`<div class="field"><label for="type-field-${esc(field.key)}">${esc(field.label)}</label><select id="type-field-${esc(field.key)}" data-field="${esc(field.key)}">${field.options.map(option=>`<option value="${esc(option.value)}" ${(project[field.key]??field.default)===option.value?'selected':''}>${esc(option.label)}</option>`).join('')}</select></div>`).join('')||'';},
    prompt(project){const type=findProductType(catalog,project.type);if(!type)return '';return `\nПРАВИЛА ТИПУ «${type.name}» (редакція ${type.revision})\n${type.rules}\nПараметри: ${type.fields.map(f=>`${f.label}: ${f.options.find(o=>o.value===(project[f.key]??f.default))?.label}`).join('; ')||'без додаткових параметрів'}`;},
    async action(action){
      if(action==='catalog-new')editor(null);
      if(action==='catalog-assistant'&&editable)assistant.open();
      if(action.startsWith('catalog-edit:')){const type=catalog.types.find(t=>t.id===action.slice(13));if(type)editor(type);}
      if(action==='catalog-refresh'){const previous=catalog;await load();await onChange(catalog,null,previous);render();}
      if(action==='catalog-export')download('plywood-product-types.json',JSON.stringify(catalog,null,2));
    }
  };
}
