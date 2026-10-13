import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';

// OS-owned endpoint: released on exit/crash; no stale PID file or secret on disk.
export async function acquireLauncher(directory,{version='0.2.1'}={}){
  const hash=createHash('sha256').update(path.resolve(directory).toLowerCase()).digest('hex').slice(0,32);
  const endpoint=process.platform==='win32'?'\\\\.\\pipe\\paper-reader-link-'+hash:path.join(os.tmpdir(),'paper-reader-link-'+hash+'.sock');
  const information={pid:process.pid,version};
  const server=net.createServer(socket=>{socket.on('error',()=>{});socket.end(JSON.stringify(information));});
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(endpoint,resolve);});}
  catch(error){
    if(error.code!=='EADDRINUSE')throw error;
    const existing=await new Promise(resolve=>{
      const client=net.connect(endpoint);let text='';
      const finish=value=>{client.destroy();resolve(value);};
      client.setTimeout(1500,()=>finish(null));client.on('error',()=>finish(null));
      client.on('data',chunk=>{text+=chunk;if(text.length>1024)finish(null);});
      client.on('end',()=>{try{const value=JSON.parse(text);finish(Number.isInteger(value.pid)&&typeof value.version==='string'?value:null);}catch{finish(null);}});
    });
    return {owner:false,existing};
  }
  server.on('error',()=>{});
  return {owner:true,release:()=>new Promise(resolve=>server.close(resolve))};
}
