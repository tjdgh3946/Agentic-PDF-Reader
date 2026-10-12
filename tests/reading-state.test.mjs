import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReadingState} from '../reading-state.mjs';
import {createAppServer} from '../server.mjs';

const state={page:5,zoom:.75,rotation:90,question:'NTK 초기화 조건은?'};
test('reading positions and drafts survive a restart and remain separate for each PDF',async()=>{
  const folder=await mkdtemp(path.join(tmpdir(),'paper-position-')),file=path.join(folder,'reading.json'),store=await createReadingState(file);
  await Promise.all([store.set('abc123',state),store.set('def456',{...state,page:2,zoom:'page-width',question:'다른 PDF'})]);
  const reopened=await createReadingState(file);assert.deepEqual(reopened.get('abc123'),state);assert.equal(reopened.get('def456').page,2);
  const copy=reopened.get('abc123');copy.question='mutated';assert.equal(reopened.get('abc123').question,state.question);
  assert.equal(reopened.get('cafe'),null);
  for(const bad of [{page:0},{zoom:100},{zoom:'unknown'},{rotation:1},{question:'a'.repeat(10001)}])assert.throws(()=>store.set('abc123',{...state,...bad}));
  assert.throws(()=>store.get('../../private'));
});
test('reading APIs obey the same local origin protection as PDF questions',async t=>{
  const reading=await createReadingState();let origin;
  const server=createAppServer({activeRequests:new Set()},{reading,settings:{get:()=>({mode:'manual'})},chats:{flush:async()=>{}},annotations:{flush:async()=>{}},getOrigin:()=>origin});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;t.after(()=>new Promise(resolve=>server.close(resolve)));
  const input={documentId:'abc123',...state},post=headers=>fetch(origin+'/api/reading',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(input)});
  assert.equal((await post({'X-Paper-Reader':'1',Origin:'https://other.invalid'})).status,403);
  assert.equal((await post({'X-Paper-Reader':'1',Origin:origin})).status,200);
  assert.deepEqual(await (await fetch(origin+'/api/reading?documentId=abc123',{headers:{'X-Paper-Reader':'1'}})).json(),state);
  assert.equal((await fetch(origin+'/reading-state.mjs')).status,404);
});
