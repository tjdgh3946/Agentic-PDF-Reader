// Real PDF.js + SQLite + MCP + Windows safeStorage, in an isolated profile.
// electron scripts/reader-recovery-check.mjs <NTK.pdf> <output-directory>
import {app,safeStorage,nativeImage} from 'electron';
import {readFile,writeFile,mkdtemp,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createPdfRenderer} from '../pdf-render-service.mjs';
import {createAppServer} from '../server.mjs';
import {createShareArchive} from '../share-archive.mjs';
import {createAnnotations} from '../annotations.mjs';
import {pageNote} from '../reading-tools.mjs';
import {createLinkMcpServer} from '../link/mcp-server.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';

const [pdfPath,outputDirectory]=process.argv.slice(2),directory=await mkdtemp(path.join(os.tmpdir(),'reader-recovery-check-'));
const version=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version;
app.setPath('userData',directory);app.setPath('sessionData',directory);app.on('window-all-closed',()=>{});

// A one-page image-only PDF fixture, containing the actual NTK figure pixels.
function rasterPdf(jpeg,width,height){
  const chunks=[Buffer.from('%PDF-1.4\n')],offsets=[0];
  const object=(number,content)=>{offsets[number]=chunks.reduce((n,chunk)=>n+chunk.length,0);chunks.push(Buffer.from(number+' 0 obj\n'),Buffer.isBuffer(content)?content:Buffer.from(content),Buffer.from('\nendobj\n'));};
  object(1,'<< /Type /Catalog /Pages 2 0 R >>');object(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 630] /Resources << /XObject << /Image 4 0 R >> >> /Contents 5 0 R >>');
  object(4,Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,Buffer.from('\nendstream')]));
  const paint='q 600 0 0 630 0 0 cm /Image Do Q';object(5,`<< /Length ${paint.length} >>\nstream\n${paint}\nendstream`);
  const start=chunks.reduce((n,chunk)=>n+chunk.length,0);chunks.push(Buffer.from('xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`));return Buffer.concat(chunks);
}

async function check(){
await app.whenReady();
const instances=[],report={version,date:new Date().toISOString(),scope:'Isolated real-runtime restart simulation, plus image-only fixture. Installed app restart and ChatGPT vision are separate checks.',checks:[]};
async function boot(){
  let origin;const renderer=createPdfRenderer(()=>origin),archive=createShareArchive(path.join(directory,'cache'),safeStorage);
  const server=createAppServer({activeRequests:new Set()},{pdfRenderer:renderer,shareArchive:archive,annotations:await createAnnotations(path.join(directory,'notes')),settings:{get:()=>({mode:'manual'})},getOrigin:()=>origin,linkDiscoveryPath:path.join(directory,'connection.json')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;await server.link.restore();
  const mcp=createLinkMcpServer({htmlPath:'',call:(method,args)=>server.link.call(method,args)}),[a,b]=InMemoryTransport.createLinkedPair(),client=new Client({name:'recovery-integration',version:'1'});await mcp.connect(a);await client.connect(b);
  const instance={server,renderer,client,async stop(){await client.close();await server.link.close();await new Promise(resolve=>server.close(resolve));renderer.close();}};instances.push(instance);return instance;
}
async function call(instance,name,args){const result=await instance.client.callTool({name,arguments:args});assert.equal(result.isError,undefined,JSON.stringify(result.content));return {raw:result,...result.structuredContent};}
try{
  await mkdir(outputDirectory,{recursive:true});assert.equal(safeStorage.isEncryptionAvailable(),true);
  const first=await boot(),bytes=await readFile(pdfPath),hash=createHash('sha256').update(bytes).digest('hex');
  const loaded=await first.renderer.load(hash,bytes,{pages:1000,text:12000000}),registered=await first.server.pdfs.register(bytes,loaded.documentId,'1806.07572v4.pdf');
  const shared=await first.server.link.share({...registered,documentId:loaded.documentId,fileName:'1806.07572v4.pdf',...pageNote(9),question:'Verify Figure 3(c) after restart.',context:'',allowSave:false}),args={selectionId:shared.selectionId};
  const found=await call(first,'search_pdf',{...args,query:'inflation'}),read=await call(first,'read_pdf',{...args,passageId:found.matches[0].passageId}),image=await call(first,'render_pdf_page',{...args,page:9});
  await first.stop();
  const second=await boot();assert.equal(second.server.link.status().restoredCount,1);assert.equal(second.server.pdfs.resources().snapshots,0);
  const [search,crop]=await Promise.all([call(second,'search_pdf',{...args,query:'inflation'}),call(second,'render_pdf_page',{...args,page:9,region:[.58,.08,.27,.22]})]);
  assert.ok(search.matches.length);assert.equal(crop.raw.content.filter(item=>item.type==='image').length,1);
  const reference=await call(second,'render_pdf_page',{...args,page:9});assert.equal(reference.delivery,'reference');assert.equal(reference.imageRef,image.imageRef);assert.equal(reference.raw.content.filter(item=>item.type==='image').length,0);
  const textReference=await call(second,'read_pdf',{...args,passageId:found.matches[0].passageId});assert.equal(textReference.characters,0);assert.equal(textReference.pages[0].textRef,read.pages[0].textRef);
  const expanded=await call(second,'expand_pdf',{...args,cursor:read.pages[0].after,reason:'Check the nearby explanation of inflation and training dynamics.'});assert.ok(expanded.characters);
  const reread=await call(second,'read_pdf',{...args,passageId:found.matches[0].passageId,reread:true,reason:'The previous source is unavailable after context compaction.'});assert.equal(reread.pages[0].text,read.pages[0].text);
  const png=crop.raw.content.find(item=>item.type==='image');await writeFile(path.join(outputDirectory,`recovery-ntk-figure3c-${version}.png`),Buffer.from(png.data,'base64'));
  report.checks.push({name:'same share across new server, renderer, MCP client and DPAPI archive instances',pass:true,selectionId:shared.selectionId,sourceHash:hash,searchPages:search.matches.map(item=>item.page),imageReferencePreserved:true,textReferencePreserved:true,reasonedExpansionCharacters:expanded.characters,crop:crop.metadata});
  for(const file of (await readdir(path.join(directory,'cache'))).filter(file=>file.endsWith('.enc'))){const encrypted=await readFile(path.join(directory,'cache',file));assert.equal(encrypted.includes(Buffer.from('%PDF-')),false);assert.equal(encrypted.includes(Buffer.from('Verify Figure 3(c)')),false);}
  const raster=nativeImage.createFromBuffer(Buffer.from(png.data,'base64')),size=raster.getSize(),scanBytes=rasterPdf(raster.toJPEG(90),size.width,size.height),scanHash=createHash('sha256').update(scanBytes).digest('hex');
  const scanLoaded=await second.renderer.load(scanHash,scanBytes,{pages:1000,text:12000000}),scanRegistered=await second.server.pdfs.register(scanBytes,scanLoaded.documentId,'image-only-ntk-figure.pdf');assert.equal(scanRegistered.textQuality.status,'limited');
  const scan=await second.server.link.share({...scanRegistered,documentId:scanLoaded.documentId,fileName:'image-only-ntk-figure.pdf',...pageNote(1),question:'Read the image-only Figure.',context:'',allowSave:false});
  const missing=await call(second,'search_pdf',{selectionId:scan.selectionId,query:'kernel'}),scanImage=await call(second,'render_pdf_page',{selectionId:scan.selectionId,page:1});
  assert.equal(missing.matches.length,0);assert.equal(missing.textQuality.status,'limited');assert.equal(scanImage.raw.content.filter(item=>item.type==='image').length,1);
  await writeFile(path.join(outputDirectory,`image-only-ntk-figure-${version}.pdf`),scanBytes);
  report.checks.push({name:'actual image-only PDF exposes lexical blind spot and still renders actual Figure pixels',pass:true,textQuality:missing.textQuality,imageBlocks:1});
  await second.server.link.setEnabled(false);assert.equal(second.server.link.status().sharedCount,0);assert.ok(!(await readdir(path.join(directory,'cache'))).some(file=>file.endsWith('.enc')));
  report.checks.push({name:'explicit revoke removes encrypted PDF/share data',pass:true});
  console.log(JSON.stringify({result:'pass',version,checks:report.checks.map(item=>item.name)}));
}catch(error){report.error=error.stack;console.error(error);process.exitCode=1;}
finally{
  for(const instance of instances)await instance.stop().catch(()=>{});
  await writeFile(path.join(outputDirectory,`reader-recovery-${version}.json`),JSON.stringify(report,null,2)+'\n');app.exit(process.exitCode||0);
}

}
check().catch(error=>{console.error(error);app.exit(1);});
