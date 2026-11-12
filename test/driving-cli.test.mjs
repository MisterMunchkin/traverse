import './support/isolated-approval-state.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync, spawn} from 'node:child_process';
import {drivingFixture, packageRoot} from './support/driving-fixture.mjs';
const cli = path.join(packageRoot, 'bin/traverse.mjs');
const env = {...process.env, NO_COLOR: '1', TERM: 'dumb'};
function run(f, args, code = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], {cwd: f.project, env, encoding: 'utf8', timeout: 30000});
  assert.equal(result.status, code, result.stdout + result.stderr); assert.equal(result.signal, null);
  assert.equal(result.stderr, ''); assert.doesNotMatch(result.stdout, /\x1b/); return JSON.parse(result.stdout);
}
const flags = f => ['--agent-device', f.executable, '--json'];
const open = (f, name = 'manual') => ['session', 'open', '--session', name, '--platform', 'web', '--app', 'http://fixture', ...flags(f)];
const calls = f => fs.readFileSync(f.log, 'utf8').trim().split('\n').map(JSON.parse);

test('CLI persists open/observe/act/close under an owned session and preserves the edited field', t => {
  const f = drivingFixture(t); run(f, ['init', '--json']);
  const opened = run(f, open(f)); assert.equal(opened.status, 'open');
  const observation = run(f, ['session', 'observe', '--session', 'manual', ...flags(f)]).observation;
  const field = observation.controls.find(c => c.label === 'Name');
  const action = path.join(f.root, 'action.json'); fs.writeFileSync(action, JSON.stringify({observationId: observation.id, type: 'fill', target: field.id, value: 'A preserved draft'}));
  const result = run(f, ['session', 'act', '--session', 'manual', '--action', action, ...flags(f)]);
  assert.equal(result.action.observation.controls.find(c => c.label === 'Name').value, 'A preserved draft');
  const closed = run(f, ['session', 'close', '--session', 'manual', ...flags(f)]); assert.equal(closed.status, 'closed');
  const sessions = Object.values(JSON.parse(fs.readFileSync(f.state))); assert.equal(sessions.length, 1); assert.equal(sessions[0].name, 'A preserved draft'); assert.equal(sessions[0].active, false);
  assert.ok(calls(f).filter(c => c.args[0] !== '--version').every(c => c.args.includes(opened.runnerSession)));
  assert.equal(fs.existsSync(path.join(f.project, '.wayfinder/local/sessions/manual/session.lock')), false);
  run(f, open(f), 1);
});

test('CLI frontier control drives the actual subprocess boundary and saves complete timing/usage/media receipts', t => {
  const f = drivingFixture(t); run(f, ['init', '--json']);
  const result = run(f, ['drive', '--task', f.task, '--session', 'control', '--platform', 'web', '--app', 'http://fixture', '--policy', 'frontier', '--frontier-config', f.config, '--record', ...flags(f)]);
  assert.equal(result.status, 'verified'); assert.equal(result.steps, 2); assert.equal(result.accounting.frontierCalls, 2); assert.equal(result.accounting.localCalls, 0);
  assert.ok(result.elapsedMs > 0); assert.equal(result.recording.status, 'stopped');
  assert.ok(fs.statSync(result.recording.file).size > 0); assert.equal(result.accounting.costUsd, .002);
  const ui = Object.values(JSON.parse(fs.readFileSync(f.state)))[0]; assert.equal(ui.committed, 'Updated'); assert.equal(ui.active, false);
  assert.equal(JSON.parse(fs.readFileSync(result.resultFile)).status, 'verified');
  const commandList = calls(f); assert.equal(commandList.filter(c => c.args[0] === 'press').length, 1);
  assert.ok(!commandList.some(c => c.args.includes('--shutdown')));
});

test('human driving reports real progress on stderr and leaves stdout clear', t => {
  const f = drivingFixture(t); run(f, ['init', '--json']);
  const args = ['drive', '--task', f.task, '--session', 'human', '--platform', 'web', '--app', 'http://fixture', '--policy', 'frontier', '--frontier-config', f.config, '--agent-device', f.executable];
  const result = spawnSync(process.execPath, [cli, ...args], {cwd: f.project, env, encoding: 'utf8', timeout: 30000});
  assert.equal(result.status, 0, result.stderr); assert.equal(result.signal, null); assert.equal(result.stdout, '');
  assert.match(result.stderr, /Checking the current graph/); assert.match(result.stderr, /Target opened/);
  assert.match(result.stderr, /Selected action via frontier/); assert.match(result.stderr, /Expected UI state observed/);
  assert.doesNotMatch(result.stderr, /\x1b/);
});

test('CLI rejects unsupported lifecycle, missing target, stale graph and conflicting options before launching', t => {
  const f = drivingFixture(t); run(f, ['init', '--json']);
  run(f, ['device', 'delete', '--platform', 'ios', '--device', 'TEST-UDID', ...flags(f)], 1);
  run(f, ['device', 'boot', '--platform', 'ios', ...flags(f)], 1);
  run(f, ['session', 'open', '--session', 'bad', '--platform', 'ios', '--app', 'dev.fixture', ...flags(f)], 1);
  run(f, [...open(f), '--record'], 1);
  fs.appendFileSync(path.join(f.project, 'app/index.tsx'), '\n// stale'); run(f, open(f), 1);
  assert.equal(fs.existsSync(f.log), false); assert.equal(fs.existsSync(path.join(f.project, '.wayfinder/local/sessions')), false);
});

test('device lifecycle uses explicit platform/identity and never advertises create/delete support', t => {
  const f = drivingFixture(t);
  const cap = run(f, ['device', 'capabilities', '--json']); assert.equal(cap.lifecycle.delete, false); assert.equal(cap.lifecycle.create, false);
  run(f, ['device', 'list', '--platform', 'ios', ...flags(f)]);
  run(f, ['device', 'boot', '--platform', 'ios', '--device', 'TEST-UDID', ...flags(f)]);
  run(f, ['device', 'shutdown', '--platform', 'ios', '--device', 'TEST-UDID', ...flags(f)]);
  assert.equal(fs.existsSync(path.join(f.project, '.wayfinder')), false);
  const operations = calls(f); assert.equal(operations[1].args[0], 'boot'); assert.ok(operations[1].args.includes('TEST-UDID'));
  assert.ok(operations[2].args.includes('--shutdown'));
});

test('session observation and cleanup survive repository edits without requiring graph regeneration', t => {
  const f = drivingFixture(t); run(f, ['init', '--json']); run(f, open(f));
  fs.appendFileSync(path.join(f.project, 'app/index.tsx'), '\n// app edited while session is open');
  const result = run(f, ['session', 'observe', '--session', 'manual', ...flags(f)]);
  assert.equal(result.observation.controls[0].label, 'Name');
  run(f, ['session', 'close', '--session', 'manual', ...flags(f)]);
  assert.equal(Object.values(JSON.parse(fs.readFileSync(f.state)))[0].active, false);
});

test('withheld post-action observation is a failed timed attempt with one dispatch and bounded cleanup', t => {
  const f = drivingFixture(t); run(f, ['init', '--json']); fs.writeFileSync(f.fault, 'hang-post');
  const result = run(f, ['drive', '--task', f.task, '--session', 'timeout', '--platform', 'web', '--app', 'http://fixture', '--policy', 'frontier', '--frontier-config', f.config, '--timeout-ms', '1000', ...flags(f)], 1);
  assert.equal(result.status, 'timeout'); assert.equal(result.lastAction.execution, 'acknowledged'); assert.ok(result.elapsedMs < 5000);
  assert.equal(calls(f).filter(c => c.args[0] === 'press').length, 1);
  assert.equal(Object.values(JSON.parse(fs.readFileSync(f.state)))[0].active, false);
  const hung = calls(f).findLast(c => c.args[0] === 'snapshot'); assert.throws(() => process.kill(-hung.pid, 0), {code: 'ESRCH'});
});

test('SIGINT cancels a pending open, closes only the owned session and exits without its lock', async t => {
  const f = drivingFixture(t); run(f, ['init', '--json']); fs.writeFileSync(f.fault, 'hang-open');
  const args = ['drive', '--task', f.task, '--session', 'cancel', '--platform', 'web', '--app', 'http://fixture', '--policy', 'frontier', '--frontier-config', f.config, ...flags(f)];
  const child = spawn(process.execPath, [cli, ...args], {cwd: f.project, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true});
  let stdout = '', stderr = '', killed = false;
  const poll = setInterval(() => { if (fs.existsSync(f.log) && calls(f).some(c => c.args[0] === 'open') && !killed) { killed = true; child.kill('SIGINT'); } }, 20);
  const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 10000);
  child.stdout.on('data', x => stdout += x); child.stderr.on('data', x => stderr += x);
  const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({code, signal})); });
  clearInterval(poll); clearTimeout(timer);
  assert.deepEqual(result, {code: 130, signal: null}, stdout + stderr); assert.equal(stderr, '');
  assert.equal(JSON.parse(stdout).status, 'cancelled');
  assert.equal(fs.existsSync(path.join(f.project, '.wayfinder/local/sessions/cancel/session.lock')), false);
  assert.equal(calls(f).filter(c => c.args[0] === 'close').length, 1);
});
