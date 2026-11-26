import './support/isolated-approval-state.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {drivingFixture, packageRoot} from './support/driving-fixture.mjs';
const cli = path.join(packageRoot, 'bin/traverse.mjs');
const loader = new URL('./support/validator-fault.mjs', import.meta.url).href;
function run(f, args, code = 0, fault) {
  const result = spawnSync(process.execPath, [...(fault ? ['--experimental-test-module-mocks', '--import', loader] : []), cli, ...args], {
    cwd: f.project, env: {...process.env, NO_COLOR: '1', TRAVERSE_TEST_VALIDATOR_FAILURE: fault ?? ''}, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, code, result.stdout + result.stderr); assert.equal(result.signal, null);
  return args.includes('--json') ? JSON.parse(result.stdout) : result;
}

test('validator deadline is a timeout in graph status and session preflight, preserving the graph and five-second limit', t => {
  const f = drivingFixture(t); run(f, ['init', '--json']);
  const graph = path.join(f.project, '.wayfinder/graph.json'), before = fs.readFileSync(graph);
  const control = run(f, ['graph', 'check', '--json']); assert.equal(control.ready, true);
  const timed = run(f, ['graph', 'check', '--json'], 1, 'timeout');
  assert.equal(timed.ready, false); assert.equal(timed.code, 'VALIDATION_TIMEOUT');
  assert.match(timed.reason, /timed out.*5000ms/i); assert.doesNotMatch(timed.reason, /stale|refresh/i);
  const human = run(f, ['graph', 'check'], 1, 'timeout');
  assert.match(human.stderr, /timed out.*5000ms/i); assert.doesNotMatch(human.stderr, /stale|refresh/i);
  const args = ['session', 'open', '--session', 'deadline', '--platform', 'web', '--app', 'http://fixture', '--agent-device', f.executable];
  const session = run(f, [...args, '--json'], 1, 'timeout');
  assert.match(session.error, /timed out.*5000ms/i); assert.doesNotMatch(session.error, /stale|refresh/i);
  assert.equal(fs.existsSync(f.log), false);
  assert.deepEqual(fs.readFileSync(graph), before);
  assert.equal(run(f, ['graph', 'check', '--json']).graphHash, control.graphHash);
  const invalid = run(f, ['graph', 'check', '--json'], 1, 'invalid');
  assert.doesNotMatch(invalid.reason, /timed out/i); assert.notEqual(invalid.code, 'VALIDATION_TIMEOUT');
  fs.appendFileSync(path.join(f.project, 'app/index.tsx'), '\n// source changed');
  const stale = run(f, ['graph', 'check', '--json'], 1);
  assert.match(stale.reason, /stale/i); assert.notEqual(stale.code, 'VALIDATION_TIMEOUT');
  assert.match(run(f, [...args, '--json'], 1).error, /stale or invalid/i);
});

test('init validator timeout remains a deadline in human output, without launching a runner', t => {
  const f = drivingFixture(t);
  const result = run(f, ['init'], 1, 'timeout');
  assert.match(result.stderr, /DEADLINE:.*5000ms/);
  assert.doesNotMatch(result.stderr, /graph is stale/i);
  assert.equal(fs.existsSync(f.log), false);
  assert.equal(fs.existsSync(path.join(f.project, '.wayfinder/graph.json')), false);
});
