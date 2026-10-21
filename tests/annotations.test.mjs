import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAnnotations} from '../annotations.mjs';
import {notesMarkdown} from '../reading-tools.mjs';

test('PDF highlights and Markdown notes persist independently of conversations',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'paper-reader-annotations-'));
  let store=await createAnnotations(directory);
  const item={quote:'Selected text',note:'**claim** and [source](https://example.com)',color:'yellow',rotation:0,anchors:[{page:2,rects:[[.1,.2,.3,.04]]}]};
  const saved=await store.upsert('abcdef1234',item);
  assert.equal((await store.list('abcdef1234')).length,1);
  store=await createAnnotations(directory);
  assert.equal((await store.list('abcdef1234'))[0].note,item.note);
  assert.equal((await store.list('1234abcd')).length,0);
  const changed=await store.upsert('abcdef1234',{...saved,color:'green',note:'Updated',rotation:90});
  assert.equal(changed.createdAt,saved.createdAt);
  assert.equal((await store.list('abcdef1234')).length,1);
  await store.delete('abcdef1234',saved.id);
  assert.equal((await store.list('abcdef1234')).length,0);
  const names=(await readdir(directory)).filter(name=>name.endsWith('.json'));assert.equal(names.length,1);
  assert.equal(JSON.parse(await readFile(path.join(directory,names[0]),'utf8')).documentId,'abcdef1234');
});

test('rejects malformed geometry and edits of missing highlights',async()=>{
  const store=await createAnnotations(await mkdtemp(path.join(tmpdir(),'paper-reader-annotations-')));
  const item={quote:'x',note:'',color:'yellow',rotation:0,anchors:[{page:1,rects:[[.1,.1,.2,.03]]}]};
  await assert.rejects(store.upsert('../escape',item));
  await assert.rejects(store.upsert('abc',{...item,anchors:[{page:1,rects:[[.9,.1,.3,.03]]}]}));
  await assert.rejects(store.upsert('abc',{...item,rotation:45}));
  await assert.rejects(store.upsert('abc',{...item,id:'not-found'}));
});

test('read evidence persists across restart and edits and is included in Markdown export',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'paper-reader-evidence-'));
  const evidence={snapshotId:'a'.repeat(64),truncated:false,pages:[{page:6,text:true,image:true,regions:[[0,0,1,1]]}]};
  let store=await createAnnotations(directory);
  const saved=await store.upsert('abc',{quote:'question',note:'answer',color:'blue',rotation:0,anchors:[{page:1,rects:[[.1,.1,.2,.03]]}],evidence});
  evidence.pages[0].page=999;
  store=await createAnnotations(directory);
  const reopened=(await store.list('abc'))[0];assert.equal(reopened.evidence.pages[0].page,6);
  const {evidence:ignored,...withoutEvidence}=reopened;
  const changed=await store.upsert('abc',{...withoutEvidence,note:'edited'});assert.deepEqual(changed.evidence,reopened.evidence);
  assert.match(notesMarkdown('test.pdf',[changed]),/p\. 6 \(본문·이미지\)/);
  await assert.rejects(store.upsert('abc',{...saved,evidence:{...reopened.evidence,pages:[{...reopened.evidence.pages[0],page:-1}]}}),/근거/);
});
