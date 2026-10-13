// Same workload on an old packaged ASAR or current source, in an isolated profile.
// electron scripts/pdf-resource-check.mjs <NTK.pdf> <Hermes.pdf> <report.json> [moduleRoot]
import {app,BrowserWindow} from 'electron';
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as wait} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {pageNote} from '../reading-tools.mjs';
import {createAnnotations} from '../annotations.mjs';
import {createChats} from '../chats.mjs';
const [ntkPath,hermesPath,reportPath,moduleRoot]=process.argv.slice(2);
if(!ntkPath||!hermesPath||!reportPath)throw Error('Supply two public PDF paths and report path');
const directory=await mkdtemp(path.join(os.tmpdir(),'paper-reader-resources-'));
app.setPath('userData',directory);app.setPath('sessionData',directory);app.on('window-all-closed',()=>{});
const report={startedAt:new Date().toISOString(),variant:moduleRoot?'packaged 0.10.1 baseline':'0.10.2 source',electron:process.versions.electron,profile:'isolated temporary; no credentials',measurements:[],timings:[]};
let server,renderer;
const execute=promisify(execFile);
async function memory(stage){
  // The collector is itself a child of this Electron process. Exclude its
  // PowerShell/conhost processes from both sides of the comparison.
  const cmd=`$all=Get-CimInstance Win32_Process;$ids=[System.Collections.Generic.HashSet[int]]::new();[void]$ids.Add(${process.pid});do{$changed=$false;foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId)-and $ids.Add([int]$p.ProcessId)){$changed=$true}}}while($changed);$items=@(Get-Process -Id @($ids) -ErrorAction SilentlyContinue | Where-Object ProcessName -eq 'electron');ConvertTo-Json -Compress @{count=$items.Count;privateBytes=($items|Measure-Object PrivateMemorySize64 -Sum).Sum;workingSetBytes=($items|Measure-Object WorkingSet64 -Sum).Sum}`;
  const output=await execute('powershell.exe',['-NoProfile','-Command',cmd],{windowsHide:true,timeout:10000});
  report.measurements.push({stage,...JSON.parse(output.stdout),hiddenWindows:BrowserWindow.getAllWindows().length,...server.pdfs.resources?.()});
}
app.whenReady().then(async()=>{
  try{
    const root=moduleRoot?pathToFileURL(path.resolve(moduleRoot)+path.sep):new URL('../',import.meta.url);
    report.application=JSON.parse(await readFile(new URL('package.json',root),'utf8')).version;report.memoryScope='Electron app and SQLite worker descendants only; PowerShell/conhost collector excluded';
    report.variant=(moduleRoot?'packaged ':'source ')+report.application;
    const {createPdfRenderer}=await import(new URL('pdf-render-service.mjs',root));
    const {createAppServer}=await import(new URL('server.mjs',root));
    let origin;renderer=createPdfRenderer(()=>origin);
    server=createAppServer({activeRequests:new Set()},{pdfRenderer:renderer,getOrigin:()=>origin,annotations:await createAnnotations(path.join(directory,'notes')),chats:await createChats(path.join(directory,'chats')),linkDiscoveryPath:path.join(directory,'connection.json')});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
    const files=[{name:'NTK',bytes:await readFile(ntkPath),page:8,term:'kernel'},{name:'TraceMonkey',bytes:await readFile(new URL('../pdfjs/web/compressed.tracemonkey-pldi-09.pdf',import.meta.url)),page:2,term:'trace'},{name:'Hermes',bytes:await readFile(hermesPath),page:4,term:'revenue'}];
    for(let i=0;i<files.length;i++){
      const f=files[i],probe='fingerprint-'+i;
      const loaded=await renderer.load(probe,f.bytes,{pages:1000,text:12000000});renderer.release(probe);
      const snapshot=await server.pdfs.register(f.bytes,loaded.documentId,f.name+'.pdf');
      f.share=await server.link.share({snapshotId:snapshot.snapshotId,documentId:loaded.documentId,fileName:f.name+'.pdf',...pageNote(1),question:'Public resource check',context:'',allowSave:false});
    }
    async function calls(phase){
      for(const f of files){
        const args={selectionId:f.share.selectionId};let start=performance.now();
        const found=await server.link.call('query_pdf',{...args,sql:'SELECT page_no FROM page_fts WHERE page_fts MATCH ? LIMIT 5',params:[f.term]});assert.ok(found.rows.length);
        report.timings.push({phase,document:f.name,tool:'query_pdf',ms:Math.round(performance.now()-start)});
        start=performance.now();const png=await server.link.call('render_pdf_page',{...args,page:f.page});assert.ok(png.image.data.length>1000);
        report.timings.push({phase,document:f.name,tool:'render_pdf_page',ms:Math.round(performance.now()-start)});
      }
    }
    await calls('initial');await memory('three documents warm');
    const initialSession=report.application==='0.10.2'?BrowserWindow.getAllWindows()[0]?.webContents.session:null;
    await wait(35000);await memory('35 seconds idle');
    if(report.application==='0.10.2'){assert.deepEqual(server.pdfs.resources(),{snapshots:3,searchWorkers:0,renderers:0});assert.equal(BrowserWindow.getAllWindows().length,0);}
    await calls('resume same immutable shares');await memory('resumed');
    if(report.application==='0.10.2'){assert.equal(BrowserWindow.getAllWindows()[0].webContents.session,initialSession);report.rendererSessionReused=true;}
    await server.link.setEnabled(false);await wait(1500);await memory('revoked');assert.equal(BrowserWindow.getAllWindows().length,0);
    report.result='pass';
  }catch(error){report.result='fail';report.error=error.message;process.exitCode=1;}
  finally{
    report.finishedAt=new Date().toISOString();await mkdir(path.dirname(path.resolve(reportPath)),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2));
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.drain();}renderer?.close();app.exit(process.exitCode||0);
  }
}).catch(error=>{console.error(error.message);app.exit(1);});
