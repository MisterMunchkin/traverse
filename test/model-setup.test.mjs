import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {runProcess} from '../src/runtime/process.mjs';
import {drivingFixture} from './support/driving-fixture.mjs';

const sha = x => createHash('sha256').update(x).digest('hex');
const modulePath = new URL('../src/model-setup.mjs', import.meta.url);
async function api() {
  assert.ok(fs.existsSync(modulePath), 'Managed model setup is not implemented');
  return import(modulePath.href);
}
async function fixture(t, {decisionFailure = false, rerunFailure = false} = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wayfinder-model-')));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const runtime = path.join(dir, 'runtime'); fs.mkdirSync(runtime);
  fs.copyFileSync(fileURLToPath(new URL('../fixtures/model-runtime/ollama.mjs', import.meta.url)), path.join(runtime, 'ollama'));
  if (decisionFailure) fs.writeFileSync(path.join(runtime, 'ollama'), fs.readFileSync(path.join(runtime, 'ollama'), 'utf8').replace("else if (request.url === '/v1/systemone') {", "else if (request.url === '/v1/systemone') { response.statusCode = 503;"));
  if (rerunFailure) fs.writeFileSync(path.join(runtime, 'ollama'), fs.readFileSync(path.join(runtime, 'ollama'), 'utf8').replace("else if (request.url === '/v1/systemone') {", "else if (request.url === '/v1/systemone') { if (fs.existsSync(path.join(process.env.HOME, 'fail-decision'))) response.statusCode = 503;"));
  fs.chmodSync(path.join(runtime, 'ollama'), 0o755);
  const archive = path.join(dir, 'runtime.tgz');
  await runProcess('tar', ['-czf', archive, '-C', runtime, 'ollama'], {timeoutMs: 10000});
  const models = path.join(dir, 'models'), blob = Buffer.from('offline-fixture-model');
  const descriptor = {digest: 'sha256:' + sha(blob), size: blob.length};
  const manifest = JSON.stringify({schemaVersion: 2, config: descriptor, layers: [descriptor]});
  const target = path.join(models, 'manifests-v2/ollama.com/library/tev1/4b');
  const canonical = path.join(models, 'blobs', 'sha256-' + sha(manifest));
  fs.mkdirSync(path.dirname(target), {recursive: true}); fs.mkdirSync(path.join(models, 'blobs'));
  fs.writeFileSync(canonical, manifest); fs.symlinkSync(path.relative(path.dirname(target), canonical), target);
  fs.writeFileSync(path.join(models, 'blobs', 'sha256-' + sha(blob)), blob);
  const pins = {schema: 'wayfinder-model-pins/1', model: {name: 'tev1:4b', digest: sha(manifest)}, runtimes: {'darwin-arm64': {version: '0.40.8', archiveSha256: sha(fs.readFileSync(archive)), url: 'https://invalid.example/never-download', executable: 'ollama'}}};
  return {dir, archive, models, pins, cacheDir: path.join(dir, 'cache')};
}

test('model setup previews and absent-cache checks create no files', async t => {
  const {setupRuntime} = await api(); const f = await fixture(t);
  for (const options of [{dryRun: true}, {check: true}]) {
    const r = await setupRuntime({...f, ...options});
    assert.equal(r.ready, false); assert.equal(r.model.name, 'tev1:4b');
    assert.equal(fs.existsSync(f.cacheDir), false);
  }
});

test('explicit setup installs verified private assets, preserves reruns and checks content integrity', async t => {
  const {setupRuntime, runtimeStatus} = await api(); const f = await fixture(t);
  const first = await setupRuntime({...f, runtimeArchive: f.archive, modelsDir: f.models});
  assert.equal(first.ready, true); assert.equal(first.created, true);
  const privateHome = path.join(f.cacheDir, 'runtime-home');
  assert.equal(JSON.parse(fs.readFileSync(path.join(privateHome, 'fixture-version-home.json'))).home, privateHome);
  assert.notEqual(privateHome, os.homedir());
  const metadata = fs.readFileSync(path.join(f.cacheDir, 'installation.json'));
  const again = await setupRuntime({...f, runtimeArchive: f.archive, modelsDir: f.models});
  assert.equal(again.created, false); assert.deepEqual(fs.readFileSync(path.join(f.cacheDir, 'installation.json')), metadata);
  assert.equal((await runtimeStatus({...f, deep: true})).ready, true);
  const blob = fs.readdirSync(path.join(f.cacheDir, 'models/blobs'))[0];
  fs.writeFileSync(path.join(f.cacheDir, 'models/blobs', blob), 'corrupted-fixture');
  assert.equal((await runtimeStatus({...f, deep: true})).ready, false);
});

test('wrong archive/model pins and unowned or symlink caches never report ready', async t => {
  const {setupRuntime} = await api();
  for (const kind of ['archive', 'model', 'unowned', 'symlink']) {
    const f = await fixture(t);
    if (kind === 'archive') f.pins.runtimes['darwin-arm64'].archiveSha256 = 'a'.repeat(64);
    if (kind === 'model') f.pins.model.digest = 'b'.repeat(64);
    if (kind === 'unowned') { fs.mkdirSync(f.cacheDir); fs.writeFileSync(path.join(f.cacheDir, 'keep'), 'not Traverse'); }
    if (kind === 'symlink') fs.symlinkSync(f.models, f.cacheDir);
    await assert.rejects(setupRuntime({...f, runtimeArchive: f.archive, modelsDir: f.models}), /checksum|digest|owned|Symlink/i);
    if (kind === 'unowned') assert.equal(fs.readFileSync(path.join(f.cacheDir, 'keep'), 'utf8'), 'not Traverse');
    if (kind === 'symlink') assert.ok(fs.lstatSync(f.cacheDir).isSymbolicLink());
  }
});

test('an unsupported runtime platform fails before mutation', async t => {
  const {setupRuntime} = await api(); const f = await fixture(t);
  await assert.rejects(setupRuntime({...f, platform: 'unsupported', arch: 'unknown'}), /Unsupported/);
  assert.equal(fs.existsSync(f.cacheDir), false);
});

test('setup pulls only through its private server and the explicit model health check closes that server', async t => {
  const {setupRuntime, checkModel} = await api(); const f = await fixture(t);
  const result = await setupRuntime({...f, runtimeArchive: f.archive});
  assert.equal(result.ready, true);
  assert.equal((await checkModel(f)).decisionReady, true);
  const runs = path.join(f.cacheDir, 'runs'); let outcomes = 0;
  for (const name of fs.readdirSync(runs)) {
    const file = path.join(runs, name, 'server/server-outcome.json');
    if (fs.existsSync(file)) { assert.equal(JSON.parse(fs.readFileSync(file)).groupEmpty, true); outcomes++; }
  }
  assert.equal(outcomes, 2);
});

test('fresh setup downloads its runtime and verifies a choice before publishing ready', async t => {
  const {setupRuntime} = await api(); const f = await fixture(t);
  let requests = 0;
  const server = http.createServer((_request, response) => { requests++; response.end(fs.readFileSync(f.archive)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  f.pins.runtimes['darwin-arm64'].url = `http://127.0.0.1:${server.address().port}/runtime.tgz`;
  const result = await setupRuntime(f);
  assert.equal(requests, 1);
  assert.equal(result.ready, true);
  assert.equal(result.decisionReady, true, 'Downloaded files alone do not establish usable model setup');
  const receipt = JSON.parse(fs.readFileSync(path.join(f.cacheDir, 'installation.json')));
  assert.equal(receipt.decisionVerified, true);
});

test('setup refuses ready publication when verified files cannot answer a decision', async t => {
  const {setupRuntime, runtimeStatus} = await api(); const f = await fixture(t, {decisionFailure: true});
  await assert.rejects(setupRuntime({...f, runtimeArchive: f.archive}), /decision|503/i);
  assert.equal(fs.existsSync(path.join(f.cacheDir, 'installation.json')), false);
  const status = await runtimeStatus(f);
  assert.equal(status.ready, false);
  assert.match(status.reason, /decision|503/i);
  assert.doesNotMatch(status.reason, /ENOENT/);
  for (const name of fs.readdirSync(path.join(f.cacheDir, 'runs'))) {
    const receipt = path.join(f.cacheDir, 'runs', name, 'server/server-outcome.json');
    if (fs.existsSync(receipt)) assert.equal(JSON.parse(fs.readFileSync(receipt)).groupEmpty, true);
  }
});

test('incomplete setup reports its saved stage and failure without creating state', async t => {
  const {runtimeStatus} = await api(); const f = await fixture(t);
  fs.mkdirSync(f.cacheDir);
  fs.writeFileSync(path.join(f.cacheDir, 'owner.json'), JSON.stringify({schema: 'wayfinder-model-cache/1', id: 'test-owner'}));
  const failure = {schema: 'wayfinder-setup-failure/1', stage: 'model download', error: 'HTTP 412: runtime is incompatible', runDirectory: path.join(f.cacheDir, 'runs/failed'), cancelled: false};
  fs.writeFileSync(path.join(f.cacheDir, 'setup-failure.json'), JSON.stringify(failure));
  const before = fs.readdirSync(f.cacheDir);
  const status = await runtimeStatus(f);
  assert.equal(status.ready, false);
  assert.match(status.reason, /model download/);
  assert.match(status.reason, /HTTP 412/);
  assert.match(status.reason, /runs/);
  assert.doesNotMatch(status.reason, /ENOENT/);
  assert.deepEqual(fs.readdirSync(f.cacheDir), before);
});

test('withheld runtime readiness fails within its bound and leaves no owned server', async t => {
  const {withOwnedOllama} = await import('../src/runtime/ollama.mjs'); const f = await fixture(t);
  const binary = path.join(f.dir, 'silent-runtime');
  fs.writeFileSync(binary, '#!' + process.execPath + '\nsetInterval(()=>{},1000)', {mode: 0o755});
  const runDir = path.join(f.dir, 'withheld');
  await assert.rejects(withOwnedOllama({binary, models: f.models, directory: runDir, runtimeHome: path.join(f.dir, 'home'), version: '0.35.0', startupMs: 100}, () => assert.fail('Must not run without readiness')), /readiness deadline/);
  const outcome = JSON.parse(fs.readFileSync(path.join(runDir, 'server-outcome.json')));
  assert.equal(outcome.groupEmpty, true);
  assert.throws(() => process.kill(outcome.pid, 0), {code: 'ESRCH'});
});


test('failed setup reruns preserve verified metadata and report their decision receipt path', async t => {
  const {setupRuntime} = await api(); const f = await fixture(t, {rerunFailure: true});
  assert.equal((await setupRuntime({...f, runtimeArchive: f.archive})).ready, true);
  const metadata = fs.readFileSync(path.join(f.cacheDir, 'installation.json'));
  fs.writeFileSync(path.join(f.cacheDir, 'runtime-home/fail-decision'), 'fail');
  await assert.rejects(setupRuntime(f), /decision.*Details:/i);
  assert.deepEqual(fs.readFileSync(path.join(f.cacheDir, 'installation.json')), metadata);
  const failure = JSON.parse(fs.readFileSync(path.join(f.cacheDir, 'setup-failure.json')));
  assert.match(failure.stage, /decision/);
  assert.match(failure.error, /503/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(failure.runDirectory, 'server/server-outcome.json'))).groupEmpty, true);
});


test('setup downloads and validates the exact pinned model tag in the native v2 store', async t => {
  const {setupRuntime} = await api(); const f = await fixture(t);
  f.pins.model.name = 'tev1:4b-q8_0';
  const result = await setupRuntime({...f, runtimeArchive: f.archive});
  assert.equal(result.ready, true);
  assert.equal(result.decisionReady, true);
  assert.equal(result.model.name, 'tev1:4b-q8_0');
  assert.equal(fs.existsSync(path.join(f.cacheDir, 'models/manifests-v2/ollama.com/library/tev1/4b-q8_0')), true);
});


test('native v2 model references accept only the pinned canonical blob inside the owned store', async t => {
  const {setupRuntime, runtimeStatus} = await api(); const f = await fixture(t);
  assert.equal((await setupRuntime({...f, runtimeArchive: f.archive, modelsDir: f.models})).ready, true);
  const named = path.join(f.cacheDir, 'models/manifests-v2/ollama.com/library/tev1/4b');
  const external = path.join(f.dir, 'foreign-manifest');
  fs.writeFileSync(external, fs.readFileSync(path.join(f.models, 'blobs', 'sha256-' + f.pins.model.digest)));
  fs.unlinkSync(named); fs.symlinkSync(external, named);
  const status = await runtimeStatus(f);
  assert.equal(status.ready, false);
  assert.match(status.reason, /reference|owned|canonical/i);
});


test('a configured model passes doctor without inference until the explicit model check is requested', async t => {
  const f = await fixture(t), packageRoot = fileURLToPath(new URL('../', import.meta.url)), copy = path.join(f.dir, 'package');
  fs.mkdirSync(copy);
  for (const name of ['bin', 'src', 'fixtures', 'package.json', 'npm-shrinkwrap.json']) fs.cpSync(path.join(packageRoot, name), path.join(copy, name), {recursive: true});
  fs.mkdirSync(path.join(copy, 'node_modules')); fs.symlinkSync(path.join(packageRoot, 'node_modules/typescript'), path.join(copy, 'node_modules/typescript'), 'dir');
  fs.writeFileSync(path.join(copy, 'src/model-pins.json'), JSON.stringify(f.pins));
  const project = drivingFixture(t).project, home = path.join(f.dir, 'home'); fs.mkdirSync(home);
  const cli = path.join(copy, 'bin/traverse.mjs');
  const run = async args => { try { return await runProcess(process.execPath, [cli, ...args], {cwd: project, env: {...process.env, HOME: home, NO_COLOR: '1', TERM: 'dumb'}, timeoutMs: 30000}); } catch (error) { assert.fail(JSON.stringify({args, ...error.record})); } };
  await run(['init', '--json']);
  await run(['setup', '--cache-dir', f.cacheDir, '--runtime-archive', f.archive, '--models-dir', f.models, '--json']);
  const metadata = fs.readFileSync(path.join(f.cacheDir, 'installation.json'));
  assert.equal(fs.readdirSync(path.join(f.cacheDir, 'runs')).length, 1);
  const installed = JSON.parse((await run(['doctor', '--cache-dir', f.cacheDir, '--json'])).stdout);
  assert.equal(installed.readiness.configuration, true); assert.equal(installed.readiness.extractor, true);
  assert.equal(installed.checks.find(c => c.name === 'managed-model-installation').status, 'pass');
  assert.equal(fs.readdirSync(path.join(f.cacheDir, 'runs')).length, 1, 'Default doctor must not start model inference');
  const checked = JSON.parse((await run(['doctor', '--model', '--cache-dir', f.cacheDir, '--json'])).stdout);
  assert.equal(checked.readiness.configuration, true);
  assert.equal(checked.checks.find(c => c.name === 'managed-model-decision').status, 'pass');
  assert.equal(fs.readdirSync(path.join(f.cacheDir, 'runs')).length, 2, 'Explicit model check must perform the owned request');
  assert.deepEqual(fs.readFileSync(path.join(f.cacheDir, 'installation.json')), metadata);
  for (const name of fs.readdirSync(path.join(f.cacheDir, 'runs'))) {
    const outcome = JSON.parse(fs.readFileSync(path.join(f.cacheDir, 'runs', name, 'server/server-outcome.json')));
    assert.equal(outcome.groupEmpty, true);
  }
});
