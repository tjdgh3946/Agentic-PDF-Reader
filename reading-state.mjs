import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {UserError} from './auth.mjs';

const validId=id=>typeof id==='string' && /^[a-f\d-]{1,200}$/i.test(id);
const validState=value=>value && Number.isInteger(value.page) && value.page>=1 && value.page<=100000
  && (['auto','page-fit','page-width','page-actual'].includes(value.zoom) || typeof value.zoom==='number' && value.zoom>=.1 && value.zoom<=10)
  && [0,90,180,270].includes(value.rotation) && typeof value.question==='string' && value.question.length<=10000;

// Stored by PDF fingerprint, independently of the localhost port or EXE version.
export async function createReadingState(file){
  let entries=new Map(),queue=Promise.resolve();
  if(file)try{const data=JSON.parse(await readFile(file,'utf8'));if(data && typeof data==='object' && !Array.isArray(data))entries=new Map(Object.entries(data).filter(([id,value])=>validId(id)&&validState(value)).slice(-64).map(([id,value])=>[id,{page:value.page,zoom:value.zoom,rotation:value.rotation,question:value.question}]));}
  catch(error){if(error.code!=='ENOENT' && !(error instanceof SyntaxError))throw error;}
  return {
    get(id){if(!validId(id))throw new UserError('PDF 식별자가 올바르지 않습니다.');return structuredClone(entries.get(id)||null);},
    set(id,value){
      if(!validId(id)||!validState(value))throw new UserError('읽던 위치와 질문을 확인하세요. 질문은 10,000자까지 저장합니다.');
      const state={page:value.page,zoom:value.zoom,rotation:value.rotation,question:value.question};
      const operation=queue.then(async()=>{
        const next=new Map(entries);next.delete(id);next.set(id,state);while(next.size>64)next.delete(next.keys().next().value);
        if(file){await mkdir(path.dirname(file),{recursive:true});await writeFile(file+'.tmp',JSON.stringify(Object.fromEntries(next)),'utf8');await rename(file+'.tmp',file);}
        entries=next;return structuredClone(state);
      });queue=operation.catch(()=>{});return operation;
    },
    flush:()=>queue
  };
}
