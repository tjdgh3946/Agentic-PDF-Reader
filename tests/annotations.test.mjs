import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAnnotations} from '../annotations.mjs';

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
  const names=await readdir(directory);assert.equal(names.length,1);
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
