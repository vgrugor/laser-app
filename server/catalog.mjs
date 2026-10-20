import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { validateCatalog } from '../dist/product-types.js';

export const defaultCatalogPath=new URL('../dist/product-types.json',import.meta.url);
export async function loadCatalog(root){return validateCatalog(JSON.parse(await readFile(root?resolve(root,'dist/product-types.json'):defaultCatalogPath,'utf8')));}
export const catalogHash=catalog=>createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
export function createCatalogStore(root){
  let pending=Promise.resolve();
  return {
    read:()=>loadCatalog(root),
    save(input){
      const operation=pending.then(async()=>{
        const current=await loadCatalog(root);
        if(input.expectedRevision!==current.revision)throw Error('Каталог уже змінено. Оновіть список і відкрийте редактор знову.');
        if(!input.type||typeof input.type.id!=='string')throw Error('Відсутній тип виробу');
        const existing=current.types.find(t=>t.id===input.type.id);
        if(existing&&existing.name!==input.type.name)throw Error('Назву наявного типу змінювати не можна: її використовують збережені проєкти.');
        const type={id:input.type.id,name:input.type.name,description:input.type.description,rules:input.type.rules,fields:existing?.fields||[],revision:(existing?.revision||0)+1};
        const next=validateCatalog({...current,revision:current.revision+1,types:existing?current.types.map(t=>t.id===type.id?type:t):[...current.types,type]});
        const backups=resolve(root,'artifacts/catalog-history');await mkdir(backups,{recursive:true});
        await writeFile(resolve(backups,`${current.revision}-${catalogHash(current)}.json`),JSON.stringify(current,null,2)+'\n');
        const path=resolve(root,'dist/product-types.json'),temporary=path+'.tmp';
        await writeFile(temporary,JSON.stringify(next,null,2)+'\n');await rename(temporary,path);
        return next;
      });
      pending=operation.catch(()=>{});return operation;
    }
  };
}
