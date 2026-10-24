import { panelList } from './panels.js';
import { TRACING_KINDS } from './tracing.js';

const encoder=new TextEncoder();
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
const join=chunks=>{const result=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;for(const c of chunks){result.set(c,offset);offset+=c.length;}return result;};
export function zipFiles(files){
  const local=[],central=[];let offset=0;
  for(const file of files){
    const name=encoder.encode(file.name),data=file.bytes,crc=crc32(data),header=new Uint8Array(30),h=new DataView(header.buffer);
    h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,name.length,true);
    local.push(header,name,data);
    const directory=new Uint8Array(46),d=new DataView(directory.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint32(16,crc,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);central.push(directory,name);offset+=header.length+name.length+data.length;
  }
  const index=join(central),end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,index.length,true);e.setUint32(16,offset,true);
  return new Blob([...local,index,end],{type:'application/zip'});
}
export async function panelArchive(p,{safeImage,passport='',fetchImage=fetch}){
  const files=[],manifest={title:p.title,material:'Фанера 3 мм',panels:[]};let total=0;
  async function add(name,src){
    if(!safeImage(src))throw Error('Неприпустиме зображення у комплекті');
    const response=await fetchImage(src);if(!response.ok)throw Error('Не вдалося прочитати файл комплекту');
    const bytes=new Uint8Array(await response.arrayBuffer());total+=bytes.length;if(total>256*1024*1024)throw Error('Архів завеликий. Завантажте файли окремо.');
    const mime=response.headers.get('Content-Type')||'',ext=mime.includes('jpeg')?'jpg':mime.includes('webp')?'webp':'png';
    files.push({name:name+'.'+ext,bytes});return name+'.'+ext;
  }
  for(const [i,part] of panelList(p).entries()){
    const folder=String(i+1).padStart(2,'0')+'-'+part.name.replace(/[\x00-\x1f\\/:*?"<>|]/g,'_');
    const entry={id:part.id,name:part.name,width_mm:part.width,height_mm:part.height,outdated:Boolean(part.pendingAssetsUpdate?.length),files:[]};
    if(part.assets?.master)entry.files.push(await add(folder+'/decor',part.assets.master));
    for(const kind of TRACING_KINDS)if(part.tracing?.assets?.[kind])entry.files.push(await add(folder+'/'+kind,part.tracing.assets[kind]));
    entry.tracing_outdated=Boolean(part.tracing?.outdated);manifest.panels.push(entry);
  }
  if(p.assets?.preview)await add('product-preview',p.assets.preview);
  files.push({name:'panels.json',bytes:encoder.encode(JSON.stringify(manifest,null,2))},{name:'passport.txt',bytes:encoder.encode(passport+'\n\nКонтурний рисунок містить різання та гравіювання разом. Призначте операції вручну у SolidWorks/LightBurn. Масштаб, перемички й з’єднання перевірте у кресленні.')});
  return zipFiles(files);
}
export async function panelSheet(p,{safeImage}){
  const list=panelList(p),columns=Math.min(3,Math.ceil(Math.sqrt(list.length))),rows=Math.ceil(list.length/columns),canvas=document.createElement('canvas');canvas.width=columns*520;canvas.height=rows*420;
  const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
  for(const [i,part] of list.entries()){
    const left=i%columns*520,top=Math.floor(i/columns)*420;context.fillStyle='#243a32';context.font='18px sans-serif';context.fillText(part.name,left+20,top+26,480);context.font='14px sans-serif';context.fillText(`${part.width} × ${part.height} мм${part.pendingAssetsUpdate?.length?' · попередній декор':''}`,left+20,top+49,480);
    const src=safeImage(part.assets?.master);if(!src){context.fillText('Зображення ще немає',left+20,top+100);continue;}
    const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Не вдалося відкрити панель'));img.src=src;});
    const scale=Math.min(480/image.naturalWidth,340/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;context.drawImage(image,left+(520-w)/2,top+65+(340-h)/2,w,h);
  }
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Не вдалося створити аркуш комплекту')),'image/png'));
}
