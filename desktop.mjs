import {app,BrowserWindow,Menu,shell,dialog,session} from 'electron';
import path from 'node:path';
import {createAuth} from './auth.mjs';
import {createAppServer} from './server.mjs';
import {createChats} from './chats.mjs';
import {createAnnotations} from './annotations.mjs';
import {createSettings} from './settings.mjs';
import {createChatGPTPanel} from './chatgpt-panel.mjs';

app.setName('Paper Reader');
app.setAppUserModelId('local.paperreader.desktop');
let window,server,auth,origin,quitting=false,chatgptPanel;
if(!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
  app.whenReady().then(async()=>{
    // Runtime identity is private to this Windows user; never bundled in the EXE.
    auth=await createAuth({directory:path.join(app.getPath('userData'),'identity'),origin:()=>origin});
    const stylesDirectory=app.isPackaged ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'))) : app.getAppPath();
    const settings=await createSettings(path.join(app.getPath('userData'),'settings.json'));
    const chats=await createChats(path.join(app.getPath('userData'),'conversations'));
    const annotations=await createAnnotations(path.join(app.getPath('userData'),'annotations'));
    server=createAppServer(auth,{settings,chats,annotations,linkDiscoveryPath:path.join(app.getPath('userData'),'link-connection.json'),getOrigin:()=>origin,externalCssPath:path.join(stylesDirectory,'Paper-Reader.css'),openBrowser:url=>{
      if(url!=='https://chatgpt.com/' && (new URL(url).origin!==origin || new URL(url).pathname!=='/auth/launch')) throw new Error('Invalid external URL');
      return shell.openExternal(url);
    }});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    origin=`http://127.0.0.1:${server.address().port}`;
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    window=new BrowserWindow({title:'Paper Reader',width:1400,height:950,minWidth:900,minHeight:650,backgroundColor:'#f4f6f4',show:false,webPreferences:{preload:path.join(app.getAppPath(),'desktop-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
    chatgptPanel=createChatGPTPanel(window,()=>origin);
    window.on('closed',()=>chatgptPanel.dispose());
    const external=url=>{
      try {
        const parsed=new URL(url);
        if((parsed.origin===origin && parsed.pathname==='/auth/launch') || (parsed.protocol==='https:' && ['chatgpt.com','auth.openai.com'].includes(parsed.hostname))) shell.openExternal(url).catch(()=>{});
      } catch {}
    };
    window.webContents.setWindowOpenHandler(({url})=>{external(url);return {action:'deny'};});
    window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin){event.preventDefault();external(url);}});
    window.webContents.on('will-attach-webview',event=>event.preventDefault());
    window.once('ready-to-show',()=>window.show());
    await window.loadURL(origin);
  }).catch(error=>{
    dialog.showErrorBox('Paper Reader 실행 오류',`앱을 시작하지 못했습니다.\n${error.code || error.message}`);
    app.quit();
  });
  app.on('window-all-closed',()=>app.quit());
  app.on('before-quit',event=>{
    if(quitting || !server)return;
    event.preventDefault();quitting=true;
    if(auth) for(const controller of auth.activeRequests)controller.abort();
    server.closeAllConnections();server.close();
    server.drain().finally(()=>app.quit());
  });
}
