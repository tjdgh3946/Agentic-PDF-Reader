import test from 'node:test';
import assert from 'node:assert/strict';
import {withRendererRecovery} from '../pdf-render-recovery.mjs';
import {UserError} from '../auth.mjs';
import {setTimeout as wait} from 'node:timers/promises';

function fixture(){
  let alive=false,loads=0,calls=0;
  const backend={has:()=>alive,load:async(_id,bytes)=>{assert.equal(bytes.toString(),'immutable PDF');loads++;alive=true;return {documentId:'abc',pages:['text']};},render:async()=>{calls++;return {image:'actual'};},release(){alive=false;},close(){alive=false;}};
  return {backend,service:withRendererRecovery(backend),crash:()=>alive=false,counts:()=>({loads,calls})};
}
test('lost renderers reload immutable bytes once for concurrent requests; release ends access',async()=>{
  const f=fixture(),bytes=Buffer.from('immutable PDF');await f.service.load('id',bytes,{});bytes.fill(0);f.crash();
  assert.equal((await Promise.all([f.service.render('id',1,[]),f.service.render('id',1,[])])).length,2);
  assert.deepEqual(f.counts(),{loads:2,calls:2});f.service.release('id');
  await assert.rejects(f.service.render('id',1,[]),/고정본/);f.service.close();
});
test('renderer death during a request retries once; healthy validation errors are not retried',async()=>{
  const f=fixture();await f.service.load('id',Buffer.from('immutable PDF'),{});
  let attempts=0;f.backend.render=async()=>{if(++attempts===1){f.crash();throw new UserError('crashed',410);}return 'recovered';};
  assert.equal(await f.service.render('id',1,[]),'recovered');assert.equal(attempts,2);
  f.backend.render=async()=>{throw new UserError('invalid',400);};await assert.rejects(f.service.render('id',1,[]),/invalid/);
  assert.equal(f.counts().loads,2);f.service.close();
});
test('revocation during recovery never returns an image or re-enables the old snapshot',async()=>{
  const f=fixture();await f.service.load('id',Buffer.from('immutable PDF'),{});f.crash();
  let finish,started;const ready=new Promise(resolve=>started=resolve);
  f.backend.load=()=>new Promise(resolve=>{finish=resolve;started();});
  const operation=f.service.render('id',1,[]);await ready;f.service.release('id');finish({documentId:'abc',pages:['text']});
  await assert.rejects(operation,/종료/);await assert.rejects(f.service.render('id',1,[]),/고정본/);f.service.close();
});
test('idle suspension retains the immutable share and reopens without text extraction',async()=>{
  const live=new Set(),loads=[];
  const backend={has:id=>live.has(id),load:async(id,bytes,limits,options)=>{loads.push(options.extractText);live.add(id);return options.extractText?{documentId:id,pages:['text']}:{documentId:id,pageCount:1};},render:async()=>({image:'png'}),release:id=>live.delete(id),close:()=>live.clear()};
  const service=withRendererRecovery(backend,{idleTimeout:20,releaseAfterLoad:true});
  await service.load('a',Buffer.from('pdf'),{});assert.equal(live.size,0);
  await service.render('a',1,[]);assert.equal(live.size,1);
  await wait(50);assert.equal(live.size,0);
  await service.render('a',1,[]);assert.deepEqual(loads,[true,false,false]);service.close();
});
test('different idle renderers are evicted while in-flight rendering is protected',async()=>{
  const live=new Set();let finish;
  const backend={has:id=>live.has(id),load:async id=>{live.add(id);return {documentId:id,pages:['text']};},render:async id=>id==='a'?new Promise(resolve=>finish=resolve):'png',release:id=>live.delete(id),close:()=>live.clear()};
  const service=withRendererRecovery(backend,{idleTimeout:20,releaseAfterLoad:true});
  await service.load('a',Buffer.from('a'),{});await service.load('b',Buffer.from('b'),{});
  const pending=service.render('a',1,[]);await wait(5);await service.render('b',1,[]);await wait(50);
  assert.equal(live.has('a'),true);assert.equal(live.has('b'),false);finish('png');await pending;await wait(50);assert.equal(live.size,0);service.close();
});
