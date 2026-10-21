import test from 'node:test';
import assert from 'node:assert/strict';
import {extractPdfText} from '../pdf-text.mjs';
import {createPassageReader} from '../pdf-passages.mjs';
import {createPdfSnapshots} from '../pdf-snapshots.mjs';
import {createLinkMcpServer} from '../link/mcp-server.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';

const id='a'.repeat(64),otherId='b'.repeat(64);
test('PDF geometry adds paragraph boundaries without rewriting extracted text',()=>{
  const items=[{str:'Theorem 2',hasEOL:true,transform:[10,0,0,10,20,100]},{str:'Assume smoothness.',hasEOL:true,transform:[10,0,0,10,20,80]},{str:'Then NTK converges.',hasEOL:true,transform:[10,0,0,10,20,69]},{str:'Proof follows.',hasEOL:true,transform:[10,0,0,10,20,45]}];
  const {text,breaks}=extractPdfText(items);
  assert.equal(text,items.map(x=>x.str+'\n').join('').trim());
  const reader=createPassageReader(id,[text],[breaks]);
  assert.deepEqual(reader.passages.map(p=>p.text),['Theorem 2','Assume smoothness.\nThen NTK converges.','Proof follows.']);
});
test('bounded continuation preserves exact math/Unicode and never repeats adjacent forward source',()=>{
  const text='조건 😀 $e^{-\\lambda_i t}$\n'.repeat(260),reader=createPassageReader(id,[text+'\n\nConclusion.']);
  let result=reader.read({passageId:'p1.1',maxCharacters:129}),reconstructed='',lastEnd=0,calls=0;
  while(true){const item=result.pages[0];assert.ok(item.text.length<=129);assert.equal(item.start,lastEnd);lastEnd=item.end;reconstructed+=item.text;calls++;
    if(item.paragraphComplete||lastEnd===text.trimEnd().length)break;
    assert.ok(item.after);result=reader.expand({cursor:item.after,reason:'문단의 조건과 수식을 끝까지 확인',maxCharacters:129});
  }
  assert.ok(calls>2);assert.equal(reconstructed,text.trimEnd());
  assert.equal(reader.expand({cursor:result.pages[0].after,reason:'다음 결론 확인'}).pages[0].text,'Conclusion.');
});
test('before expansion reaches assumptions and crosses page boundaries without repeating the anchor',()=>{
  const reader=createPassageReader(id,['Earlier page assumptions.','Theorem statement.\n\nProof and qualification.']);
  const anchor=reader.read({passageId:'p2.1'}).pages[0];assert.equal(anchor.text,'Theorem statement.');
  const previous=reader.expand({cursor:anchor.before,reason:'정리 앞쪽의 가정을 확인'}).pages[0];assert.equal(previous.page,1);assert.equal(previous.text,'Earlier page assumptions.');assert.equal(previous.before,null);
  const next=reader.expand({cursor:anchor.after,reason:'정리 뒤의 단서 확인'}).pages[0];assert.equal(next.text,'Proof and qualification.');assert.equal(next.after,null);
  const tail=createPassageReader(id,['😀'.repeat(500)+' end','Next.']).read({passageId:'p2.1'}).pages[0];
  const reverse=createPassageReader(id,['😀'.repeat(500)+' end','Next.']).expand({cursor:tail.before,reason:'previous',maxCharacters:129}).pages[0];
  assert.ok(reverse.text.length<=129);assert.ok(!/^[\uDC00-\uDFFF]/.test(reverse.text));
});
test('page fallback is paragraph-only and total budget reports omitted pages and scans',()=>{
  const reader=createPassageReader(id,['a'.repeat(1000)+'\n\nDo not return this automatically.','b'.repeat(1000),'']);
  const result=reader.read({pages:[1,2,3],maxCharacters:128});
  assert.equal(result.characters,128);assert.equal(result.pages[0].paragraphComplete,false);assert.deepEqual(result.omittedRequestedPages,[2]);assert.deepEqual(result.emptyPages,[3]);
  for(const args of [{},{pages:[1],passageId:'p1.1'},{pages:[0]},{passageId:'p9.1'},{passageId:'p1.1',maxCharacters:4001},{passageId:'p1.1',maxCharacters:0}])assert.throws(()=>reader.read(args));
  for(const args of [{cursor:result.pages[0].after},{cursor:'bad',reason:'missing'},{cursor:otherId.slice(0,16)+result.pages[0].after.slice(16),reason:'other PDF'},{cursor:result.pages[0].after,reason:'x'.repeat(181)}])assert.throws(()=>reader.expand(args));
});
test('paragraph FTS, advanced SQL and exact bounded reads use the same immutable source',async t=>{
  const pages=['Assumptions: smooth activation.\n\nTheorem 2: constant kernel.\n\nProof with λ and \\sigma.','Figure 3: finite width.\n\n'+ 'large body '.repeat(500)];
  const pdfs=createPdfSnapshots({renderer:{load:async()=>({documentId:'abc123',pages}),release(){},close(){}}});t.after(()=>pdfs.close());
  const snapshot=await pdfs.register(Buffer.from('%PDF-1.7 test'),'abc123','test.pdf');
  const found=await pdfs.search(snapshot.snapshotId,{query:'"Theorem 2"'});assert.equal(found.matches[0].passageId,'p1.2');assert.ok(found.matches[0].excerpt.length<=220);
  const read=pdfs.read(snapshot.snapshotId,{passageId:found.matches[0].passageId});assert.equal(read.pages[0].text,'Theorem 2: constant kernel.');
  assert.match(pdfs.expand(snapshot.snapshotId,{cursor:read.pages[0].before,reason:'missing assumptions'}).pages[0].text,/Assumptions/);
  assert.equal((await pdfs.search(snapshot.snapshotId,{query:'kernel',pages:[2]})).matches.length,0);
  const raw=await pdfs.query(snapshot.snapshotId,'SELECT raw_text FROM pages WHERE page_no=2');assert.equal(raw.truncated,true);assert.ok(JSON.stringify(raw.rows).length<=4000);
  assert.equal((await pdfs.query(snapshot.snapshotId,'SELECT passage_id FROM paragraphs WHERE raw_text LIKE ?',['%constant%'])).rows[0].passage_id,'p1.2');
  await assert.rejects(pdfs.search(snapshot.snapshotId,{query:'kernel',limit:6}));
  pdfs.reset();assert.throws(()=>pdfs.read(snapshot.snapshotId,{passageId:'p1.2'}),/만료/);
});
test('MCP exposes bounded search/read/expand and does not duplicate source in text and structured output',async t=>{
  const calls=[],server=createLinkMcpServer({htmlPath:'',call:async(method,args)=>{calls.push({method,args});return {pages:[{page:1,text:'exact source'}]};}});
  const client=new Client({name:'paragraph-test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);t.after(()=>client.close());
  const selectionId='11111111-1111-4111-8111-111111111111';
  for(const [name,args] of [['search_pdf',{query:'NTK'}],['read_pdf',{passageId:'p1.2'}],['expand_pdf',{cursor:'cursor',reason:'missing assumptions'}]]){
    const result=await client.callTool({name,arguments:{selectionId,...args}});assert.equal(result.isError,undefined);assert.equal(result.structuredContent.pages[0].text,'exact source');assert.ok(!result.content[0].text.includes('exact source'));
  }
  assert.deepEqual(calls.map(x=>x.method),['search_pdf','read_pdf','expand_pdf']);
  for(const [name,args] of [['search_pdf',{query:'NTK',limit:6}],['read_pdf',{passageId:'p1.2',maxCharacters:99999}],['expand_pdf',{cursor:'cursor'}]])assert.equal((await client.callTool({name,arguments:{selectionId,...args}})).isError,true);
});
