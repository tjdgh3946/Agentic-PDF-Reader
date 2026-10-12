import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {UserError} from './auth.mjs';
import {validAnchor} from './annotation-geometry.mjs';

const COLORS=new Set(['yellow','green','pink','blue']);
const validId=value=>typeof value==='string' && value.length>0 && value.length<=200 && /^[\da-f-]+$/i.test(value);

export async function createAnnotations(directory) {
  const fileFor=id=>path.join(directory,createHash('sha256').update(id).digest('hex')+'.json');
  await mkdir(directory,{recursive:true});
  let queue=Promise.resolve();
  const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
  const read=async id=>{
    try {const data=JSON.parse(await readFile(fileFor(id),'utf8'));return data.documentId===id && Array.isArray(data.items)?data.items:[];}
    catch(error){if(error.code==='ENOENT')return [];throw error;}
  };
  const save=async(id,items)=>{
    const file=fileFor(id);await writeFile(file+'.tmp',JSON.stringify({documentId:id,items}),'utf8');await rename(file+'.tmp',file);
  };
  return {
    list:id=>serial(async()=>{if(!validId(id))throw new UserError('PDF 식별자가 올바르지 않습니다.');return await read(id);}),
    upsert:(id,input)=>serial(async()=>{
      if(!validId(id))throw new UserError('PDF 식별자가 올바르지 않습니다.');
      if(!input || typeof input!=='object' || !COLORS.has(input.color) || typeof input.quote!=='string' || !input.quote.trim() || input.quote.length>10000 || typeof input.note!=='string' || input.note.length>30000 || ![0,90,180,270].includes(input.rotation) || !Array.isArray(input.anchors) || !input.anchors.length || input.anchors.length>40)throw new UserError('주석 정보가 올바르지 않습니다.');
      const anchors=input.anchors.map(anchor=>{
        if(!validAnchor(anchor))throw new UserError('형광펜 위치가 올바르지 않습니다.');
        return {page:anchor.page,rects:anchor.rects,...(anchor.space?{space:anchor.space}:{}),...(anchor.kind?{kind:anchor.kind}:{}),
          ...(anchor.textQuote!==undefined?{textQuote:anchor.textQuote}:{}),...(anchor.textStart!==undefined?{textStart:anchor.textStart}:{})};
      });
      const items=await read(id),index=items.findIndex(item=>item.id===input.id);
      if(input.id && index<0)throw new UserError('수정할 주석을 찾을 수 없습니다.',404);
      const now=new Date().toISOString(),item={id:input.id || randomUUID(),quote:input.quote.trim(),note:input.note,color:input.color,rotation:input.rotation,anchors,createdAt:index>=0?items[index].createdAt:now,updatedAt:now};
      if(index>=0)items[index]=item;else items.push(item);
      await save(id,items);return item;
    }),
    delete:(id,itemId)=>serial(async()=>{
      if(!validId(id) || typeof itemId!=='string')throw new UserError('주석 정보가 올바르지 않습니다.');
      const items=await read(id),index=items.findIndex(item=>item.id===itemId);
      if(index<0)throw new UserError('삭제할 주석을 찾을 수 없습니다.',404);
      items.splice(index,1);await save(id,items);return {deleted:true};
    }),
    flush:()=>queue
  };
}
