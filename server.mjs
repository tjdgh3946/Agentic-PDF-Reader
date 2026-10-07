import {selectorPrompt,parseSelection} from './auto-context.mjs';
import {validateAuto,fitContext} from './auto-budget.mjs';
import {estimateInput} from './tokens.mjs';
import http from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createAuth,UserError} from './auth.mjs';
import {responseEvents,responseError} from './stream.mjs';
import {createChats} from './chats.mjs';
import {createSettings} from './settings.mjs';
import {createUsageReader,compareUsageAccount} from './usage.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
export const ORIGIN='http://127.0.0.1:8767';
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.pdf':'application/pdf','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.ftl':'text/plain; charset=utf-8','.bcmap':'application/octet-stream'};
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function json(res,value,status=200) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(value));}
function page(res,title,message,status=200) {res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'}).end(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Paper Reader · ${escape(title)}</title><link rel="stylesheet" href="/auth-page.css"><main><h1>${escape(title)}</h1><p>${escape(message)}</p><p>기존 Paper Reader 창으로 돌아가면 연결 상태가 갱신됩니다.</p><a href="/">Paper Reader 열기</a></main></html>`);}
async function bodyJSON(req) {
  if(!req.headers['content-type']?.startsWith('application/json')) throw new UserError('JSON 요청이 필요합니다.',415);
  let size=0;const chunks=[];
  for await(const chunk of req) {size+=chunk.length;if(size>1_500_000) throw new UserError('요청이 너무 큽니다. 더 짧은 문서로 시도하세요.',413);chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new UserError('요청 형식이 올바르지 않습니다.');}
}
function launchBrowser(url) {
  return new Promise((resolve,reject)=>{
    const child=spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,detached:true,stdio:'ignore'});
    child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});
  });
}
export function createAppServer(auth,{openBrowser=launchBrowser,getOrigin=()=>ORIGIN,externalCssPath,settings,chats,readUsage=createUsageReader()}={}) {
  const settingsReady=settings?Promise.resolve(settings):createSettings();
  const chatsReady=chats?Promise.resolve(chats):createChats();
  let responding=false,changingSettings=false;
  const server=http.createServer(async(req,res)=>{
    const origin=getOrigin(),authority=new URL(origin).host,port=new URL(origin).port;
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','SAMEORIGIN');
    if(![authority,`localhost:${port}`].includes(req.headers.host)) {res.writeHead(403).end();return;}
    let url;
    try {url=new URL(req.url,origin);} catch {res.writeHead(400).end();return;}
    if(req.headers.host===`localhost:${port}`) {res.writeHead(302,{Location:`${origin}${url.pathname}${url.search}`}).end();return;}
    try {
      if(url.pathname==='/health') {res.writeHead(200,{'Content-Type':'text/plain'}).end('paper-reader-local-v2');return;}
      if(url.pathname.startsWith('/api/')) {
        if(req.headers['x-paper-reader']!=='1' || (req.headers.origin && req.headers.origin!==origin) || req.headers['sec-fetch-site']==='cross-site') throw new UserError('허용되지 않은 요청입니다.',403);
        if(req.method==='POST' && req.headers.origin!==origin) throw new UserError('요청 출처를 확인하지 못했습니다.',403);
        const preferences=await settingsReady;
        if(url.pathname==='/api/auto-context' && req.method==='POST') {
          const input=validateAuto(await bodyJSON(req)),direct=preferences.get().mode==='plan';
          if(changingSettings || responding)throw new UserError('진행 중인 요청이 끝난 뒤 다시 시도하세요.',409);
          let numbers=input.candidates.map(p=>p.number),reason='로컬 검색 순위에 따라 문맥을 구성했습니다.',source='local',agentUsage=null;
          // Check the unavoidable history/question cost before making a model call.
          fitContext(input,[],direct);
          if(input.useAgent===true){
            if(!direct)throw new UserError('웹 모드에서는 로컬 Auto만 사용합니다.',409);
            if(typeof input.model!=='string'||!input.model)throw new UserError('모델을 선택하세요.');
            responding=true;const controller=new AbortController();auth.activeRequests.add(controller);
            const timeout=setTimeout(()=>controller.abort(),45000);res.on('close',()=>controller.abort());
            try{
              if(res.destroyed)controller.abort();
              const upstream=await auth.inference(input.model,selectorPrompt(input),controller.signal);
              if(!upstream.ok)throw new UserError('Auto 에이전트 요청에 실패했습니다. 로그인과 사용량을 확인하세요.',502);
              let output='',complete=false;
              for await(const event of responseEvents(upstream.body)){
                if(event.type==='delta'){output+=event.text;if(output.length>10000)throw new Error('selector_too_long');}
                if(event.type==='error')throw new Error('selector_failed');
                if(event.type==='complete'){complete=true;agentUsage=event.usage || null;break;}
              }
              if(!complete)throw new Error('selector_incomplete');
              const selection=parseSelection(output,input.candidates);numbers=selection.numbers;reason=selection.reason;source='agent';
            }catch(error){
              if(controller.signal.aborted)throw new UserError('Auto 문맥 선택을 중지했습니다.',409);
              throw new UserError(error instanceof UserError?error.message:'Auto 에이전트의 선택 결과를 확인하지 못했습니다. 다시 시도하거나 수동 범위를 선택하세요.',502);
            }finally{clearTimeout(timeout);controller.abort();auth.activeRequests.delete(controller);responding=false;}
          }
          json(res,{...fitContext(input,numbers,direct),reason,source,agentUsage,selectorEstimate:estimateInput(selectorPrompt(input),true)});return;
        }
        if(url.pathname==='/api/tokens' && req.method==='POST') {
          const input=await bodyJSON(req);if(typeof input.prompt!=='string')throw new UserError('질문 텍스트가 필요합니다.');
          json(res,estimateInput(input.prompt,preferences.get().mode==='plan'));return;
        }
        if(url.pathname==='/api/chats' && req.method==='GET') {json(res,await (await chatsReady).list());return;}
        if(url.pathname.startsWith('/api/chat/') && req.method==='POST') {
          const input=await bodyJSON(req),store=await chatsReady;
          if(url.pathname==='/api/chat/new') {json(res,await store.create(input));return;}
          if(url.pathname==='/api/chat/get') {json(res,await store.get(input.id));return;}
          if(url.pathname==='/api/chat/delete') {json(res,await store.delete(input.id));return;}
          if(url.pathname==='/api/chat/export') {json(res,await store.begin(input.id,{...input.turn,exported:true}));return;}
        }
        if(url.pathname==='/api/usage' && req.method==='POST') {
          await bodyJSON(req);
          const usage=await readUsage();
          json(res,compareUsageAccount(usage,auth.info().account));return;
        }
        if(url.pathname==='/api/settings' && req.method==='GET') {json(res,preferences.get());return;}
        if(url.pathname==='/api/settings' && req.method==='POST') {
          const input=await bodyJSON(req);
          if(responding || changingSettings) throw new UserError('진행 중인 요청이 끝난 뒤 모드를 변경하세요.',409);
          changingSettings=true;
          try {json(res,await preferences.set(input));} finally {changingSettings=false;}
          return;
        }
        if(url.pathname==='/api/open-chatgpt' && req.method==='POST') {
          await bodyJSON(req);
          if(preferences.get().mode!=='manual' || changingSettings) throw new UserError('ChatGPT에서 직접 질문 모드에서 사용하세요.',409);
          let opened=true;try{await openBrowser('https://chatgpt.com/');}catch{opened=false;}
          json(res,{opened});return;
        }
        if(url.pathname==='/api/auth/status' && req.method==='GET') {json(res,auth.info());return;}
        if(url.pathname==='/api/auth/start' && req.method==='POST') {
          const input=await bodyJSON(req);const launchUrl=await auth.start(input.profileId);
          let opened=true;try{await openBrowser(launchUrl);}catch{opened=false;}
          json(res,{opened,launchUrl});return;
        }
        if(url.pathname==='/api/auth/logout' && req.method==='POST') {await bodyJSON(req);json(res,await auth.logout());return;}
        if(url.pathname==='/api/models' && req.method==='GET') {json(res,{models:await auth.models()});return;}
        if(url.pathname==='/api/ask' && req.method==='POST') {
          const input=await bodyJSON(req);
          if(preferences.get().mode!=='plan' || changingSettings) throw new UserError('현재 모드에서는 앱이 AI 요청을 보내지 않습니다. 환경 설정에서 앱에서 직접 요청 모드를 선택하세요.',409);
          if(typeof input.prompt!=='string' || !input.prompt.trim() || typeof input.model!=='string') throw new UserError('질문과 모델을 선택하세요.');
          if(responding) throw new UserError('이전 응답이 진행 중입니다. 완료되거나 중지된 뒤 다시 보내세요.',409);
          responding=true;
          const chatStore=await chatsReady;
          let entry;
          try {entry=await chatStore.begin(input.chatId,{...input.turn,model:input.model,exported:false});}catch(error){responding=false;throw error;}
          const controller=new AbortController();auth.activeRequests.add(controller);
          const timeout=setTimeout(()=>controller.abort(),180000);
          res.on('close',()=>controller.abort());
          const send=event=>{if(!res.destroyed)res.write(JSON.stringify(event)+'\n');};
          let answer='',entryStatus='interrupted',lastSave=0,usage=null;
          try {
            const upstream=await auth.inference(input.model,input.prompt,controller.signal);
            if(!upstream.ok) {
              let errorCode='';try{errorCode=(await upstream.json()).error?.code;}catch{}
              throw new UserError(upstream.status===401?'로그인이 만료되었거나 권한이 없습니다. 다시 연결하세요.':`${responseError(errorCode)} (HTTP ${upstream.status})`,upstream.status===401?401:502);
            }
            res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8'});res.flushHeaders();send({type:"entry",entry});
            let complete=false,failed=false;
            for await(const event of responseEvents(upstream.body)) {
              if(event.type==='error') {send({type:'error',message:responseError(event.code)});failed=true;break;}
              if(event.type==='complete') {complete=true;entryStatus='complete';usage=event.usage || null;break;}
              if(event.type==='delta') {answer+=event.text;if(Date.now()-lastSave>500){await chatStore.update(input.chatId,entry.id,answer,'pending');lastSave=Date.now();}}
              send(event);
            }
            if(!complete && !failed) send({type:'error',message:'연결이 완료 신호 없이 끝났습니다. 아래 내용은 부분 응답일 수 있습니다.'});
            await chatStore.update(input.chatId,entry.id,answer,entryStatus,usage);
            if(complete)send({type:'complete',usage});
            res.end();
          } catch(error) {
            const message=error instanceof UserError?error.message:controller.signal.aborted?'요청이 중지되었거나 제한 시간을 넘었습니다.':'OpenAI 응답을 받지 못했습니다. 연결을 확인하고 다시 시도하세요.';
            if(!res.headersSent) json(res,{error:message},error.status || 502);else{send({type:'error',message});res.end();}
          } finally {try{await chatStore.update(input.chatId,entry.id,answer,entryStatus,usage);}catch{console.error('Conversation save failed');}clearTimeout(timeout);controller.abort();auth.activeRequests.delete(controller);responding=false;}
          return;
        }
        throw new UserError('지원하지 않는 요청입니다.',404);
      }
      if(url.pathname==='/auth/launch' && req.method==='GET') {
        const result=auth.launch(url.searchParams.get('ticket'));
        res.writeHead(302,{'Set-Cookie':result.cookie,Location:result.url}).end();return;
      }
      if(url.pathname==='/auth/callback' && req.method==='GET') {
        const cookie=(req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith('paper_reader_oauth='))?.slice('paper_reader_oauth='.length);
        res.setHeader('Set-Cookie','paper_reader_oauth=; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=0');
        try {await auth.callback(url.searchParams,cookie);res.writeHead(303,{Location:'/auth/result?ok=1'}).end();}
        catch {res.writeHead(303,{Location:'/auth/result?ok=0'}).end();}
        return;
      }
      if(url.pathname==='/auth/result' && req.method==='GET') {
        const state=auth.info(),ok=url.searchParams.get('ok')==='1' && state.connected;
        page(res,ok?'ChatGPT 연결 완료':'로그인하지 못했습니다',ok?(state.planEnabled?'ChatGPT 구독 사용이 연결되었습니다. 앱에서 보내는 질문은 Codex / ChatGPT Work 공유 사용량 또는 허용한 크레딧을 사용합니다.':'계정은 연결되었지만 구독 사용 권한이 없습니다. ChatGPT 설정에서 권한을 확인하세요.'):(state.error || '로그인 요청이 만료되었거나 확인되지 않았습니다. 앱에서 다시 연결하세요.'));return;
      }
      if(!['GET','HEAD'].includes(req.method)) {res.writeHead(405).end();return;}
      const urlPath=decodeURIComponent(url.pathname);
      const relativePath=urlPath==='/'?'index.html':urlPath.slice(1);
      if(!['index.html','app.css','app.mjs','auto-context.mjs','context.mjs','help.mjs','ui.css','auth-page.css'].includes(relativePath) && !relativePath.startsWith('pdfjs/')) throw new UserError('Not found',404);
      let file=path.resolve(root,relativePath);
      const relative=path.relative(root,file);
      if(relative.startsWith('..') || path.isAbsolute(relative) || (relativePath.startsWith('pdfjs/') && !relative.replaceAll('\\','/').startsWith('pdfjs/'))) throw new UserError('Not found',404);
      // Only the main stylesheet can be overridden; no arbitrary sibling files are served.
      if(relativePath==='app.css' && externalCssPath) {
        try {if((await stat(externalCssPath)).isFile())file=externalCssPath;}
        catch(error) {if(!['ENOENT','ENOTDIR'].includes(error.code))throw error;}
      }
      const info=await stat(file);if(!info.isFile()) throw new UserError('Not found',404);
      res.writeHead(200,{'Content-Type':mime[path.extname(file)] || 'application/octet-stream','Content-Length':info.size});
      if(req.method==='HEAD')res.end();else createReadStream(file).on('error',()=>res.destroy()).pipe(res);
    } catch(error) {
      const message=error instanceof UserError?error.message:'요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.';
      if(url.pathname.startsWith('/api/'))json(res,{error:message},error.status || 500);else page(res,'요청을 완료하지 못했습니다',message,error.status || 404);
    }
  });
  server.drain=async()=>{while(responding)await new Promise(resolve=>setTimeout(resolve,20));await (await chatsReady).flush();};
  return server;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const auth=await createAuth({directory:path.join(root,'.local'),origin:ORIGIN});
  const settings=await createSettings(path.join(root,'.local','settings.json'));
  const chats=await createChats(path.join(root,'.local','conversations'));
  const server=createAppServer(auth,{settings,chats});
  server.on('error',error=>{console.error(error.code || 'server_error');process.exitCode=1;});
  server.listen(8767,'127.0.0.1',()=>console.log(`Paper Reader: ${ORIGIN}`));
}
