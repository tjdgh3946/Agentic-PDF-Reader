// Reproduce the initialization race through the actual pinned tunnel binary.
// No hosted tunnel, credentials, or user PDFs: loopback dev proxy + real Reader MCP.
// Run: node scripts/mcp-lifecycle-check.mjs [output-directory]
import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.resolve(process.argv[2]||path.join(root,'../outputs'));
const version=JSON.parse(await readFile(path.join(root,'package.json'))).version;
const pin=JSON.parse(await readFile(path.join(root,'build/tunnel-client.json')));
const binary=path.join(root,'build/link-payload/tools/tunnel-client.exe');
assert.equal(createHash('sha256').update(await readFile(binary)).digest('hex'),pin.executableSha256);
const directory=await mkdtemp(path.join(os.tmpdir(),'reader-mcp-lifecycle-'));
const report={date:new Date().toISOString(),appVersion:version,tunnelVersion:pin.version,scope:'Offline real tunnel-client dev proxy + real Reader MCP; no hosted credentials or user data',scenarios:[]};
try{
 const fixture=path.join(directory,'server.mjs');
 await writeFile(fixture,`import fs from 'node:fs';
import {createLinkMcpServer} from ${JSON.stringify(pathToFileURL(path.join(root,'link/mcp-server.mjs')).href)};
import {StdioServerTransport} from ${JSON.stringify(pathToFileURL(path.join(root,'node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js')).href)};
const server=createLinkMcpServer({htmlPath:'',call:async(method,args)=>method==='render_pdf_page'?{imageReturned:true,imageRef:'fixture-image',delivery:'image',image:{mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='}}:{ok:true,method}});
const transport=new StdioServerTransport();const start=transport.start.bind(transport);
transport.start=async()=>{await start();const next=transport.onmessage;transport.onmessage=message=>{fs.appendFileSync(process.env.PAPER_LIFECYCLE_TRACE,JSON.stringify({method:message.method,id:message.id})+'\\n');next(message);};};
await server.connect(transport);
`);
 for(const shim of [false,true]){
  const traceFile=path.join(directory,'trace-'+shim+'.jsonl'),urlFile=path.join(directory,'url-'+shim+'.json');
  const command='"'+process.execPath.replaceAll('\\','/')+'" "'+fixture.replaceAll('\\','/')+'"';
  const env={...process.env,MCP_STDIO_SEND_INITIALIZED_NOTIFICATION:String(shim),PAPER_LIFECYCLE_TRACE:traceFile};delete env.CONTROL_PLANE_API_KEY;
  let diagnostic='',exitCode;
  const child=spawn(binary,['dev','proxy','--listen','127.0.0.1:0','--health-listen-addr','127.0.0.1:0','--mcp-command',command,'--url-file',urlFile,'--duration','15s'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>{exitCode=code;resolve(code);});});
  child.stdout.on('data',b=>{diagnostic=(diagnostic+b).slice(-4000);});child.stderr.on('data',b=>{diagnostic=(diagnostic+b).slice(-4000);});
  try{
   let info;for(let i=0;i<70;i++){try{info=JSON.parse(await readFile(urlFile));break;}catch{}if(exitCode!==undefined)break;await delay(100);}
   assert.ok(info,'Proxy did not start: '+diagnostic);
   const call=async(method,id,params={})=>{const r=await fetch(info.mcp_url,{method:'POST',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',...(id===null?{}:{id}),method,params})});const raw=await r.text();return {status:r.status,data:raw?JSON.parse(raw):null};};
   const selectionId='11111111-1111-4111-8111-111111111111',search={name:'search_pdf',arguments:{selectionId,query:'inflation'}};
   const initial=await call('tools/call','before-init',search);assert.equal(initial.status,409);assert.equal(initial.data.error.code,-32002);
   const init={protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'lifecycle-check',version:'1'}};
   assert.equal((await call('initialize','A',init)).status,200);
   const missingNotification=await call('tools/call','missing-notification',search);assert.equal(missingNotification.status,shim?200:409);
   await call('notifications/initialized',null);
   // A is ready. B reinitializes the SAME stdio child, but its upstream
   // initialized notification is delayed until after A's next operations.
   assert.equal((await call('initialize','B',init)).status,200);
   const racedSearch=await call('tools/call','A-search',search);
   const racedImage=await call('tools/call','A-image',{name:'render_pdf_page',arguments:{selectionId,page:9}});
   assert.equal(racedSearch.status,shim?200:409);assert.equal(racedImage.status,shim?200:409);
   if(shim){assert.equal(racedImage.data.result.content.filter(c=>c.type==='image').length,1);assert.ok(racedImage.data.result.content[0].text.includes('content_items'));}
   assert.equal((await call('notifications/initialized',null)).status,200);
   assert.equal((await call('tools/call','after-B-notification',search)).status,200);
   const messages=(await readFile(traceFile,'utf8')).trim().split('\n').map(JSON.parse);
   assert.equal(messages.filter(m=>m.method==='initialize').length,2);
   assert.equal(messages.filter(m=>m.method==='notifications/initialized').length,2,'Each initialize must notify exactly once; late duplicates are suppressed');
   assert.equal(messages.some(m=>m.id==='before-init'),false,'Pre-initialize operations must remain blocked');
   report.scenarios.push({shim,initialWithoutInitialize:initial.status,missingNotification:missingNotification.status,reinitializedSearch:racedSearch.status,reinitializedImage:racedImage.status,imageBlocks:shim?1:0,initializeCount:2,downstreamInitializedNotifications:2,lateDuplicatesSuppressed:shim});
  }finally{await exited;assert.equal(exitCode,0,'Bounded dev proxy failed: '+diagnostic);}
 }
 report.result='pass';console.log(JSON.stringify(report));
}catch(error){report.result='fail';report.error=error.message;process.exitCode=1;console.error(error.message);}
finally{await mkdir(output,{recursive:true});await writeFile(path.join(output,`mcp-lifecycle-${version}.json`),JSON.stringify(report,null,2)+'\n');await rm(directory,{recursive:true,force:true,maxRetries:4,retryDelay:100});}
