import {build} from 'esbuild';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=new URL('../',import.meta.url),output=new URL('plugins/paper-reader-link/',root);
await mkdir(output,{recursive:true});
const widget=await build({entryPoints:[fileURLToPath(new URL('link/widget.mjs',root))],bundle:true,format:'esm',platform:'browser',target:'es2022',write:false,minify:true,metafile:true});
const html=(await readFile(new URL('link/widget-template.html',root),'utf8')).replace('/*__WIDGET__*/',()=>widget.outputFiles[0].text.replace(/<\/script/gi,'<\\/script'));
await writeFile(new URL('widget.html',output),html);
const server=await build({entryPoints:[fileURLToPath(new URL('link/stdio.mjs',root))],outfile:fileURLToPath(new URL('server.bundle.mjs',output)),bundle:true,format:'esm',platform:'node',target:'node20',metafile:true,banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"}});
const packages=new Set(Object.keys({...widget.metafile.inputs,...server.metafile.inputs}).map(file=>file.replaceAll('\\','/').match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)/)?.[1]).filter(Boolean));
const licenses=[];
for(const directory of [...packages].sort()){
  const info=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'));
  licenses.push(`${info.name} ${info.version} (${info.license || 'see license below'})`);
  for(const file of await readdir(directory))if(/^(license|licence|copying|notice)(\.|$)/i.test(file)){
    try{licenses.push(await readFile(path.join(directory,file),'utf8'));}catch(error){if(error.code!=='EISDIR')throw error;}
  }
}
await writeFile(new URL('THIRD_PARTY_LICENSES.txt',output),licenses.join('\n\n---\n\n'));
