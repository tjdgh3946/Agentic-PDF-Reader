import {mkdir,readFile,writeFile,rename,readdir,unlink,stat} from 'node:fs/promises';
import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import path from 'node:path';

// Only explicitly shared material is cached. The random AES key is wrapped by
// Electron safeStorage (Windows DPAPI); neither PDF bytes nor prompts are plaintext.
export function createShareArchive(directory,secureStorage){
  let key,blocked=false,queue=Promise.resolve();
  const valid=id=>typeof id==='string'&&/^[a-f\d]{64}$/.test(id);
  const atomic=async(file,bytes)=>{await writeFile(file+'.tmp',bytes,{mode:0o600});await rename(file+'.tmp',file);};
  async function unlock(){
    if(blocked)throw Error('공유 복원 캐시를 읽지 못했습니다. Link 연결 해제로 캐시를 지운 뒤 다시 공유하세요.');
    if(key)return key;
    try{
      if(!secureStorage?.isEncryptionAvailable())throw Error('Windows 암호화를 사용할 수 없습니다.');
      await mkdir(directory,{recursive:true});
      try{key=Buffer.from(secureStorage.decryptString(await readFile(path.join(directory,'key.bin'))),'base64');}
      catch(error){
        if(error.code!=='ENOENT')throw error;
        const files=await readdir(directory);
        if(files.some(file=>file.endsWith('.enc')))throw Error('공유 캐시 암호화 키가 없습니다.');
        key=randomBytes(32);await atomic(path.join(directory,'key.bin'),secureStorage.encryptString(key.toString('base64')));
      }
      if(key.length!==32)throw Error('공유 캐시 키 형식 오류');
      return key;
    }catch{key=null;blocked=true;throw Error('공유 복원 캐시를 읽지 못했습니다. Link 연결 해제로 캐시를 지운 뒤 다시 공유하세요.');}
  }
  async function encrypt(bytes){const secret=await unlock(),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,iv);const output=Buffer.concat([cipher.update(bytes),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),output]);}
  async function decrypt(file,max){
    const secret=await unlock(),info=await stat(file);if(info.size>max+28||info.size<28)throw Error('공유 캐시 크기 오류');
    const bytes=await readFile(file),decipher=createDecipheriv('aes-256-gcm',secret,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]);
  }
  const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
  return {
    load:()=>serial(async()=>{
      await unlock();let data;
      try{data=JSON.parse((await decrypt(path.join(directory,'shares.enc'),16*1024*1024)).toString('utf8'));}
      catch(error){if(error.code==='ENOENT')return [];blocked=true;throw error;}
      if(data.version!==1||!Array.isArray(data.records)||data.records.length>100){blocked=true;throw Error('공유 캐시 형식 오류');}
      return data.records;
    }),
    putPdf:(id,bytes)=>serial(async()=>{
      if(!valid(id))throw Error('공유 PDF 검증 오류');
      const file=path.join(directory,id+'.enc');
      try{await stat(file);return;}catch(error){if(error.code!=='ENOENT')throw error;}
      if(!Buffer.isBuffer(bytes)||bytes.length>64*1024*1024||createHash('sha256').update(bytes).digest('hex')!==id)throw Error('공유 PDF 검증 오류');
      await atomic(file,await encrypt(bytes));
    }),
    readPdf:id=>serial(async()=>{
      if(!valid(id))throw Error('공유 PDF ID 오류');
      const bytes=await decrypt(path.join(directory,id+'.enc'),64*1024*1024);
      if(createHash('sha256').update(bytes).digest('hex')!==id)throw Error('공유 PDF 검증 오류');
      return bytes;
    }),
    putImage:(id,bytes)=>serial(async()=>{
      if(!valid(id)||!Buffer.isBuffer(bytes)||bytes.length>17*1024*1024||createHash('sha256').update(bytes).digest('hex')!==id)throw Error('전달 이미지 검증 오류');
      const file=path.join(directory,id+'.image.enc');
      try{await stat(file);return;}catch(error){if(error.code!=='ENOENT')throw error;}
      const files=await Promise.all((await readdir(directory)).filter(name=>/^[a-f\d]{64}\.image\.enc$/.test(name)).map(async name=>({name,...await stat(path.join(directory,name))})));
      let size=files.reduce((n,file)=>n+file.size,0);
      for(const old of files.sort((a,b)=>a.mtimeMs-b.mtimeMs)){if(size+bytes.length+28<=32*1024*1024)break;await unlink(path.join(directory,old.name));size-=old.size;}
      await atomic(file,await encrypt(bytes));
    }),
    readImage:id=>serial(async()=>{
      if(!valid(id))throw Error('전달 이미지 ID 오류');
      const bytes=await decrypt(path.join(directory,id+'.image.enc'),17*1024*1024);
      if(createHash('sha256').update(bytes).digest('hex')!==id)throw Error('전달 이미지 검증 오류');
      return bytes;
    }),
    save:records=>serial(async()=>{
      const bytes=Buffer.from(JSON.stringify({version:1,records}));if(bytes.length>16*1024*1024)throw Error('공유 복원 캐시 한도 초과');
      await atomic(path.join(directory,'shares.enc'),await encrypt(bytes));
      const keep=new Set(records.map(record=>record.snapshotId).filter(valid));
      for(const file of await readdir(directory))if(/^[a-f\d]{64}\.enc$/.test(file)&&!keep.has(file.slice(0,64)))await unlink(path.join(directory,file));
      const images=new Set(records.flatMap(record=>(record.deliveries||[]).flatMap(event=>(event.items||[]).map(item=>item.sha256))).filter(valid));
      for(const file of await readdir(directory))if(/^[a-f\d]{64}\.image\.enc$/.test(file)&&!images.has(file.slice(0,64)))await unlink(path.join(directory,file));
    }),
    clear:()=>serial(async()=>{
      await mkdir(directory,{recursive:true});
      for(const file of await readdir(directory))if(/^(?:[a-f\d]{64}(?:\.image)?\.enc|shares\.enc|key\.bin)(?:\.tmp)?$/.test(file))await unlink(path.join(directory,file));
      key?.fill(0);key=null;blocked=false;
    }),
    flush:()=>queue
  };
}
