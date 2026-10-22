// electron scripts/ntk-side-effects-check.mjs <NTK.pdf> <report.json>
// Differential checks against installed pre-optimization source, without running it.
import {app,nativeImage} from 'electron';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';import assert from 'node:assert/strict';import {setTimeout as wait} from 'node:timers/promises';
import asar from '@electron/asar';
import {createAppServer} from '../server.mjs';import {createPdfRenderer} from '../pdf-render-service.mjs';
import {createAnnotations} from '../annotations.mjs';import {createChats} from '../chats.mjs';import {createSettings} from '../settings.mjs';import {createReadingState} from '../reading-state.mjs';
import {createPdfSnapshots} from '../pdf-snapshots.mjs';import {createPaperLink} from '../paper-link.mjs';import {createShareArchive} from '../share-archive.mjs';
import {createQueryIndex} from '../pdf-query.mjs';import {textQuality} from '../pdf-text-quality.mjs';import {pageNote} from '../reading-tools.mjs';
import {createLinkMcpServer} from '../link/mcp-server.mjs';import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
const [pdfPath,reportPath]=process.argv.slice(2),directory=await mkdtemp(path.join(os.tmpdir(),'reader-ntk-side-effects-'));
app.setPath('userData',directory);app.setPath('sessionData',directory);app.on('window-all-closed',()=>{});
const digest=value=>createHash('sha256').update(value).digest('hex');
const secure={isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from(text),decryptString:bytes=>bytes.toString()};
const exactRead=value=>({...value,pages:value.pages.map(({textRef,delivery,...page})=>page),advice:undefined,contextRecovery:undefined,readingAssessment:undefined});
app.whenReady().then(async()=>{
  let server,renderer,origin;const cleanup=[];
  const report={version:JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version,date:new Date().toISOString(),scope:'Actual NTK PDF.js extraction and pixels. Differential engine/SQLite/MCP tests against pre-optimization installed source, in an isolated profile/store. Does not test actual ChatGPT generation or public tunnel behavior.',checks:[],counts:{searches:0,unchangedSearchResults:0,improvedStatementRankings:0,paragraphReads:0,expansions:0,sqlComparisons:0,qualityComparisons:0,pixelComparisons:0},intentionalRankingChanges:[]};
  const check=async(name,fn)=>{try{const details=await fn();report.checks.push({name,passed:true,...(details?{details}:{})});console.log('PASS '+name);}catch(error){report.checks.push({name,passed:false,error:error.stack});console.error('FAIL '+name+': '+error.message);}};
  try{
    const archivePath=path.join(process.env.LOCALAPPDATA,'Programs','Agentic PDF Reader','resources','app.asar');
    report.referenceVersion=JSON.parse(asar.extractFile(archivePath,'package.json')).version;
    const reference=path.join(directory,'reference');await mkdir(reference);
    for(const file of ['pdf-query.mjs','pdf-query-worker.mjs','pdf-snapshots.mjs','pdf-passages.mjs','pdf-text-quality.mjs','paper-link.mjs','share-archive.mjs','annotation-geometry.mjs','pdf-evidence.mjs','delivery-history.mjs','link-question.mjs'])await writeFile(path.join(reference,file),asar.extractFile(archivePath,file));
    await writeFile(path.join(reference,'auth.mjs'),'export {UserError} from '+JSON.stringify(new URL('../auth.mjs',import.meta.url).href)+';');
    const previous={...(await import(pathToFileURL(path.join(reference,'pdf-snapshots.mjs')).href)),...(await import(pathToFileURL(path.join(reference,'pdf-query.mjs')).href)),...(await import(pathToFileURL(path.join(reference,'paper-link.mjs')).href)),...(await import(pathToFileURL(path.join(reference,'share-archive.mjs')).href)),...(await import(pathToFileURL(path.join(reference,'pdf-text-quality.mjs')).href))};
    renderer=createPdfRenderer(()=>origin);server=createAppServer({activeRequests:new Set()},{pdfRenderer:renderer,getOrigin:()=>origin,linkDiscoveryPath:path.join(directory,'unused.json'),annotations:await createAnnotations(path.join(directory,'server-notes')),chats:await createChats(path.join(directory,'server-chats')),settings:await createSettings(path.join(directory,'server-settings.json')),reading:await createReadingState(path.join(directory,'server-reading.json'))});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
    const bytes=await readFile(pdfPath),hash=digest(bytes),loaded=await renderer.load(hash,bytes,{pages:1000,text:12000000});
    report.pdf={sha256:hash,pages:loaded.pages.length,characters:loaded.pages.reduce((n,text)=>n+text.length,0)};
    const boot=async(label,module,{register=true}={})=>{
      const pdfs=module.createPdfSnapshots({renderer:{load:async()=>loaded,render:(_id,page,region)=>renderer.render(hash,page,region),release(){},close(){}}});cleanup.push(()=>pdfs.close());
      const registered=register?await pdfs.register(bytes,loaded.documentId,'1806.07572v4.pdf'):{snapshotId:hash};
      const annotations=await createAnnotations(path.join(directory,label+'-notes')),cache=path.join(directory,label+'-cache');
      const link=module.createPaperLink({pdfs,archive:module.createShareArchive(cache,secure),annotations,getOrigin:()=>origin,discoveryPath:path.join(directory,label+'-connection.json')});cleanup.push(()=>link.close());await link.restore();
      const share=(question='NTK verification',allowSave=false)=>link.share({...registered,documentId:loaded.documentId,fileName:'1806.07572v4.pdf',...pageNote(9),question,context:'',allowSave});
      return {pdfs,registered,link,share,annotations};
    };
    const old=await boot('old',previous),next=await boot('new',{createPdfSnapshots,createPaperLink,createShareArchive});
    const key=next.registered.snapshotId;
    await check('ordinary search results stay identical; exact statement queries prefer actual statements',async()=>{
      const queries=['kernel','"Theorem 1"','"Theorem 2"','"Proposition 1"','"positive definite"','"gradient descent"','"gradient flow"','eigenvalues','inflation','"Figure 3"','convergence','Gaussian','Gronwall','"non-polynomial"','initialization','activation','matrix','zzzz_missing_ntk_token'];
      for(const query of queries)for(const pages of [undefined,[1],[3],[9],[7,8]])for(const limit of [1,3,5]){
        const args={query,pages,limit},actual=await next.pdfs.search(key,args),expected=await old.pdfs.search(key,args);
        if(actual.ranking==='statement-first'){
          const source=next.pdfs.read(key,{passageId:actual.matches[0].passageId}).pages[0].text;
          assert.ok(source.replace(/\s+/g,' ').trimStart().toLowerCase().startsWith(query.replaceAll('"','').toLowerCase()+'.'));report.counts.improvedStatementRankings++;
          if(limit===1)report.intentionalRankingChanges.push({query,before:expected.matches[0].passageId,after:actual.matches[0].passageId,page:actual.matches[0].page});
        }else{assert.deepEqual(actual,expected);report.counts.unchangedSearchResults++;}
        report.counts.searches++;
      }
      return {comparisons:report.counts.searches};
    });
    const allIds=[];for(let page=1;page<=loaded.pages.length;page++){
      let number=1;while(true){try{old.pdfs.read(key,{passageId:`p${page}.${number}`});allIds.push(`p${page}.${number++}`);}catch{break;}}
    }
    report.pdf.paragraphs=allIds.length;
    report.statementLocations=allIds.flatMap(passageId=>{const source=old.pdfs.read(key,{passageId,maxCharacters:256}).pages[0];const label=/^(Theorem|Proposition)\s+[12]\b/i.exec(source.text.trim());return label?[{passageId,page:source.page,preview:source.text.slice(0,180)}]:[];});
    await check('every paragraph preserves UTF-16 ranges, Unicode/math, clipping and expansion cursors',async()=>{
      for(const passageId of allIds)for(const maxCharacters of [128,512,1600,4000]){
        const args={passageId,maxCharacters},a=old.pdfs.read(key,args),b=next.pdfs.read(key,args);assert.deepEqual(b,a);report.counts.paragraphReads++;
        if(maxCharacters===128)for(const direction of ['before','after'])if(a.pages[0][direction]){
          const expansion={cursor:a.pages[0][direction],maxCharacters:128,reason:'Check missing neighboring source.'};assert.deepEqual(next.pdfs.expand(key,expansion),old.pdfs.expand(key,expansion));report.counts.expansions++;
        }
      }
    });
    await check('prepared statements and result cache preserve SQL binding/null/BigInt/truncation semantics',async()=>{
      const sqlCases=[['SELECT :a AS a,:b AS b',[{a:1,b:2},{a:3},{},{b:4}]],['SELECT ? AS a,? AS b',[[1,2],[3],[],[null,4]]],['SELECT page_no FROM page_fts WHERE page_fts MATCH ? LIMIT 5',[['kernel'],['inflation'],['"non-polynomial"'],['zzzzmissing']]],['SELECT page_no,start,end,raw_text FROM paragraphs WHERE page_no=? ORDER BY start',[[1],[3],[9],[19]]],['SELECT count(*) AS total FROM paragraphs',[[]]],['SELECT raw_text FROM pages WHERE page_no=:page',[{page:9},{page:3},{}]],['SELECT 9007199254740993 AS n,NULL AS missing',[[]]],['WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<100) SELECT x FROM n',[[]]]];
      for(const [sql,bindings] of sqlCases)for(const params of bindings){assert.deepEqual(await next.pdfs.query(key,sql,params),await old.pdfs.query(key,sql,params));report.counts.sqlComparisons++;}
      for(let i=0;i<100;i++){const sql='SELECT ? AS marker',params=[i];assert.deepEqual(await next.pdfs.query(key,sql,params),await old.pdfs.query(key,sql,params));report.counts.sqlComparisons++;}
      for(const query of ['kernel','gradient','inflation'])assert.deepEqual(await next.pdfs.search(key,{query}),await old.pdfs.search(key,{query}));
    });
    await check('quality heuristic matches old engine on all NTK pages and damaged/Unicode boundary cases',async()=>{
      for(const pages of [loaded.pages,...loaded.pages.map(text=>[text]),[''],['𐐀'.repeat(39)],['𐐀'.repeat(40)],['a'.repeat(196)+'�'.repeat(4)],['a'.repeat(195)+'�'.repeat(4)]]){assert.deepEqual(textQuality(pages),previous.textQuality(pages));report.counts.qualityComparisons++;}
    });
    await check('SQL errors do not poison later calls; forbidden access remains denied',async()=>{
      for(const f of [old,next]){
        for(const sql of ['SELECT * FROM sqlite_master',"SELECT load_extension('anything')",'DELETE FROM pages','SELECT * FROM pages; SELECT 2','PRAGMA query_only=OFF'])await assert.rejects(f.pdfs.query(key,sql));
        const sql='SELECT page_no FROM page_fts WHERE page_fts MATCH ?';await assert.rejects(f.pdfs.query(key,sql,['non-polynomial']));
        assert.ok((await f.pdfs.query(key,sql,['kernel'])).rows.length);
      }
    });
    await check('combined search/read matches separate search plus read, source and budget exactly',async()=>{
      report.retrievalCases=[];
      for(const query of ['kernel','"Theorem 1"','"Theorem 2"','"Proposition 1"','inflation','zzzzmissing']){
        const a=await next.share(),b=await next.share(),found=await next.link.call('search_pdf',{selectionId:a.selectionId,query,limit:1}),combined=await next.link.call('search_pdf',{selectionId:b.selectionId,query,limit:1,readTop:true,maxCharacters:512});
        assert.deepEqual(combined.matches,found.matches);
        if(!found.matches.length){assert.equal(combined.reading,null);continue;}
        const read=await next.link.call('read_pdf',{selectionId:a.selectionId,passageId:found.matches[0].passageId,maxCharacters:512});
        const source=combined.reading.pages[0];report.retrievalCases.push({query,passageId:source.passageId,page:source.page,characters:source.text.length,paragraphComplete:source.paragraphComplete,continuesAfter:source.continuesAfter,hasExpansionCursor:!!source.after,sourcePreview:source.text.slice(0,180)});
        assert.deepEqual(exactRead(combined.reading),exactRead(Object.fromEntries(Object.entries(read).filter(([name])=>!['selectionId','fileName','contextUsage'].includes(name)))));
        assert.deepEqual(combined.contextUsage,read.contextUsage);
        const duplicate=await next.link.call('search_pdf',{selectionId:b.selectionId,query,limit:1,readTop:true,maxCharacters:512});assert.equal(duplicate.reading.characters,0);
        const retry=duplicate.contextRecovery.retry,recovered=await next.link.call(retry.tool,retry.arguments);assert.equal(recovered.pages[0].text,read.pages[0].text);
        const history=next.link.deliveries(loaded.documentId,b.selectionId).events;assert.equal(history[0].items.find(item=>item.kind==='text').text,read.pages[0].text);
      }
    });
    await check('concurrent cache hits keep independent response objects and snapshot source',async()=>{
      const sql='SELECT raw_text FROM pages WHERE page_no=?',batch=await Promise.all(Array.from({length:12},(_,i)=>next.pdfs.query(key,sql,[i%3+1])));
      for(let i=0;i<batch.length;i++)assert.deepEqual(batch[i],await old.pdfs.query(key,sql,[i%3+1]));
      const original=await old.pdfs.query(key,sql,[1]);batch[0].rows[0].raw_text='mutated caller';assert.deepEqual(await next.pdfs.query(key,sql,[1]),original);
    });
    await check('forced idle eviction, timeout and recovery preserve search correctness',async()=>{
      const oldIndex=previous.createQueryIndex(loaded.pages,{idleTimeout:20,timeout:50}),newIndex=createQueryIndex(loaded.pages,{idleTimeout:20,timeout:50});cleanup.push(()=>oldIndex.close(),()=>newIndex.close());
      const sql='SELECT page_no FROM page_fts WHERE page_fts MATCH ? LIMIT 3',first=await oldIndex.query(sql,['kernel']);assert.deepEqual(await newIndex.query(sql,['kernel']),first);
      await wait(70);assert.equal(oldIndex.resident,false);assert.equal(newIndex.resident,false);assert.deepEqual(await newIndex.query(sql,['kernel']),await oldIndex.query(sql,['kernel']));
      for(const index of [oldIndex,newIndex]){await assert.rejects(index.query('WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n) SELECT sum(x) FROM n'),/제한 시간/);assert.equal((await index.query('SELECT count(*) AS n FROM pages')).rows[0].n,loaded.pages.length);}
    });
    await check('Figure 3 overview/crop/zoom pixels, duplicate reference and resend are unchanged',async()=>{
      const a=await old.share('Read Figure 3'),b=await next.share('Read Figure 3');
      for(const region of [[0,0,1,1],[.58,.08,.27,.22],[.60,.10,.12,.10]]){
        await renderer.render(hash,9,region); // Same warmed PDF.js/fonts for both paths.
        const args={page:9,region},x=await old.link.call('render_pdf_page',{selectionId:a.selectionId,...args}),y=await next.link.call('render_pdf_page',{selectionId:b.selectionId,...args});
        assert.deepEqual(y.metadata,x.metadata);
        const bitmap=value=>nativeImage.createFromBuffer(Buffer.from(value.image.data,'base64')).toBitmap();assert.ok(bitmap(x).equals(bitmap(y)));report.counts.pixelComparisons++;
        const reference=await next.link.call('render_pdf_page',{selectionId:b.selectionId,...args});assert.equal(reference.image,undefined);
        const retry=reference.contextRecovery.retry,resend=await next.link.call(retry.tool,retry.arguments);assert.ok(bitmap(y).equals(bitmap(resend)));report.counts.pixelComparisons++;
        if(region[0]===.58)await writeFile(path.join(path.dirname(reportPath),'ntk-figure3c-side-effects.png'),Buffer.from(y.image.data,'base64'));
      }
    });
    await check('real MCP schema forwards merged reads without duplicating source in text envelopes',async()=>{
      const shared=await next.share(),mcp=createLinkMcpServer({htmlPath:'',call:(name,args)=>next.link.call(name,args)}),client=new Client({name:'ntk-side-effects',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await mcp.connect(a);await client.connect(b);cleanup.push(()=>client.close());
      const result=await client.callTool({name:'search_pdf',arguments:{selectionId:shared.selectionId,query:'inflation',readTop:true,limit:1,maxCharacters:128}});assert.ok(result.structuredContent.reading.characters>0);assert.ok(result.structuredContent.reading.characters<=128);assert.ok(!result.content[0].text.includes(result.structuredContent.reading.pages[0].text));
    });
    await check('heading-only fast reads warn explicitly and provide a working content-expansion call',async()=>{
      const shared=await next.share(),mcp=createLinkMcpServer({htmlPath:'',call:(name,args)=>next.link.call(name,args)}),client=new Client({name:'heading-check',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await mcp.connect(a);await client.connect(b);cleanup.push(()=>client.close());
      const result=await client.callTool({name:'search_pdf',arguments:{selectionId:shared.selectionId,query:'kernel',readTop:true,limit:1}});
      assert.match(result.content[0].text,/HEADING ONLY/);assert.equal(result.structuredContent.readingAssessment.kind,'heading');
      const nextCall=result.structuredContent.readingAssessment.next,expanded=await client.callTool({name:nextCall.tool,arguments:nextCall.arguments});assert.ok(expanded.structuredContent.characters>0);assert.notEqual(expanded.structuredContent.pages[0].text,result.structuredContent.reading.pages[0].text);
      report.headingExample={passageId:result.structuredContent.reading.pages[0].passageId,heading:result.structuredContent.reading.pages[0].text,expandedPassageId:expanded.structuredContent.pages[0].passageId,expandedCharacters:expanded.structuredContent.characters};
    });
    await check('cached NTK SQL cannot bypass text budgets and reference-only reads remain available',async()=>{
      const a=await old.share(),b=await next.share();
      const found=await next.link.call('search_pdf',{selectionId:b.selectionId,query:'inflation',readTop:true,limit:1,maxCharacters:256});
      await old.link.call('search_pdf',{selectionId:a.selectionId,query:'inflation',limit:1});await old.link.call('read_pdf',{selectionId:a.selectionId,passageId:found.matches[0].passageId,maxCharacters:256});
      const longest=loaded.pages.reduce((best,text,i)=>text.length>loaded.pages[best].length?i:best,0)+1;
      let usage=found.contextUsage.textCharacters;
      while(usage<24000){const args={sql:'SELECT substr(raw_text,1,2900) AS text FROM pages WHERE page_no=?',params:[longest]};const x=await old.link.call('query_pdf',{selectionId:a.selectionId,...args}),y=await next.link.call('query_pdf',{selectionId:b.selectionId,...args});assert.deepEqual(x.rows,y.rows);assert.equal(x.contextUsage.textCharacters,y.contextUsage.textCharacters);usage=y.contextUsage.textCharacters;}
      for(const [f,selectionId] of [[old,a.selectionId],[next,b.selectionId]]){
        await assert.rejects(f.link.call('search_pdf',{selectionId,query:'inflation',readTop:true,limit:1}),/예산/);
        const reference=await f.link.call('read_pdf',{selectionId,passageId:found.matches[0].passageId,maxCharacters:256});assert.equal(reference.characters,0);assert.ok(reference.contextRecovery.retry);
      }
    });
    await check('restart restores the same NTK share, references and encrypted source/image history',async()=>{
      const module={createPdfSnapshots,createPaperLink,createShareArchive},first=await boot('replay',module),shared=await first.share();
      const args={selectionId:shared.selectionId,query:'inflation',readTop:true,limit:1,maxCharacters:256},text=await first.link.call('search_pdf',args);
      const region=[.58,.08,.27,.22],image=await first.link.call('render_pdf_page',{selectionId:shared.selectionId,page:9,region}),history=first.link.deliveries(loaded.documentId,shared.selectionId).events;
      await first.link.close();first.pdfs.close();const second=await boot('replay',module,{register:false});
      assert.equal(second.pdfs.resources().snapshots,0);assert.deepEqual(second.link.deliveries(loaded.documentId,shared.selectionId).events,history);
      const reference=await second.link.call('search_pdf',args);assert.equal(reference.reading.characters,0);assert.equal(reference.reading.pages[0].textRef,text.reading.pages[0].textRef);
      const retry=reference.contextRecovery.retry,recovered=await second.link.call(retry.tool,retry.arguments);assert.equal(recovered.pages[0].text,text.reading.pages[0].text);
      const imageReference=await second.link.call('render_pdf_page',{selectionId:shared.selectionId,page:9,region});assert.equal(imageReference.image,undefined);assert.equal(imageReference.imageRef,image.imageRef);
      const event=history.find(event=>event.method==='render_pdf_page'),stored=await second.link.deliveryImage(loaded.documentId,shared.selectionId,event.id);assert.equal(digest(Buffer.from(stored.data,'base64')),digest(Buffer.from(image.image.data,'base64')));
    });
    await check('revocation blocks even warm cached queries and does not modify the original PDF',async()=>{
      const shared=await next.share(),args={selectionId:shared.selectionId,query:'kernel',readTop:true,limit:1};await next.link.call('search_pdf',args);await next.link.setEnabled(false);await assert.rejects(next.link.call('search_pdf',args),/꺼져/);
      assert.equal(digest(await readFile(pdfPath)),hash);
    });
    report.tradeoffs=['The first uncached search pays index construction after lazy registration.','SQL worker retention is 5 minutes instead of 30 seconds; memory can stay resident longer. Cache size remains bounded.','A first search hit is not guaranteed relevant or complete: its exact text and clipping/cursors are preserved.','Model answer quality/latency and actual ChatGPT compaction are outside these engine checks.'];
  }catch(error){report.error=error.stack;console.error(error.stack);}
  finally{
    for(const close of cleanup.reverse())try{await close();}catch{}
    await server?.link.close();server?.closeAllConnections();await new Promise(resolve=>server?server.close(resolve):resolve());renderer?.close();
    report.passed=!report.error&&report.checks.every(check=>check.passed);await mkdir(path.dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,counts:report.counts,checks:report.checks.map(({name,passed})=>({name,passed}))}));app.exit(report.passed?0:1);
  }
});
