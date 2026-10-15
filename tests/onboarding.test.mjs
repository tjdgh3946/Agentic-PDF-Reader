import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createOnboarding,readInstallationChoice} from '../onboarding.mjs';

test('deferring authentication persists across launches and can be reopened later',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'paper-reader-onboarding-')),file=path.join(directory,'onboarding.json');
  const first=await createOnboarding(file);assert.equal((await first.startup()).showSetup,true);
  await first.decide('later');assert.equal((await createOnboarding(file)).state().decision,'deferred');
  const reopened=await createOnboarding(file);await reopened.decide('now');assert.equal((await reopened.startup()).showSetup,true);
  await reopened.decide('done');assert.equal((await (await createOnboarding(file)).startup()).showSetup,false);
});
test('installer now/later choice is consumed once and explicit launch choice takes priority',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'paper-reader-install-choice-')),file=path.join(directory,'state.json'),ini=path.join(directory,'choice.ini');
  await writeFile(ini,'[authentication]\r\nmode=now\r\nversion=0.11.0\r\n');
  const installationChoice=await readInstallationChoice(ini);assert.deepEqual(installationChoice,{mode:'now',version:'0.11.0'});
  const state=await createOnboarding(file);assert.equal((await state.startup({installationChoice})).showSetup,true);
  await state.decide('later');assert.equal((await state.startup({installationChoice})).showSetup,false);
  assert.equal((await state.startup({commandChoice:'now',installationChoice})).showSetup,true);
  assert.equal((await state.startup({commandChoice:'later',installationChoice})).showSetup,false);
  await assert.rejects(state.decide('wipe-credentials'));
});
