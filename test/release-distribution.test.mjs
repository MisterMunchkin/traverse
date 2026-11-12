import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
function run(script, args, env = {}) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], {
    cwd: root, encoding: 'utf8', timeout: 60000, env: {...process.env, ...env}, maxBuffer: 4 * 1024 * 1024,
  });
}
function temporary(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'traverse-distribution-')));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return dir;
}

test('release bundle provides a checksum for the actual archive and rejects tampering', t => {
  const out = path.join(temporary(t), 'bundle');
  const packed = run('release.mjs', ['pack', '--out', out]);
  assert.equal(packed.status, 0, packed.stderr);
  const release = JSON.parse(fs.readFileSync(path.join(out, 'release.json')));
  assert.equal(release.version, manifest.version);
  assert.equal(release.kind, 'candidate');
  const bytes = fs.readFileSync(path.join(out, release.filename));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  assert.equal(release.sha256, sha256);
  assert.equal(fs.readFileSync(path.join(out, 'SHA256SUMS'), 'utf8'), `${sha256}  ${release.filename}\n`);
  assert.ok(release.files.some(file => file.path === 'docs/security.md'));
  assert.ok(release.files.every(file => !file.path.split('/').some(part => ['.checks', '.wayfinder', '.netlify', 'node_modules', 'website'].includes(part))));
  fs.appendFileSync(path.join(out, release.filename), 'changed');
  const checked = run('release.mjs', ['verify', '--out', out]);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /checksum|integrity/i);
  const site = path.join(path.dirname(out), 'invalid-site');
  const built = run('site.mjs', ['build', '--out', site, '--release-dir', out]);
  assert.notEqual(built.status, 0);
  assert.equal(fs.existsSync(site), false, 'a corrupt bundle must be refused before creating site output');
});

test('mismatched release tag is refused before creating an output bundle', t => {
  const out = path.join(temporary(t), 'bundle');
  const packed = run('release.mjs', ['pack', '--out', out, '--tag', 'v999.0.0']);
  assert.notEqual(packed.status, 0);
  assert.match(packed.stderr, /tag.*version/i);
  assert.equal(fs.existsSync(out), false);
});

test('website download uses the supplied archive bytes and works without JavaScript', t => {
  const dir = temporary(t), bundle = path.join(dir, 'bundle'), out = path.join(dir, 'site');
  const packed = run('release.mjs', ['pack', '--out', bundle]);
  assert.equal(packed.status, 0, packed.stderr);
  const built = run('site.mjs', ['build', '--out', out, '--release-dir', bundle]);
  assert.equal(built.status, 0, built.stderr);
  const release = JSON.parse(fs.readFileSync(path.join(bundle, 'release.json')));
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.ok(html.includes(`href="./downloads/${release.filename}"`));
  assert.ok(html.includes('SHA256SUMS'));
  assert.ok(html.includes('npm install --save-dev'));
  assert.ok(html.includes('curl --fail --location'));
  assert.ok(html.includes('Candidate build'));
  assert.ok(!html.includes('@@'));
  assert.deepEqual(fs.readFileSync(path.join(out, 'downloads', release.filename)), fs.readFileSync(path.join(bundle, release.filename)));
  assert.ok(fs.readFileSync(path.join(out, 'security.html'), 'utf8').includes('127.0.0.1'));
});

test('site build refuses production context without explicit opt-in', t => {
  const out = path.join(temporary(t), 'site');
  const built = run('site.mjs', ['build', '--out', out], {CONTEXT: 'production'});
  assert.notEqual(built.status, 0);
  assert.match(built.stderr, /production/i);
  assert.equal(fs.existsSync(out), false);
});


test('production website build requires explicit opt-in and keeps candidate identity', t => {
  const out = path.join(temporary(t), 'production-site');
  const built = run('site.mjs', ['build', '--allow-production', '--out', out], {CONTEXT: 'production'});
  assert.equal(built.status, 0, built.stderr);
  const release = JSON.parse(fs.readFileSync(path.join(out, 'downloads/release.json')));
  assert.equal(release.kind, 'candidate');
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.ok(html.includes('Candidate build'));
  assert.ok(!html.includes('@@'));
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(out, 'downloads', release.filename))).digest('hex'), release.sha256);
});
