// Live, read-only MCP probe. Requests are supplied as JSON so an evaluator can
// adapt searches after reading evidence; this is not an autonomous ChatGPT test.
// node scripts/ntk-query-eval.mjs requests.json results.json
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo=fileURLToPath(new URL('../',import.meta.url));
const [requestPath,outputPath]=process.argv.slice(2);
if(!requestPath||!outputPath)throw Error('Usage: node scripts/ntk-query-eval.mjs requests.json results.json');
const input=JSON.parse(await readFile(requestPath,'utf8'));
const client=new Client({name:'ntk-context-evaluation',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[path.join(repo,'plugins/paper-reader-link/server.bundle.mjs'),'--connection',path.join(process.env.APPDATA,'Paper Reader','link-connection.json')],stderr:'pipe'});
const searchSql="SELECT CAST(page_no AS INTEGER) AS page_no, snippet(page_fts,1,'[',']',' … ',40) AS excerpt FROM page_fts WHERE page_fts MATCH ? ORDER BY bm25(page_fts), CAST(page_no AS INTEGER) LIMIT 5";
const allowed=new Set(['inspect_pdf','query_pdf','read_pdf','render_pdf_page']);
const report={startedAt:new Date().toISOString(),evaluator:'Codex-selected queries via live local MCP; not ChatGPT web E2E',results:[]};
try{
  await client.connect(transport);
  const selectionResult=await client.callTool({name:'get_selection',arguments:input.selectionId?{selectionId:input.selectionId}:{}});
  if(selectionResult.isError)throw Error(selectionResult.content?.[0]?.text||'Selection unavailable');
  const selection=selectionResult.structuredContent.selection;
  if(selection.fileName!=='1806.07572v4.pdf'||!selection.pdfAvailable)throw Error('Expected shared NTK full PDF');
  report.selectionId=selection.selectionId;
  report.fileName=selection.fileName;
  await mkdir(path.dirname(path.resolve(outputPath)),{recursive:true});
  for(const request of input.requests){
    const name=request.search!==undefined?'query_pdf':request.tool;
    if(!allowed.has(name))throw Error('Only read-only PDF tools are permitted');
    const args=request.search!==undefined?{sql:searchSql,params:[request.search]}:(request.arguments||{});
    const start=performance.now();
    const response=await client.callTool({name,arguments:{...args,selectionId:selection.selectionId}});
    const result={id:request.id,question:request.question,tool:name,arguments:args,milliseconds:Math.round(performance.now()-start),isError:!!response.isError,data:response.structuredContent||response.content};
    const image=response.content?.find(item=>item.type==='image');
    if(image){
      const imagePath=path.resolve(path.dirname(outputPath),`${path.basename(outputPath,'.json')}-${String(request.id).replace(/[^a-z0-9_-]/gi,'_')}.png`);
      await writeFile(imagePath,Buffer.from(image.data,'base64'));
      result.imagePath=imagePath;
      if(!response.structuredContent)result.data=response.content.filter(item=>item.type!=='image');
    }
    report.results.push(result);
    console.log(JSON.stringify(result));
    await writeFile(outputPath,JSON.stringify(report,null,2)+'\n');
  }
}finally{await client.close();}
