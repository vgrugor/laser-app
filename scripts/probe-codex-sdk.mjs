import { Codex } from '@openai/codex-sdk';
import { mkdir, writeFile, readFile, realpath, copyFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

// Deliberately use the existing CLI's ChatGPT sign-in, never an API key.
// Do not attach this standalone probe to the desktop host's tool IPC pipe.
// Keep all inherited sandbox/permission variables intact.
const env = Object.fromEntries(Object.entries(process.env).filter(([key,value]) => value !== undefined && !['OPENAI_API_KEY','CODEX_API_KEY','OPENAI_BASE_URL','CODEX_APP_TOOLS_PIPE_PATH','CODEX_INTERNAL_ORIGINATOR_OVERRIDE'].includes(key)));
const cli = process.env.PLYWOOD_CODEX_BIN || null;
const root = process.cwd();
const output = resolve(root, 'artifacts/sdk-probe');
await mkdir(output, {recursive:true});
const codex = new Codex({...cli?{codexPathOverride:cli}:{},env});
const mode=process.argv[2] || 'text';
const options={workingDirectory:root,sandboxMode:['generation','edit'].includes(mode)?'workspace-write':'read-only',approvalPolicy:'never',webSearchMode:'disabled'};
const prompts={
  text:'This is a minimal connectivity test through the Codex SDK using existing ChatGPT sign-in. Do not invoke any tool, shell, network fetch or file edit. Reply with exactly SDK_TEXT_OK.',
  vision:[{type:'text',text:'Analyze only the attached image directly. Do not invoke shell or any other tool. In Ukrainian name the pictured product, its decorative motif and the number of visible petals. Keep under 80 words; if you cannot see the image, say so.'},{type:'local_image',path:resolve(root,'dist/assets/magnolia-master.png')}],
  generation:'$imagegen Capability test: use ONLY a built-in image-generation tool if one is exposed to this Codex session. You may read the installed imagegen skill instructions and inspect available tools to find the supported built-in path. Generate one small original raster illustration of a single magnolia flower, broad beige petals with black engraved lines, flat natural plywood background. Do not generate or render images using shell, scripts, API calls, browser automation, SVG, canvas or ASCII as a substitute. No API fallback. Do not look for API keys or inspect auth files. Do not modify application code or rules. If the tool allows choosing a destination, use artifacts/sdk-probe; otherwise report its actual output location. If no built-in image-generation tool is exposed, reply IMAGE_GENERATION_UNAVAILABLE and briefly identify the limitation. If the tool exists but fails, report IMAGE_GENERATION_FAILED with the actual reason, not UNAVAILABLE. If successful return GENERATED_IMAGE followed by the actual saved file path or artifact reference. Do not claim success without an image artifact.'
};
if(mode==='edit'){
  const image=resolve(output,'generation.png');
  await readFile(image); // Fail before running a turn if there is no verified input.
  prompts.edit=[{type:'text',text:'$imagegen Edit ONLY the attached existing image using the built-in image-generation/editing tool. Add ONE thin BLACK rectangular border inside the image edge, leaving a generous clear margin around the entire magnolia. Preserve the flower, petals, center, colors, wood background, image dimensions and all other content. This is a minimal editing capability test, not a manufacturing design. You may read imagegen skill instructions and inspect tools. Do not render a substitute in code, do not use the image API, do not look for keys or auth files, and do not modify application files. If the editing tool is not exposed, reply IMAGE_EDIT_UNAVAILABLE; if it fails, reply IMAGE_EDIT_FAILED with the actual reason. On success reply EDITED_IMAGE followed by the actual saved image file path or artifact reference. Do not claim success without an actual edited image.'},{type:'local_image',path:image}];
}
if(!prompts[mode])throw Error('Use text, vision, generation or edit');
const record={mode,sdk:'0.163.0',cli,auth:'existing ChatGPT sign-in; API key env excluded',startedAt:new Date().toISOString(),status:'running',events:[]};
await writeFile(resolve(output,`${mode}.json`),JSON.stringify(record,null,2));
console.log(`Starting ${mode} probe through Codex SDK`);
try{
  const thread=codex.startThread(options);
  const result=await thread.runStreamed(prompts[mode],{signal:AbortSignal.timeout(['generation','edit'].includes(mode)?180000:90000)});
  let final='';
  for await(const event of result.events){
    const item=event.item;
    record.events.push({type:event.type,...(item?{itemType:item.type,tool:item.tool||null,server:item.server||null}:{}),...(event.type==='turn.completed'?{usage:event.usage}:{})});
    if(event.type==='item.completed'&&item?.type==='agent_message')final=item.text;
    if(event.type==='turn.failed')throw Error(event.error?.message||'Turn failed');
    if(event.type==='error')throw Error(event.message||'Stream error');
    console.log(JSON.stringify({event:event.type,itemType:item?.type,tool:item?.tool}));
  }
  record.status='completed';record.finalResponse=final;record.threadId=thread.id;
  if(['generation','edit'].includes(mode)){
    const match=final.trim().match(/^(?:GENERATED_IMAGE|EDITED_IMAGE)\s+(.+)$/);
    if(match){
      const source=await realpath(match[1].trim());
      const generatedRoot=await realpath(resolve(process.env.HOME,'.codex/generated_images'));
      if(!source.startsWith(generatedRoot+sep)&&!source.startsWith(output+sep))throw Error('Returned image path is outside allowed artifact locations');
      const bytes=await readFile(source);
      if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Returned artifact is not a PNG image');
      const destination=resolve(output,`${mode}.png`);
      if(source!==destination)await copyFile(source,destination);
      record.artifact={source,path:destination,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
      record.capability='image_artifact_verified';
    }else record.capability=final.includes('UNAVAILABLE')?'unavailable':final.includes('_FAILED')?'tool_failed':'unverified_response';
  }
  console.log(final.slice(0,5000));
}catch(error){record.status='failed';record.error=String(error.message).slice(0,5000);console.log('Probe failed: '+record.error);process.exitCode=1;}
record.finishedAt=new Date().toISOString();
await writeFile(resolve(output,`${mode}.json`),JSON.stringify(record,null,2));
