import test from 'node:test';
import assert from 'node:assert/strict';
import {recordConceptRun,conceptRuns,conceptUsage,importedConceptRuns,conceptRunPreview} from '../dist/concept-history.js';
import {conceptSource} from '../server/concept-source.mjs';
import {createVariant} from '../dist/variants.js';
import {conceptScreen} from '../dist/concepts.js';
const run=(id,conceptId='batch-a-c1',extra={})=>({id,jobId:id,conceptId,conceptTitle:'Магнолія',projectId:'p',projectTitle:'Оригінал',action:'generate',status:'completed',startedAt:'2026-10-24T10:00:00Z',assets:{master:'master',preview:'preview'},...extra});

test('regenerated concepts in the same numbered slot have independent history',()=>{
 const p={conceptRuns:[]};recordConceptRun(p,run('one'));assert.equal(conceptUsage('batch-a-c1',conceptRuns([p])).state,'completed');assert.equal(conceptUsage('batch-b-c1',conceptRuns([p])).state,null);
});
test('running, complete, partial and failed attempts reflect only the assets from each attempt',()=>{
 assert.equal(conceptUsage('batch-a-c1',[run('a',undefined,{status:'running',assets:{}})]).state,'running');
 assert.equal(conceptUsage('batch-a-c1',[run('a',undefined,{status:'failed',assets:{master:'new'}})]).state,'partial');
 assert.equal(conceptUsage('batch-a-c1',[run('a',undefined,{status:'failed',assets:{}})]).state,'failed');
 const runs=[run('new',undefined,{status:'failed',assets:{}}),run('old')];assert.equal(conceptUsage('batch-a-c1',runs).state,'completed');assert.equal(conceptUsage('batch-a-c1',runs).result.id,'old');
});
test('variants share concept IDs and see each others records without copying their histories',()=>{
 const p={id:'p',title:'Оригінал',palette:['clear'],concepts:[{id:'batch-a-c1'}],assets:{master:'a',preview:'b'},versions:[],conceptRuns:[run('source')]};
 const variant=createVariant(p,[p],{id:'child',mode:'concepts'});assert.deepEqual(variant.conceptRuns,[]);
 recordConceptRun(variant,run('child-run','batch-a-c1',{projectId:'child',startedAt:'2026-10-24T11:00:00Z'}));
 assert.equal(conceptUsage(p.concepts[0].id,conceptRuns([p,variant])).result.id,'child-run');
 p.versions=[];assert.equal(conceptRuns([p,variant]).length,2);
});
test('updates replace the same attempt and exports imported in another project deduplicate by job ID',()=>{
 const p={};recordConceptRun(p,run('a',undefined,{status:'running',assets:{}}));recordConceptRun(p,run('a'));assert.equal(p.conceptRuns.length,1);assert.equal(p.conceptRuns[0].status,'completed');assert.equal(conceptRuns([p,structuredClone(p)]).length,1);
});
test('portable records validate images and IDs and do not resume imported jobs',()=>{
 const valid=s=>['master','preview'].includes(s)?s:'';
 assert.equal(importedConceptRuns([run('a')],valid)[0].conceptId,'batch-a-c1');
 assert.equal(importedConceptRuns([run('a',undefined,{status:'running'})],valid)[0].status,'interrupted');
 assert.throws(()=>importedConceptRuns([run('a',undefined,{assets:{master:'javascript:bad'}})],valid));
 assert.throws(()=>importedConceptRuns([run('a'),run('a')],valid));assert.deepEqual(importedConceptRuns(undefined,valid),[]);
});
test('result preview shows archived images rather than the current project and card links are separate buttons',()=>{
 const p={title:'Тест',palette:['clear'],layers:2,concepts:[{id:'batch-a-c1',title:'Магнолія',description:'Квітка',palette:['clear'],frame:'engraved'}],locks:[],selected:null};
 const html=conceptScreen(p,{esc:String,colors:[],runs:[run('a')]});assert.match(html,/Зображення вже створювалися/);assert.match(html,/<\/button><small/);assert.match(html,/data-concept-result="a"/);
 assert.match(conceptRunPreview(run('a'),{esc:String,safeImage:s=>s||''}),/src="master"/);
});
test('server attribution uses selected stable ID from the saved request, never a number or title',()=>{
 const request={action:'generate',project:{title:'Панно',selected:'new-c1',concepts:[{id:'old-c1',title:'Одна назва'},{id:'new-c1',title:'Одна назва'}]}};
 assert.equal(conceptSource(request).conceptId,'new-c1');request.project.selected='missing';assert.equal(conceptSource(request).conceptId,null);request.action='concepts';assert.equal(conceptSource(request).conceptId,null);
});
