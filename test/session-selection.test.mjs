import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import './support/isolated-approval-state.mjs';
import {writeSessionState} from '../src/driving/session-state.mjs';
import {existingSession} from '../src/driving/sessions.mjs';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'traverse-session-selection-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const project = path.join(root, 'project'), selectedDir = path.join(root, 'selected');
  const savedDir = path.join(root, 'saved');
  fs.mkdirSync(selectedDir); fs.mkdirSync(savedDir);
  const selected = path.join(selectedDir, 'agent-device'), saved = path.join(savedDir, 'agent-device');
  // Files are executable only for discovery; no test invokes either file.
  fs.writeFileSync(selected, 'synthetic selected runner\n', {mode: 0o755});
  fs.writeFileSync(saved, 'synthetic saved runner\n', {mode: 0o755});
  const dir = path.join(project, '.wayfinder/local/sessions/fixture');
  fs.mkdirSync(dir, {recursive: true});
  function metadata(executable) {
    const state = {schema: 'wayfinder-driving-session/1', name: 'fixture',
      runnerSession: 'wf-11111111-1111-1111-1111-111111111111',
      target: {platform: 'web', app: 'http://fixture.invalid'},
      executable, executableSha256: createHash('sha256').update(fs.readFileSync(executable)).digest('hex'),
      version: '0.0.0', status: 'open'};
    fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify(state));
    writeSessionState(project, state);
  }
  return {project, selectedDir, selected, saved, metadata};
}
function withPath(value, work) {
  const before = process.env.PATH;
  process.env.PATH = value;
  try { return work(); }
  finally { if (before === undefined) delete process.env.PATH; else process.env.PATH = before; }
}

test('saved session metadata cannot override the currently selected PATH runner', t => {
  const f = fixture(t); f.metadata(f.saved);
  withPath(f.selectedDir, () => {
    assert.throws(() => existingSession(f.project, {name: 'fixture'}), /runner executable changed/i);
  });
});
test('saved session metadata cannot supply a runner when current discovery finds none', t => {
  const f = fixture(t); f.metadata(f.saved);
  withPath('', () => {
    assert.throws(() => existingSession(f.project, {name: 'fixture'}), /executable unavailable/i);
  });
});
test('a matching current PATH selection resumes the recorded runner', t => {
  const f = fixture(t); f.metadata(f.selected);
  withPath(f.selectedDir, () => {
    assert.equal(existingSession(f.project, {name: 'fixture'}).state.executable, f.selected);
  });
});
test('a custom runner outside PATH resumes when explicitly selected again', t => {
  const f = fixture(t); f.metadata(f.saved);
  withPath('', () => {
    assert.equal(existingSession(f.project, {name: 'fixture', executable: f.saved}).state.executable, f.saved);
  });
});
test('current runner selection still rejects changed launcher bytes', t => {
  const f = fixture(t); f.metadata(f.selected);
  fs.writeFileSync(f.selected, 'changed synthetic runner\n');
  withPath(f.selectedDir, () => {
    assert.throws(() => existingSession(f.project, {name: 'fixture'}), /runner executable changed/i);
  });
});
