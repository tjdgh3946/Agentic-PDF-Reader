import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAnnotations} from '../annotations.mjs';
import {createPaperLink} from '../paper-link.mjs';
import {pageNote} from '../reading-tools.mjs';
import {linkQuestion} from '../link-question.mjs';

const passage={documentId:'abc123',fileName:'sample.pdf',...pageNote(9),question:'기존 노트도 참고해줘.',context:'PDF context',allowSave:false,rotation:0};
const note=(text,page=9)=>({...pageNote(page),note:text,color:'yellow',rotation:0});
async function fixture(t){
  const directory=await mkdtemp(path.join(os.tmpdir(),'reader-notes-'));
  const annotations=await createAnnotations(path.join(directory,'annotations'));
  const link=createPaperLink({annotations,discoveryPath:path.join(directory,'connection.json'),getOrigin:()=> 'http://127.0.0.1:12345'});
  t.after(async()=>{await link.close();await rm(directory,{recursive:true,force:true});});
  return {directory,annotations,link};
}

test('AI answers and manual notes are readable without save permission and stay bound to their shared PDF',async t=>{
  const {annotations,link}=await fixture(t);
  const manual=await annotations.upsert('abc123',note('## 내 메모\nNTK의 $e^{-\\lambda_i t}$ 감소를 확인.'));
  const writable=await link.share({...passage,allowSave:true});
  const saved=await link.call('save_annotation',{selectionId:writable.selectionId,note:'## AI 답변\nFigure 3의 설명'});
  const shared=await link.share(passage),selectionId=shared.selectionId;
  assert.equal(shared.annotationsAvailable,true);assert.match(linkQuestion(shared),/list_annotations/);
  assert.match(linkQuestion({...shared,pdfAvailable:true}),/read_annotation/);
  const other=await annotations.upsert('def456',note('다른 문서의 비공개 메모'));
  await link.share({...passage,documentId:'def456',fileName:'other.pdf'});
  const found=await link.call('list_annotations',{selectionId,documentId:'def456'});
  assert.equal(found.total,2);assert.equal(found.authorship,'not_recorded');assert.equal(found.contentSource,'reader_annotations');
  assert.deepEqual(new Set(found.entries.map(item=>item.annotationId)),new Set([manual.id,saved.annotationId]));
  assert.equal((await link.call('read_annotation',{selectionId,annotationId:manual.id})).text,manual.note);
  assert.equal((await link.call('read_annotation',{selectionId,annotationId:saved.annotationId})).text,'## AI 답변\nFigure 3의 설명');
  await assert.rejects(link.call('read_annotation',{selectionId,annotationId:other.id}),/이 PDF/);
  await assert.rejects(link.call('list_annotations',{}),/만료/);
  await assert.rejects(link.call('save_annotation',{selectionId,note:'권한 없음'}),/읽기 전용/);
  const edited=await annotations.upsert('abc123',{...manual,note:'수정한 메모'});
  assert.equal((await link.call('read_annotation',{selectionId,annotationId:manual.id})).text,edited.note);
  await assert.rejects(link.call('list_annotations',{selectionId,revision:found.revision}),/변경/);
  await annotations.delete('abc123',manual.id);
  await assert.rejects(link.call('read_annotation',{selectionId,annotationId:manual.id}),/찾지 못/);
  assert.equal((await link.call('list_annotations',{selectionId})).total,1);
  await link.setEnabled(false);
  await assert.rejects(link.call('list_annotations',{selectionId}),/꺼져/);
  await link.setEnabled(true);
  await assert.rejects(link.call('list_annotations',{selectionId}),/만료/);
});

test('literal note search, page filters and stable pagination include empty highlights and preserve Unicode/LaTeX chunks',async t=>{
  const {annotations,link}=await fixture(t);
  const long='한글😀 $e^{-\\lambda_i t}$\n'.repeat(1000);
  const manual=await annotations.upsert('abc123',note(long,8));
  await annotations.upsert('abc123',{...note('',10),quote:'ＦＩＧＵＲＥ   THREE',anchors:[{page:10,rects:[[.1,.2,.4,.03]]}]});
  const selectionId=(await link.share(passage)).selectionId;
  const first=await link.call('list_annotations',{selectionId,limit:1});
  assert.equal(first.nextOffset,1);assert.equal(first.entries[0].annotationId,manual.id);
  const second=await link.call('list_annotations',{selectionId,limit:1,offset:first.nextOffset,revision:first.revision});
  assert.equal(second.nextOffset,null);assert.equal(second.entries[0].kind,'highlight');assert.equal(second.entries[0].noteCharacters,0);
  const search=await link.call('list_annotations',{selectionId,query:'figure three',pages:[10]});
  assert.equal(search.matched,1);assert.equal((await link.call('list_annotations',{selectionId,query:'figure three',pages:[8]})).matched,0);
  assert.equal((await link.call('list_annotations',{selectionId,query:'lambda_i'})).matched,1);
  let offset=0,reconstructed='';
  do{const chunk=await link.call('read_annotation',{selectionId,annotationId:manual.id,offset,maxCharacters:777});reconstructed+=chunk.text;offset=chunk.nextOffset;}while(offset!==null);
  assert.equal(reconstructed,long);
  const quote=await link.call('read_annotation',{selectionId,annotationId:manual.id,field:'quote'});
  assert.equal(quote.text,manual.quote);assert.deepEqual(quote.pages,[8]);
  for(const args of [{limit:0},{limit:21},{offset:-1},{pages:[0]},{query:'x'.repeat(501)}])await assert.rejects(link.call('list_annotations',{selectionId,...args}));
  for(const args of [{maxCharacters:8001},{offset:1000000},{field:'private'}])await assert.rejects(link.call('read_annotation',{selectionId,annotationId:manual.id,...args}));
  assert.equal((await link.call('list_annotations',{selectionId})).matched,2);
});

test('persisted notes can be read from a new share after restart; note reads never become primary PDF evidence',async t=>{
  const {annotations,link,directory}=await fixture(t);
  const item=await annotations.upsert('abc123',note('永続化済みのノート'));
  const selectionId=(await link.share({...passage,allowSave:true})).selectionId;
  await link.call('list_annotations',{selectionId});await link.call('read_annotation',{selectionId,annotationId:item.id});
  assert.ok(link.status().latest.trace.every(event=>event.pages.length===0));
  assert.deepEqual(link.status().latest.trace.at(-1).annotationPages,[9]);
  const saved=await link.call('save_annotation',{selectionId,note:'別の答え'});
  assert.equal((await annotations.list('abc123')).find(item=>item.id===saved.annotationId).evidence,undefined);
  await link.close();
  const reopened=await createAnnotations(path.join(directory,'annotations'));
  const next=createPaperLink({annotations:reopened,discoveryPath:path.join(directory,'new-connection.json'),getOrigin:()=> 'http://127.0.0.1:12345'});
  t.after(()=>next.close());
  const nextId=(await next.share(passage)).selectionId;
  assert.equal((await next.call('read_annotation',{selectionId:nextId,annotationId:item.id})).text,item.note);
});

test('in-flight note reads respect revocation and the shared read concurrency limit',async t=>{
  const {link}=await fixture(t);let release;
  const pending=new Promise(resolve=>{release=resolve;});
  // A separate delayed store makes the revocation race deterministic.
  const directory=await mkdtemp(path.join(os.tmpdir(),'reader-notes-race-'));
  const delayed=createPaperLink({annotations:{list:()=>pending},discoveryPath:path.join(directory,'connection.json'),getOrigin:()=> 'http://127.0.0.1:12345'});
  t.after(async()=>{await delayed.close();await rm(directory,{recursive:true,force:true});});
  const selectionId=(await delayed.share(passage)).selectionId;
  const reads=Array.from({length:3},()=>delayed.call('list_annotations',{selectionId}));
  await assert.rejects(delayed.call('list_annotations',{selectionId}),/작업이 진행/);
  await delayed.setEnabled(false);release([]);
  const outcomes=await Promise.allSettled(reads);assert.ok(outcomes.every(item=>item.status==='rejected'));
  const nextId=(await delayed.share(passage)).selectionId;
  assert.equal((await delayed.call('list_annotations',{selectionId:nextId})).total,0);
  await link.close();
});

test('note shares expire just like PDF shares',async t=>{
  const {annotations,directory}=await fixture(t);let now=Date.now();
  const link=createPaperLink({annotations,discoveryPath:path.join(directory,'expiry.json'),getOrigin:()=> 'http://127.0.0.1:12345',now:()=>now});
  t.after(()=>link.close());const selectionId=(await link.share(passage)).selectionId;
  now+=24*60*60*1000;
  await assert.rejects(link.call('list_annotations',{selectionId}),/만료/);
});
