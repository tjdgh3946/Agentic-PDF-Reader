const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('paperDesktop',{
  writeClipboard:text=>ipcRenderer.invoke('paper:copy-text',text),
  setWebPanel:input=>ipcRenderer.invoke('paper:web-panel',input),
  webCommand:command=>ipcRenderer.invoke('paper:web-command',command),
  sendWebQuestion:input=>ipcRenderer.invoke('paper:web-send',input),
  onWebState:listener=>{const handler=(_event,state)=>listener(state);ipcRenderer.on('paper:web-state',handler);return()=>ipcRenderer.removeListener('paper:web-state',handler);}
});
