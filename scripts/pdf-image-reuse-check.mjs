// electron scripts/pdf-image-reuse-check.mjs <NTK.pdf> <output-directory>
import {app} from 'electron';
import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createPdfRenderer} from '../pdf-render-service.mjs';
import {createAppServer} from '../server.mjs';
import {createAnnotations} from '../annotations.mjs';
import {pageNote} from '../reading-tools.mjs';
import {createLinkMcpServer} from '../link/mcp-server.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
const version=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version;
const resultData=result=>result.structuredContent||JSON.parse(result.content.find(item=>item.type==='text').text);
const [pdfPath,outputDirectory]=process.argv.slice(2),directory=await mkdtemp(path.join(os.tmpdir(),'reader-image-check-'));
app.setPath('userData',directory);app.setPath('sessionData',directory);app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  let server,renderer,client;const report={date:new Date().toISOString(),checks:[]};
  try{
    await mkdir(outputDirectory,{recursive:true});let origin,renders=0;renderer=createPdfRenderer(()=>origin);const render=renderer.render.bind(renderer);renderer.render=(...args)=>{renders++;return render(...args);};
    server=createAppServer({activeRequests:new Set()},{pdfRenderer:renderer,annotations:await createAnnotations(path.join(directory,'annotations')),settings:{get:()=>({mode:'manual'})},getOrigin:()=>origin,linkDiscoveryPath:path.join(directory,'connection.json')});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
    const bytes=await readFile(pdfPath),loaded=await renderer.load(createHash('sha256').update(bytes).digest('hex'),bytes,{pages:1000,text:12000000}),registered=await server.pdfs.register(bytes,loaded.documentId,'1806.07572v4.pdf');
    const shared=await server.link.share({...registered,documentId:loaded.documentId,fileName:'1806.07572v4.pdf',...pageNote(9),question:'Figure 3(c) image reuse and zoom',context:'',allowSave:false});
    const mcp=createLinkMcpServer({htmlPath:'',call:(method,args)=>server.link.call(method,args)}),[a,b]=InMemoryTransport.createLinkedPair();client=new Client({name:'real-image-test',version:'1'});await mcp.connect(a);await client.connect(b);
    const args={selectionId:shared.selectionId,page:9},call=extra=>client.callTool({name:'render_pdf_page',arguments:{...args,...extra}});
    const first=await call({}),second=await call({region:[0,0,1,1]}),third=await call({});
    const images=result=>result.content.filter(item=>item.type==='image');
    assert.equal(Buffer.from(images(first)[0].data,'base64').subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(images(first).length,1);assert.equal(images(second).length,0);assert.equal(images(third).length,0);assert.equal(renders,1);
    assert.equal(resultData(first).imageRef,resultData(second).imageRef);
    await writeFile(path.join(outputDirectory,`image-overview-${version}.png`),Buffer.from(images(first)[0].data,'base64'));
    const region=[.58,.08,.27,.22],crop=await call({region}),repeat=await call({region});
    assert.equal(images(crop).length,1);assert.equal(images(repeat).length,0);assert.equal(renders,2);
    assert.ok(resultData(crop).metadata.zoom>1);assert.ok(resultData(crop).metadata.width>resultData(first).metadata.width*region[2]);
    assert.ok(resultData(crop).metadata.width<=2000&&resultData(crop).metadata.height<=2000);
    await writeFile(path.join(outputDirectory,`image-figure3c-zoom-${version}.png`),Buffer.from(images(crop)[0].data,'base64'));
    const explicit=await call({region,resend:true,reason:'Integration test: earlier image is unavailable in context.'});assert.equal(images(explicit).length,1);assert.equal(renders,3);
    report.checks=[{name:'full-page repeat twice',result:'pass',imageBlocks:[images(first).length,images(second).length,images(third).length],imageRef:resultData(first).imageRef},{name:'high-resolution crop then repeat',result:'pass',region,overview:resultData(first).metadata,crop:resultData(crop).metadata,imageBlocks:[images(crop).length,images(repeat).length]},{name:'explicit context recovery',result:'pass',delivery:resultData(explicit).delivery}];
    report.trace=server.link.status().latest.trace;report.totalRenderCalls=renders;report.pngPayloadsReturned=3;report.note='Six tool calls returned only three PNGs: overview, zoom crop, and deliberate explicit recovery. Source images use an isolated temporary profile with no user credentials.';
    console.log(JSON.stringify({checks:report.checks.map(c=>c.name),renders,crop:resultData(crop).metadata}));
  }catch(error){report.error=error.stack;process.exitCode=1;console.error(error);}
  finally{await writeFile(path.join(outputDirectory,`image-reuse-local-${version}.json`),JSON.stringify(report,null,2)+'\n');await client?.close();await server?.link.close();await new Promise(resolve=>server?server.close(resolve):resolve());renderer?.close();await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(()=>{});app.exit(process.exitCode||0);}
});
