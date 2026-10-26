import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {runProcess} from '../src/runtime/process.mjs';

test('cancellation stops the owned child and retains its process outcome', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wayfinder-cancel-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const ready = path.join(dir, 'ready');
  const controller = new AbortController();
  const result = runProcess(process.execPath, ['-e', `require('fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000)`], {signal: controller.signal, timeoutMs: 8000}).catch(e => e);
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(ready) && Date.now() < deadline) await pause(10);
  assert.ok(fs.existsSync(ready), 'owned child started');
  controller.abort();
  const error = await result;
  assert.match(error.message, /CANCELLED/);
  assert.equal(error.record.code, null);
  assert.ok(['SIGTERM', 'SIGKILL'].includes(error.record.signal));
  const pid = Number(fs.readFileSync(ready, 'utf8'));
  assert.throws(() => process.kill(pid, 0), {code: 'ESRCH'});
});

test('an already cancelled request never starts a process', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wayfinder-cancel-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const marker = path.join(dir, 'started');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runProcess(process.execPath, ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)},'bad')`], {signal: controller.signal}), /CANCELLED/);
  assert.equal(fs.existsSync(marker), false);
});
