import {ipcMain,shell} from 'electron';
import path from 'node:path';
import {createOnboarding,readInstallationChoice} from './onboarding.mjs';
import {createManagedLink} from './managed-link.mjs';
import {credentialDirectory} from './plugins/paper-reader-link/credential-store.mjs';

export async function createDesktopSetup({app,window,getOrigin,resourceDirectory}){
  const preferences=await createOnboarding(path.join(app.getPath('userData'),'onboarding.json'));
  const directory=app.commandLine.hasSwitch('user-data-dir')?path.join(app.getPath('userData'),'link'):credentialDirectory();
  const manager=createManagedLink({directory,resourceDirectory,connectionFile:path.join(app.getPath('userData'),'link-connection.json')});
  const installationChoice=await readInstallationChoice(app.isPackaged?path.join(process.resourcesPath,'installation-choice.ini'):null);
  const startup=await preferences.startup({commandChoice:app.commandLine.getSwitchValue('setup'),installationChoice});
  const trusted=event=>event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&new URL(event.senderFrame.url).origin===getOrigin();
  const state=async()=>({preference:preferences.state(),link:await manager.status()});
  const bindings={
    'paper:setup-state':()=>state(),
    'paper:setup-choice':async choice=>{await preferences.decide(choice);if(choice!=='now')setImmediate(()=>window.loadURL(getOrigin()).catch(()=>{}));return state();},
    'paper:setup-open':async()=>{await window.loadURL(getOrigin()+'/setup.html');return true;},
    'paper:setup-link':async input=>{await manager.configure(input);return state();},
    'paper:setup-start-link':async()=>{await manager.start();return state();},
    'paper:setup-external':async kind=>{
      const urls={tunnels:'https://platform.openai.com/settings/organization/tunnels',keys:'https://platform.openai.com/api-keys',plugins:'https://chatgpt.com/plugins',tunnelDocs:'https://developers.openai.com/api/docs/guides/secure-mcp-tunnels',pluginDocs:'https://developers.openai.com/api/docs/guides/custom-mcp-server'};
      if(!Object.hasOwn(urls,kind))throw Error('설정 링크를 확인하세요.');await shell.openExternal(urls[kind]);return true;
    }
  };
  for(const [name,operation] of Object.entries(bindings))ipcMain.handle(name,(event,input)=>{if(!trusted(event))throw Error('Invalid setup sender');return operation(input);});
  return {
    startup,
    async autoStart(){if((await manager.status()).hasSavedKey)await manager.start();},
    async open(choice='now'){await preferences.decide(choice==='later'?'later':'now');await window.loadURL(choice==='later'?getOrigin():getOrigin()+'/setup.html');},
    async dispose(){for(const name of Object.keys(bindings))ipcMain.removeHandler(name);await Promise.allSettled([preferences.flush(),manager.stop()]);}
  };
}
