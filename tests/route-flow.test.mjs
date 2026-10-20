import test from 'node:test';
import assert from 'node:assert/strict';
import {createAI} from '../dist/ai.js';
import {createApproval} from '../dist/approval.js';
import {selectConcept} from '../dist/concepts.js';
import {moveToRoute,ensureRoute} from '../dist/project-route.js';
import {paletteSignature} from '../dist/palette-confirmation.js';
import {createVariant} from '../dist/variants.js';
import {savedScreen,passportText} from '../dist/saved.js';

test('complete route retains concepts, images, acceptance and history through serialization and a second product',async t=>{
  const original={fetch:globalThis.fetch,document:globalThis.document,FileReader:globalThis.FileReader};
  t.after(()=>Object.assign(globalThis,original));
  const confirm={disabled:false},nodes={'#confirm-appearance':confirm,'#approval-reason':{value:'Звірю рамку в CAD'}};
  globalThis.document={querySelector:s=>nodes[s]||null};
  globalThis.FileReader=class{readAsDataURL(){this.result='data:image/png;base64,bmV3';this.onload();}};
  const report={disposition:'changes_required',findings:[{location:'Рамка',observation:'Ширину не виміряно',suggested_action:'Перевірити 2 мм'}],manual_checks:['Ширини у CAD']};
  const concepts=Array.from({length:10},(_,i)=>({title:`Концепція ${i+1}`,description:'Магнолія',palette:['clear'],frame:'engraved'}));
  const jobs=new Map(),requests=[];
  globalThis.fetch=async(path,options)=>{
    if(path==='/api/status')return Response.json({provider:'codex-sdk',token:'test'});
    if(path==='/api/jobs'){
      const body=JSON.parse(options.body),id='job-'+(requests.length+1);requests.push(body);
      jobs.set(id,{id,status:'completed',stage:body.action==='concepts'?'concepts':'review',result:body.action==='concepts'?{concepts}:{assets:{master:'master.png',preview:'preview.png'},plan:{parts:[{name:'Мотив',finish_id:'clear',quantity:1,layer:'top'}]},review:report}});
      return Response.json({id});
    }
    if(path.startsWith('/api/assets/'))return new Response(new Blob(['image']));
    return Response.json(jobs.get(path.split('/').at(-1)));
  };
  let p={id:'p',title:'Магнолія',type:'Панно',brief:'Квітка',width:160,height:120,layers:2,frame:'engraved',palette:['clear'],assets:{master:null,preview:null},pendingAssetsUpdate:[],notes:[],locks:[],concepts:[],selected:null,versions:[],reviews:{},approved:false};
  const projects=[p];let written;
  const persist=async()=>{for(const item of projects)ensureRoute(item);written=JSON.stringify({projects,active:p.id});};
  const snapshot=async item=>{const {versions,...data}=structuredClone(item);item.versions.push({data});await persist();};
  const ai=createAI({current:()=>p,projects:()=>projects,persist,snapshot,render(){},toast(){},esc:String,validate:()=>true});
  assert.equal(ensureRoute(p),'brief');assert.equal(moveToRoute(p,'palette'),true);p.paletteConfirmation={signature:paletteSignature(p)};
  await ai.start('concepts');assert.equal(p.route.current,'concepts');assert.equal(p.concepts.length,10);assert.equal(requests.length,1);
  assert.equal(selectConcept(p,p.concepts[0].id),true);await ai.start('generate');assert.equal(p.route.current,'result');assert.equal(p.approved,false);assert.equal(p.aiReport.disposition,'changes_required');
  const approve=createApproval({esc:String,modal(){},close(){},toast(){},persist,snapshot,render(){}});
  await approve.open(p);await confirm.onclick();assert.equal(p.route.current,'saved');assert.equal(p.appearanceApproval.aiRemarksAccepted,true);assert.equal(p.versions.length,3);
  const copy=JSON.parse(written).projects[0];assert.equal(ensureRoute(copy),'saved');assert.equal(copy.appearanceApproval.comment,'Звірю рамку в CAD');assert.deepEqual(copy.assets,p.assets);
  const html=savedScreen(copy,{esc:String,icon:()=>'',safeImage:String,view:'master',colors:[{id:'clear',name:'Чистий',hex:'#BAA687'}],versions:''});assert.match(html,/data-action="export"/);assert.match(passportText(copy,[{id:'clear',name:'Чистий'}]),/Звірю рамку в CAD/);
  const originalProduct=structuredClone(p),variant=createVariant(p,projects,{mode:'concepts',id:'second'});projects.push(variant);p=variant;
  assert.equal(p.concepts.length,10);assert.equal(p.selected,null);assert.equal(p.assets.master,null);selectConcept(p,p.concepts[1].id);await ai.start('generate');
  assert.equal(p.route.current,'result');assert.equal(p.approved,false);assert.deepEqual(projects[0],originalProduct);assert.equal(requests.length,3);assert.equal(requests[2].project.selected,'job-1-c2');assert.equal(requests[2].project.aiLaunchErrorAction,undefined);
});
