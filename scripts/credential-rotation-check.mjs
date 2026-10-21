// Requires the user's existing tunnel to be stopped first. Never changes the
// user's credential file or creates a remote key/tunnel. Bad credentials and
// Windows file locks are injected only into an isolated local credential store.
import {app} from 'electron';
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {setTimeout as wait} from 'node:timers/promises';
import {createManagedLink} from '../managed-link.mjs';
import {createCredentialStore,credentialDirectory} from '../plugins/paper-reader-link/credential-store.mjs';
import {createAppServer} from '../server.mjs';
import {createAnnotations} from '../annotations.mjs';
import {createChats} from '../chats.mjs';
import {createSettings} from '../settings.mjs';
import {createReadingState} from '../reading-state.mjs';
import {createPdfRenderer} from '../pdf-render-service.mjs';
import {pageNote} from '../reading-tools.mjs';
import {lockFile} from './windows-file-lock.mjs';
const [pdfPath,outputDirectory]=process.argv.slice(2),directory=await mkdtemp(path.join(os.tmpdir(),'reader-key-rotation-'));
app.setPath('userData',directory);app.setPath('sessionData',directory);app.on('window-all-closed',()=>{});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function main(){
  await app.whenReady();await mkdir(outputDirectory,{recursive:true});
  const sourceFile=path.join(credentialDirectory(),'credentials.json'),originalDigest=digest(await readFile(sourceFile)),saved=await createCredentialStore().load();
  if(!saved)throw Error('Existing saved tunnel credentials required.');
  const report={version:'0.14.0',date:new Date().toISOString(),scope:'Real pinned hosted tunnel and Windows DPAPI in an isolated credential store. No user credential writes. Local Reader/MCP data continuity checks are separate from hosted ChatGPT calls.',checks:[]};
  let origin,manager,server,isolatedStore;
  try{
    const credentialPath=path.join(directory,'link'),disk=createCredentialStore(credentialPath);isolatedStore=disk;await disk.save(saved.tunnelId,saved.key);
    let lockOnSave=false;
    const store={...disk,save:async(id,key)=>{let lock;try{if(lockOnSave)lock=await lockFile(path.join(credentialPath,'credentials.json'));await disk.save(id,key);}finally{await lock?.release();}}};
    const renderer=createPdfRenderer(()=>origin);server=createAppServer({activeRequests:new Set()},{pdfRenderer:renderer,annotations:await createAnnotations(path.join(directory,'notes')),chats:await createChats(path.join(directory,'chats')),settings:await createSettings(path.join(directory,'settings.json')),reading:await createReadingState(path.join(directory,'reading.json')),getOrigin:()=>origin,linkDiscoveryPath:path.join(directory,'connection.json')});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
    const registered=await server.pdfs.register(await readFile(pdfPath),'c32bc6a38538db58933d1fad27303652','1806.07572v4.pdf');
    const shared=await server.link.share({...registered,documentId:'c32bc6a38538db58933d1fad27303652',fileName:'1806.07572v4.pdf',...pageNote(9),question:'Credential rotation continuity.',context:'',allowSave:false});
    manager=createManagedLink({directory:credentialPath,resourceDirectory:path.join(process.env.LOCALAPPDATA,'Programs','Agentic PDF Reader','resources','paper-reader-link'),connectionFile:path.join(directory,'connection.json'),store});
    const record=(name,status)=>{report.checks.push({name,pass:true,phase:status.phase,health:status.health});console.log(JSON.stringify({step:name,result:'pass',phase:status.phase,health:status.health}));};
    await manager.start();await manager.configure({tunnelId:saved.tunnelId,key:''});record('same-key replacement while running verifies hosted authorization before saving',await manager.status());
    const stableDigest=digest(await readFile(path.join(credentialPath,'credentials.json')));
    await assert.rejects(manager.configure({tunnelId:saved.tunnelId,key:'sk-reader-invalid-test-only-not-a-real-key'}));
    assert.ok(digest(await readFile(path.join(credentialPath,'credentials.json')))===stableDigest,'Rejected credentials must not change disk state.');
    assert.equal((await manager.status()).phase,'running');record('invalid real API key rejected; original connection restored',await manager.status());
    lockOnSave=true;await assert.rejects(manager.configure({tunnelId:saved.tunnelId,key:''}));lockOnSave=false;
    assert.ok(digest(await readFile(path.join(credentialPath,'credentials.json')))===stableDigest,'A locked credential file must retain its old ciphertext.');
    assert.equal((await manager.status()).phase,'running');record('actual Windows credential-file lock rolls back a verified candidate',await manager.status());
    await assert.rejects(manager.configure({tunnelId:'tunnel_reader_nonexistent_fault_fixture',key:saved.key}));
    assert.equal((await manager.status()).phase,'running');assert.ok(digest(await readFile(path.join(credentialPath,'credentials.json')))===stableDigest);record('invalid real tunnel change rejected; original tunnel restored',await manager.status());
    await manager.pause();assert.equal((await manager.status()).phase,'paused');await manager.recover();assert.equal((await manager.status()).running,false);await manager.start();const deadline=Date.now()+45000;while((await manager.status()).health!=='ready'&&Date.now()<deadline)await wait(250);assert.equal((await manager.status()).health,'ready');record('explicit pause suppresses resume and permits reconnect in the same app process',await manager.status());
    assert.equal(server.link.status().latest.selectionId,shared.selectionId);
    const search=await server.link.call('search_pdf',{selectionId:shared.selectionId,query:'inflation'}),image=await server.link.call('render_pdf_page',{selectionId:shared.selectionId,page:9,region:[.58,.08,.27,.22]});assert.ok(search.matches.length);assert.ok(image.image);
    report.continuity={sameSelectionId:true,searchPages:search.matches.map(match=>match.page),image:image.metadata,sharedCount:server.link.status().sharedCount};
    report.userCredentialsUnchanged=digest(await readFile(sourceFile))===originalDigest;assert.equal(report.userCredentialsUnchanged,true);
  }catch(error){report.error=error.message;console.error('Credential rotation check failed: '+error.message);process.exitCode=1;}
  finally{
    saved.key='';await manager?.stop().catch(()=>{});await isolatedStore?.forget().catch(()=>{});if(server){await server.link.close();await new Promise(resolve=>server.close(resolve));server.pdfs.close();}
    await writeFile(path.join(outputDirectory,'credential-rotation-0.14.0.json'),JSON.stringify(report,null,2)+'\n');app.exit(process.exitCode||0);
  }
}
main().catch(error=>{console.error('Credential test setup failed: '+error.message);app.exit(1);});
