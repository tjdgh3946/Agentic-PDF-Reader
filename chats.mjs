import {mkdir,readdir} from 'node:fs/promises';
import {createReliableJson} from './reliable-json.mjs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {UserError} from './auth.mjs';

// One atomic file per conversation, outside the application bundle.
export async function createChats(directory) {
  const records=new Map(),disk=directory?createReliableJson(directory,'질문 기록'):null;
  const valid=(id,chat)=>chat?.id===id&&typeof chat.documentId==='string'&&typeof chat.fileName==='string'&&typeof chat.createdAt==='string'&&typeof chat.updatedAt==='string'&&Array.isArray(chat.entries)&&chat.entries.every(entry=>typeof entry?.id==='string'&&typeof entry.question==='string'&&typeof entry.selection==='string'&&typeof entry.pageLabel==='string'&&typeof entry.answer==='string'&&typeof entry.status==='string'&&typeof entry.createdAt==='string');
  async function loadMissing(){
    if(!directory)return;
    await mkdir(directory,{recursive:true});
    const names=new Set((await readdir(directory)).filter(name=>/^[\da-f-]{36}\.json(?:\.bak)?$/.test(name)).map(name=>name.replace(/\.bak$/,'')));
    for(const name of names){
      const id=name.slice(0,-5);if(records.has(id))continue;let chat;
      try{chat=await disk.read(path.join(directory,name),data=>valid(id,data),null);}catch{continue;}
      if(!chat)continue;
      for(const entry of chat.entries)if(entry.status==='pending')entry.status='interrupted';
      records.set(chat.id,chat);
    }
  }

  await loadMissing();
  let queue=Promise.resolve();
  const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
  const copy=value=>structuredClone(value);
  const get=id=>{const chat=records.get(id);if(!chat)throw new UserError('저장된 대화를 찾을 수 없습니다.',404);return chat;};
  async function save(chat) {
    chat.updatedAt=new Date().toISOString();
    if(directory) {
      await disk.write(path.join(directory,chat.id+'.json'),chat,data=>valid(chat.id,data));
    }
    records.set(chat.id,chat);
    return copy(chat);
  }
  return {
    retryRecovery:()=>serial(loadMissing),
    list:()=>serial(()=>[...records.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(({entries,...chat})=>({...chat,count:entries.length}))),
    get:id=>serial(()=>copy(get(id))),
    create:input=>serial(()=>{
      if(typeof input?.documentId!=='string'||!input.documentId||input.documentId.length>200||typeof input.fileName!=='string'||input.fileName.length>1000)throw new UserError('문서 정보가 필요합니다.');
      return save({id:randomUUID(),documentId:input.documentId,fileName:input.fileName,createdAt:new Date().toISOString(),entries:[]});
    }),
    begin:(id,input)=>serial(()=>{
      const chat=copy(get(id));
      for(const key of ['question','selection','pageLabel'])if(typeof input?.[key]!=='string')throw new UserError('대화 정보가 올바르지 않습니다.');
      if(input.clientEntryId!==undefined){
        if(typeof input.clientEntryId!=='string'||!/^[a-f\d-]{36}$/i.test(input.clientEntryId))throw new UserError('질문 기록 요청 ID를 확인하세요.');
        const previous=chat.entries.find(entry=>entry.id===input.clientEntryId);
        if(previous){if(['question','selection','pageLabel'].some(key=>previous[key]!==input[key]))throw new UserError('기록 요청과 질문이 일치하지 않습니다.',409);return copy(previous);}
      }
      if(input.linkSelectionId!==undefined){
        if(!input.exported || typeof input.linkSelectionId!=='string' || !/^[a-f\d-]{36}$/i.test(input.linkSelectionId))throw new UserError('Link 질문 ID를 확인하세요.');
        const existing=chat.entries.find(entry=>entry.linkSelectionId===input.linkSelectionId);
        if(existing)return copy(existing);
      }
      const entry={id:input.clientEntryId||randomUUID(),question:input.question,selection:input.selection,pageLabel:input.pageLabel,pdfWindow:String(input.pdfWindow||''),pages:Array.isArray(input.pages)?input.pages.filter(Number.isInteger):[],historyCount:Number(input.historyCount)||0,model:String(input.model||''),test:input.test===true,answer:'',status:input.exported?'exported':'pending',createdAt:new Date().toISOString()};
      if(input.autoContext && typeof input.autoContext.reason==='string')entry.autoContext={source:input.autoContext.source==='agent'?'agent':'local',reason:input.autoContext.reason.slice(0,1000),budget:Number(input.autoContext.budget)||8000,agentUsage:input.autoContext.agentUsage || null,selectorEstimate:input.autoContext.selectorEstimate || null};
      if(input.linkSelectionId)entry.linkSelectionId=input.linkSelectionId;
      chat.entries.push(entry);return save(chat).then(()=>copy(entry));
    }),
    update:(id,entryId,answer,status,usage=null)=>serial(async()=>{
      // A late stream must never recreate an explicitly deleted conversation.
      if(!records.has(id))return false;
      const chat=copy(get(id)),entry=chat.entries.find(item=>item.id===entryId);
      if(!entry)return false;
      entry.answer=answer;entry.status=status;if(usage)entry.usage=usage;await save(chat);return true;
    }),
    importAnswer:(id,entryId,answer)=>serial(async()=>{
      if(typeof answer!=='string' || !answer.trim() || answer.length>200000)throw new UserError('답변은 1~200,000자로 입력하세요.');
      const chat=copy(get(id)),entry=chat.entries.find(item=>item.id===entryId);
      if(!entry || (entry.status!=='exported' && entry.source!=='chatgpt-web'))throw new UserError('ChatGPT로 복사한 질문에만 답변을 저장할 수 있습니다.',409);
      entry.answer=answer.trim();entry.status='complete';entry.source='chatgpt-web';
      await save(chat);return copy(entry);
    }),
    completeLink:({selectionId,documentId,annotationId,note})=>serial(async()=>{
      let matched=0;
      for(const record of records.values()){
        if(record.documentId!==documentId)continue;
        const chat=copy(record);let changed=false;
        for(const entry of chat.entries){
          if(entry.linkSelectionId!==selectionId || !['exported','complete'].includes(entry.status) || (entry.status==='complete' && entry.source!=='chatgpt-link'))continue;
          matched++;
          if(entry.source==='chatgpt-link' && entry.annotationId===annotationId && entry.answer===note)continue;
          entry.status='complete';entry.source='chatgpt-link';entry.answer=note;entry.annotationId=annotationId;changed=true;
        }
        if(changed)await save(chat);
      }
      return matched>0;
    }),
    delete:id=>serial(async()=>{
      get(id);
      if(directory)await disk.remove(path.join(directory,id+'.json'));
      records.delete(id);return {deleted:true};
    }),
    storageStatus:()=>disk?.status()||{label:'질문 기록',quarantined:0,notices:[]},
    flush:()=>queue
  };
}
