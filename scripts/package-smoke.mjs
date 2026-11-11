import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {root, hash, read, options, prerequisites, checks} from './check-support.mjs';

let check, work, failure;
const detail = {};
try {
  const args = options('Usage: npm run check:package -- [--out FRESH_DIRECTORY] [--archive EXACT_TGZ]\nPack, install into a temporary dev dependency and verify the installed CLI with source reads denied. macOS; no model, device or global install. See CONTRIBUTING.md.', {archive: {type: 'string'}});
  if (args) {
    const npm = prerequisites(); check = checks('package', args.out);
    work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'traverse-package-check-')));
    const home = path.join(work, 'home'); fs.mkdirSync(home);
    for (const name of ['user-npmrc', 'global-npmrc']) fs.writeFileSync(path.join(work, name), '');
    const env = {PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH, HOME: home, CI: '1', NO_COLOR: '1',
      npm_config_userconfig: path.join(work, 'user-npmrc'), npm_config_globalconfig: path.join(work, 'global-npmrc'), npm_config_cache: path.join(work, 'npm-cache')};
    const manifest = read(path.join(root, 'package.json'));
    const packed = JSON.parse(await check.run('pack', process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', work], {env}));
    assert.equal(packed.length, 1); assert.equal(packed[0].name, manifest.name); assert.equal(packed[0].version, manifest.version);
    const generatedArchive = path.join(work, packed[0].filename);
    const archive = args.archive ? fs.realpathSync(path.resolve(args.archive)) : generatedArchive;
    if (args.archive) assert.equal(hash(fs.readFileSync(archive)), hash(fs.readFileSync(generatedArchive)), 'Selected archive differs from the current package; rebuild or select its exact source');
    const unpacked = path.join(work, 'unpacked'); fs.mkdirSync(unpacked);
    await check.run('unpack', 'tar', ['-xzf', archive, '-C', unpacked], {cwd: work, env});
    const consumer = path.join(work, 'consumer'); fs.mkdirSync(consumer);
    fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({name: 'traverse-package-check', private: true, devDependencies: {[manifest.name]: 'file:' + archive}}));
    await check.run('dev-dependency-install', process.execPath, [npm, 'install', '--prefix', consumer, '--ignore-scripts', '--no-audit', '--no-fund'], {cwd: work, env, timeoutMs: 180000});
    const installed = path.join(consumer, 'node_modules', ...manifest.name.split('/')), files = {};
    for (const entry of packed[0].files) {
      assert.ok(!path.isAbsolute(entry.path) && !entry.path.split('/').includes('..'));
      assert.ok(!entry.path.split('/').some(part => ['node_modules', '.next', '.wayfinder', '.checks', '.netlify', '.agentic'].includes(part)), 'Private or generated path in archive: ' + entry.path);
      const current = fs.readFileSync(path.join(root, entry.path)), archiveBytes = fs.readFileSync(path.join(unpacked, 'package', entry.path));
      assert.deepEqual(archiveBytes, current, 'archive differs from source: ' + entry.path);
      assert.deepEqual(fs.readFileSync(path.join(installed, entry.path)), current, 'installed bytes differ: ' + entry.path);
      files[entry.path] = hash(current);
    }
    for (const required of ['LICENSE', 'README.md', 'npm-shrinkwrap.json', 'src/source/navigation.mjs', 'docs/assets/browser-results.png']) assert.ok(files[required], 'missing package entry: ' + required);
    assert.ok(!fs.existsSync(path.join(consumer, 'node_modules/netlify-cli')) && !fs.existsSync(path.join(installed, 'node_modules/netlify-cli')), 'Contributor Netlify CLI must not become an installed Traverse dependency');
    const parser = createRequire(path.join(installed, 'package.json')).resolve('typescript/package.json');
    assert.equal(read(parser).version, manifest.dependencies.typescript);
    const project = path.join(work, 'expo'); fs.mkdirSync(project);
    for (const name of ['app', 'components', 'app.json', 'tsconfig.json', 'package.json', 'package-lock.json', 'node_modules/expo/package.json', 'node_modules/expo-router/package.json']) {
      const target = path.join(project, name); fs.mkdirSync(path.dirname(target), {recursive: true}); fs.cpSync(path.join(root, 'examples/expo', name), target, {recursive: true});
    }
    const snapshot = () => {
      const result = {};
      function walk(dir) { for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const p = path.join(dir, entry.name); assert.ok(!entry.isSymbolicLink());
        if (entry.isDirectory()) walk(p); else result[path.relative(project, p)] = hash(fs.readFileSync(p));
      } }
      walk(project); return result;
    };
    const policy = path.join(work, 'deny-source.sb');
    fs.writeFileSync(policy, '(version 1)\n(allow default)\n(deny network*)\n(deny file-read* (subpath ' + JSON.stringify(root) + '))\n');
    const cli = path.join(consumer, 'node_modules/.bin/traverse');
    const run = (label, args, expected = 0) => check.run(label, '/usr/bin/sandbox-exec', ['-f', policy, cli, ...args], {cwd: project, env, expected, timeoutMs: 30000});
    assert.equal((await run('version', ['--version'])).trim(), manifest.version);
    assert.match(await run('help', ['--help']), /traverse init/);
    let before = snapshot();
    assert.equal(JSON.parse(await run('preview', ['init', '--no-interactive', '--dry-run', '--json'])).created, false);
    assert.deepEqual(snapshot(), before);
    assert.equal(JSON.parse(await run('init', ['init', '--no-interactive', '--json'])).ready, true);
    const config = path.join(project, '.wayfinder/project.json'), bytes = fs.readFileSync(config);
    assert.equal(JSON.parse(await run('rerun', ['init', '--no-interactive', '--json'])).created, false);
    assert.deepEqual(fs.readFileSync(config), bytes);
    before = snapshot();
    assert.equal(JSON.parse(await run('doctor', ['doctor', '--json'])).exitCode, 0);
    assert.equal(JSON.parse(await run('graph-check', ['graph', 'check', '--json'])).ready, true);
    assert.deepEqual(snapshot(), before);
    const receipt = path.join(project, '.wayfinder/local/failed-run.json'); fs.writeFileSync(receipt, '{"preserve":"failed attempt"}\n');
    const refreshed = JSON.parse(await run('refresh', ['graph', 'refresh', '--json'])); assert.equal(refreshed.ready, true); assert.equal(refreshed.authorCalls, 0);
    await run('snapshot', ['snapshot', '--out', path.join(project, '.wayfinder/snapshots/one'), '--json']);
    assert.equal(fs.readFileSync(receipt, 'utf8'), '{"preserve":"failed attempt"}\n');
    // A broken installed payload must fail health checks, even while the checkout is healthy.
    const module = path.join(installed, 'src/source/navigation.mjs'), original = fs.readFileSync(module); fs.unlinkSync(module);
    try { assert.equal(JSON.parse(await run('missing-installed-module', ['doctor', '--json'], 1)).readiness.extractor, false); }
    finally { fs.writeFileSync(module, original); }
    assert.equal(JSON.parse(await run('restored-installed-module', ['doctor', '--json'])).exitCode, 0);
    for (const [name, expected] of Object.entries(files)) assert.equal(hash(fs.readFileSync(path.join(installed, name))), expected, name);
    Object.assign(detail, {packageName: manifest.name, version: manifest.version, archiveSha256: hash(fs.readFileSync(archive)), files,
      archiveSourceInstalledFilesMatched: Object.keys(files).length, sourceAndNetworkDeniedForCli: true, devDependencyInstall: true, failedRunReceiptPreserved: true});
  }
} catch (error) { failure = error; }
finally {
  if (work) { try { fs.rmSync(work, {recursive: true}); detail.temporaryInstallationRemoved = true; } catch (error) { failure ??= error; } }
  if (check) check.finish(failure, detail);
  else if (failure) { console.error(failure.message); process.exitCode = 1; }
}
