import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCredentialStore,previousTunnelId} from '../plugins/paper-reader-link/credential-store.mjs';

test('Windows DPAPI persists a runtime key across store instances without plaintext and supports replacement/removal',{skip:process.platform!=='win32'},async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'paper-reader-credential-test-'));
  t.after(async()=>{assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('paper-reader-credential-test-'));await rm(directory,{recursive:true,force:true});});
  const store=createCredentialStore(directory),key='test-only-dummy-key-not-a-real-credential';
  assert.equal(await store.load(),null);
  await store.save('tunnel_test',key);
  const disk=await readFile(path.join(directory,'credentials.json'),'utf8');
  assert.ok(!disk.includes(key));assert.ok(!disk.includes(Buffer.from(key).toString('base64')));
  assert.deepEqual(await createCredentialStore(directory).load(),{tunnelId:'tunnel_test',key});
  await store.save('tunnel_test','replacement-dummy-key');
  assert.equal((await store.load()).key,'replacement-dummy-key');
  await writeFile(path.join(directory,'credentials.json'),'{');
  await assert.rejects(store.load(),/damaged/);
  await store.forget();assert.equal(await store.load(),null);
  await mkdir(path.join(directory,'tunnel'));
  await writeFile(path.join(directory,'tunnel','paper-reader-link.yaml'),'control_plane:\n  tunnel_id: "tunnel_existing"\n  api_key: "env:CONTROL_PLANE_API_KEY"\n');
  assert.equal(await previousTunnelId(directory),'tunnel_existing');
});
