import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {mkdir,writeFile,readFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {UserError} from './auth.mjs';
import {validAnchor} from './annotation-geometry.mjs';
import {recordEvidence} from './pdf-evidence.mjs';

const DAY=24*60*60*1000;
const notePages=item=>[...new Set(item.anchors.map(anchor=>anchor.page))].sort((a,b)=>a-b);
const preview=(text,length)=>Array.from(text).slice(0,length).join('');
const searchText=text=>text.normalize('NFKC').replace(/\s+/gu,' ').trim().toLowerCase();
function annotationInteger(value,fallback,max,label){
  if(value===undefined)return fallback;
  if(!Number.isSafeInteger(value)||value<0||value>max)throw new UserError(label+' 값을 확인하세요.');
  return value;
}
function annotationResult(items,method,args){
  if(method==='list_annotations'){
    if(args.query!==undefined&&(typeof args.query!=='string'||args.query.length>500))throw new UserError('노트 검색어는 500자 이내로 입력하세요.');
    if(args.pages!==undefined&&(!Array.isArray(args.pages)||!args.pages.length||args.pages.length>20||!args.pages.every(page=>Number.isSafeInteger(page)&&page>0)))throw new UserError('노트 페이지 필터를 확인하세요.');
    const offset=annotationInteger(args.offset,0,1000000,'목록 위치'),limit=annotationInteger(args.limit,20,20,'노트 개수');
    if(!limit)throw new UserError('노트 개수는 1~20개입니다.');
    const revision=createHash('sha256').update(JSON.stringify(items)).digest('hex');
    if(args.revision!==undefined&&args.revision!==revision)throw new UserError('노트가 변경되었습니다. 목록을 처음부터 다시 조회하세요.',409);
    const query=searchText(args.query||'');
    const matches=items.filter(item=>(!args.pages||notePages(item).some(page=>args.pages.includes(page)))&&(!query||searchText(item.quote+'\n'+item.note).includes(query)))
      .sort((a,b)=>notePages(a)[0]-notePages(b)[0]||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
    const entries=[];let characters=0;
    for(const item of matches.slice(offset,offset+limit)){
      const entry={annotationId:item.id,pages:notePages(item),kind:item.anchors.every(anchor=>anchor.kind==='page-note')?'page-note':'highlight',color:item.color,quotePreview:preview(item.quote,160),notePreview:preview(item.note,240),noteCharacters:Array.from(item.note).length,createdAt:item.createdAt,updatedAt:item.updatedAt};
      const size=JSON.stringify(entry).length;if(entries.length&&characters+size>12000)break;
      entries.push(entry);characters+=size;
    }
    return {revision,total:items.length,matched:matches.length,offset,entries,nextOffset:offset+entries.length<matches.length?offset+entries.length:null};
  }
  if(typeof args.annotationId!=='string'||!/^[a-f\d-]{1,200}$/i.test(args.annotationId))throw new UserError('읽을 노트 ID를 확인하세요.');
  const item=items.find(item=>item.id===args.annotationId);
  if(!item)throw new UserError('이 PDF에서 해당 노트를 찾지 못했습니다. 목록을 다시 조회하세요.',404);
  const field=args.field??'note';if(!['note','quote'].includes(field))throw new UserError('노트 또는 원문 발췌를 선택하세요.');
  const offset=annotationInteger(args.offset,0,1000000,'본문 위치'),maxCharacters=annotationInteger(args.maxCharacters,8000,8000,'본문 길이');
  if(!maxCharacters)throw new UserError('본문 길이는 1~8,000자입니다.');
  const characters=Array.from(item[field]);if(offset>characters.length)throw new UserError('노트 본문 위치가 범위를 벗어났습니다.');
  const text=characters.slice(offset,offset+maxCharacters).join('');
  return {annotationId:item.id,pages:notePages(item),color:item.color,kind:item.anchors.every(anchor=>anchor.kind==='page-note')?'page-note':'highlight',createdAt:item.createdAt,updatedAt:item.updatedAt,quotePreview:preview(item.quote,200),field,text,offset,totalCharacters:characters.length,nextOffset:offset+maxCharacters<characters.length?offset+maxCharacters:null};
}
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
    ...(value.snapshotId?{snapshotId:value.snapshotId}:{}),
    allowSave:value.allowSave,rotation:value.rotation,anchors:structuredClone(value.anchors)};
}

// A capability bridge, not a proxy for the app's settings, OAuth tokens or files.
// Only explicit shares can be read and each share can create one annotation.
export function createPaperLink({annotations,discoveryPath,getOrigin,pdfs,onSaved,now=Date.now}){
  const records=new Map();let enabled=false,token='',revision=0,lastContactAt=null,queue=Promise.resolve();
  let activeReads=0;
  const expiryTimer=setInterval(()=>{if(enabled)prune();},60000);expiryTimer.unref?.();
  const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
  const prune=()=>{for(const [id,record] of records)if(now()-record.timestamp>=DAY){records.delete(id);if(record.snapshotId)pdfs?.unpin(record.snapshotId,id);}};
  function snapshot(record){
    if(!record)return null;
    const {selectionId,fileName,quote,question,context,allowSave,createdAt,expiresAt,saved}=record;
    return {selectionId,fileName,quote,question,context,allowSave,annotationsAvailable:true,createdAt,expiresAt,...(record.snapshotId?{snapshotId:record.snapshotId,pdfAvailable:true}:{}),scope:record.anchors[0].kind==='page-note'?'page':'selection',pages:record.anchors.map(a=>a.page),saved:saved?{annotationId:saved.id,note:saved.note}:null};
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
    pdfs?.reset();
    try{const connection=JSON.parse(await readFile(discoveryPath,'utf8'));if(connection.token===oldToken)await unlink(discoveryPath);}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  function getRecord(id){
    prune();const record=records.get(id);
    if(!record)throw new UserError('공유가 만료되었거나 해제되었습니다. Paper Reader에서 문장을 다시 Link로 보내세요.',404);
    return record;
  }
  async function syncQuestion(record){
    try{record.historyUpdated=!!(await onSaved?.({selectionId:record.selectionId,documentId:record.documentId,annotationId:record.saved.id,note:record.saved.note}));record.historyError=false;}
    catch{record.historyUpdated=false;record.historyError=true;}
    revision++;
    return record.historyUpdated;
  }
  async function readTool(method,args){
    const record=await serial(()=>{if(!enabled)throw new UserError('Paper Reader Link 연결이 꺼져 있습니다.',409);const item=getRecord(args.selectionId);if(!item.snapshotId)throw new UserError('이 질문에는 PDF 전체가 공유되지 않았습니다. AI가 문맥 찾기를 선택해 다시 공유하세요.',409);if(activeReads>=3)throw new UserError('PDF 작업이 진행 중입니다. 잠시 후 다시 시도하세요.',429);activeReads++;lastContactAt=new Date(now()).toISOString();return item;});
    const event={tool:method,state:'running',pages:[],at:new Date(now()).toISOString()};
    record.trace.push(event);if(record.trace.length>12)record.trace.shift();revision++;
    try{
      let value;
      if(method==='inspect_pdf')value=pdfs.inspect(record.snapshotId);
      if(method==='query_pdf')value=await pdfs.query(record.snapshotId,args.sql,args.params);
      if(method==='search_pdf')value=await pdfs.search(record.snapshotId,args);
      if(method==='read_pdf')value=pdfs.read(record.snapshotId,args);
      if(method==='expand_pdf')value=pdfs.expand(record.snapshotId,args);
      if(method==='render_pdf_page')value=await pdfs.render(record.snapshotId,args.page,args.region);
      if(!enabled || getRecord(record.selectionId)!==record)throw new UserError('PDF 공유가 종료되었습니다.',410);
      event.state='complete';
      event.pages=method==='query_pdf'?[...new Set(value.rows.map(row=>Number(row.page_no)).filter(n=>Number.isInteger(n)&&n>=1&&n<=pdfs.inspect(record.snapshotId).pageCount))]:method==='search_pdf'?[...new Set(value.matches.map(p=>p.page))]:['read_pdf','expand_pdf'].includes(method)?[...new Set(value.pages.map(p=>p.page))]:method==='render_pdf_page'?[args.page]:[];
      if(['read_pdf','expand_pdf','render_pdf_page'].includes(method))recordEvidence(record.evidence,method,value,args);
      if(['read_pdf','expand_pdf'].includes(method)){event.characters=value.characters;event.passages=value.pages.map(p=>({passageId:p.passageId,start:p.start,end:p.end}));if(args.reason)event.reason=args.reason;}
      if(method==='render_pdf_page')event.image={region:value.metadata.region,width:value.metadata.width,height:value.metadata.height};
      revision++;return {selectionId:record.selectionId,...value};
    }catch(error){event.state='error';revision++;throw error;}
    finally{activeReads--;}
  }
  async function readAnnotations(method,args){
    const record=await serial(()=>{
      if(!enabled)throw new UserError('Paper Reader Link 연결이 꺼져 있습니다.',409);
      const item=getRecord(args.selectionId);
      if(activeReads>=3)throw new UserError('PDF 작업이 진행 중입니다. 잠시 후 다시 시도하세요.',429);
      activeReads++;lastContactAt=new Date(now()).toISOString();return item;
    });
    const event={tool:method,state:'running',pages:[],at:new Date(now()).toISOString()};
    record.trace.push(event);if(record.trace.length>12)record.trace.shift();revision++;
    try{
      // Resolve the document from the share, never from a caller's document ID.
      // Notes are live: include both manual notes and persisted ChatGPT answers.
      const items=await (await annotations).list(record.documentId);
      if(!enabled||getRecord(record.selectionId)!==record)throw new UserError('PDF 공유가 종료되었습니다.',410);
      const value=annotationResult(items,method,args);
      event.annotationPages=method==='list_annotations'?[...new Set(value.entries.flatMap(item=>item.pages))].sort((a,b)=>a-b):value.pages;
      event.state='complete';revision++;
      // Reading a note is not evidence that the original PDF page was read.
      return {selectionId:record.selectionId,fileName:record.fileName,contentSource:'reader_annotations',authorship:'not_recorded',...value};
    }catch(error){event.state='error';revision++;throw error;}
    finally{activeReads--;}
  }
  return {
    question(selectionId,documentId,question){const record=getRecord(selectionId);if(record.documentId!==documentId || record.question!==question)throw new UserError('질문 기록과 Link 공유 문서가 일치하지 않습니다.',409);return record.saved?{selectionId,documentId,annotationId:record.saved.id,note:record.saved.note}:null;},
    authorize(header){
      if(!enabled || typeof header!=='string')return false;
      const supplied=Buffer.from(header),expected=Buffer.from('Bearer '+token);
      return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
    },
    status(){prune();const latest=[...records.values()].at(-1);return {pdfAvailable:!!pdfs?.available,enabled,revision,sharedCount:records.size,lastContactAt,latest:latest?{selectionId:latest.selectionId,documentId:latest.documentId,fileName:latest.fileName,pages:latest.anchors.map(a=>a.page),trace:structuredClone(latest.trace),saved:!!latest.saved,annotationId:latest.saved?.id||null,historyError:!!latest.historyError}:null};},
    setEnabled:value=>serial(async()=>{if(typeof value!=='boolean')throw new UserError('연결 설정이 올바르지 않습니다.');await (value?enable():disable());return {enabled};}),
    share:value=>serial(async()=>{
      const selection=validateSelection(value);prune();
      if(records.size>=100)throw new UserError('공유 문장이 100개입니다. Link 연결을 해제한 뒤 다시 시작하세요.',409);
      await enable();
      const timestamp=now(),selectionId=randomUUID(),record={...selection,selectionId,timestamp,createdAt:new Date(timestamp).toISOString(),expiresAt:new Date(timestamp+DAY).toISOString(),saved:null,trace:[],evidence:{snapshotId:selection.snapshotId,pages:[],truncated:false}};
      if(selection.snapshotId){if(typeof selection.snapshotId!=='string'||!/^[a-f\d]{64}$/.test(selection.snapshotId)||!pdfs)throw new UserError('PDF 고정본 ID를 확인하세요.');pdfs.pin(selection.snapshotId,selection.documentId,selectionId);}
      records.set(selectionId,record);revision++;return snapshot(record);
    }),
    call:(method,args={})=>['inspect_pdf','query_pdf','search_pdf','read_pdf','expand_pdf','render_pdf_page'].includes(method)?readTool(method,args):['list_annotations','read_annotation'].includes(method)?readAnnotations(method,args):serial(async()=>{
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
          const historyUpdated=await syncQuestion(record);
          return {selectionId:record.selectionId,annotationId:record.saved.id,saved:true,duplicate:true,historyUpdated};
        }
        const item=await (await annotations).upsert(record.documentId,{quote:record.quote,note,color:'blue',rotation:record.rotation,anchors:record.anchors,...(record.evidence.pages.length?{evidence:record.evidence}:{})});
        record.saved=item;revision++;
        const historyUpdated=await syncQuestion(record);
        return {selectionId:record.selectionId,annotationId:item.id,saved:true,pages:record.anchors.map(a=>a.page),historyUpdated};
      }
      throw new UserError('지원하지 않는 Link 도구입니다.',404);
    }),
    close:()=>{clearInterval(expiryTimer);return serial(disable);},
    flush:()=>queue
  };
}
