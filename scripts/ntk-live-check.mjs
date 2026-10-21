import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const directory=fileURLToPath(new URL('../',import.meta.url));
const connection=path.join(process.env.APPDATA,'Paper Reader','link-connection.json');
const client=new Client({name:'ntk-live-check',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[path.join(directory,'plugins/paper-reader-link/server.bundle.mjs'),'--connection',connection],stderr:'pipe'});
try{
  await client.connect(transport);
  const names=(await client.listTools()).tools.map(tool=>tool.name);
  console.log('tools',names.join(','));
  async function call(name,args){const value=await client.callTool({name,arguments:args});if(value.isError)throw Error(name+': '+value.content[0].text);return value;}
  const selection=(await call('get_selection',{})).structuredContent.selection;
  if(selection.fileName!=='1806.07572v4.pdf'||!selection.pdfAvailable)throw Error('Expected NTK full-PDF share');
  const args={selectionId:selection.selectionId};
  console.log('selection',selection.selectionId,'quote chars',selection.quote.length,'context chars',selection.context.length);
  console.log('inspect',JSON.stringify((await call('inspect_pdf',args)).structuredContent));
  const found=(await call('query_pdf',{...args,sql:"SELECT CAST(page_no AS INTEGER) AS page_no, snippet(page_fts,1,'[',']','…',25) AS excerpt FROM page_fts WHERE page_fts MATCH ? ORDER BY bm25(page_fts) LIMIT 10",params:['"Figure 3"']})).structuredContent;
  console.log('search',JSON.stringify(found));
  const page=9;
  const read=(await call('read_pdf',{...args,pages:[page]})).structuredContent;
  console.log('page '+page+' text',read.pages[0].text.slice(0,400));
  const image=await call('render_pdf_page',{...args,page,region:[0,0,1,1]});
  const data=image.content.find(c=>c.type==='image');
  if(!data || data.mimeType!=='image/png')throw Error('Actual PNG content missing');
  const output=path.resolve(directory,'../outputs/NTK-Figure3-from-MCP.png');await mkdir(path.dirname(output),{recursive:true});await writeFile(output,Buffer.from(data.data,'base64'));
  console.log('render metadata',JSON.stringify(image.structuredContent||JSON.parse(image.content.find(c=>c.type==='text').text)),'image bytes',Buffer.from(data.data,'base64').length,'saved',output);
  const crop=await call('render_pdf_page',{...args,page,region:[.12,.09,.75,.2]});
  const cropped=crop.content.find(c=>c.type==='image');if(!cropped)throw Error('Cropped PNG content missing');
  const cropPath=path.resolve(directory,'../outputs/NTK-Figure3-crop-from-MCP.png');await writeFile(cropPath,Buffer.from(cropped.data,'base64'));
  console.log('crop metadata',JSON.stringify(crop.structuredContent||JSON.parse(crop.content.find(c=>c.type==='text').text)),'saved',cropPath);
}finally{await client.close();}
