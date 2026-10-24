import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { formatReviewSchema } from '../server/master-format.mjs';
import { validateResult,workflow,loadKnowledge } from '../server/workflow.mjs';
import { compositionReviewHTML } from '../dist/composition-guidance.js';
import { flatComposition,passingCompositionChecks } from './fixtures/composition.mjs';

const root=resolve(import.meta.dirname,'..'),project={title:'Лис',type:'Панно',brief:'Лис серед дерев',width:200,height:200,layers:2,frame:'engraved',palette:['clear','pine'],notes:[],locks:[],assets:{}};
const plan={summary:'Лис перед деревом',composition:'Сцена лісу',parts:[{name:'Лис',finish_id:'pine',quantity:1,layer:'top'},{name:'Дерево',finish_id:'clear',quantity:2,layer:'top'}],engraving:['Штрихи на лапі'],manual_checks:['Перемички в CAD'],spatial_composition:{mode:'spatial',rationale:'Лісова сцена з глибиною',focal_point:'Лис',eye_path:'Від голови лиса до дерев',planes:[{depth:'foreground',elements:['Лис']},{depth:'background',elements:['Дерево']}],interactions:['Лис проходить перед деревом'],overlaps:[{front:'Лис',back:'Дерево',contour_instruction:'Задній контур дерева зникає за корпусом лиса',manufacturing_note:'Дві видимі частини дерева рахуються як дві вставки, без прихованої частини'}],occlusion_rationale:'Часткове перекривання поєднує сцену',engraving_cues:[{surface_part:'Лис',black_marks:'Дугоподібні чорні штрихи на лапі',purpose:'Показати округлість'}],engraving_rationale:'Рідкі штрихи підтримують форму, заднє дерево спрощене'}};
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1cAAAAASUVORK5CYII=';

test('spatial plan distinguishes visual depth from parts and supports two planes or deliberate flat design',()=>{
  assert.ok(validateResult('plan',structuredClone(plan),project));
  const flat={...structuredClone(plan),spatial_composition:flatComposition};assert.ok(validateResult('plan',flat,project));
  const missing=structuredClone(plan);delete missing.spatial_composition;assert.throws(()=>validateResult('plan',missing,project),/композиційний/);
  const one=structuredClone(plan);one.spatial_composition.planes.pop();assert.throws(()=>validateResult('plan',one,project),/два плани/);
  const surface=structuredClone(plan);surface.spatial_composition.engraving_cues[0].surface_part='Невідома вставка';assert.throws(()=>validateResult('plan',surface,project),/композиційний/);
});
test('a failed artistic check cannot be hidden behind overall pass or missing generic findings',()=>{
  const review={disposition:'pass_visual',findings:[],manual_checks:[],composition_checks:passingCompositionChecks()};
  const overlap=review.composition_checks.find(c=>c.aspect==='occlusion');Object.assign(overlap,{verdict:'changes_required',observation:'Контур дерева проходить наскрізь лиса',suggested_action:'Прибрати прихований контур'});
  const checked=validateResult('review',review,project);assert.equal(checked.disposition,'changes_required');assert.equal(checked.findings[0].location,'Перекривання й контури');assert.equal(checked.findings[0].suggested_action,'Прибрати прихований контур');
  const unchecked={disposition:'pass_visual',findings:[],manual_checks:[],composition_checks:passingCompositionChecks()};unchecked.composition_checks[0].verdict='not_checked';assert.equal(validateResult('review',unchecked,project).disposition,'not_checked');
});
test('flat designs can mark depth inapplicable and legacy reports still render',()=>{
  const report={disposition:'pass_visual',findings:[],manual_checks:[],composition_checks:passingCompositionChecks()};
  for(const c of report.composition_checks.filter(c=>['depth','occlusion'].includes(c.aspect)))Object.assign(c,{verdict:'not_applicable',observation:'Свідомо плаский орнамент'});
  assert.equal(validateResult('review',report,project).disposition,'pass_visual');assert.ok(compositionReviewHTML(report,String).includes('Не застосовується'));assert.equal(compositionReviewHTML({findings:[]},String),'');
  const incomplete=structuredClone(report);incomplete.composition_checks.pop();assert.throws(()=>validateResult('review',incomplete,project),/художня/);
});
test('standalone pair review receives saved composition and actual images; active knowledge copies agree',async t=>{
  const directory=await mkdtemp(resolve(tmpdir(),'plywood-composition-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  let request;await workflow({root,directory,action:'review',project:{...project,assets:{master:png,preview:png},designPlan:plan},run:async input=>{if(input.schema===formatReviewSchema)return {verdict:'pass',panel_bounds:{left:0,top:0,right:1,bottom:1},observation:'Габарити квадратні',suggested_action:''};request=input;return {disposition:'pass_visual',findings:[],manual_checks:[],composition_checks:passingCompositionChecks()};},signal:new AbortController().signal,stage:async()=>{},save:{event(){},file:async()=>{}}});
  assert.equal(request.images.length,2);assert.ok(request.text.includes(plan.spatial_composition.overlaps[0].contour_instruction));assert.ok(request.text.includes('задній контур переривається'));assert.ok(request.text.includes('без перспективного спотворення самої панелі'));assert.ok(request.text.includes('сюжет може передавати перспективу')||request.text.includes('Сюжет усередині панелі може передавати перспективу'));
  const knowledge=await loadKnowledge(root);assert.ok(knowledge.text.includes('Візуальні просторові плани не є шарами фанери'));
  for(const file of ['02-дизайн.md','03-перевірка.md','технології/різання-та-інкрустація.md','manifest.json'])assert.ok((await readFile(resolve(root,'docs/база-знань-v1',file))).equals(await readFile(resolve(root,'dist/knowledge',file))));
});
