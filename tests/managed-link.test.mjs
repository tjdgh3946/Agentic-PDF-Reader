import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createManagedLink} from '../managed-link.mjs';
async function fixture({external=false,withKey=true}={}){
  const directory=await mkdtemp(path.join(os.tmpdir(),'paper-reader-managed-link-'));
  await mkdir(path.join(directory,'tools'));for(const file of ['tools/tunnel-client.exe','server.bundle.mjs','widget.html'])await writeFile(path.join(directory,file),'fixture');
  let saved=withKey?{tunnelId:'tunnel_fixture',key:'test-only-private-value'}:null,writes=0,released=0;const calls=[];
  const manager=createManagedLink({directory,resourceDirectory:directory,connectionFile:path.join(directory,'private-connection.json'),executable:path.join(directory,'Agentic PDF Reader.exe'),store:{load:async()=>saved?{...saved}:null,tunnelId:async()=>saved?.tunnelId||null,save:async(tunnelId,key)=>{writes++;saved={tunnelId,key};}},acquire:async()=>({owner:!external,existing:{pid:42,version:'0.2.1'},release:async()=>{released++;}}),spawnProcess:(exe,args,options)=>{
    calls.push({exe,args,options:{...options,env:{...options.env}}});const child=new EventEmitter();child.kill=()=>queueMicrotask(()=>child.emit('exit',1));queueMicrotask(()=>{child.emit('spawn');if(args[0]==='init')child.emit('exit',0);});return child;
  }});
  return {manager,calls,counters:()=>({writes,released})};
}
test('bundled Electron runtime starts Link without exposing a saved key in args or status',async t=>{
  const f=await fixture();t.after(()=>f.manager.stop());await f.manager.start();
  assert.equal(f.calls.length,2);assert.equal(f.calls[1].options.env.ELECTRON_RUN_AS_NODE,'1');
  assert.equal(f.calls[1].options.env.CONTROL_PLANE_API_KEY,'test-only-private-value');
  assert.equal(f.calls[0].options.env.CONTROL_PLANE_API_KEY,undefined);
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
