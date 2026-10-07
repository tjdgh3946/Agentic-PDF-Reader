import {mkdir,readdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {UserError} from './auth.mjs';

// One atomic file per conversation, outside the application bundle.
export async function createChats(directory) {
  const records=new Map();
  if(directory) {
    await mkdir(directory,{recursive:true});
    for(const name of await readdir(directory)) {
      if(!/^[\da-f-]{36}\.json$/.test(name))continue;
      const chat=JSON.parse(await readFile(path.join(directory,name),'utf8'));
      if(chat.id+'.json'!==name || !Array.isArray(chat.entries))throw new Error('Invalid saved conversation');
      for(const entry of chat.entries)if(entry.status==='pending')entry.status='interrupted';
      records.set(chat.id,chat);
    }
  }
  let queue=Promise.resolve();
  const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
  const copy=value=>structuredClone(value);
  const get=id=>{const chat=records.get(id);if(!chat)throw new UserError('저장된 대화를 찾을 수 없습니다.',404);return chat;};
  async function save(chat) {
    chat.updatedAt=new Date().toISOString();
    if(directory) {
      const file=path.join(directory,chat.id+'.json');
      await writeFile(file+'.tmp',JSON.stringify(chat),'utf8');
      await rename(file+'.tmp',file);
    }
    records.set(chat.id,chat);
    return copy(chat);
  }
  return {
    list:()=>serial(()=>[...records.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(({entries,...chat})=>({...chat,count:entries.length}))),
    get:id=>serial(()=>copy(get(id))),
    create:input=>serial(()=>{
      if(typeof input?.documentId!=='string'||!input.documentId||input.documentId.length>200||typeof input.fileName!=='string'||input.fileName.length>1000)throw new UserError('문서 정보가 필요합니다.');
      return save({id:randomUUID(),documentId:input.documentId,fileName:input.fileName,createdAt:new Date().toISOString(),entries:[]});
    }),
    begin:(id,input)=>serial(()=>{
      const chat=copy(get(id));
      for(const key of ['question','selection','pageLabel'])if(typeof input?.[key]!=='string')throw new UserError('대화 정보가 올바르지 않습니다.');
      const entry={id:randomUUID(),question:input.question,selection:input.selection,pageLabel:input.pageLabel,pdfWindow:String(input.pdfWindow||''),pages:Array.isArray(input.pages)?input.pages.filter(Number.isInteger):[],historyCount:Number(input.historyCount)||0,model:String(input.model||''),test:input.test===true,answer:'',status:input.exported?'exported':'pending',createdAt:new Date().toISOString()};
      if(input.autoContext && typeof input.autoContext.reason==='string')entry.autoContext={source:input.autoContext.source==='agent'?'agent':'local',reason:input.autoContext.reason.slice(0,1000),budget:Number(input.autoContext.budget)||8000,agentUsage:input.autoContext.agentUsage || null,selectorEstimate:input.autoContext.selectorEstimate || null};
      chat.entries.push(entry);return save(chat).then(()=>copy(entry));
    }),
    update:(id,entryId,answer,status,usage=null)=>serial(async()=>{
      // A late stream must never recreate an explicitly deleted conversation.
      if(!records.has(id))return false;
      const chat=copy(get(id)),entry=chat.entries.find(item=>item.id===entryId);
      if(!entry)return false;
      entry.answer=answer;entry.status=status;if(usage)entry.usage=usage;await save(chat);return true;
    }),
    delete:id=>serial(async()=>{
      get(id);
      if(directory)await unlink(path.join(directory,id+'.json'));
      records.delete(id);return {deleted:true};
    }),
    flush:()=>queue
  };
}
