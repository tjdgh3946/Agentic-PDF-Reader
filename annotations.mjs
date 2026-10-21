import {mkdir} from 'node:fs/promises';
import {createReliableJson} from './reliable-json.mjs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {UserError} from './auth.mjs';
import {validAnchor} from './annotation-geometry.mjs';
import {validateEvidence} from './pdf-evidence.mjs';

const COLORS=new Set(['yellow','green','pink','blue']);
const validId=value=>typeof value==='string' && value.length>0 && value.length<=200 && /^[\da-f-]+$/i.test(value);

export async function createAnnotations(directory) {
  const fileFor=id=>path.join(directory,createHash('sha256').update(id).digest('hex')+'.json');
  await mkdir(directory,{recursive:true});
  let queue=Promise.resolve();
  const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
  const disk=createReliableJson(directory,'논문 노트');
  const valid=(id,data)=>data?.documentId===id&&Array.isArray(data.items)&&data.items.every(item=>validId(item?.id)&&typeof item.quote==='string'&&typeof item.note==='string'&&COLORS.has(item.color)&&[0,90,180,270].includes(item.rotation)&&Array.isArray(item.anchors)&&item.anchors.length>0&&item.anchors.every(validAnchor)&&typeof item.createdAt==='string'&&typeof item.updatedAt==='string'&&(!item.evidence||!!validateEvidence(item.evidence)));
  const read=async id=>(await disk.read(fileFor(id),data=>valid(id,data),{documentId:id,items:[]})).items;
  const save=(id,items,options)=>disk.write(fileFor(id),{documentId:id,items},data=>valid(id,data),options);
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
      if(input.creationId!==undefined&&(input.id||typeof input.creationId!=='string'||!/^[a-f\d-]{36}$/i.test(input.creationId)))throw new UserError('노트 저장 요청 ID를 확인하세요.');
      const items=await read(id),index=items.findIndex(item=>item.id===(input.id||input.creationId));
      if(input.id && index<0)throw new UserError('수정할 주석을 찾을 수 없습니다.',404);
      if(input.creationId&&index>=0){const previous=items[index];if(previous.quote!==input.quote.trim()||previous.note!==input.note||previous.color!==input.color||previous.rotation!==input.rotation||JSON.stringify(previous.anchors)!==JSON.stringify(anchors))throw new UserError('이 초안은 이미 저장됐거나 수정되었습니다. 노트 목록을 확인한 뒤 수정하세요.',409);return previous;}
      const sourceEvidence=input.evidence===undefined?(index>=0?items[index].evidence:undefined):input.evidence;
      const evidence=sourceEvidence?validateEvidence(sourceEvidence):undefined;
      const now=new Date().toISOString(),item={id:input.id || input.creationId || randomUUID(),quote:input.quote.trim(),note:input.note,color:input.color,rotation:input.rotation,anchors,...(evidence?{evidence}:{}),createdAt:index>=0?items[index].createdAt:now,updatedAt:now};
      if(index>=0)items[index]=item;else items.push(item);
      await save(id,items);return item;
    }),
    delete:(id,itemId)=>serial(async()=>{
      if(!validId(id) || typeof itemId!=='string')throw new UserError('주석 정보가 올바르지 않습니다.');
      const items=await read(id),index=items.findIndex(item=>item.id===itemId);
      if(index<0)throw new UserError('삭제할 주석을 찾을 수 없습니다.',404);
      items.splice(index,1);await save(id,items,{deleting:true});return {deleted:true};
    }),
    storageStatus:()=>disk.status(),
    flush:()=>queue
  };
}
