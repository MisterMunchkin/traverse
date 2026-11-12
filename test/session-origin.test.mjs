import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import './support/isolated-approval-state.mjs';
import {existingSession} from '../src/driving/sessions.mjs';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'traverse-session-origin-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const executable = path.join(root, 'runner');
  // Discovery only: this file is never executed.
  fs.writeFileSync(executable, 'inert selected runner\n', {mode: 0o700});
  const project = path.join(root, 'project');
  const dir = path.join(project, '.wayfinder/local/sessions/fixture');
  fs.mkdirSync(dir, {recursive: true});
  const state = {schema: 'wayfinder-driving-session/1', name: 'fixture',
    runnerSession: 'wf-11111111-1111-1111-1111-111111111111',
    target: {platform: 'web', app: 'http://fixture.invalid'}, executable,
    executableSha256: createHash('sha256').update(fs.readFileSync(executable)).digest('hex'),
    version: '0.0.0', status: 'open', createdAt: '2026-11-11T00:00:00.000Z'};
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify(state));
  return {root, project, dir, state, executable};
}

test('repository-only session metadata cannot authorize a resume through an explicitly selected runner', t => {
  const f = fixture(t);
  assert.throws(() => existingSession(f.project, {name: 'fixture', executable: f.executable}), /locally created session/i);
});

test('copying repository session files does not create session authority in another project', t => {
  const f = fixture(t), recipient = path.join(f.root, 'recipient');
  fs.cpSync(f.project, recipient, {recursive: true});
  assert.throws(() => existingSession(recipient, {name: 'fixture', executable: f.executable}), /locally created session/i);
});

// A protected local record is deliberately seeded; no runner method is invoked.
import {writeSessionState} from '../src/driving/session-state.mjs';
import {newSession} from '../src/driving/sessions.mjs';
function owned(t) {
  const f = fixture(t), before = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = path.join(f.root, 'state');
  t.after(() => { process.env.XDG_STATE_HOME = before; });
  writeSessionState(f.project, f.state);
  f.record = path.join(process.env.XDG_STATE_HOME, 'traverse/driving-sessions', fs.readdirSync(path.join(process.env.XDG_STATE_HOME, 'traverse/driving-sessions'))[0]);
  return f;
}
for (const [field, value] of [
  ['target', {platform: 'ios', app: 'com.other', device: 'OTHER-DEVICE'}],
  ['runnerSession', 'wf-22222222-2222-2222-2222-222222222222'],
  ['status', 'closed'],
]) test(`repository diagnostic ${field} cannot replace private session authority`, t => {
  const f = owned(t), changed = {...f.state, [field]: value};
  fs.writeFileSync(path.join(f.dir, 'session.json'), JSON.stringify(changed));
  const resumed = existingSession(f.project, {name: 'fixture', executable: f.executable});
  assert.deepEqual(resumed.state.target, {platform: 'web', app: 'http://fixture.invalid'});
  assert.equal(resumed.state.runnerSession, 'wf-11111111-1111-1111-1111-111111111111');
  assert.equal(resumed.state.status, 'open');
});
test('a private session cannot be resumed from a copied project', t => {
  const f = owned(t), recipient = path.join(f.root, 'recipient');
  fs.cpSync(f.project, recipient, {recursive: true});
  assert.throws(() => existingSession(recipient, {name: 'fixture', executable: f.executable}), /locally created session/i);
});
test('private session records refuse nonprivate permissions', t => {
  const f = owned(t); fs.chmodSync(f.record, 0o644);
  assert.throws(() => existingSession(f.project, {name: 'fixture', executable: f.executable}), /private state record file/i);
});
test('private session records refuse hard links', t => {
  const f = owned(t); fs.linkSync(f.record, path.join(f.root, 'second-link'));
  assert.throws(() => existingSession(f.project, {name: 'fixture', executable: f.executable}), /private state record file/i);
});
test('private session records reject a different embedded project binding', t => {
  const f = owned(t), record = JSON.parse(fs.readFileSync(f.record));
  record.binding.project = path.join(f.root, 'other');
  fs.writeFileSync(f.record, JSON.stringify(record));
  assert.throws(() => existingSession(f.project, {name: 'fixture', executable: f.executable}), /private session binding/i);
});
test('session state must remain outside the selected project', t => {
  const f = owned(t); process.env.XDG_STATE_HOME = path.join(f.project, 'state');
  assert.throws(() => existingSession(f.project, {name: 'fixture', executable: f.executable}), /outside the repository/i);
});
test('removing repository diagnostics cannot authorize overwriting a private session', async t => {
  const f = owned(t); fs.rmSync(f.dir, {recursive: true});
  await assert.rejects(newSession(f.project, {name: 'fixture', target: f.state.target, executable: f.executable}), /Session name already exists/i);
  assert.equal(JSON.parse(fs.readFileSync(f.record)).state.runnerSession, 'wf-11111111-1111-1111-1111-111111111111');
});
