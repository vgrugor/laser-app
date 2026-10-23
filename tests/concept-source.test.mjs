import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createApp} from '../server/index.mjs';

test('existing job API recovers concept identity from its saved request without opening a socket',async t=>{
 const root=await mkdtemp(join(tmpdir(),'concept-source-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const id='11111111-1111-4111-8111-111111111111',dir=join(root,'artifacts/runs',id);await mkdir(dir,{recursive:true});
 await writeFile(join(dir,'job.json'),JSON.stringify({id,action:'generate',projectId:'p',status:'completed',result:{assets:{master:'master.png'}}}));
 await writeFile(join(dir,'request.json'),JSON.stringify({action:'generate',project:{title:'Оригінал',selected:'batch-old-c1',concepts:[{id:'batch-old-c1',title:'Концепція 1'}]}}));
 const app=await createApp({root,run:()=>{}});t.after(()=>app.close());app.server.address=()=>({port:8765});
 const response=await new Promise(resolve=>{const req=Readable.from([]);Object.assign(req,{method:'GET',url:'/api/jobs/'+id,headers:{host:'127.0.0.1:8765'}});const res={setHeader(){},writeHead(status){this.status=status;},end(body){resolve({status:this.status,data:JSON.parse(body)});}};app.server.emit('request',req,res);});
 assert.equal(response.status,200);assert.equal(response.data.conceptId,'batch-old-c1');assert.equal(response.data.conceptTitle,'Концепція 1');assert.equal(response.data.projectTitle,'Оригінал');
});
