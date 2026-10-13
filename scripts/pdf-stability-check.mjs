// Real Electron/PDF.js/SQLite integration check, using its own temporary profile.
// electron scripts/pdf-stability-check.mjs <NTK.pdf> <report.json>
import {app,BrowserWindow} from 'electron';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createPdfRenderer} from '../pdf-render-service.mjs';
import {createAppServer} from '../server.mjs';
import {createAnnotations} from '../annotations.mjs';
import {createChats} from '../chats.mjs';
import {createReadingState} from '../reading-state.mjs';
import {pageNote} from '../reading-tools.mjs';

const [pdfPath,reportPath]=process.argv.slice(2);
if(!pdfPath||!reportPath)throw Error('Supply NTK PDF and output report paths.');
const directory=await mkdtemp(path.join(os.tmpdir(),'paper-reader-stability-'));
app.setPath('userData',directory);app.setPath('sessionData',directory);
app.on('window-all-closed',()=>{}); // Keep the headless test alive between PDF cycles.
const report={at:new Date().toISOString(),electron:process.versions.electron,node:process.versions.node,checks:[],timings:[],profile:'isolated temporary profile; no account credentials',profileDirectory:directory};
let server,renderer;
const checkpoint=(name,data={})=>{report.checks.push({name,result:'pass',...data});console.log(name);};
// Electron completes application module loading before emitting ready. Do not
// await readiness at ESM top level; schedule the test after the module resolves.
app.whenReady().then(async()=>{
try{
  let origin;renderer=createPdfRenderer(()=>origin);
  const annotations=await createAnnotations(path.join(directory,'annotations'));
  server=createAppServer({activeRequests:new Set()},{pdfRenderer:renderer,annotations,chats:await createChats(path.join(directory,'chats')),reading:await createReadingState(path.join(directory,'reading.json')),settings:{get:()=>({mode:'manual'})},getOrigin:()=>origin,linkDiscoveryPath:path.join(directory,'connection.json')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  const ntk=await readFile(pdfPath),sample=await readFile(new URL('../pdfjs/web/compressed.tracemonkey-pldi-09.pdf',import.meta.url));
  async function register(bytes,name){
    const id=createHash('sha256').update(bytes).digest('hex');
    const loaded=await renderer.load(id,bytes,{pages:1000,text:12_000_000});renderer.release(id);
    return {documentId:loaded.documentId,...await server.pdfs.register(bytes,loaded.documentId,name)};
  }
  const a=await register(ntk,'same-name.pdf'),b=await register(sample,'same-name.pdf');
  assert.notEqual(a.documentId,b.documentId);assert.equal(a.pageCount,19);
  const shareA=await server.link.share({...a,fileName:'same-name.pdf',...pageNote(1),question:'NTK stability check',context:'',allowSave:true});
  const args={selectionId:shareA.selectionId};
  await server.link.call('read_pdf',{...args,pages:[8,9]});
  const png=await server.link.call('render_pdf_page',{...args,page:9,region:[.1,.1,.8,.3]});
  assert.equal(png.image.mimeType,'image/png');assert.ok(png.image.data.length>1000);
  checkpoint('real text and cropped PNG',{pages:[8,9],image:png.metadata});
  await server.link.share({...b,fileName:'same-name.pdf',...pageNote(1),question:'Other document',context:'',allowSave:false});
  const saved=await server.link.call('save_annotation',{...args,note:'Stability check answer; source p.8–9.'});
  const duplicate=await server.link.call('save_annotation',{...args,note:'Stability check answer; source p.8–9.'});
  assert.equal(duplicate.annotationId,saved.annotationId);assert.equal((await annotations.list(b.documentId)).length,0);
  const reopened=await createAnnotations(path.join(directory,'annotations'));
  const notes=await reopened.list(a.documentId);assert.equal(notes.length,1);assert.deepEqual(notes[0].evidence.pages.map(p=>p.page),[8,9]);
  checkpoint('same filename document switch, duplicate save and storage reopen',{evidence:notes[0].evidence.pages});
  // The other document's storage checks are complete. Release its renderer so
  // the fault is injected into NTK, rather than an unrelated hidden window.
  renderer.release(b.snapshotId);assert.equal(BrowserWindow.getAllWindows().length,1);
  const window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===origin+'/pdf-renderer.html');
  assert.ok(window);const crashed=once(window.webContents,'render-process-gone');window.webContents.forcefullyCrashRenderer();await crashed;
  const afterCrash=await server.link.call('render_pdf_page',{...args,page:9});assert.ok(afterCrash.image.data.length>1000);
  assert.equal(BrowserWindow.getAllWindows().length,1);
  checkpoint('renderer crash recovered without resharing');
  await assert.rejects(server.link.call('query_pdf',{...args,sql:'WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n) SELECT sum(x) FROM n'}),/제한 시간/);
  const recovered=await server.link.call('query_pdf',{...args,sql:'SELECT count(*) AS count FROM pages'});assert.equal(recovered.rows[0].count,19);
  checkpoint('SQL hard timeout followed by successful query');
  for(let i=0;i<50;i++){
    const start=performance.now(),tool=i%5===0?'render_pdf_page':'query_pdf';
    await server.link.call(tool,{...args,...(tool==='render_pdf_page'?{page:8+i%2}:{sql:'SELECT page_no FROM page_fts WHERE page_fts MATCH ?',params:['Gronwall']})});
    report.timings.push({tool,ms:Math.round(performance.now()-start)});
  }
  checkpoint('50 sequential real search/image calls');
  await server.link.setEnabled(false);
  await assert.rejects(server.link.call('render_pdf_page',{...args,page:9}),/꺼져/);
  assert.equal(BrowserWindow.getAllWindows().length,0);
  checkpoint('revoke removes render windows and denies old selection');
  for(let i=0;i<10;i++){await register(i%2?sample:ntk,'reopen.pdf');server.pdfs.reset();assert.equal(BrowserWindow.getAllWindows().length,0);}
  checkpoint('10 PDF open/release cycles without remaining render windows');
  assert.equal((await fetch(origin+'/pdf-evidence.mjs')).status,200);
  assert.equal((await fetch(origin+'/auth.mjs')).status,404);
  checkpoint('browser evidence module available; backend auth module private');
  report.memory=process.memoryUsage();report.result='pass';
}catch(error){report.result='fail';report.error=error.message;process.exitCode=1;console.error(error.message);}
finally{
  await mkdir(path.dirname(path.resolve(reportPath)),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.drain();}renderer?.close();
  // Windows Chromium holds profile files until process exit. The caller can
  // remove this named temporary profile after the process has exited.
  app.exit(process.exitCode||0);
}
}).catch(error=>{console.error(error.message);app.exit(1);});
