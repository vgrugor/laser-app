// Shared by the browser and Node. Product rules are data, never executable code.
export function validateCatalog(catalog) {
  if(catalog?.schemaVersion!==1||!Number.isInteger(catalog.revision)||catalog.revision<1||!Array.isArray(catalog.types)||!catalog.types.length||catalog.types.length>100)throw Error('Некоректний каталог типів');
  const ids=new Set(),names=new Set();
  for(const type of catalog.types){
    if(!/^[a-z][a-z0-9-]{0,63}$/.test(type.id)||ids.has(type.id))throw Error('Некоректний або повторний ID типу');
    if(typeof type.name!=='string'||!type.name.trim()||type.name!==type.name.trim()||type.name.length>80||names.has(type.name.toLocaleLowerCase('uk')))throw Error('Назва типу порожня або вже існує');
    if(typeof type.description!=='string'||type.description.length>500||typeof type.rules!=='string'||!type.rules.trim()||type.rules.length>24000||!Number.isInteger(type.revision)||type.revision<1)throw Error('Некоректний опис або правила типу');
    if(!Array.isArray(type.fields)||type.fields.length>10)throw Error('Некоректні параметри типу');
    const keys=new Set();
    for(const field of type.fields){
      // Additional configurable fields are intentionally not editable in the first UI.
      if(!['clockMount'].includes(field.key)||keys.has(field.key)||typeof field.label!=='string'||!field.label||field.label.length>100||!Array.isArray(field.options)||!field.options.length||field.options.length>20)throw Error('Некоректне поле типу');
      const values=new Set();for(const option of field.options){if(typeof option.value!=='string'||!/^[a-z0-9-]{1,64}$/.test(option.value)||values.has(option.value)||typeof option.label!=='string'||!option.label||option.label.length>100)throw Error('Некоректні варіанти параметра');values.add(option.value);}
      if(!values.has(field.default))throw Error('Невідомий початковий параметр');keys.add(field.key);
    }
    ids.add(type.id);names.add(type.name.toLocaleLowerCase('uk'));
  }
  return catalog;
}
export function findProductType(catalog, name){return catalog.types.find(type=>type.name===name);}
export function productParameters(type,project){
  return Object.fromEntries(type.fields.map(field=>{
    const value=project[field.key]??field.default;
    if(!field.options.some(option=>option.value===value))throw Error('Невідоме значення: '+field.label);
    return [field.key,value];
  }));
}
