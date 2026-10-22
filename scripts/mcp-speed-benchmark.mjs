// electron scripts/mcp-speed-benchmark.mjs <NTK.pdf> <report.json>
// Separate profile and server. Never connects to or restarts the installed Reader.
import {app} from 'electron';
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {performance} from 'node:perf_hooks';
import {setTimeout as wait} from 'node:timers/promises';
import {createAppServer} from '../server.mjs';import {createPdfRenderer} from '../pdf-render-service.mjs';
import {createPdfSnapshots} from '../pdf-snapshots.mjs';import {createQueryIndex} from '../pdf-query.mjs';
import {buildPassages} from '../pdf-passages.mjs';import {textQuality} from '../pdf-text-quality.mjs';
import {createPaperLink} from '../paper-link.mjs';import {createShareArchive} from '../share-archive.mjs';import {pageNote} from '../reading-tools.mjs';
import {createLinkMcpServer} from '../link/mcp-server.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
const [pdfPath,reportPath]=process.argv.slice(2),directory=await mkdtemp(path.join(os.tmpdir(),'reader-speed-'));
app.setPath('userData',directory);app.setPath('sessionData',directory);app.on('window-all-closed',()=>{});
const timed=async fn=>{const start=performance.now(),value=await fn();return {ms:performance.now()-start,value};};
async function samples(fn,count=20){const values=[];for(let i=0;i<count;i++)values.push((await timed(()=>fn(i))).ms);values.sort((a,b)=>a-b);return {medianMs:values[Math.floor(values.length/2)],p95Ms:values[Math.min(values.length-1,Math.floor(values.length*.95))],samples:count};}
const secure={isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from(text),decryptString:bytes=>bytes.toString()};
app.whenReady().then(async()=>{
  let server,renderer,origin;const cleanup=[];
  const report={version:JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version,date:new Date().toISOString(),scope:'Local engine/MCP timings, not ChatGPT generation or public tunnel latency. Real NTK extraction plus a synthetic 950-page workload repeating public NTK text. Temporary AES archive with a test-only key wrapping adapter.',workloads:{}};
  try{
    renderer=createPdfRenderer(()=>origin);server=createAppServer({activeRequests:new Set()},{pdfRenderer:renderer,getOrigin:()=>origin,linkDiscoveryPath:path.join(directory,'unused-connection.json')});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
    const bytes=await readFile(pdfPath),hash=createHash('sha256').update(bytes).digest('hex');
    const extracted=await renderer.load(hash,bytes,{pages:1000,text:12000000});renderer.release(hash);
    for(const [name,pages,breaks] of [['ntk',extracted.pages,extracted.paragraphBreaks],['synthetic950',Array.from({length:950},(_,i)=>extracted.pages[i%extracted.pages.length]),Array.from({length:950},(_,i)=>extracted.paragraphBreaks?.[i%extracted.pages.length]||[])]]){
      const row=report.workloads[name]={pages:pages.length,characters:pages.reduce((n,p)=>n+p.length,0)};
      const pdfs=createPdfSnapshots({renderer:{load:async()=>({documentId:'abc123',pages,paragraphBreaks:breaks}),release(){},close(){}}});cleanup.push(()=>pdfs.close());
      const registration=await timed(()=>pdfs.register(bytes,'abc123',name+'.pdf')),id=registration.value.snapshotId;
      row.registerMs=registration.ms;row.workerStartedAtRegistration=pdfs.resources().searchWorkers>0;
      row.quality=samples(()=>textQuality(pages),5);row.inspect=await samples(()=>pdfs.inspect(id));row.quality=await row.quality;
      row.firstSearchMs=(await timed(()=>pdfs.search(id,{query:'kernel',limit:3}))).ms;
      row.repeatSearch=await samples(()=>pdfs.search(id,{query:'kernel',limit:3}));
      row.variedSearch=await samples(i=>pdfs.search(id,{query:['kernel','gradient','initialization','eigenvalues','convergence','training','function','matrix','positive','theorem'][i%10],limit:1+i%5}));
      const paragraphs=buildPassages(pages,breaks),index=createQueryIndex(pages,{passages:paragraphs});cleanup.push(()=>index.close());await index.ready();
      for(const [label,order] of [['bm25','bm25(paragraph_fts)'],['rank','rank']]){
        const sql='SELECT passage_id FROM paragraph_fts WHERE paragraph_fts MATCH ? ORDER BY '+order+' LIMIT ?';
        row[label]=await samples(i=>index.query(sql,[i%2?'kernel':'training',1+i%5]));
      }
      const short=createQueryIndex(pages,{passages:paragraphs,idleTimeout:25});cleanup.push(()=>short.close());
      const sql='SELECT page_no FROM page_fts WHERE page_fts MATCH ? LIMIT 3';await short.query(sql,['kernel']);await wait(80);assert.equal(short.resident,false);
      row.repeatAfterIdleMs=(await timed(()=>short.query(sql,['kernel']))).ms;
      row.novelAfterIdleMs=(await timed(async()=>{await wait(80);return short.query(sql,['training']);})).ms-80;
      const archive=createShareArchive(path.join(directory,name),secure),link=createPaperLink({pdfs,archive,annotations:{list:async()=>[]},getOrigin:()=>origin,discoveryPath:path.join(directory,name+'-connection.json')});cleanup.push(()=>link.close());
      const shared=await link.share({snapshotId:id,documentId:'abc123',fileName:name+'.pdf',...pageNote(9),question:'Explain the kernel.',context:'',allowSave:false});
      const mcp=createLinkMcpServer({htmlPath:'',call:(method,args)=>link.call(method,args)}),client=new Client({name:'speed-benchmark',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await mcp.connect(a);await client.connect(b);cleanup.push(()=>client.close());
      row.mcpSearchWithDurableArchive=await samples(()=>client.callTool({name:'search_pdf',arguments:{selectionId:shared.selectionId,query:'kernel',limit:3}}),10);
      const capabilities=(await client.listTools()).tools.find(tool=>tool.name==='search_pdf').inputSchema.properties;
      if(capabilities.readTop){
        const combined=await client.callTool({name:'search_pdf',arguments:{selectionId:shared.selectionId,query:'inflation',readTop:true,limit:1,maxCharacters:512}});
        assert.ok(combined.structuredContent.reading.characters>0);assert.ok(combined.structuredContent.reading.characters<=512);
        const duplicate=await client.callTool({name:'search_pdf',arguments:{selectionId:shared.selectionId,query:'inflation',readTop:true,limit:1,maxCharacters:512}});
        assert.equal(duplicate.structuredContent.reading.characters,0);
        const retry=duplicate.structuredContent.contextRecovery.retry;
        const recovered=await client.callTool({name:retry.tool,arguments:retry.arguments});assert.equal(recovered.structuredContent.pages[0].text,combined.structuredContent.reading.pages[0].text);
        row.singleCallSearchRead={toolCalls:1,sourceCharacters:combined.structuredContent.reading.characters,boundedSource:true,duplicateRecovery:true};
      }
      const first=await link.call('read_pdf',{selectionId:shared.selectionId,passageId:'p1.1'}),again=await link.call('read_pdf',{selectionId:shared.selectionId,passageId:'p1.1'});
      assert.ok(first.characters>0);assert.equal(again.characters,0);assert.ok(again.contextRecovery.retry);
      row.referenceGuardsPreserved=true;
      console.log(JSON.stringify({name,...row}));
      await client.close();await link.close();pdfs.close();index.close();short.close();
    }
  }catch(error){report.error=error.stack;process.exitCode=1;console.error(error.stack);}
  finally{for(const close of cleanup.reverse())try{await close();}catch{}await server?.link.close();server?.closeAllConnections();await new Promise(resolve=>server?server.close(resolve):resolve());renderer?.close();await mkdir(path.dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');app.exit(process.exitCode||0);}
});
