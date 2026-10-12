import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export const validTunnelId=id=>typeof id==='string'&&/^tunnel_[a-zA-Z0-9_-]+$/.test(id);
export const credentialDirectory=()=>path.join(process.env.LOCALAPPDATA,'PaperReaderLink');
// Secrets travel only through private child-process pipes, never command arguments
// or logs. DPAPI CurrentUser ties decryption to the signed-in Windows account.
export function protectKey(value,decrypt=false){
  if(process.platform!=='win32')throw Error('Saved tunnel credentials require Windows DPAPI.');
  const script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $data=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $entropy=[Text.Encoding]::UTF8.GetBytes('PaperReaderLink/v1'); $result=[Security.Cryptography.ProtectedData]::${decrypt?'Unprotect':'Protect'}($data,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
  return new Promise((resolve,reject)=>{
    const child=spawn(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    let output='',settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result);};
    const timer=setTimeout(()=>{child.kill();finish(Error('Windows credential protection timed out.'));},15000);
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>65536){child.kill();finish(Error('Invalid credential protection output.'));}});
    child.stderr.resume(); // PowerShell errors can contain input; never surface them.
    child.on('error',()=>finish(Error('Windows credential protection could not start.')));
    child.stdin.on('error',()=>finish(Error('Windows credential protection input failed.')));
    child.on('close',code=>{
      if(code!==0||!output||!/^[A-Za-z0-9+/=]+$/.test(output))return finish(Error('Cannot unlock the saved key with this Windows account. Use Start-Link.cmd --reset-key.'));
      finish(null,decrypt?Buffer.from(output,'base64').toString('utf8'):output);
    });
    child.stdin.end(decrypt?value:Buffer.from(value,'utf8').toString('base64'));
  });
}
export function createCredentialStore(directory=credentialDirectory()){
  const file=path.join(directory,'credentials.json');
  async function read(){
    let value;try{value=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw Error('Saved Link credentials are damaged. Use Start-Link.cmd --reset-key.');}
    if(value.version!==1||!validTunnelId(value.tunnelId)||typeof value.encryptedKey!=='string')throw Error('Unsupported Link credentials. Use Start-Link.cmd --reset-key.');
    return value;
  }
  return {
    async load(){const value=await read();return value?{tunnelId:value.tunnelId,key:await protectKey(value.encryptedKey,true)}:null;},
    async save(tunnelId,key){
      if(!validTunnelId(tunnelId)||typeof key!=='string'||!key.trim()||key.length>16384)throw Error('Invalid tunnel credentials.');
      const encryptedKey=await protectKey(key);
      await mkdir(directory,{recursive:true});
      const temporary=file+'.'+randomUUID()+'.tmp';
      try{await writeFile(temporary,JSON.stringify({version:1,tunnelId,encryptedKey})+'\n',{mode:0o600});await rename(temporary,file);}
      finally{await rm(temporary,{force:true});}
    },
    async forget(){await rm(file,{force:true});},
    async tunnelId(){return (await read())?.tunnelId||null;}
  };
}
export async function previousTunnelId(directory){
  try{return (await readFile(path.join(directory,'tunnel','paper-reader-link.yaml'),'utf8')).match(/^\s*tunnel_id:\s*["']?(tunnel_[a-zA-Z0-9_-]+)/m)?.[1]||null;}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
