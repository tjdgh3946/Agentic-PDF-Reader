import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {mkdir,writeFile,readFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {UserError} from './auth.mjs';
import {validAnchor} from './annotation-geometry.mjs';

const DAY=24*60*60*1000;
function validateSelection(value){
  if(!value || typeof value.documentId!=='string' || !/^[a-f\d-]{1,200}$/i.test(value.documentId)
    || typeof value.fileName!=='string' || !value.fileName.trim() || value.fileName.length>500
    || typeof value.quote!=='string' || !value.quote.trim() || value.quote.length>10000
    || typeof value.question!=='string' || !value.question.trim() || value.question.length>10000
    || typeof value.context!=='string' || value.context.length>120000
    || typeof value.allowSave!=='boolean' || ![0,90,180,270].includes(value.rotation)
    || !Array.isArray(value.anchors) || !value.anchors.length || value.anchors.length>40
    || !value.anchors.every(validAnchor))
    throw new UserError('선택 문장·질문·PDF 위치를 확인하세요. 문맥은 120,000자까지 공유할 수 있습니다.');
  return {documentId:value.documentId,fileName:value.fileName,quote:value.quote.trim(),question:value.question.trim(),context:value.context,
    allowSave:value.allowSave,rotation:value.rotation,anchors:structuredClone(value.anchors)};
}

// A capability bridge, not a proxy for the app's settings, OAuth tokens or files.
// Only explicit shares can be read and each share can create one annotation.
export function createPaperLink({annotations,discoveryPath,getOrigin,now=Date.now}){
  const records=new Map();let enabled=false,token='',revision=0,lastContactAt=null,queue=Promise.resolve();
  const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
  const prune=()=>{for(const [id,record] of records)if(now()-record.timestamp>=DAY)records.delete(id);};
  function snapshot(record){
    if(!record)return null;
    const {selectionId,fileName,quote,question,context,allowSave,createdAt,expiresAt,saved}=record;
    return {selectionId,fileName,quote,question,context,allowSave,createdAt,expiresAt,pages:record.anchors.map(a=>a.page),saved:saved?{annotationId:saved.id,note:saved.note}:null};
  }
  async function enable(){
    if(enabled)return;
    const nextToken=randomBytes(32).toString('hex');
    await mkdir(path.dirname(discoveryPath),{recursive:true});
    await writeFile(discoveryPath+'.tmp',JSON.stringify({version:1,origin:getOrigin(),token:nextToken}),{encoding:'utf8',mode:0o600});
    await rename(discoveryPath+'.tmp',discoveryPath);
    token=nextToken;enabled=true;revision++;
  }
  async function disable(){
    const oldToken=token;enabled=false;token='';records.clear();lastContactAt=null;revision++;
    try{const connection=JSON.parse(await readFile(discoveryPath,'utf8'));if(connection.token===oldToken)await unlink(discoveryPath);}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  function getRecord(id){
    prune();const record=records.get(id);
    if(!record)throw new UserError('공유가 만료되었거나 해제되었습니다. Paper Reader에서 문장을 다시 Link로 보내세요.',404);
    return record;
  }
  return {
    authorize(header){
      if(!enabled || typeof header!=='string')return false;
      const supplied=Buffer.from(header),expected=Buffer.from('Bearer '+token);
      return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
    },
    status(){prune();const latest=[...records.values()].at(-1);return {enabled,revision,sharedCount:records.size,lastContactAt,latest:latest?{selectionId:latest.selectionId,documentId:latest.documentId,fileName:latest.fileName,pages:latest.anchors.map(a=>a.page),saved:!!latest.saved,annotationId:latest.saved?.id||null}:null};},
    setEnabled:value=>serial(async()=>{if(typeof value!=='boolean')throw new UserError('연결 설정이 올바르지 않습니다.');await (value?enable():disable());return {enabled};}),
    share:value=>serial(async()=>{
      const selection=validateSelection(value);prune();
      if(records.size>=100)throw new UserError('공유 문장이 100개입니다. Link 연결을 해제한 뒤 다시 시작하세요.',409);
      await enable();
      const timestamp=now(),selectionId=randomUUID(),record={...selection,selectionId,timestamp,createdAt:new Date(timestamp).toISOString(),expiresAt:new Date(timestamp+DAY).toISOString(),saved:null};
      records.set(selectionId,record);revision++;return snapshot(record);
    }),
    call:(method,args={})=>serial(async()=>{
      if(!enabled)throw new UserError('Paper Reader Link 연결이 꺼져 있습니다.',409);
      lastContactAt=new Date(now()).toISOString();
      if(method==='get_selection'){
        prune();const id=args.selectionId || [...records.keys()].at(-1);
        return {selection:id?snapshot(getRecord(id)):null};
      }
      if(method==='save_annotation'){
        const record=getRecord(args.selectionId);
        if(!record.allowSave)throw new UserError('이 문장은 읽기 전용으로 공유했습니다. 주석 저장을 켜고 다시 공유하세요.',403);
        if(typeof args.note!=='string' || !args.note.trim() || args.note.length>30000)throw new UserError('답변은 1~30,000자로 작성하세요.');
        const note=args.note.trim();
        if(record.saved){
          if(record.saved.note!==note)throw new UserError('이 요청에는 이미 다른 답변이 저장되었습니다. 새 답변은 문장을 다시 공유해 저장하세요.',409);
          const items=await (await annotations).list(record.documentId);
          const persisted=items.find(item=>item.id===record.saved.id);
          if(!persisted || persisted.note!==note)throw new UserError('저장 후 주석이 수정되거나 삭제되었습니다. 문장을 다시 공유하세요.',409);
          return {selectionId:record.selectionId,annotationId:record.saved.id,saved:true,duplicate:true};
        }
        const item=await (await annotations).upsert(record.documentId,{quote:record.quote,note,color:'blue',rotation:record.rotation,anchors:record.anchors});
        record.saved=item;revision++;
        return {selectionId:record.selectionId,annotationId:item.id,saved:true,pages:record.anchors.map(a=>a.page)};
      }
      throw new UserError('지원하지 않는 Link 도구입니다.',404);
    }),
    close:()=>serial(disable),
    flush:()=>queue
  };
}
