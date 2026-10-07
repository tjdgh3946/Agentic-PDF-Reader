import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline';
import {access,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {UserError} from './auth.mjs';

const execute=promisify(execFile);
async function findCodex() {
  try {
    const {stdout}=await execute('where.exe',['codex.exe'],{windowsHide:true,timeout:5000});
    for(const candidate of stdout.trim().split(/\r?\n/)) {
      if(path.isAbsolute(candidate) && path.basename(candidate).toLowerCase()==='codex.exe') {await access(candidate);return candidate;}
    }
  } catch {}
  if(process.env.LOCALAPPDATA) {
    const root=path.join(process.env.LOCALAPPDATA,'OpenAI','Codex','bin');
    try {
      const candidates=[];
      for(const entry of await readdir(root,{withFileTypes:true})) {
        if(!entry.isDirectory())continue;
        const file=path.join(root,entry.name,'codex.exe');
        try {candidates.push({file,mtime:(await stat(file)).mtimeMs});}catch{}
      }
      candidates.sort((a,b)=>b.mtime-a.mtime);
      if(candidates.length)return candidates[0].file;
    }catch{}
  }
  throw new UserError('사용량 조회에는 이 PC의 Codex 설치와 ChatGPT 로그인이 필요합니다. Codex를 실행해 로그인하거나 아래 공식 사용량 링크를 이용하세요.',503);
}

export async function queryCodex(executable,{spawnProcess=spawn,timeoutMs=25000}={}) {
  // Only account reads are issued: no conversation, inference, login or reset operation.
  const child=spawnProcess(executable,['app-server','--listen','stdio://'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const pending=new Map();let nextId=0,ended=false;
  const failAll=message=>{ended=true;for(const task of pending.values())task.reject(new UserError(message,502));pending.clear();};
  child.on('error',()=>failAll('Codex 사용량 조회 도구를 시작하지 못했습니다. Codex 설치 상태를 확인하세요.'));
  child.on('exit',()=>failAll('Codex 사용량 조회 연결이 종료되었습니다. 다시 시도하세요.'));
  child.stdin.on('error',()=>failAll('사용량 조회 도구와 통신하지 못했습니다.'));
  child.stderr.resume();
  const lines=createInterface({input:child.stdout});
  lines.on('line',line=>{
    let message;try{message=JSON.parse(line);}catch{return;}
    const task=pending.get(message.id);if(!task)return;pending.delete(message.id);
    if(message.error)task.reject(new UserError('사용량을 조회하지 못했습니다. Codex의 ChatGPT 로그인 상태와 네트워크를 확인하세요.',502));
    else task.resolve(message.result);
  });
  const call=(method,params)=>new Promise((resolve,reject)=>{
    if(ended){reject(new UserError('사용량 조회 연결이 종료되었습니다.',502));return;}
    const id=++nextId;pending.set(id,{resolve,reject});
    child.stdin.write(JSON.stringify({id,method,...(params?{params}:{})})+'\n');
  });
  const timer=setTimeout(()=>{failAll('사용량 조회 시간이 초과되었습니다. 잠시 후 다시 시도하세요.');child.kill();},timeoutMs);
  try {
    await call('initialize',{clientInfo:{name:'paper_reader_usage',title:'Paper Reader',version:'0.4.2'}});
    child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
    const first=await call('account/read',{refreshToken:false});
    if(first?.account?.type!=='chatgpt')throw new UserError('Codex에서 ChatGPT 계정으로 먼저 로그인하세요. API 키 로그인으로는 이 계정 사용량을 조회할 수 없습니다.',401);
    const limits=await call('account/rateLimits/read');
    const last=await call('account/read',{refreshToken:false});
    if(last?.account?.type!=='chatgpt' || first.account.email!==last.account.email || first.account.planType!==last.account.planType)throw new UserError('조회 중 Codex 계정이 변경되었습니다. 다시 조회하세요.',409);
    return {account:last.account,limits};
  } finally {clearTimeout(timer);lines.close();child.stdin.end();child.kill();}
}

export function normalizeUsage({account,limits},now=Date.now()) {
  const sources=limits?.rateLimitsByLimitId && Object.keys(limits.rateLimitsByLimitId).length ? Object.entries(limits.rateLimitsByLimitId) : limits?.rateLimits ? [[limits.rateLimits.limitId || 'codex',limits.rateLimits]] : [];
  const buckets=sources.filter(([,value])=>value && typeof value==='object').map(([id,value])=>{
    const windows=['primary','secondary'].flatMap(key=>{
      const item=value[key];if(!item)return [];
      return [{key,remainingPercent:typeof item.usedPercent==='number' && Number.isFinite(item.usedPercent)?Math.max(0,Math.min(100,100-item.usedPercent)):null,windowDurationMins:typeof item.windowDurationMins==='number' && Number.isFinite(item.windowDurationMins) && item.windowDurationMins>0?item.windowDurationMins:null,resetsAt:typeof item.resetsAt==='number' && Number.isFinite(item.resetsAt) && item.resetsAt>0?item.resetsAt:null}];
    });
    const credits=value.credits;
    const balance=typeof credits?.balance==='string' && /^\d+(?:\.\d+)?$/.test(credits.balance)?credits.balance:typeof credits?.balance==='number' && Number.isFinite(credits.balance) && credits.balance>=0?String(credits.balance):null;
    return {id,name:typeof value.limitName==='string'?value.limitName:id,windows,credits:{balance,unlimited:credits?.unlimited===true}};
  });
  return {source:'local-codex',account:{email:typeof account?.email==='string'?account.email:null,planType:typeof account?.planType==='string'?account.planType:null},checkedAt:new Date(now).toISOString(),buckets};
}

export function compareUsageAccount(usage,readerAccount) {
  const readerEmail=readerAccount?.email?.trim().toLowerCase(),sourceEmail=usage.account.email?.trim().toLowerCase();
  return {...usage,accountMatch:readerEmail && sourceEmail ? readerEmail===sourceEmail : null};
}

export function createUsageReader({resolveExecutable=findCodex,runQuery=queryCodex,clock=Date.now}={}) {
  let pending=null,cached=null;
  return async()=>{
    if(cached && clock()-cached.time<10000)return cached.result;
    if(pending)return pending;
    pending=(async()=>{
      const result=normalizeUsage(await runQuery(await resolveExecutable()),clock());
      cached={time:clock(),result};return result;
    })();
    try{return await pending;}finally{pending=null;}
  };
}
