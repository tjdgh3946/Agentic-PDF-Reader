import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {acquireLauncher} from '../plugins/paper-reader-link/launcher-instance.mjs';

test('concurrent launchers elect one owner, report the existing process and release for restart',async()=>{
  const directory=path.join(os.tmpdir(),'link-instance-'+randomUUID());
  const results=await Promise.all([acquireLauncher(directory),acquireLauncher(directory)]);
  const owner=results.find(r=>r.owner),other=results.find(r=>!r.owner);
  try{assert.ok(owner);assert.ok(other);assert.equal(other.existing.pid,process.pid);assert.equal(other.existing.version,'0.2.1');}
  finally{await owner?.release();}
  const restarted=await acquireLauncher(directory);assert.equal(restarted.owner,true);await restarted.release();
});
