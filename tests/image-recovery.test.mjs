import test from 'node:test';
import assert from 'node:assert/strict';
import {linkQuestion,imageRecoveryQuestion,imageDisplayGuide} from '../link-question.mjs';
import {createLinkMcpServer} from '../link/mcp-server.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
const selection={selectionId:'11111111-1111-4111-8111-111111111111',fileName:'ntk.pdf',pages:[9],pdfAvailable:true,question:'Read Figure 3(c)',quote:'source',allowSave:false};
test('normal and recovery questions teach both raw image envelope shapes while preserving share and save preference',()=>{
  for(const question of [linkQuestion(selection),imageRecoveryQuestion(selection)]){
    assert.ok(question.includes(imageDisplayGuide));assert.ok(question.includes(selection.selectionId));assert.ok(question.includes(selection.question));
    assert.match(question,/이번 답변은 PDF에 저장하지/);
  }
  assert.match(imageRecoveryQuestion(selection),/기존 대화/);
  assert.match(imageRecoveryQuestion(selection),/resend:true/);
  assert.match(imageRecoveryQuestion({...selection,allowSave:true}),/답변 후 save_annotation/);
});
test('MCP image response guides wrappers that expose content as text and blocks as content_items',async t=>{
  const png={type:'image',mimeType:'image/png',data:'iVBORw0KGgo='};
  const server=createLinkMcpServer({htmlPath:'',call:async()=>({image:png,imageReturned:true,imageRef:'image-test',delivery:'image'})});
  const client=new Client({name:'envelope-regression',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);t.after(()=>client.close());
  const result=await client.callTool({name:'render_pdf_page',arguments:{selectionId:selection.selectionId,page:9}});
  assert.ok(result.content.find(c=>c.type==='text').text.includes(imageDisplayGuide));
  assert.equal(result.structuredContent.image,undefined);
  const descriptor=(await client.listTools()).tools.find(x=>x.name==='render_pdf_page');assert.ok(descriptor.description.includes(imageDisplayGuide));
  // Run the exact selection expression shipped to the model, against the
  // observed host envelope and the standard MCP envelope.
  const expression=imageDisplayGuide.match(/Use (.+?), and pass/)[1];
  const selectBlocks=new Function('r','return '+expression);
  for(const r of [result,{content:result.content[0].text,content_items:result.content,structuredContent:result.structuredContent}]){
    const images=selectBlocks(r).filter(c=>c.type==='image');assert.equal(images.length,1);assert.equal(images[0].data,png.data);
  }
  assert.deepEqual(selectBlocks({content:'metadata only'}),[]);
});


test('MCP reference envelopes refuse summary-based inference and expose the recovery call for both source types',async t=>{
  const {sourceRecoveryGuide}=await import('../link-question.mjs');
  const retry={tool:'read_pdf',arguments:{selectionId:selection.selectionId,passageId:'p9.17',maxCharacters:256,reread:true,reason:'Earlier exact source is unavailable.'}};
  const server=createLinkMcpServer({htmlPath:'',call:async()=>({pages:[{page:9,textRef:'text-fixture',delivery:'reference'}],characters:0,contextRecovery:{sourceIncluded:false,missingReferences:['text-fixture'],instruction:sourceRecoveryGuide,retry}})});
  const client=new Client({name:'context-loss-regression',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);t.after(()=>client.close());
  const result=await client.callTool({name:'read_pdf',arguments:{selectionId:selection.selectionId,passageId:'p9.17'}});
  assert.match(result.content[0].text,/REFERENCE ONLY/);assert.match(result.content[0].text,/before answering/);assert.match(result.content[0].text,/without guessing/);
  assert.deepEqual(result.structuredContent.contextRecovery.retry,retry);
  assert.ok(linkQuestion(selection).includes(sourceRecoveryGuide));
  const tools=(await client.listTools()).tools;for(const name of ['read_pdf','expand_pdf','render_pdf_page'])assert.match(tools.find(x=>x.name===name).description,/contextRecovery.retry/);
});
