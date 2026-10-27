import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {root, inventory, checks} from '../scripts/check-support.mjs';

test('contributor source identity includes the shipped root license', () => {
  const inputs = inventory();
  assert.ok(Object.hasOwn(inputs, 'LICENSE'), 'shipped LICENSE must participate in source identity');
  assert.equal(inputs.LICENSE.sha256, createHash('sha256').update(fs.readFileSync(path.join(root, 'LICENSE'))).digest('hex'));
});

test('contributor commands make the Expo offline contract explicit in the child environment', async t => {
  const previous = process.env.EXPO_OFFLINE;
  delete process.env.EXPO_OFFLINE;
  t.after(() => { if (previous === undefined) delete process.env.EXPO_OFFLINE; else process.env.EXPO_OFFLINE = previous; });
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'traverse-offline-check-')));
  t.after(() => fs.rmSync(parent, {recursive: true, force: true}));
  const check = checks('offline', path.join(parent, 'reports'));
  let error;
  try {
    const output = await check.run('offline-environment', process.execPath, ['-e', 'console.log(JSON.stringify({offline:process.env.EXPO_OFFLINE??null}))']);
    assert.deepEqual(JSON.parse(output), {offline: '1'});
  } catch (e) { error = e; throw e; }
  finally { check.finish(error); }
});
