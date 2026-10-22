import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createPaperLink} from '../paper-link.mjs';
import {pageNote} from '../reading-tools.mjs';
import {createLinkMcpServer} from '../link/mcp-server.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {requestLinkShare} from '../link-ui.mjs';

const snapshotId='a'.repeat(64),input={snapshotId,documentId:'abc123',fileName:'ntk.pdf',...pageNote(9),question:'Read Figure 3',context:'',allowSave:false};
async function fixture(t){
  const directory=await mkdtemp(path.join(os.tmpdir(),'reader-image-'));let renders=0;const saved=[];
  const pdfs={pin(){},unpin(){},reset(){},render:async(_id,page,region)=>{renders++;return {image:{mimeType:'image/png',data:'aGVsbG8='},metadata:{page,region,width:1600,height:2000,zoom:region[2]<1?3:1}};}};
  const link=createPaperLink({pdfs,annotations:{upsert:async(_id,item)=>{saved.push(item);return {id:'abc',...item};}},discoveryPath:path.join(directory,'connection.json'),getOrigin:()=> 'http://127.0.0.1:1'});
  t.after(async()=>{await link.close();await rm(directory,{recursive:true,force:true});});
  const shared=await link.share(input);return {link,pdfs,shared,saved,renders:()=>renders};
}
test('same share sends each canonical image once; a zoom region and fresh share still send images',async t=>{
  const {link,shared,renders}=await fixture(t),args={selectionId:shared.selectionId,page:9};
  const first=await link.call('render_pdf_page',args),same=await link.call('render_pdf_page',{...args,region:[0,0,1,1]});
  assert.equal(first.imageReturned,true);assert.equal(same.image,undefined);assert.equal(same.delivery,'reference');assert.equal(same.imageRef,first.imageRef);assert.equal(renders(),1);
  const crop=await link.call('render_pdf_page',{...args,region:[.6,.08,.32,.2]});assert.ok(crop.image);assert.notEqual(crop.imageRef,first.imageRef);
  const tinyNoise=await link.call('render_pdf_page',{...args,region:[.6000000001,.0800000001,.3199999999,.1999999999]});assert.equal(tinyNoise.image,undefined);assert.equal(tinyNoise.imageRef,crop.imageRef);assert.equal(renders(),2);
  const next=await link.share(input);assert.ok((await link.call('render_pdf_page',{...args,selectionId:next.selectionId})).image);assert.equal(renders(),3);
  assert.equal(JSON.stringify(link.status()).includes('aGVsbG8='),false);
});

test('ordinary retries reuse a share while a changed question receives its own image delivery tracking',async t=>{
  const {link}=await fixture(t);let shares=0;
  const api=async(route,data)=>{assert.equal(route,'/api/link/share');shares++;return link.share(data);};
  const first=await requestLinkShare({api,input,allowSave:false});
  const image=await link.call('render_pdf_page',{selectionId:first.result.selectionId,page:9});assert.ok(image.image);
  const ordinary=await requestLinkShare({api,input,allowSave:false,lastRequest:first});assert.equal(shares,1);assert.equal(ordinary.result.selectionId,first.result.selectionId);
  assert.equal((await link.call('render_pdf_page',{selectionId:ordinary.result.selectionId,page:9})).delivery,'reference');
  const recovered=await requestLinkShare({api,input,allowSave:false,lastRequest:ordinary,input:{...input,question:"Read Figure 1"}});
  assert.equal(shares,2);assert.notEqual(recovered.result.selectionId,first.result.selectionId);assert.equal(recovered.result.allowSave,false);
  const next=await link.call('render_pdf_page',{selectionId:recovered.result.selectionId,page:9});assert.ok(next.image);assert.notEqual(next.imageRef,image.imageRef);
  assert.notEqual(recovered.result.question,first.result.question);assert.equal(recovered.input.snapshotId,first.input.snapshotId);
});
test('concurrent duplicate requests coalesce to one PNG and a failed render can be retried',async t=>{
  const {link,pdfs,shared}=await fixture(t);let finish,calls=0;const original=pdfs.render;
  pdfs.render=async(...args)=>{calls++;await new Promise(resolve=>finish=resolve);return original(...args);};
  const args={selectionId:shared.selectionId,page:9},a=link.call('render_pdf_page',args),b=link.call('render_pdf_page',args);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);finish();
  const results=await Promise.all([a,b]);assert.equal(results.filter(r=>r.image).length,1);assert.equal(results[0].imageRef,results[1].imageRef);
  pdfs.render=async()=>{throw Error('render failed');};await assert.rejects(link.call('render_pdf_page',{...args,page:8}),/render failed/);
  pdfs.render=original;assert.ok((await link.call('render_pdf_page',{...args,page:8})).image);
});
test('explicit resend requires a reason, is not the zoom path, and duplicates add no evidence',async t=>{
  const {link,pdfs,shared,renders,saved}=await fixture(t),args={selectionId:shared.selectionId,page:9};
  const first=await link.call('render_pdf_page',args);
  for(const extra of [{resend:true},{resend:true,reason:' '},{resend:true,reason:'x'.repeat(181)},{resend:'yes'}])await assert.rejects(link.call('render_pdf_page',{...args,...extra}));
  const repeat=await link.call('render_pdf_page',{...args,resend:true,reason:'Earlier image is no longer in the conversation context.'});
  assert.ok(repeat.image);assert.equal(repeat.delivery,'resend');assert.equal(repeat.imageRef,first.imageRef);assert.equal(renders(),2);
  const duplicate=await link.call('render_pdf_page',args);assert.equal(duplicate.delivery,'reference');
  const original=pdfs.render;pdfs.render=async()=>{throw Error('resend failed');};
  await assert.rejects(link.call('render_pdf_page',{...args,resend:true,reason:'Missing prior image'}),/resend failed/);
  assert.equal((await link.call('render_pdf_page',args)).imageRef,first.imageRef);pdfs.render=original;
  const writable=await link.share({...input,allowSave:true});
  await link.call('render_pdf_page',{...args,selectionId:writable.selectionId});await link.call('render_pdf_page',{...args,selectionId:writable.selectionId});
  await link.call('save_annotation',{selectionId:writable.selectionId,note:'Figure explanation'});assert.equal(saved[0].evidence.pages.length,1);assert.equal(saved[0].evidence.pages[0].regions.length,1);
});
test('image delivery tracking respects revocation and bounds unique regions without evicting references',async t=>{
  const {link,shared}=await fixture(t),args={selectionId:shared.selectionId,page:9};
  for(let i=0;i<32;i++)await link.call('render_pdf_page',{...args,region:[i*.01,0,.5,.5],reason:'Verify a distinct evidence region in the bounded history test.'});
  await assert.rejects(link.call('render_pdf_page',{...args,region:[.4,0,.5,.5],reason:'Check the region limit.'}),/32/);
  assert.equal((await link.call('render_pdf_page',{...args,region:[0,0,.5,.5]})).delivery,'reference');
  await link.setEnabled(false);await assert.rejects(link.call('render_pdf_page',args),/꺼져/);
  await link.setEnabled(true);await assert.rejects(link.call('render_pdf_page',args),/만료/);
});
test('MCP duplicate contains no image content but a different crop provides a real image',async t=>{
  const {link,shared}=await fixture(t),server=createLinkMcpServer({htmlPath:'',call:(method,args)=>link.call(method,args)});
  const client=new Client({name:'image-reuse-test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);t.after(()=>client.close());
  const args={selectionId:shared.selectionId,page:9};
  const first=await client.callTool({name:'render_pdf_page',arguments:args}),repeat=await client.callTool({name:'render_pdf_page',arguments:args});
  assert.equal(first.content.filter(x=>x.type==='image').length,1);assert.equal(repeat.content.filter(x=>x.type==='image').length,0);assert.match(repeat.content[0].text,/REFERENCE ONLY/);assert.equal(repeat.structuredContent.imageRef,first.structuredContent.imageRef);
  assert.equal((await client.callTool({name:'render_pdf_page',arguments:{...args,region:[.6,.1,.3,.2]}})).content.filter(x=>x.type==='image').length,1);
});
