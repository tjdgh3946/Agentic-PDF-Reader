import {open,readFile,rename,unlink,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {UserError} from './auth.mjs';

// A committed primary plus a verified backup. IO failures are never mistaken
// for malformed JSON or an empty collection. Callers serialize transactions.
export function createReliableJson(directory,label){
  const events=new Map();
  const notice=(file,state,message)=>events.set(path.basename(file),{file:path.basename(file),state,message});
  async function atomic(file,text){
    const temporary=file+'.tmp';let handle;
    try{handle=await open(temporary,'w',0o600);await handle.writeFile(text);await handle.sync();await handle.close();handle=null;await rename(temporary,file);}
    finally{await handle?.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
  }
  async function candidate(file,validate){
    let text;try{text=await readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')return {missing:true};throw error;}
    try{const value=JSON.parse(text);if(!validate(value))throw Error('schema');return {value,text};}
    catch{return {invalid:true};}
  }
  async function quarantine(file){const target=file+'.corrupt-'+Date.now()+'-'+randomUUID();await rename(file,target);return path.basename(target);}
  const ioError=(file)=>{notice(file,'error',label+' 저장 파일에 접근하지 못했습니다. 다른 프로그램의 파일 잠금과 디스크 여유 공간을 확인한 뒤 다시 시도하세요.');return new UserError(label+' 파일을 읽거나 저장하지 못했습니다. 작성 내용은 현재 창에 보관됩니다. 잠금·디스크 여유 공간을 확인하고 다시 저장하거나 내용을 복사하세요.',503);};
  async function read(file,validate,fallback){
    try{
      // A durable deletion marker prevents old backups from reviving deleted chats.
      try{await readFile(file+'.deleted');for(const target of [file,file+'.bak'])await unlink(target).catch(()=>{});return fallback;}catch(error){if(error.code!=='ENOENT')throw error;}
      const primary=await candidate(file,validate);
      if(primary.value!==undefined){
        try{
          const backup=await candidate(file+'.bak',validate);
          if(backup.invalid)await quarantine(file+'.bak');
          if(backup.text!==primary.text)await atomic(file+'.bak',primary.text);
          if(['error','warning'].includes(events.get(path.basename(file))?.state))events.delete(path.basename(file));
        }catch{notice(file,'warning',label+'은 열었지만 백업 갱신에 실패했습니다. 디스크·파일 잠금을 확인하세요.');}
        return primary.value;
      }
      const backup=await candidate(file+'.bak',validate);
      if(primary.invalid)await quarantine(file);
      if(backup.invalid)await quarantine(file+'.bak');
      if(backup.value!==undefined){
        await atomic(file,backup.text);notice(file,'recovered',label+'을 정상 백업에서 복원했습니다. 최근 내용이 맞는지 확인하세요.');return backup.value;
      }
      if(primary.invalid||backup.invalid)notice(file,'quarantined',label+'의 손상 파일을 별도로 보관했습니다. 정상 백업을 찾지 못했으며, 다른 정상 기록은 계속 사용할 수 있습니다.');
      return fallback;
    }catch{throw ioError(file);}
  }
  async function write(file,value,validate,{deleting=false}={}){
    const text=JSON.stringify(value);if(!validate(value))throw new Error('Invalid '+label+' state');
    try{
      let previous=await candidate(file,validate);
      if(previous.invalid){await read(file,validate,null);previous=await candidate(file,validate);}
      if(deleting)await unlink(file+'.bak').catch(error=>{if(error.code!=='ENOENT')throw error;});
      else if(previous.text!==undefined)await atomic(file+'.bak',previous.text);
      await atomic(file,text);
    }catch{throw ioError(file);}
    // The primary is committed. A secondary backup failure must not turn a
    // successful save into an ambiguous failure and encourage duplicate notes.
    try{await atomic(file+'.bak',text);if(events.get(path.basename(file))?.state==='error')events.delete(path.basename(file));}
    catch{notice(file,'warning',label+'은 저장됐지만 백업 갱신에 실패했습니다. 디스크·파일 잠금을 확인하세요.');}
  }
  return {
    read,write,
    async remove(file){
      try{await atomic(file+'.deleted','deleted\n');}catch{throw ioError(file);}
      // Logical deletion is committed before best-effort physical cleanup.
      for(const target of [file,file+'.bak'])try{await unlink(target);}catch(error){if(error.code!=='ENOENT')notice(file,'warning','삭제한 '+label+'의 파일 정리가 지연됐습니다. 삭제 표시가 유지되어 복구로 다시 나타나지 않습니다.');}
    },
    async status(){
      const files=await readdir(directory).catch(()=>[]),quarantined=files.filter(file=>file.includes('.corrupt-')).length;
      return {label,quarantined,notices:[...events.values()]};
    }
  };
}
