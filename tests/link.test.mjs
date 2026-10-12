import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import http from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createAnnotations} from '../annotations.mjs';
import {createPaperLink} from '../paper-link.mjs';
import {createAppServer} from '../server.mjs';
import {createBridgeClient} from '../link/bridge-client.mjs';
import {UI_URI} from '../link/mcp-server.mjs';
import {pageNote} from '../reading-tools.mjs';
import {linkQuestion} from '../link-question.mjs';

const base=fileURLToPath(new URL('../../../work/',import.meta.url));
const passage={documentId:'abc123',fileName:'sample.pdf',quote:'The selected passage.',question:'한국어로 설명해줘.',context:'Surrounding source text.',allowSave:true,rotation:90,anchors:[{page:2,rects:[[.1,.2,.4,.03]]}]};
test('a page question is saved as a page note without marking arbitrary source text',async t=>{
  const f=await fixture(t),link=createPaperLink({...f,getOrigin:()=> 'http://127.0.0.1:12345'});
  const shared=await link.share({...passage,...pageNote(5),context:'[페이지 5] NTK definition'});
  assert.equal(shared.scope,'page');assert.match(linkQuestion(shared),/현재 PDF 페이지/);
  await link.call('save_annotation',{selectionId:shared.selectionId,note:'페이지의 수식 설명'});
  const [saved]=await f.annotations.list(passage.documentId);assert.equal(saved.anchors[0].kind,'page-note');assert.equal(saved.anchors[0].page,5);
  const reopened=await createAnnotations(path.join(f.directory,'annotations'));assert.equal((await reopened.list(passage.documentId))[0].anchors[0].kind,'page-note');
  await link.close();
});
async function fixture(t){
  await mkdir(base,{recursive:true});const directory=await mkdtemp(path.join(base,'link-test-'));
  t.after(async()=>{const relative=path.relative(base,directory);assert.ok(relative.startsWith('link-test-')&&!relative.includes(path.sep));await rm(directory,{recursive:true,force:true});});
  const annotations=await createAnnotations(path.join(directory,'annotations')),discoveryPath=path.join(directory,'connection.json');
  return {directory,annotations,discoveryPath};
}
test('a late answer stays anchored to its original PDF; retries do not duplicate notes',async t=>{
  const f=await fixture(t),link=createPaperLink({...f,getOrigin:()=> 'http://127.0.0.1:12345'});
  const first=await link.share(passage);
  await link.share({...passage,documentId:'def456',fileName:'other.pdf',quote:'Different selection.'});
  const args={selectionId:first.selectionId,note:'## 핵심\n원래 문장의 설명입니다.'};
  const saved=await Promise.all([link.call('save_annotation',args),link.call('save_annotation',args)]);
  assert.equal(saved[0].annotationId,saved[1].annotationId);assert.equal(saved[1].duplicate,true);
  const items=await f.annotations.list(passage.documentId);
  assert.equal(items.length,1);assert.equal(items[0].note,args.note);assert.deepEqual(items[0].anchors,passage.anchors);assert.equal(items[0].rotation,90);
  assert.equal((await f.annotations.list('def456')).length,0);
  await assert.rejects(link.call('save_annotation',{...args,note:'Another answer'}),/이미 다른 답변/);
  const reopened=await createAnnotations(path.join(f.directory,'annotations'));assert.equal((await reopened.list('abc123'))[0].id,saved[0].annotationId);
  await f.annotations.delete('abc123',saved[0].annotationId);
  await assert.rejects(link.call('save_annotation',args),/수정되거나 삭제/);
  await link.close();
});
test('revocation rotates credentials, expires snapshots, and preserves existing annotations',async t=>{
  const f=await fixture(t);let now=Date.now();const link=createPaperLink({...f,getOrigin:()=> 'http://127.0.0.1:12345',now:()=>now});
  const first=await link.share(passage),credential=JSON.parse(await readFile(f.discoveryPath,'utf8'));
  assert.ok(link.authorize('Bearer '+credential.token));assert.equal(link.authorize('Bearer nope'),false);
  assert.ok(!JSON.stringify(link.status()).includes(credential.token));
  await link.call('save_annotation',{selectionId:first.selectionId,note:'Persisted answer'});
  await link.setEnabled(false);assert.equal(link.authorize('Bearer '+credential.token),false);
  await assert.rejects(readFile(f.discoveryPath),{code:'ENOENT'});
  await link.setEnabled(true);assert.equal(link.authorize('Bearer '+credential.token),false);
  await assert.rejects(link.call('get_selection',{selectionId:first.selectionId}),/만료/);
  assert.equal((await f.annotations.list('abc123')).length,1);
  const second=await link.share(passage);now+=24*60*60*1000;
  await assert.rejects(link.call('save_annotation',{selectionId:second.selectionId,note:'Expired'}),/만료/);
  await link.close();
});

test('text anchors survive a delayed ChatGPT answer, reopening and editing the note',async t=>{
  const f=await fixture(t),link=createPaperLink({...f,getOrigin:()=> 'http://127.0.0.1:12345'});
  const anchors=[{page:2,space:'page',textQuote:'Theselectedpassage.',textStart:27,rects:[[.1,.2,.4,.03]]}];
  const shared=await link.share({...passage,anchors});
  assert.equal(link.status().latest.documentId,passage.documentId);
  assert.equal(link.status().latest.annotationId,null);
  anchors[0].textStart=999; // A later UI selection must not move the shared anchor.
  await link.call('save_annotation',{selectionId:shared.selectionId,note:'Answer'});
  const store=await createAnnotations(path.join(f.directory,'annotations'));
  const [saved]=await store.list(passage.documentId);
  assert.equal(link.status().latest.annotationId,saved.id);
  assert.equal(link.status().latest.saved,true);
  assert.equal(saved.anchors[0].textStart,27);assert.equal(saved.anchors[0].space,'page');
  const edited=await store.upsert(passage.documentId,{...saved,note:'Edited answer'});
  assert.deepEqual(edited.anchors,saved.anchors);
  await link.close();
});
test('only validated explicit shares can be read or written',async t=>{
  const f=await fixture(t),link=createPaperLink({...f,getOrigin:()=> 'http://127.0.0.1:12345'});
  await assert.rejects(link.call('get_selection'),/꺼져/);
  for(const bad of [{documentId:'../../private'},{anchors:[{page:0,rects:[[0,0,1,1]]}]},{anchors:[{page:1,rects:[[.9,0,.2,1]]}]},{context:'a'.repeat(120001)},{rotation:23}])await assert.rejects(link.share({...passage,...bad}));
  assert.equal(link.status().enabled,false);
  const readonly=await link.share({...passage,allowSave:false});
  await assert.rejects(link.call('save_annotation',{selectionId:readonly.selectionId,note:'No'}),/읽기 전용/);
  await assert.rejects(link.call('read_file',{path:'identity/registration.json'}),/지원하지/);
  const data=(await link.call('get_selection')).selection;assert.equal(data.documentId,undefined);assert.equal(data.anchors,undefined);assert.equal(data.selectionId,readonly.selectionId);
  await link.close();
});
test('full stdio MCP loop uses the scoped bridge and writes a real persisted annotation',async t=>{
  const f=await fixture(t);let origin;
  const server=createAppServer({activeRequests:new Set()},{annotations:f.annotations,settings:{get:()=>({mode:'manual'})},chats:{flush:async()=>{}},linkDiscoveryPath:f.discoveryPath,getOrigin:()=>origin});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{await server.link.close();await new Promise(resolve=>server.close(resolve));});
  const request=(route,body,headers={})=>fetch(origin+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await request('/api/link/share',passage)).status,403);
  const shareResponse=await request('/api/link/share',passage,{'X-Paper-Reader':'1',Origin:origin});assert.equal(shareResponse.status,200);
  const shared=await shareResponse.json(),credential=JSON.parse(await readFile(f.discoveryPath,'utf8'));
  assert.equal((await request('/link/rpc',{method:'get_selection'})).status,403);
  assert.equal((await request('/link/rpc',{method:'get_selection'},{Authorization:'Bearer '+credential.token,Origin:'https://attacker.invalid'})).status,403);
  assert.equal((await fetch(origin+'/link/bridge-client.mjs')).status,404);
  assert.equal((await fetch(origin+'/link-question.mjs')).status,200);
  const rebound=await new Promise((resolve,reject)=>{const req=http.request(origin+'/link/rpc',{method:'POST',headers:{Host:'evil.invalid','Content-Type':'application/json',Authorization:'Bearer '+credential.token}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end('{"method":"get_selection"}');});assert.equal(rebound,403);
  const client=new Client({name:'paper-link-test',version:'1.0.0'});
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../plugins/paper-reader-link/server.bundle.mjs',import.meta.url)),'--connection',f.discoveryPath],stderr:'pipe'});
  await client.connect(transport);t.after(()=>client.close());
  const catalog=await client.listTools();assert.deepEqual(catalog.tools.map(tool=>tool.name),['open_paper_reader','get_selection','save_annotation','inspect_pdf','query_pdf','read_pdf','render_pdf_page']);
  // ChatGPT tool import needs homogeneous array items, not JSON Schema tuples.
  const cropSchema=catalog.tools.find(tool=>tool.name==='render_pdf_page').inputSchema.properties.region;
  assert.equal(cropSchema.items.type,'number');assert.equal(cropSchema.minItems,4);assert.equal(cropSchema.maxItems,4);
  assert.equal(catalog.tools[0]._meta['openai/ui'].entrypoints[0].type,'thread');
  const opened=await client.callTool({name:'open_paper_reader',arguments:{}});assert.equal(opened.structuredContent.selection.selectionId,shared.selectionId);
  const resource=await client.readResource({uri:UI_URI});assert.equal(resource.contents[0].mimeType,'text/html;profile=mcp-app');assert.ok(resource.contents[0].text.includes('Paper Reader Link'));
  const answer='**로컬 왕복 검증**\n선택한 문장의 해설입니다.';
  const saved=await client.callTool({name:'save_annotation',arguments:{selectionId:shared.selectionId,note:answer}});assert.equal(saved.structuredContent.saved,true);
  const response=await fetch(origin+'/api/annotations?documentId=abc123',{headers:{'X-Paper-Reader':'1'}});
  assert.equal((await response.json())[0].note,answer);
  const invalid=await client.callTool({name:'save_annotation',arguments:{selectionId:shared.selectionId,note:''}});assert.equal(invalid.isError,true);
  await server.link.setEnabled(false);
  const revoked=await client.callTool({name:'get_selection',arguments:{selectionId:shared.selectionId}});assert.equal(revoked.isError,true);
});
test('discovery files cannot turn the bridge client into a remote credential sender',async t=>{
  const f=await fixture(t);await writeFile(f.discoveryPath,JSON.stringify({version:1,origin:'https://attacker.invalid',token:'a'.repeat(64)}));
  await assert.rejects(createBridgeClient(f.discoveryPath)('get_selection'),/올바르지/);
});
