import {UserError} from './auth.mjs';

// Retain bounded immutable PDF bytes only while the snapshot is shared. A lost
// hidden renderer can be rebuilt without asking the user to upload/share again.
export function withRendererRecovery(backend,{idleTimeout=30000,maxResident=1,releaseAfterLoad=false}={}){
  const records=new Map();let closed=false;
  const current=(id,record)=>{if(closed||records.get(id)!==record)throw new UserError('PDF 공유가 종료되었습니다.',410);};
  function suspend(id,record){clearTimeout(record.timer);record.timer=null;if(records.get(id)===record&&!record.active)backend.release(id);}
  function trim(except){
    const idle=[...records].filter(([id,r])=>id!==except&&!r.active&&backend.has(id)).sort((a,b)=>a[1].touched-b[1].touched);
    while([...records.keys()].filter(id=>backend.has(id)).length>=maxResident&&idle.length){const [id,r]=idle.shift();suspend(id,r);}
  }
  function idle(id,record){
    if(closed||records.get(id)!==record||record.active)return;
    trim(id);
    record.touched=Date.now();clearTimeout(record.timer);
    record.timer=setTimeout(()=>suspend(id,record),idleTimeout);record.timer.unref?.();
  }
  async function reload(id,record){
    current(id,record);
    trim(id);
    const loaded=await backend.load(id,record.bytes,record.limits,{extractText:!record.loaded});
    current(id,record);
    const identity={documentId:loaded.documentId,pageCount:loaded.pageCount??loaded.pages.length};
    if(record.loaded&&(identity.documentId!==record.loaded.documentId||identity.pageCount!==record.loaded.pageCount))throw new UserError('복구된 PDF가 원래 고정본과 일치하지 않습니다.',409);
    record.loaded=identity;return loaded;
  }
  return {
    async load(id,bytes,limits){
      if(closed)throw new UserError('PDF 처리기가 종료되었습니다.',410);
      const record={bytes:Buffer.from(bytes),limits:{...limits},chain:Promise.resolve(),active:1,touched:Date.now()};records.set(id,record);
      try{return await reload(id,record);}catch(error){if(records.get(id)===record){records.delete(id);backend.release(id);}throw error;}
      finally{record.active--;if(releaseAfterLoad)suspend(id,record);else idle(id,record);}
    },
    render(id,page,region){
      const record=records.get(id);if(!record)return Promise.reject(new UserError('PDF 렌더 고정본이 없습니다.',410));
      record.active++;clearTimeout(record.timer);
      const operation=record.chain.then(async()=>{
        current(id,record);if(!backend.has(id))await reload(id,record);
        let value;
        try{value=await backend.render(id,page,region);}
        catch(error){current(id,record);if(backend.has(id)||![408,410].includes(error.status))throw error;await reload(id,record);value=await backend.render(id,page,region);}
        current(id,record);return value;
      }).finally(()=>{record.active--;idle(id,record);});record.chain=operation.catch(()=>{});return operation;
    },
    get residentCount(){return [...records.keys()].filter(id=>backend.has(id)).length;},
    release(id){clearTimeout(records.get(id)?.timer);records.delete(id);backend.release(id);},
    close(){closed=true;for(const record of records.values())clearTimeout(record.timer);records.clear();backend.close();}
  };
}
