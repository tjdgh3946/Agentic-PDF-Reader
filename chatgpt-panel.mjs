import {WebContentsView,clipboard,ipcMain,session,shell} from 'electron';
import {CHATGPT_HOME,allowedWebNavigation,isChatGPTPage,webPanelBounds} from './web-panel-policy.mjs';

export function createChatGPTPanel(window,getOrigin){
  let view,attached=false,error='',loading=false;
  const popups=new Set();
  const webSession=session.fromPartition('persist:paper-reader-chatgpt');
  webSession.setPermissionRequestHandler((_contents,permission,callback)=>callback(permission==='clipboard-sanitized-write'));
  webSession.setPermissionCheckHandler((_contents,permission)=>permission==='clipboard-sanitized-write');
  const preferences={session:webSession,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true};
  const state=()=>({url:view?.webContents.getURL() || CHATGPT_HOME,loading,error,canGoBack:view?.webContents.navigationHistory.canGoBack() || false});
  const publish=()=>{if(!window.isDestroyed())window.webContents.send('paper:web-state',state());};
  const trusted=event=>event.sender===window.webContents && event.senderFrame===window.webContents.mainFrame && new URL(event.senderFrame.url).origin===getOrigin();
  const guard=contents=>{
    contents.on('will-navigate',(event,url)=>{if(!allowedWebNavigation(url)){event.preventDefault();try{if(new URL(url).protocol==='https:')shell.openExternal(url).catch(()=>{});}catch{}}});
    contents.on('will-redirect',(event,url)=>{if(!allowedWebNavigation(url))event.preventDefault();});
    contents.on('will-attach-webview',event=>event.preventDefault());
    contents.setWindowOpenHandler(({url})=>{
      if(!allowedWebNavigation(url))return {action:'deny'};
      return {action:'allow',overrideBrowserWindowOptions:{parent:window,width:560,height:760,autoHideMenuBar:true,webPreferences:preferences}};
    });
    contents.on('did-create-window',popup=>{popups.add(popup);guard(popup.webContents);popup.on('closed',()=>popups.delete(popup));});
  };
  const ensureView=()=>{
    if(view)return;
    view=new WebContentsView({webPreferences:preferences});guard(view.webContents);
    view.setBackgroundColor('#ffffff');
    view.webContents.on('did-start-loading',()=>{loading=true;error='';publish();});
    view.webContents.on('did-stop-loading',()=>{loading=false;publish();});
    view.webContents.on('did-navigate',publish);view.webContents.on('did-navigate-in-page',publish);
    view.webContents.on('did-fail-load',(_event,code,_description,_url,main)=>{if(main && code!==-3){error='ChatGPT 웹을 열지 못했습니다. 새로고침하거나 기본 브라우저에서 여세요.';publish();}});
    view.webContents.on('render-process-gone',()=>{error='웹 화면이 종료되었습니다. 새로고침하세요.';publish();});
    view.webContents.loadURL(CHATGPT_HOME).catch(()=>{});
  };
  ipcMain.handle('paper:copy-text',(event,text)=>{
    if(!trusted(event) || typeof text!=='string' || text.length>2_000_000)throw new Error('Invalid clipboard request');
    clipboard.writeText(text);
  });
  ipcMain.handle('paper:web-panel',(event,input)=>{
    if(!trusted(event))throw new Error('Invalid desktop sender');
    const bounds=webPanelBounds(input,window.getContentBounds(),window.webContents.getZoomFactor());
    if(input?.visible===true && bounds){ensureView();if(!attached){window.contentView.addChildView(view);attached=true;}view.setBounds(bounds);publish();}
    else if(attached){window.contentView.removeChildView(view);attached=false;}
    return state();
  });
  ipcMain.handle('paper:web-command',async(event,command)=>{
    if(!trusted(event))throw new Error('Invalid desktop sender');
    if(!['back','reload','home','external','focus'].includes(command))throw new Error('Invalid web command');
    ensureView();const contents=view.webContents;
    if(command==='back' && contents.navigationHistory.canGoBack())contents.navigationHistory.goBack();
    if(command==='reload')contents.reload();
    if(command==='home')await contents.loadURL(CHATGPT_HOME);
    if(command==='external'){const url=contents.getURL();await shell.openExternal(isChatGPTPage(url)?url:CHATGPT_HOME);}
    if(command==='focus')contents.focus();
    return state();
  });
  return {dispose(){ipcMain.removeHandler('paper:copy-text');ipcMain.removeHandler('paper:web-panel');ipcMain.removeHandler('paper:web-command');for(const popup of popups)if(!popup.isDestroyed())popup.close();if(view && !view.webContents.isDestroyed())view.webContents.close();}};
}
