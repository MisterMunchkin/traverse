import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn, spawnSync} from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url)), cli = path.join(root, 'bin/traverse.mjs');
const env = {...process.env, NO_COLOR: '1', TERM: 'dumb'};
function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wayfinder-cli-')));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  for (const name of ['app', 'components', 'app.json', 'tsconfig.json', 'package.json', 'package-lock.json', 'node_modules/expo/package.json', 'node_modules/expo-router/package.json']) {
    const dest = path.join(dir, name); fs.mkdirSync(path.dirname(dest), {recursive: true}); fs.cpSync(path.join(root, 'examples/expo', name), dest, {recursive: true});
  }
  return dir;
}
function run(cwd, args, code = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], {cwd, env: {...env, HOME:path.join(cwd,'.test-home')}, encoding: 'utf8', timeout: 30000});
  assert.equal(result.status, code, result.stdout + '\n' + result.stderr); assert.equal(result.signal, null); assert.doesNotMatch(result.stdout + result.stderr, /\x1b/);
  return result;
}

test('setup preview/check and option rejection are read-only through the CLI', t => {
  const project = fixture(t), cache = path.join(project, 'cache');
  const preview = run(project, ['setup', '--cache-dir', cache, '--dry-run', '--json']);
  assert.equal(preview.stderr, ''); assert.equal(JSON.parse(preview.stdout).schema, 'wayfinder-setup/1');
  assert.equal(JSON.parse(run(project, ['setup', '--cache-dir', cache, '--check', '--json'], 1).stdout).ready, false);
  run(project, ['setup', '--cache-dir', cache, '--unknown', '--json'], 1);
  assert.equal(fs.existsSync(cache), false);
  run(project, ['graph', 'check', '--accepted', 'ignored', '--json'], 1);
  run(project, ['init', '--cache-dir', cache, '--json'], 1); assert.equal(fs.existsSync(path.join(project, '.wayfinder')), false);
});

test('init creates the graph, check reports actual staleness, and refresh repairs it without tev1', t => {
  const project = fixture(t);
  const result = JSON.parse(run(project, ['init', '--json']).stdout); assert.equal(result.graph.ready, true);
  const doctor = JSON.parse(run(project, ['doctor', '--cache-dir', path.join(project, 'absent-cache'), '--json'], 1).stdout);
  assert.deepEqual(doctor.readiness, {extractor: true, configuration: false});
  assert.equal(doctor.checks.find(c => c.name === 'project-graph').status, 'pass');
  assert.equal(doctor.checks.find(c => c.name === 'managed-model-installation').status, 'fail');
  fs.appendFileSync(path.join(project, 'app/index.tsx'), '\n// source changed\n');
  assert.equal(JSON.parse(run(project, ['graph', 'check', '--json'], 1).stdout).ready, false);
  assert.equal(JSON.parse(run(project, ['doctor', '--json'], 1).stdout).readiness.extractor, false);
  const repaired = JSON.parse(run(project, ['graph', 'refresh', '--json']).stdout); assert.equal(repaired.authorCalls, 0);
  assert.equal(JSON.parse(run(project, ['graph', 'check', '--json']).stdout).ready, true);
  const missingModel = JSON.parse(run(project, ['doctor', '--model', '--cache-dir', path.join(project, 'absent-cache'), '--json'], 1).stdout);
  assert.equal(missingModel.readiness.extractor, true); assert.equal(missingModel.checks.find(c => c.name === 'managed-model-decision').status, 'fail');
});

test('managed ignore blocks preserve existing text and allow portable artifacts in a repository', t => {
  const project = fixture(t), original = '# User rules\n.wayfinder/\nkeep-secret\n'; fs.writeFileSync(path.join(project, '.gitignore'), original);
  run(project, ['init', '--json']);
  const after = fs.readFileSync(path.join(project, '.gitignore'), 'utf8'); assert.ok(after.startsWith(original));
  run(project, ['init', '--json']); assert.equal(fs.readFileSync(path.join(project, '.gitignore'), 'utf8'), after);
  const git = args => spawnSync('git', args, {cwd: project, encoding: 'utf8'});
  assert.equal(git(['init', '-q']).status, 0);
  for (const name of ['project.json', 'graph.json', 'extractor/artifact.json']) assert.equal(git(['check-ignore', '-q', '.wayfinder/' + name]).status, 1, name);
  assert.equal(git(['check-ignore', '-q', '.wayfinder/local/private.json']).status, 0);
});

test('CLI watch emits NDJSON and SIGINT stops an idle watcher without leaving a graph lock', async t => {
  const project = fixture(t); run(project, ['init', '--json']);
  const child = spawn(process.execPath, [cli, 'graph', 'watch', '--json'], {cwd: project, env, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
  let stdout = '', stderr = '', requested = false, timedOut = false, killTimer;
  const deadline = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 2500); }, 30000);
  child.stdout.on('data', data => {
    stdout += data;
    if (!requested && stdout.includes('"status":"ready"')) { requested = true; child.kill('SIGINT'); }
  });
  child.stderr.on('data', data => { stderr += data; });
  const outcome = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({code, signal})); });
  clearTimeout(deadline); clearTimeout(killTimer);
  assert.equal(timedOut, false, stdout + stderr); assert.equal(outcome.code, 130, stdout + stderr); assert.equal(outcome.signal, null);
  assert.equal(stderr, ''); const events = stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.ok(events.some(e => e.status === 'ready')); assert.equal(events.at(-1).status, 'stopped');
  assert.ok(events.every(e => e.schema === 'wayfinder-graph-watch-event/1'));
  assert.equal(fs.existsSync(path.join(project, '.wayfinder/local/graph.lock')), false);
  assert.throws(() => process.kill(child.pid, 0), {code: 'ESRCH'});
});


test('doctor omits an unconfigured optional model but fails an explicitly selected missing cache', t => {
  const project = fixture(t); run(project, ['init', '--json']);
  const unconfigured = JSON.parse(run(project, ['doctor', '--json']).stdout);
  assert.ok(!unconfigured.checks.some(c => c.name.startsWith('managed-model')), 'No model setup was requested or attempted');
  assert.ok(!unconfigured.checks.some(c => c.status === 'warn'));
  for (const cache of [path.join(project, 'explicit-cache'), '']) {
    const selected = JSON.parse(run(project, ['doctor', '--cache-dir', cache, '--json'], 1).stdout);
    assert.equal(selected.readiness.configuration, false); assert.equal(selected.readiness.extractor, true);
    assert.equal(selected.checks.find(c => c.name === 'managed-model-installation').status, 'fail');
    assert.equal(fs.existsSync(cache), false);
  }
});

test('an attempted but incomplete default model setup is a configuration failure without modifying its receipts', t => {
  const project = fixture(t); run(project, ['init', '--json']);
  const cache = path.join(project, '.test-home/.cache/wayfinder'); fs.mkdirSync(cache, {recursive: true});
  const owner = JSON.stringify({schema: 'wayfinder-model-cache/1', id: 'owned-failed-fixture'});
  const failure = JSON.stringify({schema: 'wayfinder-setup-failure/1', stage: 'model download', error: 'fixture failure', runDirectory: path.join(cache, 'runs/failed'), cancelled: false});
  fs.writeFileSync(path.join(cache, 'owner.json'), owner); fs.writeFileSync(path.join(cache, 'setup-failure.json'), failure);
  const report = JSON.parse(run(project, ['doctor', '--json'], 1).stdout);
  assert.equal(report.readiness.configuration, false); assert.equal(report.readiness.extractor, true);
  const check = report.checks.find(c => c.name === 'managed-model-installation');
  assert.equal(check.status, 'fail'); assert.match(check.evidence.reason, /model download.*fixture failure/);
  assert.equal(fs.readFileSync(path.join(cache, 'owner.json'), 'utf8'), owner);
  assert.equal(fs.readFileSync(path.join(cache, 'setup-failure.json'), 'utf8'), failure);
  assert.deepEqual(fs.readdirSync(cache).sort(), ['owner.json', 'setup-failure.json']);
});

test('model setup preview gives an executable next command that preserves its explicit cache literally', t => {
  const project = fixture(t), cache = path.join(project, "model ' cache $(touch PWNED)");
  const output = run(project, ['setup', '--cache-dir', cache, '--dry-run']).stderr;
  const next = /^  Next: (.+)$/m.exec(output)?.[1]; assert.ok(next);
  const bin = path.join(project, 'owned-bin'); fs.mkdirSync(bin);
  const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  fs.writeFileSync(path.join(bin, 'traverse'), '#!/bin/sh\nexec ' + quote(process.execPath) + ' ' + quote(cli) + ' "$@"\n', {mode: 0o755});
  const result = spawnSync('/bin/sh', ['-c', next + ' --dry-run --json'], {cwd: project, env: {...env, HOME: path.join(project, '.test-home'), PATH: bin + path.delimiter + process.env.PATH}, encoding: 'utf8', timeout: 30000});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).cacheDir, cache);
  assert.equal(fs.existsSync(cache), false); assert.equal(fs.existsSync(path.join(project, 'PWNED')), false);
});
