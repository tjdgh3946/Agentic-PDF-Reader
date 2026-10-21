import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {spawn,execFile} from 'node:child_process';
import {access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createCredentialStore,credentialDirectory,previousTunnelId,validTunnelId} from './credential-store.mjs';
import {acquireLauncher} from './launcher-instance.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const tunnelExecutable=path.join(root,'tools','tunnel-client.exe');
const serverScript=path.join(root,'server.bundle.mjs');
async function question(prompt,hidden=false){
  if(!process.stdin.isTTY)throw new Error('Run Start-Link.cmd in an interactive terminal. Do not pipe an API key into it.');
  const output=new Writable({write(chunk,_encoding,done){if(!hidden)process.stdout.write(chunk);done();}});
  const reader=createInterface({input:process.stdin,output,terminal:true});
  reader.on('SIGINT',()=>{reader.close();process.exit(130);});
  try{if(hidden)process.stdout.write(prompt);return (await reader.question(hidden?'':prompt)).trim();}
  finally{reader.close();if(hidden)process.stdout.write('\n');}
}
async function run(args,env=process.env){
  return await new Promise((resolve,reject)=>{
    const child=spawn(tunnelExecutable,args,{stdio:'inherit',env,windowsHide:true});
    let stopping=false;
    const stop=()=>{stopping=true;process.exitCode=130;if(child.pid){if(process.platform==='win32')execFile('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>{});else child.kill('SIGTERM');}};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    const cleanup=()=>{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);};
    child.once('close',cleanup);
    child.once('error',()=>reject(new Error('Could not launch the bundled official tunnel-client.')));
    child.once('exit',(code,signal)=>code===0||stopping?resolve():reject(new Error(signal?'Tunnel stopped.':'tunnel-client exited with code '+code)));
  });
}
let instance;
async function main(){
  if(Number(process.versions.node.split('.')[0])<20)throw new Error('Node.js 20 or later is required.');
  await Promise.all([access(tunnelExecutable),access(serverScript),access(path.join(root,'widget.html'))]);
  if(process.argv.includes('--check')){console.log('Ready: Node.js, tunnel-client, MCP server and question card are present.');process.exit(0);}
  console.log('Paper Reader Link - Secure MCP Tunnel\nCreate a tunnel at https://platform.openai.com/settings/organization/tunnels\nAssociate your ChatGPT workspace and use a runtime key with Tunnels Read + Use.');
  const directory=credentialDirectory(),store=createCredentialStore(directory);
  instance=await acquireLauncher(directory);
  if(!instance.owner){console.log('Paper Reader Link is already running'+(instance.existing?' (PID '+instance.existing.pid+', version '+instance.existing.version+')':'')+'. No credentials or tunnel settings were changed. Stop the existing Link window before updating or replacing the key.');return;}
  if(process.argv.includes('--forget-key')){await store.forget();console.log('Saved runtime key removed. Tunnel profile retained.');process.exit(0);}
  const reset=process.argv.includes('--reset-key');
  const saved=reset?null:await store.load();
  const tunnelId=process.argv.slice(2).find(value=>!value.startsWith('--')) || saved?.tunnelId || await previousTunnelId(directory) || await question('Tunnel ID (tunnel_...): ');
  if(!validTunnelId(tunnelId))throw new Error('Invalid tunnel ID.');
  const profileDirectory=path.join(directory,'tunnel');
  // tunnel-client parses a shell-style command; forward slashes preserve Windows paths.
  const mcpCommand='"'+process.execPath.replaceAll('\\','/')+'" "'+serverScript.replaceAll('\\','/')+'"';
  await run(['init','--sample','sample_mcp_stdio_local','--profile','paper-reader-link','--profile-dir',profileDirectory,'--tunnel-id',tunnelId,'--mcp-command',mcpCommand,'--health-listen-addr','127.0.0.1:0','--force']);
  let key=saved?.key || (!reset&&process.env.CONTROL_PLANE_API_KEY) || await question('Runtime API key (hidden; saved with Windows encryption): ',true);
  if(!key)throw new Error('A runtime API key is required.');
  if(!saved||saved.key!==key||saved.tunnelId!==tunnelId)await store.save(tunnelId,key);
  console.log('Using saved Windows-encrypted credentials. Next launch needs no key entry.');
  console.log('Keep this window and Paper Reader open. Stop with Ctrl+C.\nIn ChatGPT > Plugins > Add custom MCP server, choose Tunnel and this tunnel ID.\nFor this private stdio server choose No authentication; the tunnel controls access.');
  const environment={...process.env,CONTROL_PLANE_API_KEY:key};key='';
  // Finish each successful initialize before another logical caller can issue
  // a tool request on the same stdio child. Late upstream notifications are
  // suppressed by the official tunnel shim, not sent twice to the MCP server.
  try{await run(['run','--config',path.join(profileDirectory,'paper-reader-link.yaml'),'--mcp.stdio-send-initialized-notification','--open-web-ui'],environment);}
  finally{delete environment.CONTROL_PLANE_API_KEY;}
}
try{await main();}
catch(error){console.error(error.code==='ENOENT'?'Missing package files. Extract the complete Paper Reader Link ZIP.':error.message);process.exitCode=1;}
finally{await instance?.release?.();}
