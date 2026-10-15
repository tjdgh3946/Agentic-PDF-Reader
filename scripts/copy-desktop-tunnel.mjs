import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

// Windows CopyFile can reject an executable held by Defender or a running
// tunnel. Copy verified bytes into the new package; never stop a live tunnel.
export default async function copyDesktopTunnel(context){
  const root=context.packager.projectDir;
  const pin=JSON.parse(await readFile(path.join(root,'build','tunnel-client.json'),'utf8'));
  const bytes=await readFile(path.join(root,'build','link-payload','tools','tunnel-client.exe'));
  if(createHash('sha256').update(bytes).digest('hex')!==pin.executableSha256)throw Error('Bundled tunnel-client checksum mismatch');
  const target=path.join(context.appOutDir,'resources','paper-reader-link','tools');
  await mkdir(target,{recursive:true});await writeFile(path.join(target,'tunnel-client.exe'),bytes);
}
