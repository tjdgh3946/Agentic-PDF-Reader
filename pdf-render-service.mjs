import {BrowserWindow,ipcMain,session} from 'electron';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {UserError} from './auth.mjs';
import {withRendererRecovery} from './pdf-render-recovery.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
export function createPdfRenderer(getOrigin,options={}){
  const windows=new Map();let requestId=0,closed=false,isolated;
  // A single in-memory partition stays separate from login profiles. Reusing it
  // avoids accumulating partition caches on every idle recovery.
  const allowed=url=>{try{const parsed=new URL(url);return parsed.origin===getOrigin() && (parsed.pathname.startsWith('/pdfjs/')||['/pdf-renderer.html','/pdf-renderer.mjs'].includes(parsed.pathname));}catch{return false;}};
  function release(id){const record=windows.get(id);if(!record)return;windows.delete(id);record.abort();if(!record.window.isDestroyed())record.window.destroy();}
  return withRendererRecovery({
    has:id=>windows.has(id),
    async load(snapshotId,bytes,limits,{extractText=true}={}){
      if(closed)throw new UserError('PDF 처리기가 종료되었습니다.',410);
      const origin=getOrigin();
      if(!isolated){isolated=session.fromPartition('paper-pdf-'+randomUUID());isolated.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!allowed(details.url)}));isolated.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));}
      const window=new BrowserWindow({show:false,webPreferences:{session:isolated,preload:path.join(root,'pdf-renderer-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
      window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      window.webContents.on('will-navigate',(event,url)=>{if(!allowed(url))event.preventDefault();});
      window.webContents.on('will-attach-webview',event=>event.preventDefault());
      let chain=Promise.resolve(),bootResolve,bootReject;
      const pending=new Map(),boot=new Promise((resolve,reject)=>{bootResolve=resolve;bootReject=reject;});
      const trusted=event=>event.sender===window.webContents && event.senderFrame===window.webContents.mainFrame && event.senderFrame.url===origin+'/pdf-renderer.html';
      const receive=(event,message)=>{
        if(!trusted(event))return;
        if(message.ready){bootResolve();return;}
        const task=pending.get(message.id);if(!task)return;pending.delete(message.id);clearTimeout(task.timer);
        message.error?task.reject(new UserError(message.error)):task.resolve(message.value);
      };
      ipcMain.on('paper:pdf-result',receive);
      const abort=()=>{ipcMain.removeListener('paper:pdf-result',receive);bootReject(new UserError('PDF 처리가 중단되었습니다.',410));for(const task of pending.values()){clearTimeout(task.timer);task.reject(new UserError('PDF 처리가 중단되었습니다.',410));}pending.clear();};
      // Attach a rejection handler even if navigation fails before awaiting boot.
      boot.catch(()=>{});
      const record={window,abort,call(input){const operation=chain.then(()=>new Promise((resolve,reject)=>{
        if(window.isDestroyed()){reject(new UserError('PDF 공유가 종료되었습니다.',410));return;}
        const id=++requestId,timer=setTimeout(()=>{reject(new UserError('PDF 처리 제한 시간을 넘었습니다.',408));release(snapshotId);},input.method==='load'?60000:12000);
        pending.set(id,{resolve,reject,timer});window.webContents.send('paper:pdf-request',{id,...input});
      }));chain=operation.catch(()=>{});return operation;}};
      windows.set(snapshotId,record);window.webContents.on('render-process-gone',()=>release(snapshotId));
      const bootTimeout=setTimeout(()=>{bootReject(new UserError('PDF 처리 화면을 열지 못했습니다.',408));release(snapshotId);},15000);
      try{await window.loadURL(origin+'/pdf-renderer.html');await boot;clearTimeout(bootTimeout);return await record.call({method:'load',bytes,limits,extractText});}
      catch(error){clearTimeout(bootTimeout);release(snapshotId);throw error;}
    },
    render(id,page,region){const record=windows.get(id);if(!record)throw new UserError('PDF 렌더 고정본이 없습니다.',410);return record.call({method:'render',page,region});},
    release,
    close(){closed=true;for(const id of [...windows.keys()])release(id);}
  },{releaseAfterLoad:true,...options});
}
