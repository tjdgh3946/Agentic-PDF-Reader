// Isolated UI fixture. The right pane is a clearly labelled ChatGPT-layout
// stand-in with the same desktop bridge contract; no ChatGPT requests are sent.
import {app} from 'electron';import {mkdtemp,readFile,writeFile,mkdir,access} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';
import {createAppServer} from '../server.mjs';import {createPdfRenderer} from '../pdf-render-service.mjs';
import {createAnnotations} from '../annotations.mjs';import {createChats} from '../chats.mjs';import {createSettings} from '../settings.mjs';import {createReadingState} from '../reading-state.mjs';
const [pdfPath,out]=process.argv.slice(2),directory=await mkdtemp(path.join(os.tmpdir(),'reader-note-pane-'));
app.setPath('userData',directory);app.setPath('sessionData',directory);app.on('window-all-closed',()=>{});
const bridgeScript='('+function(){
  let surface;window.paperDesktop={
    async setWebPanel(input){
      if(!surface){surface=document.createElement('section');surface.id='fixture-chatgpt';surface.setAttribute('aria-label','ChatGPT 레이아웃 시험 화면');surface.style.cssText='position:fixed;z-index:20;background:#f8faf7;padding:22px;border:1px solid #dbe1d7;box-sizing:border-box;overflow:auto';
        surface.innerHTML='<h2>ChatGPT 대화 · 레이아웃 시험</h2><p>실제 ChatGPT가 아닌 패널 유지 시험용 화면입니다.</p><p>노트를 작성하는 동안 이 화면과 대화 초안이 유지되어야 합니다.</p><label>대화 초안<input id="fixture-chat-draft" value="유지되어야 하는 대화 초안" style="display:block;width:100%;margin-top:14px;padding:12px"></label>';document.body.append(surface);}
      surface.dataset.visible=String(input.visible);surface.style.display=input.visible?'block':'none';for(const k of ['x','y','width','height'])surface.style[k==='x'?'left':k==='y'?'top':k]=input[k]+'px';document.documentElement.dataset.fixtureChatVisible=String(input.visible);
    },onWebState(callback){callback({url:'https://chatgpt.com/c/layout-fixture',loading:false,canGoBack:false});},async webCommand(){},async writeClipboard(text){await navigator.clipboard.writeText(text);}
  };
  // Read-only fixture diagnostics: no production state or credentials.
  setInterval(()=>{const doc=document.querySelector('#viewer')?.contentDocument;if(!doc)return;
    document.documentElement.dataset.fixtureNoteState=JSON.stringify({
      previewIds:[...doc.querySelectorAll('.reader-highlight.is-preview')].map(mark=>mark.dataset.annotationId),
      groups:[...doc.querySelectorAll('.reader-note-marker')].map(marker=>({count:marker.dataset.annotationIds.split(',').length,hidden:marker.hidden})),
      popup:doc.querySelector('.reader-note-group')?.getBoundingClientRect().toJSON(),
      viewport:doc.getElementById('viewerContainer')?.getBoundingClientRect().toJSON(),
      rail:doc.getElementById('reader-note-rail')?.getBoundingClientRect().toJSON()
    });
  },100);
}.toString()+')();';
app.whenReady().then(async()=>{
  await mkdir(out,{recursive:true});let origin;const annotations=await createAnnotations(path.join(directory,'notes')),renderer=createPdfRenderer(()=>origin),settings=await createSettings(path.join(directory,'settings.json'));await settings.set({mode:'manual',pdfSearch:true,linkSaveAnswer:false});
  const server=createAppServer({activeRequests:new Set()},{pdfRenderer:renderer,annotations,chats:await createChats(path.join(directory,'chats')),settings,reading:await createReadingState(path.join(directory,'reading.json')),getOrigin:()=>origin,linkDiscoveryPath:path.join(directory,'connection.json')});
  const handler=server.listeners('request')[0];server.removeAllListeners('request');server.on('request',async(req,res)=>{if(req.url==='/note-workspace-fixture'){const html=await readFile(new URL('../index.html',import.meta.url),'utf8');res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html.replace('<head>','<head><script>'+bridgeScript+'</script>'));}else handler(req,res);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  const bytes=await readFile(pdfPath),loaded=await renderer.load(createHash('sha256').update(bytes).digest('hex'),bytes,{pages:1000,text:12000000});
  const base={rotation:0,color:'yellow'},seed=(quote,x,y,note)=>annotations.upsert(loaded.documentId,{...base,quote,anchors:[{page:1,rects:[[x,y,.18,.016]]}],note});
  const note=await seed('시험용 첫 번째 원문',.16,.18,'같은 줄의 첫 번째 노트입니다.');
  const second=await seed('시험용 두 번째 원문',.42,.18,'같은 줄의 두 번째 노트입니다.');
  await seed('시험용 세 번째 원문',.68,.18,'같은 줄의 세 번째 노트입니다.');
  await seed('시험용 다음 줄 원문',.16,.22,'다음 줄의 독립된 노트입니다.');
  await seed('시험용 하이라이트',.16,.26,'');
  const version=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version;
  const stopFile=path.join(directory,'stop');await writeFile(path.join(out,'note-pane-info-'+version+'.json'),JSON.stringify({origin,url:origin+'/note-workspace-fixture',documentId:loaded.documentId,noteId:note.id,secondNoteId:second.id,stopFile}));console.log(origin);
  while(true){try{await access(stopFile);break;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}
  await server.link.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));renderer.close();app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
