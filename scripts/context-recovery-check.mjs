// electron scripts/context-recovery-check.mjs <NTK.pdf> <report.json>
// Isolated real PDF.js/MCP test: deliberately discard first source payloads,
// then follow only the reference response's bounded recovery requests.
import {app} from 'electron';
import {readFile,writeFile,mkdtemp,mkdir,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {createPdfRenderer} from '../pdf-render-service.mjs';import {createAppServer} from '../server.mjs';
import {createAnnotations} from '../annotations.mjs';import {pageNote} from '../reading-tools.mjs';
import {createLinkMcpServer} from '../link/mcp-server.mjs';import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
const [pdfPath,reportPath,mode]=process.argv.slice(2),directory=await mkdtemp(path.join(os.tmpdir(),'reader-context-recovery-'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
app.setPath('userData',directory);app.setPath('sessionData',directory);app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{let server,renderer,client;const report={version:JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version,date:new Date().toISOString(),scope:'Real NTK PDF.js + SQLite + MCP envelopes in an isolated store. Earlier payloads are deliberately discarded; this simulates unavailable evidence, not actual ChatGPT compaction.',checks:{}};
try{
  let origin;renderer=createPdfRenderer(()=>origin);server=createAppServer({activeRequests:new Set()},{pdfRenderer:renderer,annotations:await createAnnotations(path.join(directory,'notes')),settings:{get:()=>({mode:'manual'})},getOrigin:()=>origin,linkDiscoveryPath:path.join(directory,'connection.json')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  const bytes=await readFile(pdfPath),hash=digest(bytes),loaded=await renderer.load(hash,bytes,{pages:1000,text:12000000}),registered=await server.pdfs.register(bytes,loaded.documentId,'1806.07572v4.pdf');
  const shared=await server.link.share({...registered,documentId:loaded.documentId,fileName:'1806.07572v4.pdf',...pageNote(9),question:'Recover missing exact source and Figure 3(c).',context:'',allowSave:false});
  const mcp=createLinkMcpServer({htmlPath:'',call:(method,args)=>server.link.call(method,args)}),[a,b]=InMemoryTransport.createLinkedPair();client=new Client({name:'missing-context-test',version:'1'});await mcp.connect(a);await client.connect(b);
  const call=(name,args)=>client.callTool({name,arguments:{selectionId:shared.selectionId,...args}}),images=result=>result.content.filter(item=>item.type==='image');
  const found=(await call('search_pdf',{query:'inflation'})).structuredContent;assert.ok(found.matches.length);
  const args={passageId:found.matches[0].passageId,maxCharacters:512};let first=await call('read_pdf',args);
  const textHash=digest(first.structuredContent.pages[0].text),textRef=first.structuredContent.pages[0].textRef;first=null;
  const textReference=await call('read_pdf',args);assert.equal(textReference.structuredContent.characters,0);assert.match(textReference.content[0].text,/REFERENCE ONLY/);
  const textPlan=textReference.structuredContent.contextRecovery.retry;
  const text=await client.callTool({name:textPlan.tool,arguments:textPlan.arguments});assert.equal(digest(text.structuredContent.pages[0].text),textHash);assert.equal(text.structuredContent.pages[0].textRef,textRef);
  const region=[.58,.08,.27,.22];let original=await call('render_pdf_page',{page:9,region});assert.equal(images(original).length,1);
  const imageHash=digest(Buffer.from(images(original)[0].data,'base64')),imageRef=original.structuredContent.imageRef;original=null;
  const reference=await call('render_pdf_page',{page:9,region});assert.equal(images(reference).length,0);assert.equal(reference.structuredContent.contextRecovery.sourceIncluded,false);
  const imagePlan=reference.structuredContent.contextRecovery.retry,image=await client.callTool({name:imagePlan.tool,arguments:imagePlan.arguments});assert.equal(images(image).length,1);assert.equal(image.structuredContent.delivery,'resend');assert.equal(image.structuredContent.imageRef,imageRef);const resendHash=digest(Buffer.from(images(image)[0].data,'base64'));const delivered=server.link.deliveries(loaded.documentId,shared.selectionId).events.filter(event=>event.items.some(item=>item.kind==='image'&&item.sha256));for(const event of delivered){const cached=await server.link.deliveryImage(loaded.documentId,shared.selectionId,event.id);assert.equal(digest(Buffer.from(cached.data,'base64')),event.items[0].sha256);}assert.equal(delivered[0].items[0].sha256,imageHash);assert.equal(delivered.at(-1).items[0].sha256,resendHash);
  const outputImage=path.join(path.dirname(reportPath),'context-recovered-figure3c-'+report.version+'.png');await writeFile(outputImage,Buffer.from(images(image)[0].data,'base64'));
  report.checks={referenceContainsNoText:true,textRecoveryPreservesExactRange:true,textRecoveryHashMatches:true,referenceContainsNoImage:true,imageResendPreservesRegionAndRef:true,eachDeliveredPngMatchesItsRecordedHash:true,originalPdfUnchanged:digest(await readFile(pdfPath))===hash,noNotesWritten:(await server.link.call('list_annotations',{selectionId:shared.selectionId})).total===0};
  report.text={passageId:args.passageId,characters:text.structuredContent.characters,textRef,sha256:textHash};report.image={...image.structuredContent.metadata,imageRef,sha256:resendHash,firstSha256:imageHash};report.trace=server.link.status().latest.trace;
  console.log(JSON.stringify({checks:report.checks,text:report.text,image:report.image}));
  if(mode==='--serve'){const stopFile=path.join(directory,'stop');await writeFile(path.join(path.dirname(reportPath),'delivery-ui-info-0.14.2.json'),JSON.stringify({origin,selectionId:shared.selectionId,documentId:loaded.documentId,stopFile}));console.log('UI ready '+origin);while(true){try{await access(stopFile);break;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}}
}catch(error){report.error=error.stack;process.exitCode=1;console.error(error.message);}
finally{await mkdir(path.dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');await client?.close();await server?.link.close();await new Promise(resolve=>server?server.close(resolve):resolve());renderer?.close();app.exit(process.exitCode||0);}

});
