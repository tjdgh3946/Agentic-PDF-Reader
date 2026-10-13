import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {UserError} from './auth.mjs';

export function validateQuery(sql,params=[]){
  if(typeof sql!=='string' || !sql.trim() || sql.length>6000)throw new UserError('SQL은 1~6,000자로 작성하세요.');
  // Split SQL tokens without mistaking a quoted semicolon for a new statement.
  const tokens=[];let i=0;
  while(i<sql.length){
    const rest=sql.slice(i);let match;
    if((match=/^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)/.exec(rest))){i+=match[0].length;continue;}
    if((match=/^(?:'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\])/.exec(rest))){tokens.push('quoted');i+=match[0].length;continue;}
    if((match=/^[a-z_][a-z_0-9]*/i.exec(rest))){tokens.push(match[0].toLowerCase());i+=match[0].length;continue;}
    tokens.push(rest[0]);i++;
  }
  if(!['select','with'].includes(tokens[0]) || tokens.filter(t=>t===';').length>1 || (tokens.includes(';') && tokens.at(-1)!==';'))throw new UserError('단일 읽기 전용 SELECT/CTE만 사용할 수 있습니다.');
  if(tokens.some(t=>['pragma','attach','detach','insert','update','delete','create','drop','alter','vacuum','reindex','load_extension','readfile','writefile'].includes(t)))throw new UserError('파일 접근·쓰기·PRAGMA SQL은 허용하지 않습니다.');
  if(!params || typeof params!=='object' || Object.keys(params).length>30 || Object.values(params).some(v=>v!==null && typeof v!=='string' && typeof v!=='number') || Object.values(params).some(v=>typeof v==='string' && v.length>2000 || typeof v==='number' && !Number.isFinite(v)))throw new UserError('SQL 파라미터를 확인하세요. 최대 30개, 문자열 2,000자까지 가능합니다.');
  return {sql,params};
}

export function createQueryIndex(pages,{timeout=1500,idleTimeout=30000}={}){
  let worker=null,ready=null,closed=false,serial=Promise.resolve(),id=0,idleTimer,queued=0;
  const pending=new Map();
  function idle(){clearTimeout(idleTimer);if(closed||queued||pending.size||!worker)return;idleTimer=setTimeout(()=>{if(!queued&&!pending.size)stop();},idleTimeout);idleTimer.unref?.();}
  function start(){
    if(closed)throw new UserError('PDF 공유가 종료되었습니다.',410);
    if(ready)return ready;
    const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:'--max-old-space-size=192'};
    worker=fork(fileURLToPath(new URL('./pdf-query-worker.mjs',import.meta.url)),[],{execPath:process.execPath,execArgv:[],env,stdio:['ignore','ignore','ignore','ipc']});
    const active=worker;
    ready=new Promise((resolve,reject)=>{
      const boot=setTimeout(()=>{reject(new UserError('PDF 색인 시간이 초과되었습니다.'));stop();},15000);
      active.on('message',message=>{
        if(message.ready){clearTimeout(boot);resolve();idle();return;}
        const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);
        message.error?item.reject(new UserError(message.error)):item.resolve(message.value);
      });
      active.on('error',error=>{clearTimeout(boot);reject(new UserError('PDF 검색 런타임을 확인하세요: '+error.message));if(worker===active)stop();});
      active.on('exit',code=>{clearTimeout(boot);reject(new UserError('PDF 검색 프로세스가 종료되었습니다.'));if(worker===active)stop();});
    });
    worker.send({pages});
    return ready;
  }
  function stop(){clearTimeout(idleTimer);const old=worker;worker=null;ready=null;old?.kill();for(const item of pending.values()){clearTimeout(item.timer);item.reject(new UserError('SQL 작업이 중단되었습니다. 다시 검색하세요.',408));}pending.clear();}
  return {
    ready:start,
    query(sql,params){const input=validateQuery(sql,params);queued++;clearTimeout(idleTimer);const job=serial.then(async()=>{
      await start();if(closed)throw new UserError('PDF 공유가 종료되었습니다.',410);
      return new Promise((resolve,reject)=>{const request=++id;const timer=setTimeout(()=>{pending.delete(request);reject(new UserError('SQL 검색 제한 시간 1.5초를 넘었습니다. 검색 범위를 줄이세요.',408));stop();},timeout);pending.set(request,{resolve,reject,timer});worker.send({id:request,...input});});
    }).finally(()=>{queued--;idle();});serial=job.catch(()=>{});return job;},
    get resident(){return !!worker;},
    close(){closed=true;stop();}
  };
}
