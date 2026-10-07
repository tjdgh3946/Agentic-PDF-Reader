import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pageWindow,historyFor,buildPrompt} from '../context.mjs';
import {createChats} from '../chats.mjs';
import {createSettings} from '../settings.mjs';
test('PDF window clamps edges and includes multi-page backwards selections',()=>{
  assert.deepEqual(pageWindow('selection',2,4,10),[]);
  assert.deepEqual(pageWindow('page',4,2,10),[2,3,4]);
  assert.deepEqual(pageWindow('near1',1,1,10),[1,2]);
  assert.deepEqual(pageWindow('near2',9,10,10),[7,8,9,10]);
  assert.equal(pageWindow('all',2,2,14).length,14);
});
test('history includes only completed answers and never repeats prior PDF payload',()=>{
  const entries=[{question:'old',status:'complete'},{question:'partial',status:'interrupted'},{question:'test',status:'complete',test:true},{question:'web',status:'exported'},{question:'recent',status:'complete',answer:'prior answer',selection:'quote',pageLabel:'p. 1',prompt:'OLD_FULL_PDF'}];
  assert.equal(historyFor(entries,'all').length,2);assert.equal(historyFor(entries,0).length,0);
  const history=historyFor(entries,1);assert.equal(history[0].question,'recent');
  const prompt=buildPrompt({fileName:'test.pdf',question:'next',selection:'quote',startPage:1,endPage:1,pages:[{number:1,text:'UNIQUE_PDF_BODY'}],history}).text;
  assert.equal(prompt.split('UNIQUE_PDF_BODY').length-1,1);assert.ok(!prompt.includes('OLD_FULL_PDF'));assert.ok(prompt.includes('prior answer'));
});
test('conversations survive restart; partials stay out of context; explicit deletion cannot resurrect',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'paper-reader-chat-test-'));
  let store=await createChats(directory),chat=await store.create({documentId:'pdf-id',fileName:'test.pdf'});
  const turn={question:'why?',selection:'quote',pageLabel:'p. 2',prompt:'DO_NOT_STORE_PDF'};
  const entry=await store.begin(chat.id,turn);await store.update(chat.id,entry.id,'answer','complete');
  await store.begin(chat.id,{...turn,question:'pending'});
  store=await createChats(directory);const restored=await store.get(chat.id);
  assert.equal(restored.entries[0].answer,'answer');assert.equal(restored.entries[1].status,'interrupted');assert.equal(historyFor(restored.entries,'all').length,1);
  assert.ok(!(await readFile(path.join(directory,chat.id+'.json'),'utf8')).includes('DO_NOT_STORE_PDF'));
  const other=await store.create({documentId:'other',fileName:'other.pdf'});
  await store.delete(chat.id);assert.equal(await store.update(chat.id,entry.id,'late answer','complete'),false);
  assert.equal((await createChats(directory)).list instanceof Function,true);
  assert.deepEqual((await readdir(directory)).filter(name=>name.endsWith('.json')),[other.id+'.json']);
});
test('context preferences migrate old settings and survive restart',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'paper-reader-settings-test-')),file=path.join(directory,'settings.json');
  await writeFile(file,JSON.stringify({mode:'plan'}));const settings=await createSettings(file);
  assert.deepEqual(settings.get(),{mode:'plan',pdfWindow:'near1',historyTurns:3});
  await settings.set({mode:'plan',pdfWindow:'selection',historyTurns:6});await settings.set({mode:'manual'});
  assert.deepEqual((await createSettings(file)).get(),{mode:'manual',pdfWindow:'selection',historyTurns:6});
  assert.throws(()=>settings.set({mode:'plan',historyTurns:999}));
});
test('panel width persists independently from request mode and rejects invalid sizes',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'paper-reader-layout-'));
  const file=path.join(directory,'settings.json'),settings=await createSettings(file);
  await Promise.all([settings.set({mode:'plan'}),settings.set({panelWidth:620})]);
  assert.equal(settings.get().mode,'plan');
  assert.equal((await createSettings(file)).get().panelWidth,620);
  await settings.set({mode:'manual'});assert.equal(settings.get().panelWidth,620);
  for(const panelWidth of [0,359,1201,NaN,'620'])assert.throws(()=>settings.set({panelWidth}));
});

test('web answers persist, enter follow-up context, and cannot overwrite model turns',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'paper-web-answer-'));
  const store=await createChats(dir);
  const chat=await store.create({documentId:'web-test',fileName:'paper.pdf'});
  const turn={question:'Explain this',selection:'quote',pageLabel:'p. 1'};
  const exported=await store.begin(chat.id,{...turn,exported:true});
  await assert.rejects(store.importAnswer(chat.id,exported.id,'   '));
  const imported=await store.importAnswer(chat.id,exported.id,'  **Web answer**  ');
  assert.equal(imported.source,'chatgpt-web');
  assert.equal(imported.answer,'**Web answer**');
  const reopened=await createChats(dir);
  const history=historyFor((await reopened.get(chat.id)).entries,3);
  assert.equal(history.length,1);assert.equal(history[0].answer,'**Web answer**');
  await store.importAnswer(chat.id,exported.id,'Edited answer');
  const direct=await store.begin(chat.id,turn);
  await assert.rejects(store.importAnswer(chat.id,direct.id,'Overwrite'));
  await assert.rejects(store.importAnswer(chat.id,'missing','Missing'));
  await store.delete(chat.id);
  await assert.rejects(store.importAnswer(chat.id,exported.id,'Restore'));
});
