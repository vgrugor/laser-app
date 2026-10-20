import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename, readdir, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { createRunner, workflow, validateProject } from './workflow.mjs';
import { createCatalogStore } from './catalog.mjs';
import { validateAssistantRequest, runTypeAssistant } from './type-assistant.mjs';

const rootDefault=resolve(fileURLToPath(new URL('..',import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.md':'text/plain; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.jpeg':'image/jpeg','.webp':'image/webp'};
const json=(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req){let size=0,chunks=[];for await(const b of req){size+=b.length;if(size>36*1024*1024)throw Error('Завеликий запит');chunks.push(b);}return JSON.parse(Buffer.concat(chunks).toString());}
export async function createApp({root=rootDefault,run=createRunner(),runWorkflow=workflow}={}){
  const catalogStore=createCatalogStore(root);
  const runs=resolve(root,'artifacts/runs'),jobs=new Map(),controllers=new Map(),token=randomBytes(32).toString('hex');
  await mkdir(runs,{recursive:true});
  async function store(job){const dir=resolve(runs,job.id);await mkdir(dir,{recursive:true});await writeFile(resolve(dir,'job.tmp'),JSON.stringify(job,null,2));await rename(resolve(dir,'job.tmp'),resolve(dir,'job.json'));}
  for(const id of await readdir(runs)){
    if(!/^[a-f0-9-]{36}$/.test(id))continue;
    try{const j=JSON.parse(await readFile(resolve(runs,id,'job.json')));if(['running','queued'].includes(j.status)){j.status='interrupted';j.error='Сервер перезапущено. Результати, які встигли зберегтися, залишилися на диску.';await store(j);}jobs.set(id,j);}catch{}
  }
  const server=createServer(async(req,res)=>{
    // Bind only loopback; reject DNS rebinding and cross-origin requests before reading input.
    const address=server.address();
    const hosts=[`127.0.0.1:${address.port}`,`localhost:${address.port}`];
    if(!hosts.includes(req.headers.host)){json(res,403,{error:'Недозволений Host'});return;}
    if(req.headers.origin&&!hosts.some(host=>req.headers.origin===`http://${host}`)){json(res,403,{error:'Недозволений Origin'});return;}
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    const url=new URL(req.url,'http://127.0.0.1');
    try{
      if(req.method==='GET'&&url.pathname==='/api/status'){json(res,200,{provider:'codex-sdk',auth:'existing-chatgpt',token,active:[...jobs.values()].find(j=>j.status==='running')?.id||null});return;}
      if(req.method==='POST'&&req.headers['x-plywood-token']!==token){json(res,403,{error:'Оновіть сторінку для підключення до сервера'});return;}
      if(req.method==='GET'&&url.pathname==='/api/product-types'){json(res,200,await catalogStore.read());return;}
      if(req.method==='POST'&&url.pathname==='/api/product-types'){
        const input=await body(req);json(res,200,await catalogStore.save(input));return;
      }
      if(req.method==='POST'&&url.pathname==='/api/jobs'){
        if([...jobs.values()].some(j=>j.status==='running')){json(res,409,{error:'Зараз виконується інше завдання. Дочекайтеся або скасуйте його.'});return;}
        const data=await body(req);
        if(!['concepts','generate','edit','review','type-assistant'].includes(data.action))throw Error('Невідома дія');
        const catalog=await catalogStore.read();
        if(data.action==='type-assistant')validateAssistantRequest(data.assistant);else validateProject(data.project,catalog);
        if([...jobs.values()].some(j=>j.status==='running')){json(res,409,{error:'Зараз виконується інше завдання. Дочекайтеся або скасуйте його.'});return;}
        const id=randomUUID(),directory=resolve(runs,id),controller=new AbortController();
        const job={id,projectId:data.project?.id||null,action:data.action,status:'running',stage:'Підготовка',createdAt:new Date().toISOString(),events:[],result:null,error:null};
        jobs.set(id,job);controllers.set(id,controller);await store(job);
        await writeFile(resolve(directory,'request.json'),JSON.stringify({...data,catalog},null,2));
        json(res,202,{id});
        const timeout=setTimeout(()=>controller.abort(Error('Перевищено час виконання (20 хвилин)')),20*60*1000);
        const save={event:e=>{job.events.push({...e,at:new Date().toISOString()});job.events=job.events.slice(-150);},file:async(name,value)=>writeFile(resolve(directory,name),JSON.stringify(value,null,2)),partial:async result=>{job.result=structuredClone(result);await store(job);}};
        (async()=>{
          try{const execute=data.action==='type-assistant'?runTypeAssistant:runWorkflow;job.result=await execute({root,directory,action:data.action,project:data.project,assistant:data.assistant,catalog,run,signal:controller.signal,stage:async name=>{if(controller.signal.aborted)throw Error('Завдання скасовано');job.stage=name;await store(job);},save});job.status=controller.signal.aborted?'cancelled':'completed';}
          catch(e){job.status=controller.signal.aborted?'cancelled':'failed';const detail=String(e.message).slice(0,5000);await save.file('error.json',{message:detail});job.error=controller.signal.aborted?'Завдання скасовано або перевищено час виконання.':detail.includes('Operation not permitted')?'Codex не зміг запуститися в обмеженому середовищі. Зупиніть цей сервер і запустіть sh scripts/start.command зі звичайного Terminal.':detail.slice(0,2000);}
          finally{clearTimeout(timeout);controllers.delete(id);job.finishedAt=new Date().toISOString();await store(job);}
        })().catch(e=>console.error('Cannot persist job:',e.message));return;
      }
      const jobRoute=url.pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})(\/cancel)?$/);
      if(jobRoute){const job=jobs.get(jobRoute[1]);if(!job){json(res,404,{error:'Завдання не знайдено'});return;}
        if(req.method==='POST'&&jobRoute[2]){controllers.get(job.id)?.abort();json(res,200,{status:job.status});return;}
        if(req.method==='GET'&&!jobRoute[2]){json(res,200,job);return;}
      }
      if(req.method!=='GET'&&req.method!=='HEAD'){json(res,405,{error:'Метод не підтримується'});return;}
      let path,base;
      const asset=url.pathname.match(/^\/api\/assets\/([a-f0-9-]{36})\/(master|preview)\.png$/);
      if(asset){base=runs;path=resolve(runs,asset[1],asset[2]+'.png');}
      else {if(url.pathname.startsWith('/api/')){json(res,404,{error:'Не знайдено'});return;}base=resolve(root,'dist');path=resolve(base,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));}
      const actual=await realpath(path),actualBase=await realpath(base);
      if(!actual.startsWith(actualBase+sep)){json(res,403,{error:'Недозволений шлях'});return;}
      const bytes=await readFile(actual);res.writeHead(200,{'Content-Type':mime[extname(actual)]||'application/octet-stream','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:bytes);
    }catch(e){json(res,e.code==='ENOENT'?404:400,{error:e.code==='ENOENT'?'Файл не знайдено':String(e.message).slice(0,2000)});}
  });
  return {server,jobs,close:async()=>{for(const c of controllers.values())c.abort();await new Promise(r=>server.close(r));}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=await createApp(),port=Number(process.env.PORT||8765);
  app.server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`Порт ${port} зайнято. Зупиніть старий сервер або задайте PORT.`:e.message);process.exitCode=1;});
  app.server.listen(port,'127.0.0.1',()=>console.log(`Plywood Flow: http://127.0.0.1:${port}/\nCodex SDK · штатний вхід ChatGPT · Ctrl+C для зупинки`));
}
