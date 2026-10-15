// Exercise the same SQLite/FTS5 runtime shipped in the desktop app, even when
// the developer's system Node is older than the SQLite authorizer API.
import {spawn} from 'node:child_process';
import {readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import electron from 'electron';
const root=fileURLToPath(new URL('../',import.meta.url));
const files=(await readdir(new URL('../tests/',import.meta.url))).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>'tests/'+name);
const child=spawn(electron,['--test',...files],{cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'inherit',windowsHide:true});
child.once('error',error=>{console.error('Test runtime could not start: '+error.message);process.exitCode=1;});
child.once('exit',(code)=>{process.exitCode=code??1;});
