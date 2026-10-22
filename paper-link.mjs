import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {mkdir,writeFile,readFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {UserError} from './auth.mjs';
import {validAnchor} from './annotation-geometry.mjs';
import {recordEvidence} from './pdf-evidence.mjs';
import {renderRegion} from './pdf-snapshots.mjs';
import {sourceRecoveryGuide} from './link-question.mjs';
import {deliveryEvent,validDelivery,appendDelivery,DELIVERY_LIMIT,TOTAL_DELIVERY_LIMIT,IMAGE_CACHE_LIMIT} from './delivery-history.mjs';

function contextRecovery(method,args,sourceIncluded,missingReferences){
  const keys=method==='render_pdf_page'?['selectionId','page','region']:method==='expand_pdf'?['selectionId','cursor','maxCharacters']:['selectionId','passageId','pages','maxCharacters'];
  const parameters=Object.fromEntries(keys.filter(key=>args[key]!==undefined).map(key=>[key,args[key]]));
  parameters[method==='render_pdf_page'?'resend':'reread']=true;
  parameters.reason='Earlier exact source is unavailable or uncertain in current conversation context; recover it before answering.';
  return {sourceIncluded,missingReferences,requiredIf:'Earlier exact source is inaccessible or availability is uncertain; a summary is insufficient.',instruction:sourceRecoveryGuide,retry:{tool:method,arguments:parameters},onFailure:'Report unavailable evidence; do not guess or repeat recovery in a loop.'};
}

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
export function createPaperLink({annotations,discoveryPath,getOrigin,pdfs,onSaved,archive,now=Date.now}){
  const records=new Map();let enabled=false,token='',revision=0,lastContactAt=null,queue=Promise.resolve();
  let activeReads=0,archiveError=null,restoring,closePromise;
  const hydration=new Map();
  const deliveredImages=new Map();
  function trimImages(){
    const keep=new Set([...records.values()].flatMap(record=>(record.deliveries||[]).flatMap(event=>event.items.map(item=>item.sha256).filter(Boolean))));
    for(const id of deliveredImages.keys())if(!keep.has(id))deliveredImages.delete(id);
    let size=[...deliveredImages.values()].reduce((n,bytes)=>n+bytes.length,0);
    while(size>IMAGE_CACHE_LIMIT){const id=deliveredImages.keys().next().value;size-=deliveredImages.get(id).length;deliveredImages.delete(id);}
  }
  async function recordDelivery(record,method,args,value){
    if(!['read_pdf','expand_pdf','render_pdf_page','search_pdf','query_pdf'].includes(method))return;
    const {event,image}=deliveryEvent(method,value,now());if(args.reason)event.reason=args.reason;
    appendDelivery(records,record,event);
    if(image){deliveredImages.set(image.sha256,image.bytes);try{await archive?.putImage?.(image.sha256,image.bytes);}catch{event.imageCacheWarning=true;}}
    trimImages();
  }
  const expiryTimer=setInterval(()=>{if(enabled)serial(async()=>{prune();await persist();}).catch(()=>{});},60000);expiryTimer.unref?.();
  const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
  const prune=()=>{for(const [id,record] of records)if(now()-record.timestamp>=DAY){records.delete(id);if(record.snapshotId)pdfs?.unpin(record.snapshotId,id);}trimImages();};
  const archived=()=>[...records.values()].map(({images,textReads,trace,...record})=>({...record,images:[...images].filter(([,entry])=>!entry.pending),textReads:[...textReads],trace:[]}));
  async function persist(){if(!archive)return;try{await archive.save(archived());archiveError=[...records.values()].some(record=>record.cacheFailure)?'공유 PDF 복원 캐시 저장 실패 · 재시작 후 다시 공유해야 합니다.':null;}catch{archiveError='공유 복원 캐시 저장 실패 · 현재 실행 중에는 사용할 수 있지만 재시작 후에는 다시 공유해야 할 수 있습니다.';}}
  async function restore(){
    if(!archive)return;
    if(restoring)return restoring;
    restoring=(async()=>{
      try{
        const stored=await archive.load(),restored=[];
        for(const item of stored){
          validateSelection(item);
          if(!/^[a-f\d-]{36}$/i.test(item.selectionId)||!Number.isFinite(item.timestamp)||item.timestamp>now()||now()-item.timestamp>=DAY)continue;
          if(item.snapshotId&&!/^[a-f\d]{64}$/.test(item.snapshotId))continue;
          const record={...item,trace:[],deliveries:(item.deliveries||[]).filter(validDelivery).slice(-DELIVERY_LIMIT),images:new Map(item.images||[]),textReads:new Map(item.textReads||[]),needsHydration:!!item.snapshotId,restored:true};
          restored.push(record);
        }
        for(const record of restored)records.set(record.selectionId,record);
        if(records.size)await enable();
        await persist();
      }catch{archiveError='이전 공유를 복원하지 못했습니다. Link 연결 해제로 캐시를 지운 뒤 PDF를 다시 공유하세요.';}
    })();return restoring;
  }
  async function hydrate(record){
    if(!record.needsHydration)return;
    let pending=hydration.get(record.snapshotId);
    if(!pending){pending=(async()=>{
      const bytes=await archive.readPdf(record.snapshotId);
      await pdfs.register(bytes,record.documentId,record.fileName);
      pdfs.discardSource?.(record.snapshotId);
      if(!enabled||records.get(record.selectionId)!==record)throw new UserError('PDF 공유가 종료되었습니다.',410);
      // Pin all restored shares for this snapshot, including other questions.
      for(const item of records.values())if(item.snapshotId===record.snapshotId){pdfs.pin(item.snapshotId,item.documentId,item.selectionId);item.needsHydration=false;}
    })();hydration.set(record.snapshotId,pending);}
    try{await pending;}catch{throw new UserError('이전 공유 PDF를 복원하지 못했습니다. PDF를 다시 공유하세요.',410);}
    finally{if(hydration.get(record.snapshotId)===pending)hydration.delete(record.snapshotId);}
  }
  function snapshot(record){
    if(!record)return null;
    const {selectionId,fileName,quote,question,context,allowSave,createdAt,expiresAt,saved}=record;
    return {selectionId,fileName,quote,question,context,allowSave,annotationsAvailable:true,createdAt,expiresAt,...(record.snapshotId?{snapshotId:record.snapshotId,pdfAvailable:true,textQuality:record.textQuality}:{}),scope:record.anchors[0].kind==='page-note'?'page':'selection',pages:record.anchors.map(a=>a.page),saved:saved?{annotationId:saved.id,note:saved.note}:null};
  }
  async function enable(){
    if(enabled)return;
    const nextToken=randomBytes(32).toString('hex');
    await mkdir(path.dirname(discoveryPath),{recursive:true});
    await writeFile(discoveryPath+'.tmp',JSON.stringify({version:1,origin:getOrigin(),token:nextToken}),{encoding:'utf8',mode:0o600});
    await rename(discoveryPath+'.tmp',discoveryPath);
    token=nextToken;enabled=true;revision++;
  }
  async function disable({preserve=false}={}){
    if(preserve)await persist();else await archive?.clear();
    const oldToken=token;enabled=false;token='';records.clear();deliveredImages.clear();lastContactAt=null;revision++;
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
  async function imageResult(record,args){
    if(args.resend!==undefined&&typeof args.resend!=='boolean')throw new UserError('이미지 재전송 옵션을 확인하세요.');
    if(args.resend&&(typeof args.reason!=='string'||!args.reason.trim()||args.reason.length>180))throw new UserError('이미지를 다시 받아야 하는 이유를 180자 이내로 적으세요. 확대에는 더 작은 region을 지정하세요.');
    const region=renderRegion(args.region),key=JSON.stringify([args.page,region]),existing=record.images.get(key);
    let previous;
    if(existing){
      previous=existing.pending?await existing.pending:existing;
      if(!args.resend)return {metadata:previous.metadata,imageRef:previous.imageRef,delivery:'reference',imageReturned:false,contextRecovery:contextRecovery('render_pdf_page',{...args,region},false,[previous.imageRef]),advice:'NO IMAGE PIXELS IN THIS RESPONSE. A reference proves earlier delivery, not current visual access. If earlier pixels are missing or uncertain, execute contextRecovery.retry before describing the figure. A smaller region is for zoom, not recovery.'};
    }
    if(!existing&&record.images.size>=32)throw new UserError('이 공유의 이미지 영역은 최대 32개입니다. 필요한 자료만 새로 공유하세요.');
    const imageRef=existing?.imageRef||'image-'+randomUUID(),entry={imageRef};
    // Store pending metadata for coalescing; discard PNG bytes after delivery.
    let complete,fail;entry.pending=new Promise((resolve,reject)=>{complete=resolve;fail=reject;});entry.pending.catch(()=>{});
    record.images.set(key,entry);
    try{
      const value=await pdfs.render(record.snapshotId,args.page,region);
      const metadata={...value.metadata,region};
      const delivered={metadata,imageRef};if(record.images.get(key)===entry)record.images.set(key,delivered);
      complete(delivered);
      return {...value,metadata,imageRef,delivery:args.resend?'resend':'image',imageReturned:true};
    }catch(error){if(record.images.get(key)===entry){if(previous)record.images.set(key,previous);else record.images.delete(key);}fail(error);throw error;}
  }
  async function readTool(method,args){
    const record=await serial(()=>{if(!enabled)throw new UserError('Paper Reader Link 연결이 꺼져 있습니다.',409);const item=getRecord(args.selectionId);if(!item.snapshotId)throw new UserError('이 질문에는 PDF 전체가 공유되지 않았습니다. AI가 문맥 찾기를 선택해 다시 공유하세요.',409);if(activeReads>=3)throw new UserError('PDF 작업이 진행 중입니다. 잠시 후 다시 시도하세요.',429);activeReads++;lastContactAt=new Date(now()).toISOString();return item;});
    const event={tool:method,state:'running',pages:[],at:new Date(now()).toISOString()};
    record.trace.push(event);if(record.trace.length>12)record.trace.shift();revision++;
    try{
      await hydrate(record);
      if(args.reason!==undefined&&(typeof args.reason!=='string'||!args.reason.trim()||args.reason.length>180))throw new UserError('추가 자료가 필요한 이유를 180자 이내로 적으세요.');
      if(args.reread!==undefined&&typeof args.reread!=='boolean')throw new UserError('원문 재읽기 옵션을 확인하세요.');
      if(args.reread&&!args.reason)throw new UserError('원문을 다시 읽어야 하는 이유를 reason에 적으세요.');
      const usage=record.usage??={textCharacters:0,imageCount:0};
      const budgetError=()=>new UserError('이 질문의 기본 자료 예산(본문·검색 24,000자 / 이미지 8개)을 사용했습니다. 이미 읽은 자료로 답하거나, 부족한 근거를 reason에 구체적으로 적어 추가 요청하세요.',409);
      const imageReference=method==='render_pdf_page'&&!args.resend&&record.images.has(JSON.stringify([args.page,renderRegion(args.region)]));
      if(method==='render_pdf_page'&&usage.imageCount>=8&&!imageReference&&!args.reason)throw budgetError();
      if(['search_pdf','query_pdf'].includes(method)&&usage.textCharacters>=24000&&!args.reason)throw budgetError();
      let value;
      if(method==='inspect_pdf')value=pdfs.inspect(record.snapshotId);
      if(method==='query_pdf')value=await pdfs.query(record.snapshotId,args.sql,args.params);
      if(method==='search_pdf')value=await pdfs.search(record.snapshotId,args);
      if(method==='read_pdf')value=pdfs.read(record.snapshotId,args);
      if(method==='expand_pdf')value=pdfs.expand(record.snapshotId,args);
      if(method==='render_pdf_page')value=await imageResult(record,args);
      if(!enabled || getRecord(record.selectionId)!==record)throw new UserError('PDF 공유가 종료되었습니다.',410);
      if(['read_pdf','expand_pdf'].includes(method)){
        const additions=[];
        value={...value,pages:value.pages.map(page=>{
          const key=JSON.stringify([page.passageId,page.start,page.end]),prior=record.textReads.get(key);
          if(prior&&!args.reread){const {text,...reference}=page;return {...reference,textRef:prior,delivery:'reference'};}
          const textRef=prior||'text-'+randomUUID();additions.push([key,textRef]);return {...page,textRef,delivery:args.reread?'reread':'text'};
        })};value.characters=value.pages.reduce((total,page)=>total+(page.text?.length||0),0);
        if(value.characters&&usage.textCharacters>=24000&&!args.reason)throw budgetError();
        if(new Set([...record.textReads.keys(),...additions.map(([key])=>key)]).size>256)throw new UserError('읽기 이력 한도에 도달했습니다. 질문을 새로 공유하세요.',409);
        for(const [key,textRef] of additions)record.textReads.set(key,textRef);
        const missing=value.pages.filter(page=>page.delivery==='reference').map(page=>page.textRef);
        if(missing.length)value.contextRecovery=contextRecovery(method,args,value.characters>0,missing);
        value.advice=missing.length?'REFERENCE RANGES CONTAIN NO SOURCE TEXT. A textRef is not evidence. If the exact earlier text is missing or uncertain, execute contextRecovery.retry before answering. Mixed responses still omit the referenced ranges.':'Read the returned exact source before answering. To obtain missing adjacent evidence use before/after cursors with expand_pdf and a reason.';
      }
      if(['read_pdf','expand_pdf'].includes(method))usage.textCharacters+=value.characters;
      if(method==='search_pdf')usage.textCharacters+=value.matches.reduce((n,item)=>n+item.excerpt.length,0);
      if(method==='query_pdf')usage.textCharacters+=JSON.stringify(value.rows).length;
      if(method==='render_pdf_page'&&value.imageReturned)usage.imageCount++;
      value={...value,contextUsage:{...usage,textBudget:24000,imageBudget:8,requiresReason:usage.textCharacters>=24000||usage.imageCount>=8,scope:'this selectionId only; previous ChatGPT messages are not deleted'}};
      event.state='complete';
      event.pages=method==='query_pdf'?[...new Set(value.rows.map(row=>Number(row.page_no)).filter(n=>Number.isInteger(n)&&n>=1&&n<=pdfs.inspect(record.snapshotId).pageCount))]:method==='search_pdf'?[...new Set(value.matches.map(p=>p.page))]:['read_pdf','expand_pdf'].includes(method)?[...new Set(value.pages.map(p=>p.page))]:method==='render_pdf_page'?[args.page]:[];
      if(['read_pdf','expand_pdf'].includes(method)||method==='render_pdf_page'&&value.imageReturned)recordEvidence(record.evidence,method,value,args);
      if(['read_pdf','expand_pdf'].includes(method)){event.characters=value.characters;event.passages=value.pages.map(p=>({passageId:p.passageId,start:p.start,end:p.end}));if(args.reason)event.reason=args.reason;}
      if(method==='render_pdf_page'){event.image={...value.metadata,imageRef:value.imageRef,delivery:value.delivery};if(args.resend)event.reason=args.reason;}
      await recordDelivery(record,method,args,value);
      if(!enabled||records.get(record.selectionId)!==record)throw new UserError('PDF 공유가 종료되었습니다.',410);
      revision++;await persist();return {selectionId:record.selectionId,fileName:record.fileName,...value};
    }catch(error){event.state='error';if(['read_pdf','expand_pdf','render_pdf_page','search_pdf','query_pdf'].includes(method))appendDelivery(records,record,{id:randomUUID(),at:new Date(now()).toISOString(),method,state:'error',items:[],error:'도구 결과를 반환하지 못했습니다.'});revision++;throw error;}
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
    restore,
    deliveries(documentId,selectionId){
      prune();trimImages();
      if(typeof documentId!=='string'||!documentId||documentId.length>160)throw new UserError('자료 전달 기록의 문서를 확인하세요.');
      const shares=[...records.values()].filter(record=>record.documentId===documentId);
      const result={meaning:'Reader 도구 결과 반환 기록입니다. ChatGPT의 최종 수신·실제 열람·현재 기억 상태는 확인할 수 없습니다.',limits:{perShare:DELIVERY_LIMIT,total:TOTAL_DELIVERY_LIMIT,imageBytes:IMAGE_CACHE_LIMIT,hours:24},shares:shares.map(record=>({selectionId:record.selectionId,fileName:record.fileName,question:record.question.slice(0,180),createdAt:record.createdAt,count:record.deliveries?.length||0,dropped:record.deliveryDropped||0}))};
      if(selectionId){const record=getRecord(selectionId);if(record.documentId!==documentId)throw new UserError('다른 문서의 자료 전달 기록입니다.',409);result.selectionId=selectionId;result.events=structuredClone(record.deliveries||[]);result.dropped=record.deliveryDropped||0;}
      return result;
    },
    async deliveryImage(documentId,selectionId,eventId){
      const record=getRecord(selectionId);if(record.documentId!==documentId)throw new UserError('다른 문서의 전달 이미지입니다.',409);
      const item=record.deliveries?.find(event=>event.id===eventId)?.items.find(item=>item.kind==='image'&&item.sha256);
      if(!item)throw new UserError('이 항목에는 전달한 PNG가 없습니다. 참조 응답은 이미지 바이트를 포함하지 않습니다.',404);
      let bytes=deliveredImages.get(item.sha256);try{bytes??=await archive?.readImage?.(item.sha256);}catch{}
      if(!bytes||createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new UserError('보관 한도 또는 캐시 오류로 당시 PNG를 열 수 없습니다. 페이지·영역·해시 기록은 남아 있습니다. 다른 이미지로 대체하지 않았습니다.',410);
      // Inspection is local only: never render/resend a new image or mutate usage.
      return {mimeType:'image/png',data:bytes.toString('base64'),sha256:item.sha256,bytes:bytes.length};
    },
    question(selectionId,documentId,question){const record=getRecord(selectionId);if(record.documentId!==documentId || record.question!==question)throw new UserError('질문 기록과 Link 공유 문서가 일치하지 않습니다.',409);return record.saved?{selectionId,documentId,annotationId:record.saved.id,note:record.saved.note}:null;},
    authorize(header){
      if(!enabled || typeof header!=='string')return false;
      const supplied=Buffer.from(header),expected=Buffer.from('Bearer '+token);
      return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
    },
    status(){prune();const latest=[...records.values()].at(-1);return {pdfAvailable:!!pdfs?.available,enabled,revision,sharedCount:records.size,lastContactAt,restoredCount:[...records.values()].filter(record=>record.restored).length,archiveError,restorable:!!archive,latest:latest?{selectionId:latest.selectionId,documentId:latest.documentId,fileName:latest.fileName,pages:latest.anchors.map(a=>a.page),trace:structuredClone(latest.trace),saved:!!latest.saved,annotationId:latest.saved?.id||null,historyError:!!latest.historyError}:null};},
    setEnabled:value=>serial(async()=>{if(typeof value!=='boolean')throw new UserError('연결 설정이 올바르지 않습니다.');await (value?enable():disable());if(!value)archiveError=null;return {enabled};}),
    share:value=>serial(async()=>{
      const selection=validateSelection(value);prune();
      if(archive&&selection.snapshotId&&new Set([...records.values()].map(record=>record.snapshotId).filter(Boolean).concat(selection.snapshotId)).size>3)throw new UserError('복원 가능한 PDF 공유는 최대 3개입니다. 문맥 설정의 연결 해제로 이전 공유를 지운 뒤 다시 공유하세요.',409);
      if(records.size>=100)throw new UserError('공유 문장이 100개입니다. Link 연결을 해제한 뒤 다시 시작하세요.',409);
      await enable();
      const timestamp=now(),selectionId=randomUUID(),record={...selection,selectionId,timestamp,createdAt:new Date(timestamp).toISOString(),expiresAt:new Date(timestamp+DAY).toISOString(),saved:null,trace:[],images:new Map(),textReads:new Map(),evidence:{snapshotId:selection.snapshotId,pages:[],truncated:false}};
      if(selection.snapshotId){if(typeof selection.snapshotId!=='string'||!/^[a-f\d]{64}$/.test(selection.snapshotId)||!pdfs)throw new UserError('PDF 고정본 ID를 확인하세요.');pdfs.pin(selection.snapshotId,selection.documentId,selectionId);}
      if(selection.snapshotId)record.textQuality=pdfs.inspect?.(selection.snapshotId).textQuality;
      if(archive&&selection.snapshotId)try{await archive.putPdf(selection.snapshotId,pdfs.source(selection.snapshotId));pdfs.discardSource?.(selection.snapshotId);}catch{record.cacheFailure=true;}
      records.set(selectionId,record);revision++;await persist();return snapshot(record);
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
        const item=await (await annotations).upsert(record.documentId,{creationId:record.selectionId,quote:record.quote,note,color:'blue',rotation:record.rotation,anchors:record.anchors,...(record.evidence.pages.length?{evidence:record.evidence}:{})});
        record.saved=item;revision++;
        const historyUpdated=await syncQuestion(record);await persist();
        return {selectionId:record.selectionId,annotationId:item.id,saved:true,pages:record.anchors.map(a=>a.page),historyUpdated};
      }
      throw new UserError('지원하지 않는 Link 도구입니다.',404);
    }),
    close:()=>{clearInterval(expiryTimer);return closePromise??=serial(()=>disable({preserve:!!archive}));},
    flush:async()=>{await queue;await archive?.flush();}
  };
}
