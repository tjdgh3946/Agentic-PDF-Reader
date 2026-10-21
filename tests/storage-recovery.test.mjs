import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,mkdir,rmdir,unlink} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {createAnnotations} from '../annotations.mjs';
import {createChats} from '../chats.mjs';
import {lockFile} from '../scripts/windows-file-lock.mjs';

const item={quote:'Original quote',note:'**한국어 노트**\n\n$e^{-\\lambda_i t}$',color:'yellow',rotation:0,anchors:[{page:2,rects:[[.1,.2,.3,.04]]}]};
const turn={question:'private question',selection:'quote',pageLabel:'p. 2',exported:true};
const directory=()=>mkdtemp(path.join(os.tmpdir(),'reader-storage-fault-'));
const noteFile=dir=>path.join(dir,createHash('sha256').update('abc123').digest('hex')+'.json');

test('truncated notes restore the last committed Unicode/LaTeX/evidence and quarantine bad bytes',async()=>{
  const dir=await directory(),store=await createAnnotations(dir),evidence={snapshotId:'a'.repeat(64),truncated:false,pages:[{page:2,text:true,image:false,regions:[]}]};
  const saved=await store.upsert('abc123',{...item,evidence}),file=noteFile(dir);
  await writeFile(file,'{"items":[');const reopened=await createAnnotations(dir),notes=await reopened.list('abc123');
  assert.deepEqual(notes,[saved]);assert.equal((await reopened.storageStatus()).notices[0].state,'recovered');
  const corrupt=(await readdir(dir)).find(name=>name.includes('.corrupt-'));assert.equal(await readFile(path.join(dir,corrupt),'utf8'),'{"items":[');
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')).items,[saved]);
});

test('one unrecoverable question file cannot block healthy conversations or silently disappear',async()=>{
  const dir=await directory(),store=await createChats(dir),bad=await store.create({documentId:'a',fileName:'damaged.pdf'}),good=await store.create({documentId:'b',fileName:'healthy.pdf'});
  await store.begin(good.id,turn);await writeFile(path.join(dir,bad.id+'.json'),'{broken');await writeFile(path.join(dir,bad.id+'.json.bak'),'[]');
  const reopened=await createChats(dir);assert.deepEqual((await reopened.list()).map(chat=>chat.id),[good.id]);assert.equal((await reopened.get(good.id)).entries[0].question,turn.question);
  const status=await reopened.storageStatus();assert.equal(status.quarantined,2);assert.equal(status.notices[0].state,'quarantined');
  assert.ok(!JSON.stringify(status).includes(turn.question),'Diagnostics must not expose stored questions');
});

test('missing primary restores backup; a malformed primary can be repaired during an existing session',async()=>{
  const dir=await directory(),store=await createChats(dir),chat=await store.create({documentId:'a',fileName:'a.pdf'}),entry=await store.begin(chat.id,turn),file=path.join(dir,chat.id+'.json');
  await unlink(file);assert.equal((await (await createChats(dir)).get(chat.id)).entries.length,1);
  await writeFile(file,'wrong json');await store.importAnswer(chat.id,entry.id,'**Recovered answer**');
  assert.equal((await (await createChats(dir)).get(chat.id)).entries[0].answer,'**Recovered answer**');
});

test('actual temporary-file write failures preserve committed note and question state and allow retry',async()=>{
  const dir=await directory(),notes=await createAnnotations(dir),saved=await notes.upsert('abc123',item),file=noteFile(dir);
  await mkdir(file+'.tmp');await assert.rejects(notes.upsert('abc123',{...saved,note:'unsaved draft'}),/저장하지 못/);
  assert.equal((await notes.list('abc123'))[0].note,item.note);await rmdir(file+'.tmp');
  assert.equal((await notes.upsert('abc123',{...saved,note:'unsaved draft'})).note,'unsaved draft');
  const chats=await createChats(dir),chat=await chats.create({documentId:'a',fileName:'a.pdf'}),chatFile=path.join(dir,chat.id+'.json');
  await mkdir(chatFile+'.tmp');await assert.rejects(chats.begin(chat.id,turn),/저장하지 못/);assert.equal((await chats.get(chat.id)).entries.length,0);
  await rmdir(chatFile+'.tmp');await chats.begin(chat.id,turn);assert.equal((await chats.get(chat.id)).entries.length,1);
});

test('a secondary backup failure reports a committed save without encouraging duplicate creation',async()=>{
  const dir=await directory(),notes=await createAnnotations(dir),file=noteFile(dir),creationId=randomUUID();
  await mkdir(file+'.bak.tmp');const saved=await notes.upsert('abc123',{...item,creationId});assert.equal(saved.id,creationId);
  assert.equal((await notes.storageStatus()).notices[0].state,'warning');assert.equal(JSON.parse(await readFile(file,'utf8')).items.length,1);
  const again=await notes.upsert('abc123',{...item,creationId});assert.equal(again.id,saved.id);assert.equal((await notes.list('abc123')).length,1);
  await rmdir(file+'.bak.tmp');
});

test('replayed note/record writes after a lost response remain singular and reject changed payloads',async()=>{
  const dir=await directory(),creationId=randomUUID(),notes=await createAnnotations(dir);await notes.upsert('abc123',{...item,creationId});
  const reopened=await createAnnotations(dir);await reopened.upsert('abc123',{...item,creationId});assert.equal((await reopened.list('abc123')).length,1);
  await assert.rejects(reopened.upsert('abc123',{...item,creationId,note:'changed'}),/이미 저장/);
  const chats=await createChats(dir),chat=await chats.create({documentId:'a',fileName:'a.pdf'}),clientEntryId=randomUUID();
  await chats.begin(chat.id,{...turn,clientEntryId});const fresh=await createChats(dir);await fresh.begin(chat.id,{...turn,clientEntryId});assert.equal((await fresh.get(chat.id)).entries.length,1);
  await assert.rejects(fresh.begin(chat.id,{...turn,clientEntryId,question:'changed'}),/일치하지/);
});

test('deleted conversations and notes cannot be revived by backup recovery',async()=>{
  const dir=await directory(),chats=await createChats(dir),chat=await chats.create({documentId:'a',fileName:'a.pdf'}),file=path.join(dir,chat.id+'.json'),old=await readFile(file);
  await chats.delete(chat.id);await writeFile(file+'.bak',old);assert.equal((await (await createChats(dir)).list()).length,0);
  const notes=await createAnnotations(dir),saved=await notes.upsert('abc123',item);await notes.delete('abc123',saved.id);await writeFile(noteFile(dir),'broken');assert.equal((await (await createAnnotations(dir)).list('abc123')).length,0);
});

test('legacy committed files gain a verified backup when first opened after upgrade',async()=>{
  const dir=await directory(),notes=await createAnnotations(dir),saved=await notes.upsert('abc123',item),file=noteFile(dir);await unlink(file+'.bak');
  assert.deepEqual(await (await createAnnotations(dir)).list('abc123'),[saved]);assert.equal(JSON.parse(await readFile(file+'.bak','utf8')).items[0].id,saved.id);
  const chats=await createChats(dir),chat=await chats.create({documentId:'a',fileName:'a.pdf'}),chatFile=path.join(dir,chat.id+'.json');await unlink(chatFile+'.bak');
  await createChats(dir);assert.equal(JSON.parse(await readFile(chatFile+'.bak','utf8')).id,chat.id);
});

test('real Windows exclusive file locks preserve notes and allow skipped startup records to recover without restart',async t=>{
  if(process.platform!=='win32'){t.skip('Windows file sharing semantics');return;}
  const dir=await directory(),notes=await createAnnotations(dir),saved=await notes.upsert('abc123',item);let lock=await lockFile(noteFile(dir));t.after(()=>lock?.release());
  await assert.rejects(notes.upsert('abc123',{...saved,note:'retry after actual lock'}),/저장하지 못/);await lock.release();lock=null;
  assert.equal((await notes.list('abc123'))[0].note,item.note);await notes.upsert('abc123',{...saved,note:'retry after actual lock'});
  const chats=await createChats(dir),blocked=await chats.create({documentId:'a',fileName:'a.pdf'}),healthy=await chats.create({documentId:'b',fileName:'b.pdf'});
  lock=await lockFile(path.join(dir,blocked.id+'.json'));const reopened=await createChats(dir);assert.deepEqual((await reopened.list()).map(chat=>chat.id),[healthy.id]);
  await lock.release();lock=null;await reopened.retryRecovery();assert.equal((await reopened.list()).length,2);assert.equal((await reopened.get(blocked.id)).id,blocked.id);
});
