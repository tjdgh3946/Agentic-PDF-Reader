// Real PDF.js + FTS + cursor integration, isolated from user credentials.
// electron scripts/pdf-paragraph-check.mjs <PDF> <report.json>
import {app} from 'electron';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createPdfRenderer} from '../pdf-render-service.mjs';
import {createAppServer} from '../server.mjs';
import {createAnnotations} from '../annotations.mjs';
import {pageNote} from '../reading-tools.mjs';
const [pdfPath,reportPath]=process.argv.slice(2),directory=await mkdtemp(path.join(os.tmpdir(),'paper-paragraph-'));
app.setPath('userData',directory);app.setPath('sessionData',directory);app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  let server,renderer;const report={date:new Date().toISOString(),checks:[]};
  try{
    let origin;renderer=createPdfRenderer(()=>origin);
    server=createAppServer({activeRequests:new Set()},{pdfRenderer:renderer,annotations:await createAnnotations(path.join(directory,'annotations')),settings:{get:()=>({mode:'manual'})},getOrigin:()=>origin,linkDiscoveryPath:path.join(directory,'connection.json')});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
    const bytes=await readFile(pdfPath),loaded=await renderer.load(createHash('sha256').update(bytes).digest('hex'),bytes,{pages:1000,text:12000000});
    const registered=await server.pdfs.register(bytes,loaded.documentId,'1806.07572v4.pdf');
    const shared=await server.link.share({...registered,documentId:loaded.documentId,fileName:'1806.07572v4.pdf',...pageNote(6),question:'Theorem 2 assumptions and conclusion',context:'',allowSave:false});
    const args={selectionId:shared.selectionId},search=await server.link.call('search_pdf',{...args,query:'"Theorem 2"',pages:[6]});
    assert.ok(search.matches.length);const first=await server.link.call('read_pdf',{...args,passageId:search.matches[0].passageId,maxCharacters:256});
    const anchor=first.pages[0];assert.ok(anchor.text.length<=256);assert.equal(loaded.pages[anchor.page-1].slice(anchor.start,anchor.end),anchor.text);
    const expanded=[];let cursor=anchor.after;
    for(let i=0;i<2&&cursor;i++){
      const result=await server.link.call('expand_pdf',{...args,cursor,reason:'정리의 가정과 결론을 잘리지 않게 확인',maxCharacters:512});
      assert.ok(result.characters<=512);const part=result.pages[0];assert.equal(loaded.pages[part.page-1].slice(part.start,part.end),part.text);
      const previous=expanded.at(-1)||anchor;if(part.passageId===previous.passageId)assert.equal(part.start,previous.end);
      expanded.push(part);cursor=part.after;if(part.page>6)break;
    }
    assert.ok(expanded.length);const before=anchor.before?await server.link.call('expand_pdf',{...args,cursor:anchor.before,reason:'정리 앞의 추가 가정 확인',maxCharacters:512}):null;
    const figure=await server.link.call('search_pdf',{...args,query:'"Figure 3"',pages:[9]});assert.ok(figure.matches.length);
    const sql=await server.link.call('query_pdf',{...args,sql:'SELECT raw_text FROM pages WHERE page_no=6'});assert.ok(JSON.stringify(sql.rows).length<=4000);
    report.checks=[{name:'real NTK paragraph search and bounded anchor',result:'pass',search,anchor},{name:'forward and backward extension preserves exact raw text',result:'pass',expanded,before},{name:'Figure 3 paragraph search',result:'pass',matches:figure.matches},{name:'SQL result cap',result:'pass',characters:JSON.stringify(sql.rows).length,truncated:sql.truncated}];
    report.info=await server.link.call('inspect_pdf',args);report.trace=server.link.status().latest.trace;
    report.measurement={fullPageCharacters:loaded.pages[5].length,anchorCharacters:anchor.text.length,expandedCharacters:expanded.reduce((n,p)=>n+p.text.length,0),note:'Character counts of source text, not actual ChatGPT context tokens. Explicit expansions add new context; they do not remove old results.'};
    console.log(JSON.stringify({pageCount:loaded.pages.length,paragraphCount:report.info.paragraphCount,anchor:anchor.passageId,expansions:expanded.length,...report.measurement}));
  }catch(error){report.error=error.stack;process.exitCode=1;console.error(error);}
  finally{await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');await server?.link.close();await new Promise(resolve=>server?server.close(resolve):resolve());renderer?.close();await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(()=>{});app.exit(process.exitCode||0);}
});
