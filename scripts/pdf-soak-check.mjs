// Read-only live package soak. UI document opening and real ChatGPT calls are
// performed separately in the app's built-in browser, never by this script.
// node scripts/pdf-soak-check.mjs manifest.json report.json [seconds=7200]
import {readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const execute=promisify(execFile);
const [manifestPath,outputPath,duration='7200']=process.argv.slice(2);
if(!manifestPath||!outputPath)throw Error('Usage: manifest.json report.json [seconds]');
const seconds=Number(duration);
if(!Number.isFinite(seconds)||seconds<60)throw Error('Duration must be at least 60 seconds');
const initial=JSON.parse(await readFile(manifestPath,'utf8'));
const target=new URL(initial.origin);
if(target.hostname!=='127.0.0.1')throw Error('Only the loopback app is supported');
const roots=initial.processRoots;
if(!Array.isArray(roots)||!roots.length||roots.some(id=>!Number.isSafeInteger(id)||id<=0))throw Error('Explicit process roots required');
const started=Date.now(),deadline=started+seconds*1000;
const report={startedAt:new Date(started).toISOString(),requestedSeconds:seconds,mode:'live EXE local tools plus separate built-in browser UI/ChatGPT evidence',samples:[],calls:[],documents:[],completed:false};
const client=new Client({name:'paper-reader-readonly-soak',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[initial.serverBundle,'--connection',initial.connectionFile],stderr:'pipe'});
transport.stderr?.on('data',()=>{}); // Do not copy discovery or credentials into reports.
const persist=()=>writeFile(outputPath,JSON.stringify(report,null,2)+'\n');
const metricsScript=`$all=Get-CimInstance Win32_Process; $ids=[System.Collections.Generic.HashSet[int]]::new(); foreach($n in @(${roots.join(',')})){[void]$ids.Add($n)}; do {$changed=$false; foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)){$changed=$true}}}while($changed); $items=@(Get-Process -Id @($ids) -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,WorkingSet64,PrivateMemorySize64,HandleCount,@{n='Threads';e={$_.Threads.Count}}); ConvertTo-Json -InputObject $items -Compress`;
let nextCall=started,nextSample=started;
const inspectCache=new Map();
try{
  await client.connect(transport);
  while(Date.now()<deadline||report.calls.length<50){
    const now=Date.now();
    if(now>=nextSample){
      const sample={at:new Date().toISOString(),elapsedSeconds:Math.round((now-started)/1000)};
      try{
        const result=await execute('powershell.exe',['-NoProfile','-Command',metricsScript],{windowsHide:true,timeout:15000,maxBuffer:1024*1024});
        sample.processes=JSON.parse(result.stdout.trim()||'[]');
        if(!Array.isArray(sample.processes))sample.processes=[sample.processes];
        sample.workingSetBytes=sample.processes.reduce((sum,p)=>sum+p.WorkingSet64,0);
        sample.privateBytes=sample.processes.reduce((sum,p)=>sum+p.PrivateMemorySize64,0);
        const health=await fetch(new URL('/api/link/status',target),{headers:{'X-Paper-Reader':'1'},signal:AbortSignal.timeout(10000)});
        sample.httpStatus=health.status;
        if(health.ok){const status=await health.json();sample.linkEnabled=status.enabled;sample.sharedCount=status.sharedCount;}
      }catch(error){sample.error=error.name;}
      report.samples.push(sample);nextSample=Date.now()+30000;
    }
    if(now>=nextCall&&report.calls.length<50){
      const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
      const documents=manifest.documents||[];
      if(documents.length){
        const doc=documents[report.calls.length%documents.length];
        const call={index:report.calls.length+1,at:new Date().toISOString(),document:doc.label};
        const begin=performance.now();
        try{
          if(!inspectCache.has(doc.selectionId)){
            const inspected=await client.callTool({name:'inspect_pdf',arguments:{selectionId:doc.selectionId}},undefined,{timeout:30000});
            if(inspected.isError)throw Error('InspectFailed');
            const metadata=inspected.structuredContent;
            inspectCache.set(doc.selectionId,metadata);
            report.documents.push({label:doc.label,pageCount:metadata.pageCount,snapshotId:metadata.snapshotId});
          }
          call.tool=call.index%5===0?'render_pdf_page':'query_pdf';
          const args=call.tool==='query_pdf'?{sql:'SELECT page_no, substr(raw_text,1,100) AS excerpt FROM pages WHERE raw_text LIKE ? ORDER BY page_no LIMIT 5',params:[`%${doc.term}%`]}:{page:doc.imagePage||1};
          const result=await client.callTool({name:call.tool,arguments:{selectionId:doc.selectionId,...args}},undefined,{timeout:30000});
          call.isError=!!result.isError;
          if(call.tool==='query_pdf')call.pages=result.structuredContent?.rows?.map(row=>Number(row.page_no))||[];
          else{
            const image=result.content?.find(item=>item.type==='image');
            const png=image?Buffer.from(image.data,'base64'):null;
            call.pngValid=!!png&&png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
            call.imageBytes=png?.length||0;call.image=result.structuredContent?.metadata;
            if(!call.pngValid)call.isError=true;
          }
        }catch(error){call.isError=true;call.error=error.name;}
        call.milliseconds=Math.round(performance.now()-begin);report.calls.push(call);
        // Spread all 50 calls over the requested elapsed duration, including one near the end.
        nextCall=started+(report.calls.length*seconds*1000/49);
      }else nextCall=now+10000;
    }
    await persist();
    if(Date.now()>=deadline&&report.calls.length>=50)break;
    await delay(Math.min(5000,Math.max(100,nextSample-Date.now(),0)));
  }
  report.completed=true;report.finishedAt=new Date().toISOString();report.elapsedSeconds=Math.round((Date.now()-started)/1000);
  report.failedCalls=report.calls.filter(call=>call.isError).length;
  report.failedHealthSamples=report.samples.filter(sample=>sample.error||sample.httpStatus!==200).length;
  report.result=report.failedCalls||report.failedHealthSamples?'fail':'pass';
}catch(error){report.result='fail';report.error=error.name;report.finishedAt=new Date().toISOString();}
finally{await client.close();await persist();}
