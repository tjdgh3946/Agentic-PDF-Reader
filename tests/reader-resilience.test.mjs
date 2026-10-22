import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createShareArchive} from '../share-archive.mjs';
import {createPaperLink} from '../paper-link.mjs';
import {createPdfSnapshots} from '../pdf-snapshots.mjs';
import {textQuality} from '../pdf-text-quality.mjs';
import {pageNote} from '../reading-tools.mjs';

// DPAPI is exercised separately in the real Electron runtime. This adapter
// isolates archive format/AEAD behavior from platform account availability.
const secure={isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from('wrapped:'+text),decryptString:bytes=>bytes.toString().slice(8)};
const bytes=Buffer.from('%PDF-1.7\nprivate fixture document'),paragraph='Neural tangent kernel '+ 'source '.repeat(650);
async function fixture(t,{pages=[paragraph+'\n\nSecond paragraph assumptions.',''],archiveOptions}={}){
  const directory=await mkdtemp(path.join(os.tmpdir(),'reader-resilience-'));let timestamp=Date.now(),loads=0,notes=[];
  const instances=[];
  const boot=async()=>{
    const archive=createShareArchive(path.join(directory,'cache'),archiveOptions||secure);
    const pdfs=createPdfSnapshots({renderer:{load:async()=>{loads++;return {documentId:'abc123',pages};},render:async(_id,page,region)=>({image:{data:'aGVsbG8=',mimeType:'image/png'},metadata:{page,region}}),release(){},close(){}}});
    const link=createPaperLink({pdfs,archive,annotations:{list:async()=>notes,upsert:async(_id,item)=>{const note={id:'aa11',...item};notes.push(note);return note;}},discoveryPath:path.join(directory,'connection.json'),getOrigin:()=> 'http://127.0.0.1:12345',now:()=>timestamp});
    const instance={link,pdfs,archive};instances.push(instance);await link.restore();return instance;
  };
  t.after(async()=>{for(const instance of instances){await instance.link.close();instance.pdfs.close();}});
  const first=await boot(),registered=await first.pdfs.register(bytes,'abc123','private.pdf');
  const shared=await first.link.share({snapshotId:registered.snapshotId,documentId:'abc123',fileName:'private.pdf',...pageNote(1),question:'private question',context:'',allowSave:true});
  return {directory,boot,first,shared,notes,loads:()=>loads,advance:ms=>timestamp+=ms};
}

test('encrypted shares survive a new app instance with the same ID, evidence and delivery history',async t=>{
  const f=await fixture(t),args={selectionId:f.shared.selectionId};
  const firstText=await f.first.link.call('read_pdf',{...args,passageId:'p1.1'});
  const firstImage=await f.first.link.call('render_pdf_page',{...args,page:1});
  await f.first.link.call('save_annotation',{...args,note:'Saved once.'});
  const oldDiscovery=JSON.parse(await readFile(path.join(f.directory,'connection.json'),'utf8'));
  await f.first.link.close();f.first.pdfs.close();
  const next=await f.boot();assert.equal(f.loads(),1,'Restoration must not eagerly render/index every PDF');
  const newDiscovery=JSON.parse(await readFile(path.join(f.directory,'connection.json'),'utf8'));
  assert.notEqual(newDiscovery.token,oldDiscovery.token);assert.equal(next.link.authorize('Bearer '+oldDiscovery.token),false);
  assert.equal((await next.link.call('get_selection',args)).selection.selectionId,f.shared.selectionId);
  const [found,duplicate]=await Promise.all([next.link.call('search_pdf',{...args,query:'kernel'}),next.link.call('render_pdf_page',{...args,page:1})]);
  assert.equal(found.matches[0].page,1);assert.equal(f.loads(),2,'Concurrent tools hydrate a single original snapshot');
  assert.equal(duplicate.delivery,'reference');assert.equal(duplicate.imageRef,firstImage.imageRef);
  const text=await next.link.call('read_pdf',{...args,passageId:'p1.1'});assert.equal(text.characters,0);assert.equal(text.pages[0].textRef,firstText.pages[0].textRef);assert.equal(text.pages[0].text,undefined);
  const reread=await next.link.call('read_pdf',{...args,passageId:'p1.1',reread:true,reason:'The earlier source is no longer visible in this conversation.'});assert.equal(reread.pages[0].text,firstText.pages[0].text);
  assert.equal((await next.link.call('save_annotation',{...args,note:'Saved once.'})).duplicate,true);assert.equal(f.notes.length,1);
  assert.equal(f.notes[0].evidence.pages[0].image,true);
});

test('encrypted archive contains no plaintext PDF/question and detects PDF tampering',async t=>{
  const f=await fixture(t),cache=path.join(f.directory,'cache'),files=await readdir(cache);
  for(const name of files.filter(name=>name.endsWith('.enc'))){const data=await readFile(path.join(cache,name));assert.equal(data.includes(bytes),false);assert.equal(data.includes(Buffer.from('private question')),false);}
  const pdf=path.join(cache,f.shared.snapshotId+'.enc'),data=await readFile(pdf);data[data.length-1]^=1;await writeFile(pdf,data);
  await f.first.link.close();f.first.pdfs.close();const next=await f.boot();
  await assert.rejects(next.link.call('render_pdf_page',{selectionId:f.shared.selectionId,page:1}),/복원하지 못/);
});

test('revocation and TTL remove restored access and cached PDF bytes',async t=>{
  const f=await fixture(t);await f.first.link.setEnabled(false);
  assert.ok(!(await readdir(path.join(f.directory,'cache'))).some(file=>file===f.shared.snapshotId+'.enc'));
  await f.first.link.close();const next=await f.boot();assert.equal(next.link.status().sharedCount,0);
  const registered=await next.pdfs.register(bytes,'abc123','private.pdf');
  const shared=await next.link.share({snapshotId:registered.snapshotId,documentId:'abc123',fileName:'private.pdf',...pageNote(1),question:'expires',context:'',allowSave:false});
  await next.link.close();f.advance(24*60*60*1000);const expired=await f.boot();assert.equal(expired.link.status().sharedCount,0);assert.equal(expired.link.status().restoredCount,0);
  await assert.rejects(expired.link.call('get_selection',{selectionId:shared.selectionId}),/꺼져|만료/);
  assert.ok(!(await readdir(path.join(f.directory,'cache'))).some(file=>file===shared.snapshotId+'.enc'));
});

test('cache failures are visible while current-session PDF reading remains available',async t=>{
  const f=await fixture(t,{archiveOptions:{isEncryptionAvailable:()=>false}});
  assert.ok(f.first.link.status().archiveError);assert.equal((await f.first.link.call('search_pdf',{selectionId:f.shared.selectionId,query:'kernel'})).matches[0].page,1);
  assert.ok(f.first.link.status().archiveError);
});

test('damaged share metadata fails closed and explicit revoke repairs the archive for new shares',async t=>{
  const f=await fixture(t);await f.first.link.close();f.first.pdfs.close();
  const file=path.join(f.directory,'cache','shares.enc'),data=await readFile(file);data[data.length-1]^=1;await writeFile(file,data);
  const next=await f.boot();assert.equal(next.link.status().enabled,false);assert.ok(next.link.status().archiveError);assert.equal(next.link.status().sharedCount,0);
  await next.link.setEnabled(false);assert.equal(next.link.status().archiveError,null);
  const registered=await next.pdfs.register(bytes,'abc123','private.pdf'),shared=await next.link.share({snapshotId:registered.snapshotId,documentId:'abc123',fileName:'private.pdf',...pageNote(1),question:'Repaired cache',context:'',allowSave:false});
  await next.link.close();const repaired=await f.boot();assert.equal(repaired.link.status().archiveError,null);assert.equal(repaired.link.status().restoredCount,1);
  assert.equal((await repaired.link.call('search_pdf',{selectionId:shared.selectionId,query:'kernel'})).matches[0].page,1);
});

test('text references save context; missing evidence expands; budget extension requires a reason',async t=>{
  const f=await fixture(t),args={selectionId:f.shared.selectionId,passageId:'p1.1',maxCharacters:4000};
  const original=await f.first.link.call('read_pdf',args),again=await f.first.link.call('read_pdf',args);
  assert.equal(again.characters,0);assert.equal(again.contextUsage.textCharacters,4000);
  const more=await f.first.link.call('expand_pdf',{selectionId:f.shared.selectionId,cursor:original.pages[0].after,reason:'The source sentence is clipped.'});assert.ok(more.characters>0);
  for(let i=0;i<5;i++)await f.first.link.call('read_pdf',{...args,reread:true,reason:'Explicitly verify the source again.'});
  await assert.rejects(f.first.link.call('search_pdf',{selectionId:f.shared.selectionId,query:'kernel'}),/예산/);
  const extra=await f.first.link.call('search_pdf',{selectionId:f.shared.selectionId,query:'assumptions',reason:'Locate assumptions needed to verify the theorem.'});assert.ok(extra.matches.length);
  assert.equal((await f.first.link.call('read_pdf',args)).characters,0,'References remain accessible after budget exhaustion');
  await assert.rejects(f.first.link.call('read_pdf',{...args,reread:true}),/이유/);
});

test('image budget keeps references usable and permits a justified new zoom',async t=>{
  const f=await fixture(t),args={selectionId:f.shared.selectionId,page:1};
  for(let i=0;i<8;i++)await f.first.link.call('render_pdf_page',{...args,region:[i*.01,0,.5,.5]});
  await assert.rejects(f.first.link.call('render_pdf_page',{...args,region:[.2,.1,.2,.2]}),/예산/);
  assert.equal((await f.first.link.call('render_pdf_page',{...args,region:[0,0,.5,.5]})).delivery,'reference');
  const zoom=await f.first.link.call('render_pdf_page',{...args,region:[.2,.1,.2,.2],reason:'Read the small legend which is not legible in the overview.'});assert.equal(zoom.imageReturned,true);assert.equal(zoom.contextUsage.imageCount,9);
});

test('scanned/mixed/damaged text exposes bounded quality metadata even on zero search hits',async t=>{
  assert.equal(textQuality(['']).status,'limited');assert.equal(textQuality(['Normal source '.repeat(10)]).status,'searchable');
  const f=await fixture(t,{pages:['','Normal kernel source '.repeat(10),'Damaged '+ '\uFFFD'.repeat(20)]});
  const found=await f.first.link.call('search_pdf',{selectionId:f.shared.selectionId,query:'absent'});
  assert.equal(found.matches.length,0);assert.equal(found.textQuality.status,'partial');assert.deepEqual(found.textQuality.lowTextPages,[1,3]);assert.deepEqual(found.textQuality.damagedTextPages,[3]);
  assert.ok(found.advice.includes('render_pdf_page'));assert.ok((await f.first.link.call('render_pdf_page',{selectionId:f.shared.selectionId,page:1})).image);
  const bounded=textQuality(Array(1000).fill(''));assert.equal(bounded.lowTextPages.length,20);assert.equal(bounded.lowTextPageCount,1000);assert.equal(bounded.pageListTruncated,true);
});


test('reference recovery returns executable bounded requests for text, expansion and identical image',async t=>{
  const f=await fixture(t),args={selectionId:f.shared.selectionId,passageId:'p1.1',maxCharacters:256};
  const first=await f.first.link.call('read_pdf',args),reference=await f.first.link.call('read_pdf',args);
  const plan=reference.contextRecovery;assert.equal(plan.sourceIncluded,false);assert.equal(reference.characters,0);
  assert.deepEqual(plan.missingReferences,[first.pages[0].textRef]);assert.equal(plan.retry.tool,'read_pdf');
  assert.deepEqual({...plan.retry.arguments,reason:undefined},{...args,reread:true,reason:undefined});
  assert.match(plan.instruction,/missing OR.*uncertain/);assert.match(plan.instruction,/do not guess/);assert.match(plan.onFailure,/do not guess/);
  const recovered=await f.first.link.call(plan.retry.tool,plan.retry.arguments);
  assert.equal(recovered.pages[0].text,first.pages[0].text);assert.equal(recovered.pages[0].textRef,first.pages[0].textRef);assert.equal(recovered.contextRecovery,undefined);
  const expansion={selectionId:args.selectionId,cursor:first.pages[0].after,maxCharacters:128,reason:'Read clipped conclusion.'};
  const expanded=await f.first.link.call('expand_pdf',expansion),repeated=await f.first.link.call('expand_pdf',expansion);
  assert.equal(repeated.contextRecovery.retry.tool,'expand_pdf');assert.equal(repeated.contextRecovery.retry.arguments.cursor,expansion.cursor);
  assert.equal((await f.first.link.call('expand_pdf',repeated.contextRecovery.retry.arguments)).pages[0].text,expanded.pages[0].text);
  const imageArgs={selectionId:args.selectionId,page:1,region:[.58,.08,.27,.22]};
  const image=await f.first.link.call('render_pdf_page',imageArgs),duplicate=await f.first.link.call('render_pdf_page',imageArgs);
  assert.equal(duplicate.image,undefined);assert.equal(duplicate.contextRecovery.sourceIncluded,false);
  assert.deepEqual({...duplicate.contextRecovery.retry.arguments,reason:undefined},{...imageArgs,resend:true,reason:undefined});
  const resent=await f.first.link.call('render_pdf_page',duplicate.contextRecovery.retry.arguments);
  assert.ok(resent.image);assert.equal(resent.imageRef,image.imageRef);assert.equal(resent.delivery,'resend');
  await f.first.link.setEnabled(false);
  await assert.rejects(f.first.link.call(plan.retry.tool,plan.retry.arguments),/꺼져/);
});

test('mixed multi-page reads identify omitted references instead of claiming all evidence is present',async t=>{
  const f=await fixture(t,{pages:['First kernel source.','Second kernel source.']});const args={selectionId:f.shared.selectionId,maxCharacters:256};
  await f.first.link.call('read_pdf',{...args,passageId:'p1.1'});
  const mixed=await f.first.link.call('read_pdf',{...args,pages:[1,2]});
  assert.equal(mixed.pages[0].text,undefined);assert.equal(mixed.pages[1].text,'Second kernel source.');
  assert.equal(mixed.contextRecovery.sourceIncluded,true);assert.equal(mixed.contextRecovery.missingReferences.length,1);
  const retry=await f.first.link.call('read_pdf',mixed.contextRecovery.retry.arguments);
  assert.equal(retry.pages[0].text,'First kernel source.');assert.equal(retry.pages[1].text,'Second kernel source.');
});


test('delivery history distinguishes actual source, references and recovery without exposing payloads in polling',async t=>{
  const f=await fixture(t),id=f.shared.selectionId;
  const args={selectionId:id,passageId:'p1.1',maxCharacters:256};
  const first=await f.first.link.call('read_pdf',args);await f.first.link.call('read_pdf',args);await f.first.link.call('read_pdf',{...args,reread:true,reason:'Earlier source unavailable.'});
  const imageArgs={selectionId:id,page:1,region:[.58,.08,.27,.22]};await f.first.link.call('render_pdf_page',imageArgs);await f.first.link.call('render_pdf_page',imageArgs);await f.first.link.call('render_pdf_page',{...imageArgs,resend:true,reason:'Earlier pixels unavailable.'});
  const history=f.first.link.deliveries('abc123',id);assert.equal(history.events.length,6);
  assert.deepEqual(history.events.map(e=>e.items[0].delivery),['text','reference','reread','image','reference','resend']);
  assert.equal(history.events[0].items[0].text,first.pages[0].text);assert.equal(history.events[1].items[0].text,undefined);assert.equal(history.events[1].items[0].characters,0);assert.equal(history.events[4].items[0].sha256,undefined);
  const statusBefore=JSON.stringify(f.first.link.status()),image=await f.first.link.deliveryImage('abc123',id,history.events[3].id);
  assert.equal(image.data,'aGVsbG8=');assert.equal(JSON.stringify(f.first.link.status()),statusBefore,'Local preview must not contact the model or change trace/budget');
  assert.equal(JSON.stringify(f.first.link.status()).includes(first.pages[0].text),false);
  await assert.rejects(f.first.link.deliveryImage('abc123',id,history.events[4].id),/PNG/);
  assert.throws(()=>f.first.link.deliveries('other-document',id),/다른 문서/);
  await f.first.link.close();f.first.pdfs.close();const next=await f.boot();const restored=next.link.deliveries('abc123',id);
  assert.equal(restored.events[0].items[0].text,first.pages[0].text);assert.equal((await next.link.deliveryImage('abc123',id,history.events[3].id)).sha256,image.sha256);
  const files=await readdir(path.join(f.directory,'cache'));const encrypted=await readFile(path.join(f.directory,'cache',image.sha256+'.image.enc'));assert.equal(encrypted.includes(Buffer.from('hello')),false);
  await next.link.setEnabled(false);assert.ok(!(await readdir(path.join(f.directory,'cache'))).some(name=>name.endsWith('.image.enc')));
  await assert.rejects(next.link.deliveryImage('abc123',id,history.events[3].id),/해제|만료/);
});

test('delivery retention is bounded and missing cached PNG never silently renders a substitute',async t=>{
  const f=await fixture(t),args={selectionId:f.shared.selectionId,page:1};
  await f.first.link.call('render_pdf_page',args);const old=f.first.link.deliveries('abc123',args.selectionId).events[0];
  for(let i=0;i<43;i++)await f.first.link.call('render_pdf_page',args);
  const history=f.first.link.deliveries('abc123',args.selectionId);assert.equal(history.events.length,40);assert.equal(history.dropped,4);
  await assert.rejects(f.first.link.deliveryImage('abc123',args.selectionId,old.id),/PNG/);
  const {appendDelivery}=await import('../delivery-history.mjs');const records=new Map();
  for(let r=0;r<6;r++){const item={deliveries:[]};records.set(String(r),item);for(let i=0;i<40;i++)appendDelivery(records,item,{id:r+'-'+i,at:new Date(r*1000+i).toISOString(),items:[]});}
  assert.equal([...records.values()].reduce((n,r)=>n+r.deliveries.length,0),160);
});


test('disconnect during PNG archival cannot return a newly revoked image',async t=>{
  const f=await fixture(t);let release,entered=false;const barrier=new Promise(resolve=>release=resolve);
  f.first.archive.putImage=async()=>{entered=true;await barrier;};
  const reading=f.first.link.call('render_pdf_page',{selectionId:f.shared.selectionId,page:1});
  while(!entered)await new Promise(resolve=>setImmediate(resolve));
  await f.first.link.setEnabled(false);release();await assert.rejects(reading,/종료/);
  assert.equal(f.first.link.deliveries('abc123').shares.length,0);
});

test('damaged archived delivery PNG reports unavailability without rendering a replacement',async t=>{
  const f=await fixture(t),id=f.shared.selectionId;await f.first.link.call('render_pdf_page',{selectionId:id,page:1});const event=f.first.link.deliveries('abc123',id).events[0];
  await f.first.link.close();f.first.pdfs.close();const next=await f.boot(),loads=f.loads();
  const file=path.join(f.directory,'cache',event.items[0].sha256+'.image.enc'),bytes=await readFile(file);bytes[30]^=1;await writeFile(file,bytes);
  await assert.rejects(next.link.deliveryImage('abc123',id,event.id),/PNG.*열 수 없/);assert.equal(f.loads(),loads,'Do not replace the recorded PNG by rendering the PDF');
});


test('reference inspection selects the most recent preceding payload after a resend, not an older PNG',async()=>{
  const {previousDelivery}=await import('../delivery-ui.mjs');const events=['image','reference','resend','reference'].map((delivery,id)=>({id:String(id),items:[{ref:'same-image',delivery}]}));
  assert.equal(previousDelivery(events,'1','same-image').id,'0');assert.equal(previousDelivery(events,'3','same-image').id,'2');assert.equal(previousDelivery(events,'1','unknown'),undefined);
});
