const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('paperDesktop',{
  setupState:()=>ipcRenderer.invoke('paper:setup-state'),
  setupChoice:choice=>ipcRenderer.invoke('paper:setup-choice',choice),
  openSetup:()=>ipcRenderer.invoke('paper:setup-open'),
  setupLink:input=>ipcRenderer.invoke('paper:setup-link',input),
  setupStartLink:()=>ipcRenderer.invoke('paper:setup-start-link'),
  setupExternal:kind=>ipcRenderer.invoke('paper:setup-external',kind),
  writeClipboard:text=>ipcRenderer.invoke('paper:copy-text',text),
  setWebPanel:input=>ipcRenderer.invoke('paper:web-panel',input),
  webCommand:command=>ipcRenderer.invoke('paper:web-command',command),
  sendWebQuestion:input=>ipcRenderer.invoke('paper:web-send',input),
  onWebState:listener=>{const handler=(_event,state)=>listener(state);ipcRenderer.on('paper:web-state',handler);return()=>ipcRenderer.removeListener('paper:web-state',handler);}
});
