export function conceptSource(input) {
  const p=input?.project;
  if(!['generate','edit'].includes(input?.action)||typeof p?.selected!=='string'||!Array.isArray(p.concepts))return {conceptId:null};
  const concept=p.concepts.find(c=>c?.id===p.selected);
  return concept?{conceptId:concept.id,conceptTitle:String(concept.title||''),projectTitle:String(p.title||'')}:{conceptId:null};
}
