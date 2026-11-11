import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {runProcess} from '../src/runtime/process.mjs';

for (const reason of ['cancel', 'deadline']) test(`${reason} reaps an owned same-group helper after its parent closes`, async t => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'traverse-owned-helper-')));
  const ready = path.join(dir, 'helper-ready'), group = path.join(dir, 'owned-group');
  t.after(() => {
    if (fs.existsSync(group)) {
      const pid = Number(fs.readFileSync(group));
      if (Number.isSafeInteger(pid) && pid > 1) { try { process.kill(-pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; } }
    }
    fs.rmSync(dir, {recursive: true, force: true});
  });
  // Harmless fake provider: same group, no inherited pipes, no work beyond
  // waiting. A self-expiry bounds the fixture even if supervisor cleanup fails.
  const helper = `process.on('SIGTERM',()=>{});require('fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setTimeout(()=>process.exit(0),8000);`;
  const parent = `require('fs').writeFileSync(${JSON.stringify(group)},String(process.pid));process.on('SIGTERM',()=>process.exit(0));require('child_process').spawn(process.execPath,['-e',${JSON.stringify(helper)}],{stdio:'ignore'});setInterval(()=>{},1000);`;
  const controller = new AbortController();
  const pending = runProcess(process.execPath, ['-e', parent], {signal: controller.signal, timeoutMs: reason === 'deadline' ? 2500 : 6000}).catch(error => error);
  const started = Date.now();
  while (!fs.existsSync(ready) && Date.now() - started < 2000) await pause(10);
  assert.equal(fs.existsSync(ready), true, 'owned helper reported readiness');
  const helperPid = Number(fs.readFileSync(ready));
  if (reason === 'cancel') controller.abort();
  const error = await pending;
  assert.match(error.message, reason === 'cancel' ? /CANCELLED/ : /DEADLINE/);
  let alive = true;
  for (const end = Date.now() + 300; alive && Date.now() < end;) {
    try { process.kill(helperPid, 0); await pause(10); }
    catch (e) { if (e.code !== 'ESRCH') throw e; alive = false; }
  }
  assert.equal(alive, false, 'owned helper must not survive completed cancellation/deadline cleanup');
});
