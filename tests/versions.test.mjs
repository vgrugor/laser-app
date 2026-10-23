import test from 'node:test';
import assert from 'node:assert/strict';
import { versionEntries, versionHistory } from '../dist/versions.js';

const version = (number, master, preview, extra = {}) => ({id:'v'+number,number,label:'Версія '+number,savedAt:'2026-10-23T10:00:00Z',data:{assets:{master,preview},...extra}});
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const options = {esc,safeImage:src=>src||'',icon:()=>'<svg></svg>',label:v=>v.label,time:v=>v.savedAt,concept:()=>null};

test('image filter defaults to newest representative for each pair, including nonadjacent duplicates',()=>{
 const versions=[version(1,null,null),version(2,'m1','p1'),version(3,'m2','p2'),version(4,'m1','p1',{notes:['Правка'],approved:true}),version(5,'m2','p2',{aiReport:{disposition:'pass_visual'}})];
 const before=structuredClone(versions),entries=versionEntries(versions);
 assert.deepEqual(entries.map(e=>[e.version.number,e.count]),[[5,2],[4,2]]);assert.deepEqual(versions,before);
 assert.equal(entries[0].version,versions[4]);
});

test('changing either image is distinct and partial pairs keep their image roles',()=>{
 const versions=[version(1,'m','p'),version(2,'changed','p'),version(3,'m','changed'),version(4,'m',null),version(5,null,'m'),version(6,'p','m')];
 assert.equal(versionEntries(versions).length,6);
});

test('all versions retain duplicates and snapshots with no images in reverse history order',()=>{
 const versions=[version(1,null,null),version(2,'m','p'),version(3,'m','p')];
 assert.deepEqual(versionEntries(versions,'all').map(e=>e.version.number),[3,2,1]);
 assert.deepEqual(versionEntries(versions).map(e=>e.version.number),[3]);
});

test('filter renders pressed state, actual snapshot IDs and counters without inventing new versions',()=>{
 const versions=[version(1,null,null),version(2,'m','p'),version(3,'m','p')];
 const html=versionHistory(versions,options);
 assert.match(html,/data-version-mode="images" aria-pressed="true"/);assert.match(html,/data-version-mode="all" aria-pressed="false"/);
 assert.match(html,/Показано: 1 · усього версій: 3/);assert.match(html,/data-version-id="v3"/);assert.doesNotMatch(html,/data-version-id="v2"/);assert.match(html,/Збережень із цими зображеннями: 2/);
 const all=versionHistory(versions,{...options,mode:'all'});assert.match(all,/data-version-id="v1"/);assert.match(all,/data-version-id="v2"/);assert.match(all,/data-version-mode="all" aria-pressed="true"/);
});

test('empty history and text-only history have different explanations, and unsafe images are excluded',()=>{
 assert.match(versionHistory([],options),/Збережіть поточну версію/);
 assert.match(versionHistory([version(1,null,null)],options),/ще немає зображень/);
 const unsafe=version(1,'javascript:bad',null);
 assert.equal(versionEntries([unsafe],'images',src=>src?.startsWith('javascript:')?'':src).length,0);
});

test('labels and reasons remain escaped in both views',()=>{
 const v=version(1,'m','p');v.label='<script>bad</script>';v.reason='<img src=x>';
 for(const mode of ['all','images']){const html=versionHistory([v],{...options,mode});assert.doesNotMatch(html,/<script>|<img src=x/);assert.match(html,/&lt;script&gt;/);}
});
