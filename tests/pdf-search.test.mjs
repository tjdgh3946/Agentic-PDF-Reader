import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createQueryIndex,validateQuery} from '../pdf-query.mjs';
import {createPdfSnapshots,renderRegion} from '../pdf-snapshots.mjs';
import {createPaperLink} from '../paper-link.mjs';
import {createAppServer} from '../server.mjs';
import {pageNote} from '../reading-tools.mjs';
import {linkQuestion} from '../link-question.mjs';
import {createLinkMcpServer} from '../link/mcp-server.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {setTimeout as wait} from 'node:timers/promises';

const texts=['Theorem 2: neural tangent kernel initialization.', 'Figure 3: ﬂow and soft\u00adhyphen.'];
test('FTS5 preserves raw text, normalizes ligatures and supports parameterized CTE evidence',async t=>{
  const index=createQueryIndex(texts);t.after(()=>index.close());
  const found=await index.query("WITH hits AS (SELECT CAST(page_no AS INTEGER) AS page_no, snippet(page_fts,1,'[',']','…',20) AS excerpt FROM page_fts WHERE page_fts MATCH ?) SELECT * FROM hits",['"Theorem 2"']);
  assert.equal(found.rows[0].page_no,1);assert.match(found.rows[0].excerpt,/Theorem/);
  assert.equal((await index.query('SELECT page_no FROM page_fts WHERE page_fts MATCH ?',['flow'])).rows[0].page_no,2);
  assert.equal((await index.query('SELECT raw_text FROM pages WHERE page_no=:page',{page:2})).rows[0].raw_text,texts[1]);
  assert.equal((await index.query('SELECT raw_text FROM pages WHERE raw_text LIKE ?',['%notfound%'])).rows.length,0);
  assert.equal((await index.query("SELECT ';' AS marker; -- harmless comment")).rows[0].marker,';');
});
test('SQL denies schema/file access, unauthorized functions, mutations and multiple statements',async t=>{
  const index=createQueryIndex(texts);t.after(()=>index.close());
  for(const sql of ["SELECT * FROM sqlite_master","SELECT * FROM pragma_table_info('pages')","SELECT load_extension('evil')","SELECT randomblob(1000000000)","SELECT * FROM pages; DELETE FROM pages","WITH x AS (SELECT 1) DELETE FROM pages","ATTACH 'file.db' AS other",'PRAGMA query_only=OFF','SELECT * FROM "sqlite_master"']){
    await assert.rejects(async()=>index.query(sql));
  }
  assert.equal((await index.query('SELECT count(*) AS count FROM pages')).rows[0].count,2);
  assert.throws(()=>validateQuery('SELECT ?', ['a'.repeat(2001)]));
  const bounded=await index.query('WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<100) SELECT x FROM n');
  assert.equal(bounded.rows.length,20);assert.equal(bounded.truncated,true);
});
test('TeX split diaeresis remains searchable without modifying evidence; FTS errors explain quoting',async t=>{
  const raw='Applying Gr¨ onwall’s Lemma. Sch¨ olkopf. Non-polynomial functions. A standalone ¨ mark.';
  const index=createQueryIndex([raw]);t.after(()=>index.close());
  const sql='SELECT page_no FROM page_fts WHERE page_fts MATCH ?';
  for(const term of ['Gronwall','Grönwall','Scholkopf','"non-polynomial"']){
    assert.deepEqual((await index.query(sql,[term])).rows.map(row=>row.page_no),[1],term);
  }
  assert.equal((await index.query('SELECT raw_text FROM pages')).rows[0].raw_text,raw);
  await assert.rejects(index.query(sql,['non-polynomial']),/큰따옴표/);
  assert.equal((await index.query(sql,['functions'])).rows.length,1);
});
test('hard worker timeout recovers without blocking later reads',async t=>{
  const index=createQueryIndex(texts,{timeout:100});t.after(()=>index.close());
  await assert.rejects(index.query('WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n) SELECT sum(x) FROM n'),/제한 시간/);
  assert.equal((await index.query('SELECT count(*) AS count FROM pages')).rows[0].count,2);
});
test('idle SQL workers stop and rebuild the same search without invalidating queued queries',async t=>{
  const index=createQueryIndex(texts,{idleTimeout:20});t.after(()=>index.close());
  const sql='SELECT page_no FROM page_fts WHERE page_fts MATCH ?';
  assert.equal((await index.query(sql,['Theorem'])).rows[0].page_no,1);await wait(60);assert.equal(index.resident,false);
  const results=await Promise.all([index.query(sql,['Theorem']),index.query(sql,['Figure'])]);assert.deepEqual(results.map(r=>r.rows[0].page_no),[1,2]);
  await wait(60);assert.equal(index.resident,false);index.close();await assert.rejects(index.query(sql,['Theorem']),/종료/);
});

async function fixture(t){
  const base=fileURLToPath(new URL('../../../work/',import.meta.url));await mkdir(base,{recursive:true});
  const directory=await mkdtemp(path.join(base,'pdf-test-'));
  t.after(async()=>{assert.ok(path.relative(base,directory).startsWith('pdf-test-'));await rm(directory,{recursive:true,force:true});});
  const renderer={load:async()=>({documentId:'abc123',pages:texts}),render:async(_id,page,region)=>({image:{data:'aGVsbG8=',mimeType:'image/png'},metadata:{page,region,width:100,height:100}}),release(){},close(){}};
  const pdfs=createPdfSnapshots({renderer});t.after(()=>pdfs.close());
  const savedItems=[];
  const link=createPaperLink({pdfs,annotations:{upsert:async(documentId,item)=>{const saved={id:'note-id',documentId,...structuredClone(item)};savedItems.push(saved);return saved;},list:async()=>savedItems},getOrigin:()=> 'http://127.0.0.1:12345',discoveryPath:path.join(directory,'connection.json')});
  t.after(()=>link.close());
  const registered=await pdfs.register(Buffer.from('%PDF-1.7\nfixture'),'abc123','ntk.pdf');
  const shared=await link.share({snapshotId:registered.snapshotId,documentId:'abc123',fileName:'ntk.pdf',...pageNote(1),question:'Explain Figure 3',context:'',allowSave:true});
  return {pdfs,link,shared,renderer,directory,savedItems};
}
test('PDF snapshot stays fixed across document changes and is erased on revoke',async t=>{
  const {link,pdfs,shared}=await fixture(t);
  await link.share({documentId:'def456',fileName:'other.pdf',...pageNote(1),question:'Other question',context:'',allowSave:false});
  assert.equal((await link.call('inspect_pdf',{selectionId:shared.selectionId})).pageCount,2);
  const saved=await link.call('save_annotation',{selectionId:shared.selectionId,note:'Original document answer'});assert.equal(saved.saved,true);
  assert.match(linkQuestion(shared),/query_pdf/);assert.ok(!linkQuestion(shared).includes('Theorem 2'));
  await link.setEnabled(false);
  assert.throws(()=>pdfs.inspect(shared.snapshotId),/만료/);
});
test('revoke proceeds during an image request and no image is released afterward',async t=>{
  const {link,shared,renderer}=await fixture(t);let finish,started;
  const ready=new Promise(resolve=>started=resolve);
  renderer.render=()=>new Promise(resolve=>{finish=resolve;started();});
  const pending=link.call('render_pdf_page',{selectionId:shared.selectionId,page:1});
  await ready;await link.setEnabled(false);finish({image:{data:'private',mimeType:'image/png'}});
  await assert.rejects(pending,/만료|종료/);
});
test('MCP image is actual image content; structured output contains metadata only',async t=>{
  const {link,shared}=await fixture(t);
  const server=createLinkMcpServer({call:(method,args)=>link.call(method,args),htmlPath:''});
  const client=new Client({name:'image-test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
  await server.connect(a);await client.connect(b);t.after(()=>client.close());
  const image=await client.callTool({name:'render_pdf_page',arguments:{selectionId:shared.selectionId,page:2,region:[0,.1,1,.8]}});
  assert.equal(image.content[1].type,'image');assert.equal(image.content[1].mimeType,'image/png');
  assert.equal(image.structuredContent.image,undefined);assert.ok(!JSON.stringify(image.structuredContent).includes('aGVsbG8='));
  const search=await client.callTool({name:'query_pdf',arguments:{selectionId:shared.selectionId,sql:'SELECT page_no FROM pages WHERE raw_text LIKE ?',params:['%Figure%']}});
  assert.equal(search.structuredContent.rows[0].page_no,2);
  assert.equal(link.status().latest.trace.at(-1).pages[0],2);
});

test('saved evidence includes only successful reads/images and survives rolling trace overflow',async t=>{
  const {link,shared,savedItems}=await fixture(t);
  await link.call('query_pdf',{selectionId:shared.selectionId,sql:'SELECT page_no FROM pages',params:[]});
  await assert.rejects(link.call('read_pdf',{selectionId:shared.selectionId,pages:[99]}));
  await link.call('read_pdf',{selectionId:shared.selectionId,pages:[2]});
  await link.call('render_pdf_page',{selectionId:shared.selectionId,page:2,region:[0,.1,1,.8]});
  for(let i=0;i<15;i++)await link.call('inspect_pdf',{selectionId:shared.selectionId});
  assert.equal(link.status().latest.trace.length,12);
  await link.call('save_annotation',{selectionId:shared.selectionId,note:'answer with source'});
  assert.deepEqual(savedItems[0].evidence,{snapshotId:shared.snapshotId,truncated:false,pages:[{page:2,text:true,image:true,regions:[[0,.1,1,.8]]}]});
});
test('binary registration requires same-origin app request and separates PDF size from JSON cap',async t=>{
  let origin;
  const {renderer,directory}=await fixture(t);
  const server=createAppServer({activeRequests:new Set()},{pdfRenderer:renderer,settings:{get:()=>({mode:'manual'})},getOrigin:()=>origin,linkDiscoveryPath:path.join(directory,'http.json')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{await server.link.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const url=origin+'/api/link/pdf?documentId=abc123&fileName=ntk.pdf',body=Buffer.concat([Buffer.from('%PDF-1.7\n'),Buffer.alloc(1_600_000)]);
  assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/pdf'},body})).status,403);
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/pdf','X-Paper-Reader':'1',Origin:origin},body});
  assert.equal(response.status,200);assert.equal((await response.json()).pageCount,2);
});
test('image coordinates reject invalid or tiny crops',()=>{
  assert.deepEqual(renderRegion(),[0,0,1,1]);
  for(const region of [[0,0,0,1],[.9,0,.2,1],[-.1,0,1,1],[0,0,1,NaN]])assert.throws(()=>renderRegion(region));
});
