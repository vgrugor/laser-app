import test from 'node:test';
import assert from 'node:assert/strict';
import {savedScreen,savedFinishes,savedReview,savedManualChecks,passportText} from '../dist/saved.js';
import {projectShell} from '../dist/project-shell.js';
const colors=[{id:'clear',name:'Чистий',hex:'#BAA687'},{id:'pine',name:'Сосна',hex:'#C19F42'},{id:'black',name:'Чорна',hex:'#2A2725'}];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const project=()=>({id:'saved',title:'Магнолія',type:'Панно',brief:'Квітка',width:200,height:200,layers:2,frame:'cut',palette:['clear','pine','black'],assets:{master:'master.png',preview:'preview.png'},approved:true,approvedAt:'2026-10-21T08:30:00Z',appearanceApproval:{at:'2026-10-21T08:30:00Z',aiRemarksAccepted:true,comment:'Перевірю в CAD',aiReview:{disposition:'changes_required',findings:[{location:'Рамка',observation:'Вузька',suggested_action:'Розширити'}],manual_checks:['Ширина рамки']}},aiData:{plan:{parts:[{name:'Пелюстки',finish_id:'clear',quantity:7,layer:'top'},{name:'Серединка',finish_id:'pine',quantity:1,layer:'top'}],engraving:['Чорні прожилки'],manual_checks:['Ширина рамки','Кріплення']}},concepts:[{id:'c1',palette:['clear','black']}],selected:'c1',notes:[],versions:[],route:{version:2,current:'saved'}});
const options={esc,icon:()=>'',safeImage:String,view:'preview',colors,versions:'<p>Історія</p>'};
test('saved product shows paired images, direct downloads, backup and separate variants with derived tracing but without appearance editing controls',()=>{
 const p=project(),before=structuredClone(p),html=savedScreen(p,options);
 for(const text of ['data-download="master"','data-download="preview"','data-action="export"','data-action="passport"','data-view="tracing"','data-action="variant-concepts"','Вигляд погоджено','Ширина рамки'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/data-action="approve"|data-action="ai-(?!tracing")|data-upload|data-field|id="change-note"/);assert.deepEqual(p,before);
 assert.match(savedScreen(p,{...options,view:'master'}),/src="master.png"/);
 assert.doesNotMatch(html,/id="tracing-panel"/);
 assert.match(savedScreen(p,{...options,view:'tracing'}),/id="tracing-panel"/);
 assert.match(savedScreen(p,{...options,view:'tracing'}),/data-action="ai-tracing"/);
});
test('displayed finishes follow the proposed parts, then concept, and finally explicitly labelled available colors',()=>{
 const p=project();assert.deepEqual(savedFinishes(p),{ids:['clear','pine'],label:'Морилки за планом деталей'});
 delete p.aiData;assert.deepEqual(savedFinishes(p),{ids:['clear','black'],label:'Морилки обраної концепції'});
 p.selected=null;assert.deepEqual(savedFinishes(p),{ids:p.palette,label:'Доступні морилки проєкту'});
});
test('saved approval uses the captured review, including an explicit null review, and deduplicates CAD checks',()=>{
 const p=project();p.aiReport={disposition:'pass_visual',findings:[],manual_checks:['Інша перевірка']};assert.equal(savedReview(p).disposition,'changes_required');assert.deepEqual(savedManualChecks(p),['Ширина рамки','Кріплення']);
 p.appearanceApproval.aiReview=null;assert.equal(savedReview(p),null);delete p.appearanceApproval;assert.equal(savedReview(p),p.aiReport);
});
test('passport retains production parameters, accepted findings, proposed parts and the drawing handoff',()=>{
 const p=project(),text=passportText(p,colors);
 for(const expected of ['200 × 200 мм','фанера 3 мм','Пелюстки · 7 шт. · Інкрустація · Чистий','Прийнято попри зауваження','Вузька','Перевірю в CAD','SolidWorks','LightBurn','не готовий файл для різання'])assert.ok(text.includes(expected),expected);
});
test('legacy saved products present missing dates and plans honestly, without inventing manufacturing data',()=>{
 const p=project();delete p.aiData;delete p.approvedAt;delete p.appearanceApproval;p.concepts=[];p.selected=null;
 const html=savedScreen(p,options);assert.match(html,/Дату погодження не записано/);assert.match(html,/План деталей не збережено/);assert.match(html,/Повну візуальну перевірку ШІ не зафіксовано/);assert.doesNotMatch(html,/data-action="variant-concepts"/);
});
test('saved shell omits the result inspector and the redundant parameter sidebar',()=>{
 const html=projectShell(project(),{esc,colors,content:'Saved content',aiPanel:'',showContext:false});assert.match(html,/saved-layout/);assert.doesNotMatch(html,/project-context|result-inspector-content/);assert.match(html,/Saved content/);
});
test('saved product escapes user and model text in the passport, findings and table',()=>{
 const p=project();p.brief='<img src=x onerror=boom>';p.aiData.plan.parts[0].name='<script>boom</script>';p.appearanceApproval.comment='<img src=x>';p.appearanceApproval.aiReview.findings[0].observation='<script>x</script>';
 const html=savedScreen(p,options);assert.doesNotMatch(html,/<script>|<img src=x/);assert.match(html,/&lt;script&gt;boom/);assert.match(html,/&lt;img src=x/);
});

test('malformed optional imported plan data is treated as absent instead of breaking the saved screen',()=>{
 const p=project();p.aiData={plan:{parts:'invalid',engraving:{},manual_checks:'invalid'}};p.appearanceApproval.aiReview={findings:'invalid',manual_checks:{}};
 assert.doesNotThrow(()=>savedScreen(p,options));assert.match(passportText(p,colors),/План деталей не збережено/);
});
