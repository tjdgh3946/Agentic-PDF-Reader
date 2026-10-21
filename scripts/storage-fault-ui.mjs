// Isolated, synthetic data only. Read the emitted info file, then write
// {id:unique,action:'lock-notes'|'lock-chats'|'unlock'|'stop'} to controlPath.
import {app} from 'electron';
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createAnnotations} from '../annotations.mjs';
import {createChats} from '../chats.mjs';
import {createAppServer} from '../server.mjs';
import {createPdfRenderer} from '../pdf-render-service.mjs';
import {pageNote} from '../reading-tools.mjs';
import {createSettings} from '../settings.mjs';
import {createReadingState} from '../reading-state.mjs';
import {lockFile} from './windows-file-lock.mjs';
const output=path.resolve(process.argv[2]),directory=await mkdtemp(path.join(os.tmpdir(),'reader-storage-ui-'));
app.setPath('userData',directory);app.setPath('sessionData',directory);app.on('window-all-closed',()=>{});
async function main(){
  await app.whenReady();await mkdir(output,{recursive:true});let origin;
  const documentId='c32bc6a38538db58933d1fad27303652',notesDirectory=path.join(directory,'notes'),chatsDirectory=path.join(directory,'chats');
  const annotations=await createAnnotations(notesDirectory),chats=await createChats(chatsDirectory);
  const note=await annotations.upsert(documentId,{...pageNote(9),color:'yellow',note:'**원래 저장된 테스트 노트**\n\n$e^{-\\lambda_i t}$'});
  const chat=await chats.create({documentId,fileName:'1806.07572v4.pdf'});await chats.begin(chat.id,{question:'파일 잠금 시험용 질문',selection:'',pageLabel:'p. 9',exported:true});
  const damaged=await chats.create({documentId:'fixture-other',fileName:'damaged-fixture.pdf'});await writeFile(path.join(chatsDirectory,damaged.id+'.json'),'{truncated');
  const settings=await createSettings(path.join(directory,'settings.json'));await settings.set({mode:'manual',pdfSearch:true,linkSaveAnswer:false});const reading=await createReadingState(path.join(directory,'reading.json'));
  const loadedChats=await createChats(chatsDirectory),renderer=createPdfRenderer(()=>origin),server=createAppServer({activeRequests:new Set()},{pdfRenderer:renderer,annotations,chats:loadedChats,settings,reading,getOrigin:()=>origin,linkDiscoveryPath:path.join(directory,'connection.json')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  const info={origin,directory,controlPath:path.join(directory,'control.json'),noteId:note.id,chatId:chat.id,documentId,noteFile:path.join(notesDirectory,createHash('sha256').update(documentId).digest('hex')+'.json'),chatFile:path.join(chatsDirectory,chat.id+'.json'),action:null,locked:false};
  const infoFile=path.join(output,'storage-fault-ui-info.json');await writeFile(infoFile,JSON.stringify(info,null,2));console.log(JSON.stringify({origin,infoFile}));
  let seen=null,working=false,lock;
  const timer=setInterval(async()=>{
    if(working)return;working=true;
    try{
      let command;try{command=JSON.parse(await readFile(info.controlPath,'utf8'));}catch{return;}
      if(command.id===seen)return;seen=command.id;info.action=command.action;
      if(['lock-notes','lock-chats','unlock','stop'].includes(command.action)){await lock?.release();lock=null;}
      if(command.action==='lock-notes')lock=await lockFile(info.noteFile);
      if(command.action==='lock-chats')lock=await lockFile(info.chatFile);
      info.locked=!!lock;info.error=null;await writeFile(infoFile,JSON.stringify(info,null,2));
      if(command.action==='stop'){clearInterval(timer);server.closeAllConnections();await server.link.close();await new Promise(resolve=>server.close(resolve));renderer.close();app.exit(0);}
    }catch(error){info.error=error.message;await writeFile(infoFile,JSON.stringify(info,null,2));}
    finally{working=false;}
  },200);
}
main().catch(error=>{console.error(error);app.exit(1);});
