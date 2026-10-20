import { compositionAspects } from '../../server/workflow.mjs';
export const flatComposition={mode:'flat',rationale:'Один символ у пласкому медальйоні',focal_point:'Центральний мотив',eye_path:'Від центру до широкої рамки',planes:[],interactions:[],overlaps:[],occlusion_rationale:'Перекривання не потрібні одному символу',engraving_cues:[],engraving_rationale:'Великий силует достатньо виразний'};
export const passingCompositionChecks=()=>compositionAspects.map(aspect=>({aspect,verdict:'pass',observation:'Контрольоване спостереження тестового перевіряльника',suggested_action:''}));
