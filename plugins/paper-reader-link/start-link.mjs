import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

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
    child.once('error',()=>reject(new Error('Could not launch the bundled official tunnel-client.')));
    child.once('exit',(code,signal)=>code===0?resolve():reject(new Error(signal?'Tunnel stopped.':'tunnel-client exited with code '+code)));
  });
}
try{
  if(Number(process.versions.node.split('.')[0])<20)throw new Error('Node.js 20 or later is required.');
  await Promise.all([access(tunnelExecutable),access(serverScript),access(path.join(root,'widget.html'))]);
  if(process.argv.includes('--check')){console.log('Ready: Node.js, tunnel-client, MCP server and question card are present.');process.exit(0);}
  console.log('Paper Reader Link - Secure MCP Tunnel\nCreate a tunnel at https://platform.openai.com/settings/organization/tunnels\nAssociate your ChatGPT workspace and use a runtime key with Tunnels Read + Use.');
  const tunnelId=process.argv[2] || await question('Tunnel ID (tunnel_...): ');
  if(!/^tunnel_[a-zA-Z0-9_-]+$/.test(tunnelId))throw new Error('Invalid tunnel ID.');
  const profileDirectory=path.join(process.env.LOCALAPPDATA || root,'PaperReaderLink','tunnel');
  // tunnel-client parses a shell-style command; forward slashes preserve Windows paths.
  const mcpCommand='"'+process.execPath.replaceAll('\\','/')+'" "'+serverScript.replaceAll('\\','/')+'"';
  await run(['init','--sample','sample_mcp_stdio_local','--profile','paper-reader-link','--profile-dir',profileDirectory,'--tunnel-id',tunnelId,'--mcp-command',mcpCommand,'--health-listen-addr','127.0.0.1:0','--force']);
  let key=await question('Runtime API key (hidden, this session only): ',true);
  if(!key)throw new Error('A runtime API key is required.');
  console.log('Keep this window and Paper Reader open. Stop with Ctrl+C.\nIn ChatGPT > Plugins > Add custom MCP server, choose Tunnel and this tunnel ID.\nFor this private stdio server choose No authentication; the tunnel controls access.');
  const environment={...process.env,CONTROL_PLANE_API_KEY:key};key='';
  try{await run(['run','--profile-dir',profileDirectory,'--profile','paper-reader-link','--open-web-ui'],environment);}
  finally{delete environment.CONTROL_PLANE_API_KEY;}
}catch(error){console.error(error.code==='ENOENT'?'Missing package files. Extract the complete Paper Reader Link ZIP.':error.message);process.exitCode=1;}
