// Native lifecycle regression: run the real desktop entry with an empty
// temporary profile and close during initial navigation. No real login is used.
// Usage: electron scripts/desktop-close-check.mjs [delayMilliseconds]
import {app,BrowserWindow,dialog} from 'electron';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const delay=Number(process.argv[2]||0);
if(!Number.isInteger(delay)||delay<0||delay>10000)throw Error('Invalid close delay');
const profile=mkdtempSync(path.join(tmpdir(),'paper-reader-close-'));
app.commandLine.appendSwitch('user-data-dir',profile);
app.commandLine.appendSwitch('setup','later');
app.getAppPath=()=>root;
dialog.showErrorBox=(title,message)=>{console.error(JSON.stringify({result:'fail',title,message}));app.exit(1);};
process.on('uncaughtException',error=>{console.error(error.stack);app.exit(1);});
let requested=false;
app.on('will-quit',()=>{if(!requested){console.error('Desktop quit before reader loaded');process.exitCode=1;}else console.log(JSON.stringify({result:'pass',delay,closedDuringNavigation:true}));});
await import('../desktop.mjs');
const timer=setInterval(()=>{
  const win=BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('논문 읽기'));
  if(!win)return;
  clearInterval(timer);setTimeout(()=>{requested=true;win.close();},delay);
},10);
setTimeout(()=>{console.error('Desktop close timed out');app.exit(2);},20000).unref();
