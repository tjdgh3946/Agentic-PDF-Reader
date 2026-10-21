import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {questionContext,findNotes,notesMarkdown,notesFileName} from '../reading-tools.mjs';
import {buildPrompt,pageWindow} from '../context.mjs';
import {createSettings} from '../settings.mjs';

test('clearing a selection follows the current page, including selection-only preferences',()=>{
  const input={selection:'',startPage:2,endPage:3,currentPage:5,total:19,window:'selection'};
  const context=questionContext(input);
  assert.deepEqual(pageWindow(context.window,context.startPage,context.endPage,19),[5]);
  assert.equal(questionContext({...input,currentPage:6}).startPage,6);
  const prompt=buildPrompt({...context,fileName:'1806.07572v4.pdf',selection:'',question:'Explain the formula',pages:[{number:5,text:'NTK'}],history:[]}).text;
  assert.match(prompt,/1806\.07572v4\.pdf/);assert.match(prompt,/현재 읽는 위치: p\. 5/);
  assert.deepEqual(questionContext({...input,selection:'backwards',startPage:8,endPage:6}),{startPage:6,endPage:8,window:'selection'});
});

const note=(page,y,quote,body)=>({anchors:[{page,rects:[[.1,y,.4,.03]]}],quote,note:body,createdAt:'2026-10-10'});
test('notes search uses both the source and answer, exports in reading order without losing math',()=>{
  const formula=String.raw`\[\Theta(x,x') = \sum_p a_p b_p\]`;
  const items=[note(6,.1,'Training','finite width'),note(5,.5,'ＮＴＫ definition',formula),note(5,.2,'Introduction','커널 설명')];
  assert.equal(findNotes(items,'ntk sum_p').length,1);
  assert.equal(findNotes(items,'커널 설명')[0].quote,'Introduction');
  assert.equal(findNotes(items,'missing').length,0);
  const exported=notesMarkdown('1806.07572v4.pdf',items);
  assert.ok(exported.indexOf('Introduction')<exported.indexOf('ＮＴＫ'));
  assert.ok(exported.indexOf('ＮＴＫ')<exported.indexOf('Training'));
  assert.ok(exported.includes(formula));assert.match(exported,/저장된 주석 3개/);
  assert.equal(notesFileName('1806.07572v4.pdf'),'1806.07572v4-notes.md');
  assert.ok(!/[<>:"/\\|?*]/.test(notesFileName('bad:/name?.pdf')));
});

test('ChatGPT is the default; delivery preference survives restarts without changing context',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'paper-reading-'));
  const file=path.join(directory,'settings.json'),settings=await createSettings(file);
  assert.equal(settings.get().mode,'manual');
  await settings.set({mode:'manual',manualDelivery:'clipboard',pdfWindow:'near2'});
  const restored=await createSettings(file);
  assert.equal(restored.get().manualDelivery,'clipboard');assert.equal(restored.get().pdfWindow,'near2');
  assert.throws(()=>restored.set({mode:'manual',manualDelivery:'unknown'}));
  assert.equal(restored.get().manualDelivery,'clipboard');
});

test('PDF search consent and note-save preference survive new origins and store restarts',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'paper-share-preferences-'));
  const file=path.join(directory,'settings.json');let settings=await createSettings(file);
  await settings.set({pdfSearch:true,linkAllowSave:false});settings=await createSettings(file);
  assert.equal(settings.get().pdfSearch,true);assert.equal(settings.get().linkAllowSave,false);
  assert.equal(settings.get().mode,'manual');
  await settings.set({panelWidth:500});assert.equal(settings.get().linkAllowSave,false);
  assert.throws(()=>settings.set({pdfSearch:'true'}));assert.throws(()=>settings.set({linkAllowSave:1}));
});

test('answer-note saving is an explicit opt-in independent of the old automatic permission',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'paper-note-opt-in-'));
  const file=path.join(directory,'settings.json');
  assert.equal((await createSettings()).get().linkSaveAnswer,false);
  await writeFile(file,JSON.stringify({mode:'manual',linkAllowSave:true}));
  let settings=await createSettings(file);
  assert.equal(settings.get().linkSaveAnswer,false,'Legacy automatic saving must not select the new checkbox');
  await settings.set({linkSaveAnswer:true});settings=await createSettings(file);
  assert.equal(settings.get().linkSaveAnswer,true);
  await settings.set({linkSaveAnswer:false});settings=await createSettings(file);
  assert.equal(settings.get().linkSaveAnswer,false);
  assert.throws(()=>settings.set({linkSaveAnswer:'true'}));
});
