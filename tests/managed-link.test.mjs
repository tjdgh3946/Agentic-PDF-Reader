import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as wait} from 'node:timers/promises';
import {createManagedLink} from '../managed-link.mjs';
async function until(condition){for(let i=0;i<200;i++){if(condition())return;await wait(5);}assert.fail('Expected lifecycle transition did not occur');}
async function fixture({external=false,withKey=true,retryDelays,probe,verifyConnection=async()=>{},failSave=false}={}){
  const directory=await mkdtemp(path.join(os.tmpdir(),'paper-reader-managed-link-'));
  await mkdir(path.join(directory,'tools'));for(const file of ['tools/tunnel-client.exe','server.bundle.mjs','widget.html'])await writeFile(path.join(directory,file),'fixture');
  let saved=withKey?{tunnelId:'tunnel_fixture',key:'test-only-private-value'}:null,writes=0,released=0;const calls=[],children=[];
  const manager=createManagedLink({directory,resourceDirectory:directory,connectionFile:path.join(directory,'private-connection.json'),executable:path.join(directory,'Agentic PDF Reader.exe'),retryDelays,probe,verifyConnection,store:{load:async()=>saved?{...saved}:null,tunnelId:async()=>saved?.tunnelId||null,save:async(tunnelId,key)=>{if(failSave)throw Error('fixture disk failure');writes++;saved={tunnelId,key};}},acquire:async()=>({owner:!external,existing:{pid:42,version:'0.2.1'},release:async()=>{released++;}}),spawnProcess:(exe,args,options)=>{
    calls.push({exe,args,options:{...options,env:{...options.env}}});const child=new EventEmitter();children.push(child);child.kill=()=>queueMicrotask(()=>child.emit('exit',1));queueMicrotask(()=>{child.emit('spawn');if(args[0]==='init')child.emit('exit',0);});return child;
  }});
  return {manager,calls,children,saved:()=>saved,counters:()=>({writes,released})};
}

test('unexpected tunnel exits recover with saved credentials and a bounded retry budget',async t=>{
  const f=await fixture({retryDelays:[5,5]});t.after(()=>f.manager.stop());await f.manager.start();
  f.children.at(-1).emit('exit',1);assert.equal((await f.manager.status()).phase,'recovering');
  await until(()=>f.calls.length===4);await wait(5);assert.equal((await f.manager.status()).phase,'running');
  f.children.at(-1).emit('exit',1);await until(()=>f.calls.length===6);await wait(5);
  f.children.at(-1).emit('exit',1);await wait(30);assert.equal(f.calls.length,6);assert.equal((await f.manager.status()).phase,'error');
  await f.manager.recover();await wait(15);assert.equal(f.calls.length,6,'Resume must not defeat a failed authentication/restart budget');
});

test('shutdown cancels pending recovery and repeated resume does not duplicate a running tunnel',async()=>{
  const f=await fixture({retryDelays:[20]});await f.manager.start();await Promise.all([f.manager.recover(),f.manager.recover()]);assert.equal(f.calls.length,2);
  f.children.at(-1).emit('exit',1);await f.manager.stop();await wait(40);assert.equal(f.calls.length,2);
});

test('health distinguishes local readiness from observed network and authentication failures',async t=>{
  for(const [status,expected] of [[200,'ready'],[401,'auth_required'],[503,'reconnecting']]){
    const routes=[];
    const f=await fixture({probe:async url=>{routes.push(url.pathname);return {ok:true,json:async()=>({schema_version:1,status:status===200?'ok':'degraded',details:{http_status:status}})};}});t.after(()=>f.manager.stop());
    await f.manager.start();const run=f.calls[1],file=run.args[run.args.indexOf('--health.url-file')+1];
    await writeFile(file,'http://127.0.0.1:55555');assert.equal((await f.manager.status()).health,expected);
    assert.deepEqual(routes.sort(),['/health/control-plane','/readyz']);assert.equal(f.calls.length,2,'A health observation must not restart an active tunnel or replay model calls');
  }
});
test('bundled Electron runtime starts Link without exposing a saved key in args or status',async t=>{
  const f=await fixture();t.after(()=>f.manager.stop());await f.manager.start();
  assert.equal(f.calls.length,2);assert.equal(f.calls[1].options.env.ELECTRON_RUN_AS_NODE,'1');
  assert.equal(f.calls[1].options.env.CONTROL_PLANE_API_KEY,'test-only-private-value');
  assert.equal(f.calls[0].options.env.CONTROL_PLANE_API_KEY,undefined);
  assert.equal(f.calls[1].args[1],'--config');
  assert.match(f.calls[1].args[2],/[/\\]tunnel[/\\]paper-reader-link\.yaml$/);
  assert.ok(!f.calls[1].args.includes('--profile-dir'));
  assert.ok(f.calls[1].args.includes('--mcp.stdio-send-initialized-notification'));
  assert.match(f.calls[0].args[f.calls[0].args.indexOf('--mcp-command')+1],/--connection ".*private-connection.json"/);
  assert.ok(!JSON.stringify(f.calls.map(c=>c.args)).includes('test-only-private-value'));
  assert.ok(!JSON.stringify(await f.manager.status()).includes('test-only-private-value'));
  assert.equal((await f.manager.status()).phase,'running');assert.equal(f.counters().writes,0);
});
test('an existing launcher is reused and its credentials are never overwritten',async t=>{
  const f=await fixture({external:true});t.after(()=>f.manager.stop());
  assert.equal((await f.manager.start()).phase,'external');assert.equal(f.calls.length,0);
  await assert.rejects(f.manager.configure({tunnelId:'tunnel_other',key:'replacement-dummy'}),/기존 Link/);
  assert.equal(f.counters().writes,0);await f.manager.stop();assert.equal(f.counters().released,0);
});
test('fresh users can defer installation without credentials, and empty-key changes are rejected',async t=>{
  const f=await fixture({withKey:false});t.after(()=>f.manager.stop());
  assert.equal((await f.manager.status()).hasSavedKey,false);
  await assert.rejects(f.manager.start(),/먼저 저장/);assert.equal(f.calls.length,0);
  await assert.rejects(f.manager.configure({tunnelId:'tunnel_fixture',key:''}),/실행 키/);assert.equal(f.counters().writes,0);
  await f.manager.configure({tunnelId:'tunnel_fixture',key:'local-dummy'});assert.equal(f.counters().writes,1);
});

test('running credentials can be replaced only after verification, without two live children',async t=>{
  let verified=0;const f=await fixture({verifyConnection:async()=>{verified++;assert.equal(f.counters().writes,0);}});t.after(()=>f.manager.stop());
  await f.manager.start();const old=f.children.at(-1);let exited=false;old.once('exit',()=>exited=true);
  const input={tunnelId:'tunnel_new',key:'new-dummy-key'};await f.manager.configure(input);
  assert.equal(exited,true);assert.equal(verified,1);assert.equal(f.saved().tunnelId,'tunnel_new');assert.equal(f.saved().key,'new-dummy-key');assert.equal(input.key,'');
  assert.equal((await f.manager.status()).running,true);assert.equal(f.calls.filter(call=>call.args[0]==='run').length,2);
});

test('rejected candidate credentials never replace the encrypted store and restore the previous connection',async t=>{
  let attempts=0;const f=await fixture({verifyConnection:async()=>{if(++attempts===1)throw Error('fixture authentication failure');}});t.after(()=>f.manager.stop());
  await f.manager.start();const input={tunnelId:'tunnel_new',key:'rejected-dummy'};await assert.rejects(f.manager.configure(input),/기존 설정과 연결을 복원/);
  assert.equal(f.saved().tunnelId,'tunnel_fixture');assert.equal(f.counters().writes,0);assert.equal((await f.manager.status()).phase,'running');assert.equal(attempts,2);assert.equal(input.key,'');
  assert.equal(f.calls.filter(call=>call.args[0]==='run').length,3);
});

test('credential persistence failure rolls back; pause suppresses resume and supports manual reconnect',async t=>{
  const f=await fixture({failSave:true});t.after(()=>f.manager.stop());await f.manager.start();
  await assert.rejects(f.manager.configure({tunnelId:'tunnel_new',key:'dummy'}),/기존 설정과 연결을 복원/);assert.equal(f.saved().tunnelId,'tunnel_fixture');
  await f.manager.pause();const count=f.calls.length;await f.manager.recover();await wait(20);assert.equal(f.calls.length,count);assert.equal((await f.manager.status()).phase,'paused');
  await f.manager.start();assert.equal((await f.manager.status()).running,true);
});
