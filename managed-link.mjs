import {spawn,execFile} from 'node:child_process';
import {access,readFile,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {setTimeout as wait} from 'node:timers/promises';
import path from 'node:path';
import {createCredentialStore,previousTunnelId,validTunnelId} from './plugins/paper-reader-link/credential-store.mjs';
import {acquireLauncher} from './plugins/paper-reader-link/launcher-instance.mjs';

export function createManagedLink({directory,resourceDirectory,connectionFile,executable=process.execPath,store=createCredentialStore(directory),acquire=acquireLauncher,spawnProcess=spawn,probe=fetch,retryDelays=[1000,3000,10000],verifyConnection,verificationTimeout=45000}){
  if(typeof connectionFile!=='string'||!path.isAbsolute(connectionFile))throw Error('Private app connection path required');
  const client=path.join(resourceDirectory,'tools','tunnel-client.exe'),server=path.join(resourceDirectory,'server.bundle.mjs');
  let instance,child,initializer,busy=false,closing=false,paused=false,authenticated=false,state={phase:'idle',message:'Link 설정을 아직 시작하지 않았습니다.'};
  let retryTimer,retries=0,startedAt=0,healthFile=null,checking=null,checkedAt=0,health='unknown';
  function retry(){
    if(closing||paused||retryTimer||retries>=retryDelays.length)return;
    const delay=retryDelays[retries++];set('recovering',`Link 연결 복구 대기 · ${retries}/${retryDelays.length}`);
    const attempt=()=>{retryTimer=null;if(closing||paused||child)return;if(busy){retryTimer=setTimeout(attempt,100);retryTimer.unref?.();return;}operate(run).catch(()=>retry());};
    retryTimer=setTimeout(attempt,delay);retryTimer.unref?.();
  }
  async function check(){
    if(!child||!healthFile||closing)return health='unknown';
    if(checking)return checking;
    if(Date.now()-checkedAt<5000)return health;
    checkedAt=Date.now();const active=child,file=healthFile;
    checking=(async()=>{
      try{
        const url=new URL((await readFile(file,'utf8')).trim());
        if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||!url.port)throw Error('Invalid health URL');
        const results=await Promise.allSettled(['/readyz','/health/control-plane'].map(route=>probe(new URL(route,url),{signal:AbortSignal.timeout(3000),redirect:'error'})));
        if(active===child){
          health=results[0].status==='fulfilled'?(results[0].value.ok?'ready':'waiting'):'unreachable';
          if(results[1].status==='fulfilled'&&results[1].value.ok){
            const observation=await results[1].value.json();
            if(active===child&&observation.schema_version===1){
              authenticated=observation.status==='ok'&&!!observation.details?.last_success;
              if(observation.status==='degraded')health=[401,403].includes(observation.details?.http_status)?'auth_required':'reconnecting';
            }
          }
        }
      }catch(error){if(active===child)health=error.code==='ENOENT'&&Date.now()-startedAt<5000?'waiting':'unreachable';}
      return health;
    })().finally(()=>{checking=null;});return checking;
  }
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
  async function run(credentials){
    if(closing)throw Error('앱 종료 중에는 연결을 시작할 수 없습니다.');
    const saved=credentials?{...credentials}:await store.load();if(!saved)throw Error('터널 ID와 실행 키를 먼저 저장하세요.');
    await initialize(saved.tunnelId);
    if(closing){saved.key='';throw Error('연결 준비를 취소했습니다.');}
    const env={...process.env,ELECTRON_RUN_AS_NODE:'1',CONTROL_PLANE_API_KEY:saved.key};
    // v0.0.16's profile-directory reader can reject ordinary Windows files
    // with "too many levels of symbolic links". Load our fixed config directly.
    // The tunnel shares one physical stdio child across logical callers. A
    // repeated initialize otherwise clears readiness until a later upstream
    // notification, so another caller can receive -32002 in that gap. Complete
    // the notification before releasing initialize's lifecycle slot. The
    // official shim also suppresses the caller's eventual duplicate notification.
    healthFile=path.join(directory,'health-'+randomUUID()+'.url');health='unknown';authenticated=false;checkedAt=0;
    try{child=spawnProcess(client,['run','--config',path.join(directory,'tunnel','paper-reader-link.yaml'),'--mcp.stdio-send-initialized-notification','--health.url-file',healthFile,'--control-plane.initial-poll-timeout=1s'],{env,stdio:'ignore',windowsHide:true});}
    finally{delete env.CONTROL_PLANE_API_KEY;saved.key='';}
    const active=child,file=healthFile;startedAt=Date.now();
    const exited=()=>{if(child!==active)return;child=null;health='unknown';unlink(file).catch(()=>{});if(!closing&&!paused){if(Date.now()-startedAt>60000)retries=0;set('error','터널이 종료됐습니다. 환경 설정에서 조직·키 권한·인터넷 연결을 확인하고 다시 시작하세요.');retry();}};
    active.once('exit',exited);
    await new Promise((resolve,reject)=>{active.once('spawn',resolve);active.once('error',()=>{exited();reject(Error('터널 실행에 실패했습니다.'));});});
    set('running','터널 실행 중 · ChatGPT 플러그인에서 연결을 확인하세요.');
  }
  async function halt(){
    clearTimeout(retryTimer);retryTimer=null;
    const active=child,file=healthFile;if(!active)return;
    await new Promise((resolve,reject)=>{
      let settled=false;
      const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);active.removeListener('exit',ended);error?reject(error):resolve();};
      const ended=()=>finish();const timer=setTimeout(()=>finish(Error('기존 연결을 종료하지 못했습니다. 새 연결은 시작하지 않았습니다.')),10000);
      active.once('exit',ended);
      if(active.pid&&process.platform==='win32')execFile('taskkill',['/PID',String(active.pid),'/T','/F'],{windowsHide:true,timeout:8000},error=>{if(error&&child===active)finish(Error('기존 연결 종료에 실패했습니다.'));});
      else active.kill();
    });
    if(child===active)child=null;health='unknown';authenticated=false;
    if(file)await unlink(file).catch(()=>{});
  }
  async function verify(){
    if(verifyConnection){await verifyConnection();return;}
    const active=child,deadline=Date.now()+verificationTimeout;
    while(!closing&&Date.now()<deadline){
      if(child!==active||!active)throw Error('새 연결이 확인 전에 종료됐습니다.');
      checkedAt=0;await check();
      if(health==='auth_required')throw Error('새 키의 조직 또는 터널 실행 권한을 확인하지 못했습니다.');
      if(authenticated&&health==='ready')return;
      await wait(250);
    }
    throw Error('새 연결 확인 시간이 초과됐습니다. 인터넷 연결·터널 ID·권한을 확인하세요.');
  }
  async function operate(operation){
    if(closing)throw Error('앱 종료 중입니다.');
    if(busy)throw Error('연결을 준비 중입니다. 잠시 기다려 주세요.');
    busy=true;
    try{return await operation();}catch(error){if(!retryTimer&&!(child&&state.phase==='running'))set('error',error.message);throw error;}
    finally{busy=false;}
  }
  return {
    async status(){let tunnelId=null;try{tunnelId=await store.tunnelId();}catch{}await check();return {...state,health,busy,running:!!child,paused,retryAttempt:retries,hasSavedKey:!!tunnelId,tunnelId:tunnelId||await previousTunnelId(directory)};},
    start:()=>operate(async()=>{paused=false;if(child){await check();return {...state};}clearTimeout(retryTimer);retryTimer=null;retries=0;set('starting','저장된 설정으로 연결을 준비하고 있습니다.');if(await claim())await run();return {...state};}),
    pause:()=>operate(async()=>{if(instance&&!instance.owner)throw Error('별도 Link 실행기에서 연결을 중지하세요.');paused=true;await halt();set('paused','Link 연결을 중지했습니다. PDF 공유와 ChatGPT 로그인은 유지됩니다.');return {...state};}),
    async recover(){if(closing||paused||busy)return;if(child){checkedAt=0;await check();return;}if(instance?.owner&&retries<retryDelays.length)retry();},
    configure:input=>operate(async()=>{
      if(!input||!validTunnelId(input.tunnelId)||typeof input.key!=='string'||input.key.length>16384)throw Error('터널 ID와 실행 키를 확인하세요.');
      if(!await claim())throw Error('기존 Link 실행기를 종료한 뒤 인증 정보를 변경하세요.');
      let previous=null;try{previous=await store.load();}catch{if(child){input.key='';throw Error('기존 인증 설정을 읽지 못해 교체를 중단했습니다. 현재 연결은 유지됩니다. 파일 잠금을 확인하거나 연결을 중지한 뒤 다시 적용하세요.');}}
      const candidate={tunnelId:input.tunnelId,key:input.key.trim()};input.key='';
      if(!candidate.key){if(previous?.tunnelId!==candidate.tunnelId)throw Error('이 터널의 실행 키를 입력하세요.');candidate.key=previous.key;}
      const wasRunning=!!child;paused=true;
      try{
        await halt();set('validating','새 설정으로 연결을 확인하고 있습니다. 확인 후 암호화해 저장합니다.');
        await run(candidate);set('validating','새 터널의 실행 권한과 연결을 확인하고 있습니다.');await verify();
        if(closing)throw Error('앱 종료로 설정 변경을 취소했습니다.');
        await store.save(candidate.tunnelId,candidate.key);
        paused=false;retries=0;set('running','새 설정의 연결을 확인하고 저장했습니다. 터널 ID를 바꿨다면 ChatGPT 플러그인도 같은 터널로 변경하세요.');return {...state};
      }catch(error){
        await halt();
        if(previous&&wasRunning&&!closing){
          try{set('recovering','새 설정을 적용하지 못해 기존 연결을 복원합니다.');await run(previous);await verify();paused=false;retries=0;set('running','새 설정 적용 실패 · 저장된 기존 설정과 연결을 복원했습니다.');}
          catch{await halt();set('error','새 설정을 저장하지 않았습니다. 기존 설정은 보관돼 있습니다. 저장된 설정으로 다시 연결하세요.');}
        }else set('error','새 설정을 저장하지 않았습니다. 터널 ID·키·네트워크를 확인하고 다시 시도하세요.');
        throw Error(state.message);
      }finally{candidate.key='';if(previous)previous.key='';input.key='';}
    }),
    async stop(){
      closing=true;paused=true;
      clearTimeout(retryTimer);retryTimer=null;
      initializer?.kill();
      while(busy)await new Promise(resolve=>setTimeout(resolve,20));
      await halt();
      if(instance?.owner)await instance.release();instance=null;set('idle','Link 실행을 종료했습니다.');
    }
  };
}
