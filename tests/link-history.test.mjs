import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAppServer} from '../server.mjs';
import {createChats} from '../chats.mjs';
import {createAnnotations} from '../annotations.mjs';
import {pageNote} from '../reading-tools.mjs';
async function fixture(t){
  const directory=await mkdtemp(path.join(tmpdir(),'paper-link-history-'));
  const chats=await createChats(path.join(directory,'chats')),annotations=await createAnnotations(path.join(directory,'notes'));
  let origin;const server=createAppServer({activeRequests:new Set()},{chats,annotations,settings:{get:()=>({mode:'manual'})},getOrigin:()=>origin,linkDiscoveryPath:path.join(directory,'link.json')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{await server.link.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const share=await server.link.share({documentId:'abc',fileName:'a.pdf',...pageNote(2),question:'Why?',context:'',allowSave:true});
  const chat=await chats.create({documentId:'abc',fileName:'a.pdf'});
  const request=async(url,input)=>{const response=await fetch(origin+url,{method:'POST',headers:{'X-Paper-Reader':'1',Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:response.status,data:await response.json()};};
  const turn={question:'Why?',selection:'',pageLabel:'p. 2',linkSelectionId:share.selectionId};
  return {directory,chats,annotations,server,share,chat,request,turn};
}
test('saved Link reply completes the exact question and survives document change/restart',async t=>{
  const f=await fixture(t),entry=(await f.request('/api/chat/export',{id:f.chat.id,turn:f.turn})).data;
  await f.server.link.share({documentId:'def',fileName:'b.pdf',...pageNote(1),question:'Other',context:'',allowSave:true});
  const saved=await f.server.link.call('save_annotation',{selectionId:f.share.selectionId,note:'**source answer**'});
  assert.equal(saved.historyUpdated,true);
  const reopened=await createChats(path.join(f.directory,'chats'));
  const result=(await reopened.get(f.chat.id)).entries[0];
  assert.equal(result.id,entry.id);assert.equal(result.status,'complete');assert.equal(result.source,'chatgpt-link');assert.equal(result.annotationId,saved.annotationId);assert.equal(result.answer,'**source answer**');
  assert.equal((await f.annotations.list('def')).length,0);
});
test('reply before question recording reconciles, and duplicate exports/saves stay singular',async t=>{
  const f=await fixture(t);const args={selectionId:f.share.selectionId,note:'answer'};
  await f.server.link.call('save_annotation',args);
  const first=await f.request('/api/chat/export',{id:f.chat.id,turn:f.turn});assert.equal(first.data.status,'complete');
  const second=await f.request('/api/chat/export',{id:f.chat.id,turn:f.turn});assert.equal(second.data.id,first.data.id);
  await f.server.link.call('save_annotation',args);
  assert.equal((await f.chats.get(f.chat.id)).entries.length,1);assert.equal((await f.annotations.list('abc')).length,1);
});
test('export rejects a different document or question instead of binding by text',async t=>{
  const f=await fixture(t);const other=await f.chats.create({documentId:'def',fileName:'b.pdf'});
  assert.equal((await f.request('/api/chat/export',{id:other.id,turn:f.turn})).status,409);
  assert.equal((await f.request('/api/chat/export',{id:f.chat.id,turn:{...f.turn,question:'Different'}})).status,409);
  assert.equal((await f.chats.get(f.chat.id)).entries.length,0);
});
test('late Link saves preserve manually pasted answers and deleted conversations',async t=>{
  const f=await fixture(t);const entry=(await f.request('/api/chat/export',{id:f.chat.id,turn:f.turn})).data;
  await f.chats.importAnswer(f.chat.id,entry.id,'My edited answer');
  await f.server.link.call('save_annotation',{selectionId:f.share.selectionId,note:'Model answer'});
  assert.equal((await f.chats.get(f.chat.id)).entries[0].answer,'My edited answer');
  await f.chats.delete(f.chat.id);
  await f.server.link.call('save_annotation',{selectionId:f.share.selectionId,note:'Model answer'});
  assert.equal((await f.chats.list()).length,0);
});
test('history write failure preserves the note and an idempotent retry repairs history',async t=>{
  const f=await fixture(t);await f.request('/api/chat/export',{id:f.chat.id,turn:f.turn});
  const update=f.chats.completeLink;f.chats.completeLink=async()=>{throw Error('disk unavailable');};
  const args={selectionId:f.share.selectionId,note:'answer'};const first=await f.server.link.call('save_annotation',args);
  assert.equal(first.saved,true);assert.equal(first.historyUpdated,false);assert.equal(f.server.link.status().latest.historyError,true);
  f.chats.completeLink=update;const retry=await f.server.link.call('save_annotation',args);
  assert.equal(retry.duplicate,true);assert.equal(retry.historyUpdated,true);assert.equal((await f.annotations.list('abc')).length,1);assert.equal(f.server.link.status().latest.historyError,false);
});
