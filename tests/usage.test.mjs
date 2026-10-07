import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {queryCodex,normalizeUsage,compareUsageAccount,createUsageReader} from '../usage.mjs';
import {createAppServer} from '../server.mjs';

test('usage distinguishes missing from zero and uses each actual quota window',()=>{
  const result=normalizeUsage({account:{email:'sample@example.invalid'},limits:{rateLimits:{primary:{usedPercent:99}},rateLimitsByLimitId:{codex:{primary:{usedPercent:17,windowDurationMins:10080,resetsAt:1800000000},credits:{balance:'0'}},other:{primary:{usedPercent:null},secondary:{usedPercent:105},credits:null}}}},0);
  assert.equal(result.buckets.length,2);assert.equal(result.buckets[0].windows[0].remainingPercent,83);
  assert.equal(result.buckets[0].windows[0].windowDurationMins,10080);assert.equal(result.buckets[0].credits.balance,'0');
  assert.equal(result.buckets[1].windows[0].remainingPercent,null);assert.equal(result.buckets[1].windows[1].remainingPercent,0);assert.equal(result.buckets[1].credits.balance,null);
  assert.equal(normalizeUsage({limits:{rateLimits:{credits:{unlimited:true}}}}).buckets[0].credits.unlimited,true);
  assert.equal(normalizeUsage({limits:{}}).buckets.length,0);
  assert.equal(compareUsageAccount(result,{email:'SAMPLE@example.invalid'}).accountMatch,true);
  assert.equal(compareUsageAccount(result,{email:'other@example.invalid'}).accountMatch,false);
  assert.equal(compareUsageAccount(result,null).accountMatch,null);
});

function fakeChild(handler) {
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.killed=false;
  child.kill=()=>{child.killed=true;child.stdout.end();child.stderr.end();child.emit('exit',0);};
  const messages=[];let buffer='';
  child.stdin.on('data',chunk=>{buffer+=chunk.toString();let pos;while((pos=buffer.indexOf('\n'))!==-1){const message=JSON.parse(buffer.slice(0,pos));buffer=buffer.slice(pos+1);messages.push(message);if(!('id' in message))continue;const result=handler(message);if(result!==undefined)queueMicrotask(()=>child.stdout.write(JSON.stringify({id:message.id,result})+'\n'));}});
  return {child,messages,spawnProcess:()=>child};
}

test('usage bridge only reads accounts and quotas, verifies identity, and terminates child',async()=>{
  const account={type:'chatgpt',email:'a@example.invalid',planType:'pro'};
  const mock=fakeChild(message=>message.method==='account/read'?{account}:message.method==='account/rateLimits/read'?{rateLimits:{}}:{});
  const result=await queryCodex('test.exe',{spawnProcess:mock.spawnProcess});
  assert.equal(result.account.email,account.email);assert.ok(mock.child.killed);
  assert.deepEqual(mock.messages.map(x=>x.method),['initialize','initialized','account/read','account/rateLimits/read','account/read']);
  assert.ok(!JSON.stringify(result).includes('access_token'));
});

test('usage bridge rejects changing accounts and times out without leaking raw errors',async()=>{
  let reads=0;
  const changed=fakeChild(message=>message.method==='account/read'?{account:{type:'chatgpt',email:++reads===1?'a':'b'}}:{});
  await assert.rejects(queryCodex('test.exe',{spawnProcess:changed.spawnProcess}),/계정이 변경/);assert.ok(changed.child.killed);
  const hung=fakeChild(()=>undefined);
  await assert.rejects(queryCodex('test.exe',{spawnProcess:hung.spawnProcess,timeoutMs:20}),/시간이 초과/);assert.ok(hung.child.killed);
  const noLogin=fakeChild(message=>message.method==='account/read'?{account:null}:{});
  await assert.rejects(queryCodex('test.exe',{spawnProcess:noLogin.spawnProcess}),/먼저 로그인/);
  assert.ok(!noLogin.messages.some(x=>x.method==='account/rateLimits/read'));
});

test('concurrent refreshes share a read and cache expires after ten seconds',async()=>{
  let calls=0,now=0;
  const read=createUsageReader({resolveExecutable:async()=>'/test',runQuery:async()=>{calls++;return {account:{},limits:{}};},clock:()=>now});
  await Promise.all([read(),read()]);assert.equal(calls,1);now=9000;await read();assert.equal(calls,1);now=10001;await read();assert.equal(calls,2);
});

test('local usage route protects origin and labels a different PDF account',async t=>{
  let origin,calls=0;const server=createAppServer({info:()=>({account:{email:'reader@example.invalid'}})},{getOrigin:()=>origin,readUsage:async()=>{calls++;return normalizeUsage({account:{email:'codex@example.invalid'},limits:{rateLimits:{credits:{balance:'0'}}}});}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const post=site=>fetch(origin+'/api/usage',{method:'POST',headers:{Origin:site,'X-Paper-Reader':'1','Content-Type':'application/json'},body:'{}'});
  assert.equal((await post('https://evil.invalid')).status,403);assert.equal(calls,0);
  const result=await (await post(origin)).json();assert.equal(result.accountMatch,false);assert.equal(result.buckets[0].credits.balance,'0');
  assert.equal((await fetch(origin+'/usage.mjs')).status,404);
});
