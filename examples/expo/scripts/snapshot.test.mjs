import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {snapshot, sampleRoot} from './snapshot.mjs';
import {sha} from '../../../src/extractor-pipeline/contract.mjs';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wayfinder-snapshot-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  for (const name of ['app', 'components', 'app.json', 'tsconfig.json', 'package.json', 'package-lock.json', 'node_modules/expo/package.json', 'node_modules/expo-router/package.json']) {
    fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true});
    fs.cpSync(path.join(sampleRoot, name), path.join(root, name), {recursive: true});
  }
  return root;
}
function change(root, file, edit) {
  const name = path.join(root, file), value = JSON.parse(fs.readFileSync(name));
  edit(value); fs.writeFileSync(name, JSON.stringify(value));
}

test('actual source bytes and installed/locked routing identity produce deterministic provenance', t => {
  const root = fixture(t), first = snapshot(root);
  assert.deepEqual(snapshot(root), first);
  assert.deepEqual(Object.keys(first.spec.source.files).sort(), ['app/_layout.tsx','app/index.tsx','app/notes/edit.tsx','app/notes/first.tsx','app/notes/index.tsx','components/note-store.tsx','components/page.tsx']);
  for (const [name, content] of Object.entries(first.spec.source.files)) {
    assert.equal(content, fs.readFileSync(path.join(root, name), 'utf8'));
    assert.equal(first.provenance.sourceManifest[name].sha256, sha(content));
  }
  assert.equal(first.spec.framework.version, JSON.parse(fs.readFileSync(path.join(root, 'node_modules/expo-router/package.json'))).version);
  fs.appendFileSync(path.join(root, 'app/index.tsx'), '\n// changed source\n');
  assert.notEqual(snapshot(root).provenance.sourceFingerprint, first.provenance.sourceFingerprint);
});

test('fresh CLI processes produce identical specs and refuse output reuse', t => {
  const root = fixture(t), cli = path.join(sampleRoot, 'scripts/snapshot.mjs');
  const run = out => execFileSync(process.execPath, [cli, '--out', path.join(root, out)], {encoding: 'utf8', timeout: 5000});
  run('one'); run('two');
  assert.equal(fs.readFileSync(path.join(root, 'one/spec.json'), 'utf8'), fs.readFileSync(path.join(root, 'two/spec.json'), 'utf8'));
  assert.throws(() => run('one'), /EEXIST/);
});

for (const [label, mutate, error] of [
  ['missing route', r => fs.unlinkSync(path.join(r, 'app/notes/edit.tsx')), /Missing sample route/],
  ['missing parser input directory', r => fs.rmSync(path.join(r, 'components'), {recursive: true}), /ENOENT/],
  ['missing installed router', r => fs.unlinkSync(path.join(r, 'node_modules/expo-router/package.json')), /ENOENT/],
  ['installed version mismatch', r => change(r, 'node_modules/expo-router/package.json', p => {p.version = '57.0.999';}), /installed, declared or locked/],
  ['declared range incompatible with locked version', r => { for (const f of ['package.json', 'package-lock.json']) change(r, f, p => {(p.packages?.[''] || p).dependencies['expo-router'] = '~58.0.0';}); }, /installed, declared or locked/],
  ['unsupported custom root', r => change(r, 'app.json', p => {p.expo.plugins = [['expo-router', {root: 'src/app'}]];}), /Unsupported app routing/],
  ['alias mismatch', r => change(r, 'tsconfig.json', p => {p.compilerOptions.paths['@/*'] = ['./src/*'];}), /root @\/ alias/],
  ['competing src app', r => fs.mkdirSync(path.join(r, 'src/app'), {recursive: true}), /Unsupported project routing/],
  ['dynamic config', r => fs.writeFileSync(path.join(r, 'app.config.ts'), 'throw Error("must never execute")'), /Unsupported project routing/],
  ['source symlink', r => fs.symlinkSync(path.join(r, 'package.json'), path.join(r, 'app/leak.ts')), /Symlink input/],
  ['package directory symlink', r => {fs.renameSync(path.join(r, 'node_modules/expo-router'), path.join(r, 'router')); fs.symlinkSync(path.join(r, 'router'), path.join(r, 'node_modules/expo-router'));}, /Symlink input/],
  ['unsupported source asset', r => fs.writeFileSync(path.join(r, 'app/secret.json'), '{}'), /Unsupported source input/],
]) test(`snapshot rejects ${label}`, t => {const root = fixture(t); mutate(root); assert.throws(() => snapshot(root), error);});
