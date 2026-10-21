import {spawn,execFile} from 'node:child_process';
import {access} from 'node:fs/promises';
import path from 'node:path';
import {createCredentialStore,previousTunnelId,validTunnelId} from './plugins/paper-reader-link/credential-store.mjs';
import {acquireLauncher} from './plugins/paper-reader-link/launcher-instance.mjs';

export function createManagedLink({directory,resourceDirectory,connectionFile,executable=process.execPath,store=createCredentialStore(directory),acquire=acquireLauncher,spawnProcess=spawn}){
  if(typeof connectionFile!=='string'||!path.isAbsolute(connectionFile))throw Error('Private app connection path required');
  const client=path.join(resourceDirectory,'tools','tunnel-client.exe'),server=path.join(resourceDirectory,'server.bundle.mjs');
  let instance,child,initializer,busy=false,closing=false,state={phase:'idle',message:'Link 설정을 아직 시작하지 않았습니다.'};
  const set=(phase,message)=>{state={phase,message};};
  async function claim(){
    if(instance?.owner)return true;
    instance=await acquire(directory);
    if(!instance.owner){set('external','별도 Link 실행기가 이미 실행 중입니다. 기존 연결을 사용합니다.');return false;}
    return true;
  }
  async function initialize(tunnelId){
    await Promise.all([access(client),access(server),access(path.join(resourceDirectory,'widget.html'))]);
    const command='"'+executable.replaceAll('\\','/')+'" "'+server.replaceAll('\\','/')+'" --connection "'+connectionFile.replaceAll('\\','/')+'"';
    const env={...process.env,ELECTRON_RUN_AS_NODE:'1'};delete env.CONTROL_PLANE_API_KEY;
    await new Promise((resolve,reject)=>{
      const processChild=initializer=spawnProcess(client,['init','--sample','sample_mcp_stdio_local','--profile','paper-reader-link','--profile-dir',path.join(directory,'tunnel'),'--tunnel-id',tunnelId,'--mcp-command',command,'--health-listen-addr','127.0.0.1:0','--force'],{env,stdio:'ignore',windowsHide:true});
      const timer=setTimeout(()=>{processChild.kill();reject(Error('터널 준비 시간이 초과됐습니다.'));},20000);
      processChild.once('error',()=>{clearTimeout(timer);reject(Error('내장 터널 실행기를 시작하지 못했습니다.'));});
      processChild.once('exit',code=>{initializer=null;clearTimeout(timer);code===0?resolve():reject(Error('터널 설정을 준비하지 못했습니다.'));});
    });
  }
  async function run(){
    if(closing)throw Error('앱 종료 중에는 연결을 시작할 수 없습니다.');
    const saved=await store.load();if(!saved)throw Error('터널 ID와 실행 키를 먼저 저장하세요.');
    await initialize(saved.tunnelId);
    if(closing){saved.key='';throw Error('연결 준비를 취소했습니다.');}
    const env={...process.env,ELECTRON_RUN_AS_NODE:'1',CONTROL_PLANE_API_KEY:saved.key};
    // v0.0.16's profile-directory reader can reject ordinary Windows files
    // with "too many levels of symbolic links". Load our fixed config directly.
    try{child=spawnProcess(client,['run','--config',path.join(directory,'tunnel','paper-reader-link.yaml')],{env,stdio:'ignore',windowsHide:true});}
    finally{delete env.CONTROL_PLANE_API_KEY;saved.key='';}
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(Error('터널 실행에 실패했습니다.')));});
    child.once('exit',()=>{child=null;if(!closing)set('error','터널이 종료됐습니다. 조직·Tunnels Read + Use 권한·인터넷 연결을 확인하고 다시 시작하세요.');});
    set('running','터널 실행 중 · ChatGPT 플러그인에서 연결을 확인하세요.');
  }
  async function operate(operation){
    if(closing)throw Error('앱 종료 중입니다.');
    if(busy)throw Error('연결을 준비 중입니다. 잠시 기다려 주세요.');
    busy=true;
    try{return await operation();}catch(error){set('error',error.message);throw error;}
    finally{busy=false;}
  }
  return {
    async status(){let tunnelId=null;try{tunnelId=await store.tunnelId();}catch{}return {...state,busy,hasSavedKey:!!tunnelId,tunnelId:tunnelId||await previousTunnelId(directory)};},
    start:()=>operate(async()=>{if(child)return {...state};set('starting','저장된 설정으로 연결을 준비하고 있습니다.');if(await claim())await run();return {...state};}),
    configure:input=>operate(async()=>{
      if(!input||!validTunnelId(input.tunnelId)||typeof input.key!=='string'||input.key.length>16384)throw Error('터널 ID와 실행 키를 확인하세요.');
      if(child)throw Error('Link 실행 중에는 키를 바꿀 수 없습니다. 앱을 다시 실행한 뒤 설정하세요.');
      if(!await claim())throw Error('기존 Link 실행기를 종료한 뒤 인증 정보를 변경하세요.');
      let key=input.key.trim();
      try{
        if(key)await store.save(input.tunnelId,key);
        else if(await store.tunnelId()!==input.tunnelId)throw Error('이 터널의 실행 키를 입력하세요.');
      }finally{key='';input.key='';}
      set('starting','암호화한 설정으로 연결을 준비하고 있습니다.');await run();return {...state};
    }),
    async stop(){
      closing=true;
      initializer?.kill();
      while(busy)await new Promise(resolve=>setTimeout(resolve,20));
      if(child?.pid){const pid=child.pid;await new Promise(resolve=>{if(process.platform==='win32')execFile('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true},()=>resolve());else{child.kill('SIGTERM');resolve();}});child=null;}
      if(instance?.owner)await instance.release();instance=null;set('idle','Link 실행을 종료했습니다.');
    }
  };
}
