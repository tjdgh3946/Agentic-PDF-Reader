import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
const root=new URL('../',import.meta.url),output=new URL('build/link-payload/',root);
const pin=JSON.parse(await readFile(new URL('build/tunnel-client.json',root),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function download(name,expected){const response=await fetch(pin.baseUrl+name);if(!response.ok)throw Error('Official tunnel-client download failed: '+response.status);const bytes=Buffer.from(await response.arrayBuffer());if(hash(bytes)!==expected)throw Error('Official tunnel-client checksum mismatch');return bytes;}
await mkdir(new URL('tools/',output),{recursive:true});
let client;
for(const file of [new URL('tools/tunnel-client.exe',output),new URL('plugins/paper-reader-link/tools/tunnel-client.exe',root)]){
  try{const bytes=await readFile(file);if(hash(bytes)===pin.executableSha256){client=bytes;break;}}catch(error){if(error.code!=='ENOENT')throw error;}
}
if(!client){
  const directory=await mkdtemp(path.join(os.tmpdir(),'agentic-pdf-runtime-')),archive=path.join(directory,'official.zip'),target=path.join(directory,'tunnel-client.exe');
  await writeFile(archive,await download(pin.archive,pin.archiveSha256));
  // Extract only the named executable to a fixed destination; archive paths are never followed.
  await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip=[IO.Compression.ZipFile]::OpenRead($env:PAPER_RUNTIME_ARCHIVE); try {$entries=@($zip.Entries|Where-Object {$_.Name -eq 'tunnel-client.exe'}); if($entries.Count -ne 1){throw 'Expected one runtime executable'}; [IO.Compression.ZipFileExtensions]::ExtractToFile($entries[0],$env:PAPER_RUNTIME_TARGET,$true)} finally {$zip.Dispose()}"],{windowsHide:true,env:{...process.env,PAPER_RUNTIME_ARCHIVE:archive,PAPER_RUNTIME_TARGET:target}});
  client=await readFile(target);if(hash(client)!==pin.executableSha256)throw Error('Tunnel executable checksum mismatch');
}
// A byte copy avoids Windows CopyFile locks on the currently running standalone client.
await writeFile(new URL('tools/tunnel-client.exe',output),client);
for(const name of ['server.bundle.mjs','widget.html','THIRD_PARTY_LICENSES.txt'])await writeFile(new URL(name,output),await readFile(new URL('plugins/paper-reader-link/'+name,root)));
const licenseFile=new URL('tools/tunnel-client-LICENSES.txt',output);let licenses;
try{licenses=await readFile(licenseFile);}catch(error){if(error.code!=='ENOENT')throw error;}
if(!licenses||hash(licenses)!==pin.licensesSha256)licenses=await download(pin.licenses,pin.licensesSha256);
await writeFile(licenseFile,licenses);
console.log('Verified bundled tunnel-client '+pin.version+'; desktop runtime prepared without credentials.');
