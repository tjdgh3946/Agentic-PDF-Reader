const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('pdfProcessing',{
  onRequest:callback=>ipcRenderer.on('paper:pdf-request',(_event,value)=>callback(value)),
  reply:value=>ipcRenderer.send('paper:pdf-result',value),
  ready:()=>ipcRenderer.send('paper:pdf-result',{ready:true})
});
