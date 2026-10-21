import {spawn} from 'node:child_process';
import path from 'node:path';
export function lockFile(file){
  if(process.platform!=='win32')throw Error('This fault fixture requires Windows.');
  const script="$ErrorActionPreference='Stop'; $locked=[IO.File]::Open($env:PAPER_FAULT_FILE,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None); try {[Console]::Out.WriteLine('LOCKED'); [Console]::Out.Flush(); [Console]::In.ReadLine() | Out-Null} finally {$locked.Dispose()}";
  return new Promise((resolve,reject)=>{
    const child=spawn(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,PAPER_FAULT_FILE:file},stdio:['pipe','pipe','ignore'],windowsHide:true});let output='',ready=false;
    const timer=setTimeout(()=>{child.kill();reject(Error('File lock fixture timed out.'));},15000);
    child.stdout.on('data',chunk=>{output+=chunk;if(!ready&&output.includes('LOCKED')){ready=true;clearTimeout(timer);const safety=setTimeout(()=>child.kill(),600000);safety.unref?.();resolve({pid:child.pid,release:()=>new Promise(done=>{clearTimeout(safety);if(child.exitCode!==null){done();return;}child.once('exit',done);child.stdin.end('\n');})});}});
    child.on('error',()=>{clearTimeout(timer);reject(Error('File lock fixture failed to start.'));});
    child.on('exit',()=>{clearTimeout(timer);if(!ready)reject(Error('File lock fixture could not acquire the target.'));});
    child.stdin.on('error',()=>{});
  });
}
