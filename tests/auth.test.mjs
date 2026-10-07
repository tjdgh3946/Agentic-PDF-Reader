import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,unlink,mkdir,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import http from 'node:http';
import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT} from 'jose';
import {createAuth,ISSUER,RESOURCE} from '../auth.mjs';
import {createAppServer,ORIGIN} from '../server.mjs';
import {responseEvents} from '../stream.mjs';
import {createSettings} from '../settings.mjs';
const {privateKey,publicKey}=await generateKeyPair('RS256');
const jwk=await exportJWK(publicKey);jwk.kid='test';jwk.alg='RS256';
const keys=createLocalJWKSet({keys:[jwk]});
const base=fileURLToPath(new URL('../../../work/',import.meta.url));await mkdir(base,{recursive:true});
async function fixture(t,options={}) {
  const directory=await mkdtemp(path.join(base,'auth-test-'));
  t.after(async()=>{const relative=path.relative(base,directory);assert.ok(relative.startsWith('auth-test-')&&!relative.includes(path.sep));await rm(directory,{recursive:true,force:true});});
  let nonce='',now=Date.now();const requests=[];
  const fetcher=async(url,init={})=>{
    requests.push({url,init});
    if(url.endsWith('openid-configuration')) return Response.json({issuer:ISSUER,authorization_endpoint:ISSUER+'/api/accounts/authorize',token_endpoint:ISSUER+'/api/accounts/oauth/token',jwks_uri:ISSUER+'/.well-known/jwks.json',revocation_endpoint:ISSUER+'/api/accounts/oauth/revoke'});
    if(url.endsWith('/token')) {
      const body=new URLSearchParams(init.body);
      if(body.get('grant_type')==='refresh_token') return Response.json({access_token:'refreshed-secret',refresh_token:'rotated-secret',expires_in:3600});
      if(options.exchangeError) return Response.json({error:'invalid_grant'},{status:400});
      const jwt=await new SignJWT({sub:'subject-1',email:'test@example.invalid',nonce:options.badNonce?'bad':nonce}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer(ISSUER).setAudience(options.badAudience?'other-app':'oaiapp_test').setIssuedAt().setExpirationTime('1h').sign(privateKey);
      return Response.json({id_token:jwt,access_token:'access-secret',refresh_token:'refresh-secret',scope:options.noScope?'openid email':'openid chatgpt.tokens.use.direct',expires_in:3600});
    }
    if(url.endsWith('/models')) return Response.json({models:[{slug:'allowed',display_name:'Allowed',visibility:'list'},{slug:'hidden',visibility:'hidden'}]});
    if(url.endsWith('/revoke')) return new Response('',{status:200});
    if(url.endsWith('/responses')) return new Response('data: {"type":"response.completed"}\n\n');
    throw new Error('Unexpected request');
  };
  const auth=await createAuth({directory,origin:options.origin || ORIGIN,fetcher,jwks:keys,clock:()=>now});
  async function begin(profileId) {
    const launchUrl=await auth.start(profileId);
    const ticket=new URL(launchUrl).searchParams.get('ticket');
    const result=auth.launch(ticket);const params=new URL(result.url).searchParams;nonce=params.get('nonce');
    return {params,cookie:result.cookie.split(';')[0].split('=')[1],callback:new URLSearchParams({state:params.get('state'),code:'test-code',client_id:'oaiapp_test'}),ticket};
  }
  return {auth,begin,requests,directory,advance:ms=>{now+=ms;}};
}
test('PKCE, loopback URI and browser binding; forged state is never exchanged',async t=>{
  const f=await fixture(t),tx=await f.begin();
  assert.equal(tx.params.get('client_id'),'dynamic_agent_client');assert.equal(tx.params.get('code_challenge_method'),'S256');assert.equal(tx.params.get('redirect_uri'),ORIGIN+'/auth/callback');
  await assert.rejects(f.auth.callback(tx.callback,'wrong-cookie'));
  assert.equal(f.requests.filter(x=>x.url.endsWith('/token')).length,0);
  assert.throws(()=>f.auth.launch(tx.ticket));
});
test('valid ID token enables plan usage; credentials never reach status or disk; callback is one-use',async t=>{
  const f=await fixture(t),tx=await f.begin();await f.auth.callback(tx.callback,tx.cookie);
  assert.equal(f.auth.info().planEnabled,true);await assert.rejects(f.auth.callback(tx.callback,tx.cookie));
  const disk=await readFile(path.join(f.directory,'registration.json'),'utf8');
  assert.ok(!disk.includes('access-secret')&&!disk.includes('refresh-secret')&&!disk.includes('id_token'));
  assert.ok(!JSON.stringify(f.auth.info()).includes('secret'));
  const tokenCall=f.requests.find(x=>x.url.endsWith('/token'));assert.equal(new URLSearchParams(tokenCall.init.body).get('client_id'),'oaiapp_test');
  const tx2=await f.begin(f.auth.info().profiles[0].id);assert.equal(tx2.params.get('client_id'),'oaiapp_test');assert.equal(tx2.params.has('agent_name_hint'),false);
});
for(const option of ['badNonce','badAudience']) test(`rejects invalid ${option}`,async t=>{
  const f=await fixture(t,{[option]:true}),tx=await f.begin();await assert.rejects(f.auth.callback(tx.callback,tx.cookie));assert.equal(f.auth.info().connected,false);
});
test('expired attempts and denied consent cannot sign in',async t=>{
  const f=await fixture(t);let tx=await f.begin();tx.callback.set('error','access_denied');await assert.rejects(f.auth.callback(tx.callback,tx.cookie));
  tx=await f.begin();f.advance(601000);await assert.rejects(f.auth.callback(tx.callback,tx.cookie));assert.equal(f.auth.info().connected,false);
});
test('identity alone does not grant inference',async t=>{
  const f=await fixture(t,{noScope:true}),tx=await f.begin();await f.auth.callback(tx.callback,tx.cookie);assert.equal(f.auth.info().connected,true);assert.equal(f.auth.info().planEnabled,false);await assert.rejects(f.auth.models());
});
test('failed exchange retains issued registration for retry',async t=>{
  const f=await fixture(t,{exchangeError:true}),tx=await f.begin();await assert.rejects(f.auth.callback(tx.callback,tx.cookie));const retry=await f.begin(f.auth.info().profiles[0].id);assert.equal(retry.params.get('client_id'),'oaiapp_test');
});
test('refresh is serialized, model catalog filtered, sign out revokes rotated token',async t=>{
  const f=await fixture(t),tx=await f.begin();await f.auth.callback(tx.callback,tx.cookie);f.advance(3550000);
  const results=await Promise.all([f.auth.models(),f.auth.models()]);assert.deepEqual(results[0],[{id:'allowed',name:'Allowed'}]);
  assert.equal(f.requests.filter(x=>x.url.endsWith('/token')&&new URLSearchParams(x.init.body).get('grant_type')==='refresh_token').length,1);
  await f.auth.inference('allowed','hello',new AbortController().signal);
  const sent=JSON.parse(f.requests.find(x=>x.url.endsWith('/responses')).init.body);assert.equal(sent.store,false);assert.equal(sent.stream,true);
  assert.equal((await f.auth.logout()).revoked,true);assert.equal(f.auth.info().connected,false);
  assert.equal(new URLSearchParams(f.requests.find(x=>x.url.endsWith('/revoke')).init.body).get('token'),'rotated-secret');
});
test('loopback API rejects foreign origins and never serves private/backend files',async t=>{
  const f=await fixture(t);const server=createAppServer(f.auth,{openBrowser:async()=>{}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));const address=`http://127.0.0.1:${server.address().port}`;
  const localFetch=(url,options={})=>new Promise((resolve,reject)=>{const req=http.request(url,{method:options.method || 'GET',headers:options.headers},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode}));});req.on('error',reject);req.end(options.body);});
  const headers={Host:'127.0.0.1:8767'};
  for(const file of ['/auth.mjs','/server.mjs','/.local/registration.json','/node_modules/jose/package.json','/pdfjs/..%5c.local%5cregistration.json']) assert.equal((await localFetch(address+file,{headers})).status,404);
  assert.equal((await localFetch(address+'/api/auth/status',{headers})).status,403);
  assert.equal((await localFetch(address+'/api/auth/start',{method:'POST',headers:{...headers,'X-Paper-Reader':'1','Content-Type':'application/json',Origin:'https://evil.invalid'},body:'{}'})).status,403);
  assert.equal((await localFetch(address+'/api/auth/status',{headers:{...headers,'X-Paper-Reader':'1'}})).status,200);
});
test('stream parses fragmented UTF-8 and surfaces failure after partial text',async()=>{
  const raw='data: {"type":"response.output_text.delta","delta":"안녕"}\r\n\r\ndata: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n';
  const bytes=new TextEncoder().encode(raw);async function* chunks(){for(let n=0;n<bytes.length;n+=3)yield bytes.slice(n,n+3);}
  const events=[];for await(const event of responseEvents(chunks()))events.push(event);
  assert.deepEqual(events,[{type:'delta',text:'안녕'},{type:'error',code:'subscription_sharing_usage_limit_exceeded'}]);assert.ok(!events.some(x=>x.type==='complete'));
});
test('desktop uses its own available loopback port for server and OAuth exchange',async t=>{
  let origin;
  const f=await fixture(t,{origin:()=>origin});
  const server=createAppServer(f.auth,{getOrigin:()=>origin,openBrowser:async()=>{}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin=`http://127.0.0.1:${server.address().port}`;
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  assert.equal((await fetch(origin+'/api/auth/status',{headers:{'X-Paper-Reader':'1'}})).status,200);
  const tx=await f.begin();assert.equal(tx.params.get('redirect_uri'),origin+'/auth/callback');
  await f.auth.callback(tx.callback,tx.cookie);
  const tokenRequest=f.requests.find(x=>x.url.endsWith('/token'));
  assert.equal(new URLSearchParams(tokenRequest.init.body).get('redirect_uri'),origin+'/auth/callback');
});
test('external CSS loads on request, is editable, and falls back when removed',async t=>{
  let origin;const f=await fixture(t),externalCssPath=path.join(f.directory,'Paper-Reader.css');
  await writeFile(externalCssPath,'body { color: purple; }');
  const server=createAppServer(f.auth,{getOrigin:()=>origin,externalCssPath});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  t.after(()=>new Promise(resolve=>server.close(resolve)));
    const overlay=await fetch(origin+'/annotation-overlay.css');assert.equal(overlay.status,200);assert.match(overlay.headers.get('content-type'),/text\/css/);assert.match(await overlay.text(),/\.reader-highlight/);
    const response=await fetch(origin+'/app.css');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(await response.text(),'body { color: purple; }');
  await writeFile(externalCssPath,'body { color: navy; }');assert.equal(await (await fetch(origin+'/app.css')).text(),'body { color: navy; }');
  assert.equal((await fetch(origin+'/Paper-Reader.css')).status,404);
  assert.equal((await fetch(origin+'/registration.json')).status,404);
  await unlink(externalCssPath);const fallback=await fetch(origin+'/app.css');assert.equal(fallback.status,200);assert.ok((await fallback.text()).includes('.primary'));
});

test('mode persists across restarts; invalid or corrupt settings cannot enable inference',async t=>{
  const f=await fixture(t),file=path.join(f.directory,'settings.json');
  const settings=await createSettings(file);assert.equal(settings.get().mode,'manual');
  await settings.set({mode:'plan'});assert.equal((await createSettings(file)).get().mode,'plan');
  assert.throws(()=>settings.set({mode:'invalid'}));assert.equal(settings.get().mode,'plan');
  await settings.set({mode:'manual'});assert.equal((await createSettings(file)).get().mode,'manual');
  await writeFile(file,'{broken');assert.equal((await createSettings(file)).get().mode,'manual');
});

test('manual mode blocks all inference even when signed in; browser receives only a fixed homepage URL',async t=>{
  const f=await fixture(t),tx=await f.begin();await f.auth.callback(tx.callback,tx.cookie);
  let origin;const opened=[],settings=await createSettings();
  const server=createAppServer(f.auth,{settings,getOrigin:()=>origin,openBrowser:async url=>opened.push(url)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const post=(url,body)=>fetch(origin+url,{method:'POST',headers:{'X-Paper-Reader':'1',Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post('/api/ask',{model:'allowed',prompt:'private paper'})).status,409);
  assert.equal(f.requests.filter(x=>x.url.endsWith('/responses')).length,0);
  assert.deepEqual(await (await post('/api/open-chatgpt',{url:'https://evil.invalid/?paper=private'})).json(),{opened:true});
  assert.deepEqual(opened,['https://chatgpt.com/']);
  assert.equal((await post('/api/settings',{mode:'plan'})).status,200);
  await f.auth.models();
  const chat=await (await post('/api/chat/new',{documentId:'test',fileName:'test.pdf'})).json();
  const answer=await post('/api/ask',{model:'allowed',prompt:'synthetic question',chatId:chat.id,turn:{question:'synthetic question',selection:'quote',pageLabel:'p. 1'}});
  assert.equal(answer.status,200);assert.match(await answer.text(),/complete/);
  assert.equal(f.requests.filter(x=>x.url.endsWith('/responses')).length,1);
  assert.equal((await post('/api/open-chatgpt',{})).status,409);
  assert.equal((await post('/api/settings',{mode:'manual'})).status,200);
  assert.equal((await post('/api/ask',{model:'allowed',prompt:'stale UI request'})).status,409);
  assert.equal(f.requests.filter(x=>x.url.endsWith('/responses')).length,1);
  assert.equal((await fetch(origin+'/settings.mjs')).status,404);
});

test('cannot change mode during inference; failed browser launch is reported for fallback',async t=>{
  let origin,finish,started;
  const waiting=new Promise(resolve=>{started=resolve;});
  const settings=await createSettings();await settings.set({mode:'plan'});
  const auth={activeRequests:new Set(),async inference(){started();await new Promise(resolve=>{finish=resolve;});return new Response('data: {"type":"response.completed"}\n\n');}};
  const server=createAppServer(auth,{settings,getOrigin:()=>origin,openBrowser:async()=>{throw new Error('no browser');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const post=(url,body)=>fetch(origin+url,{method:'POST',headers:{'X-Paper-Reader':'1',Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const chat=await (await post('/api/chat/new',{documentId:'test',fileName:'test.pdf'})).json();
  const response=post('/api/ask',{model:'allowed',prompt:'synthetic',chatId:chat.id,turn:{question:'synthetic',selection:'quote',pageLabel:'p. 1'}});await waiting;
  assert.equal((await post('/api/settings',{mode:'manual'})).status,409);
  assert.equal(settings.get().mode,'plan');finish();await (await response).text();
  assert.equal((await post('/api/settings',{mode:'manual'})).status,200);
  assert.deepEqual(await (await post('/api/open-chatgpt',{})).json(),{opened:false});
});
