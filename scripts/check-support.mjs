import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {runProcess} from '../src/runtime/process.mjs';
import {noSymlinks} from '../src/installation.mjs';

export const root = fs.realpathSync(fileURLToPath(new URL('../', import.meta.url)));
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export function options(help) {
  const {values} = parseArgs({options: {out: {type: 'string'}, help: {type: 'boolean'}}});
  if (values.help) { console.log(help); return null; }
  if (values.out !== undefined && !values.out.trim()) throw Error('--out needs a fresh report directory');
  return values;
}
export function prerequisites({full = false} = {}) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major === 22 && minor < 13) throw Error('Contributor checks need Node 22.13+; use the version in .nvmrc');
  if (process.platform !== 'darwin' || full && process.arch !== 'arm64') throw Error('Current contributor checks target macOS' + (full ? ' arm64' : '') + '; other platforms need separate validation');
  for (const name of ['node_modules/typescript/package.json', 'examples/expo/node_modules/expo/package.json', 'examples/expo/node_modules/expo-router/package.json']) {
    if (!fs.existsSync(path.join(root, name))) throw Error('Missing contributor dependencies. Run both npm ci commands in CONTRIBUTING.md first');
  }
  const cli = process.env.npm_execpath;
  if (!cli || !path.isAbsolute(cli) || !fs.statSync(cli).isFile()) throw Error('Run this check through npm run check or npm run check:package');
  return cli;
}
export function inventory() {
  const result = {};
  const excluded = new Set(['node_modules', '.git', '.wayfinder', '.checks', '.expo', 'dist', '__pycache__', 'expo-env.d.ts']);
  function visit(relative) {
    const file = path.join(root, relative), stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw Error('Check inputs must be regular source paths: ' + relative);
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) {
      if (!excluded.has(name)) visit(path.join(relative, name));
    }
    else result[relative.split(path.sep).join('/')] = {sha256: hash(fs.readFileSync(file)), executable: !!(stat.mode & 0o111)};
  }
  for (const name of ['src', 'bin', 'test', 'fixtures', 'scripts', 'docs', 'examples/expo', '.github', '.nvmrc', 'package.json', 'npm-shrinkwrap.json', 'README.md', 'LICENSE', 'CONTRIBUTING.md', 'AGENTS.md', '.gitignore', 'install.sh']) visit(name);
  return result;
}
export function checks(name, requested) {
  const out = path.resolve(requested ?? path.join(root, '.checks', name + '-' + randomUUID()));
  const reports = path.join(root, '.checks');
  if (out === root || out.startsWith(root + path.sep) && out !== reports && !out.startsWith(reports + path.sep)) throw Error('Reports must be under .checks/ or outside the source checkout');
  noSymlinks(out);
  if (fs.existsSync(out)) throw Error('Report directory already exists; choose a fresh --out path');
  fs.mkdirSync(path.dirname(out), {recursive: true}); fs.mkdirSync(out);
  const signal = new AbortController(), onInterrupt = () => signal.abort('SIGINT'), onTerminate = () => signal.abort('SIGTERM');
  process.once('SIGINT', onInterrupt); process.once('SIGTERM', onTerminate);
  const startedAt = new Date().toISOString(), inputs = inventory(), inputHash = hash(JSON.stringify(inputs)), commands = [];
  const write = (filename, value) => fs.writeFileSync(path.join(out, filename), JSON.stringify(value, null, 2) + '\n');
  write('inputs.json', inputs);
  async function run(label, command, args, {cwd = root, env = {...process.env, CI: '1', NO_COLOR: '1', EXPO_NO_TELEMETRY: '1', EXPO_OFFLINE: '1'}, timeoutMs = 60000, expected = 0} = {}) {
    const commandStartedAt = new Date().toISOString();
    const filename = String(commands.length + 1).padStart(2, '0') + '-' + label;
    console.error('Checking ' + label + '…');
    const environment = Object.fromEntries(['CI', 'NO_COLOR', 'EXPO_NO_TELEMETRY', 'EXPO_OFFLINE'].map(key => [key, env[key] ?? null]));
    write(filename + '.json', {command, args, cwd, environment, timeoutMs, expected, startedAt: commandStartedAt, status: 'running'});
    let record, failure;
    try { record = await runProcess(command, args, {cwd, env, timeoutMs, maxBytes: 16 * 1024 * 1024, signal: signal.signal}); }
    catch (e) { record = e.record ?? {command, args, code: null, signal: null, stdout: '', stderr: ''}; failure = e; }
    const passed = record.code === expected && record.signal === null && !signal.signal.aborted && (!failure || failure.message.startsWith('PROCESS_EXIT '));
    write(filename + '.json', {...record, cwd, environment, timeoutMs, expected, startedAt: commandStartedAt, node: process.version, platform: process.platform, arch: process.arch,
      timedOut: !!failure?.message.startsWith('DEADLINE:'), status: passed ? 'passed' : 'failed', error: failure?.message ?? null});
    fs.writeFileSync(path.join(out, filename + '.log'), record.stdout + record.stderr);
    commands.push({label, receipt: filename + '.json', passed});
    if (!passed) throw Error(label + ' failed; inspect ' + path.join(out, filename + '.log'));
    return record.stdout;
  }
  function finish(error, extra = {}) {
    let changed = false;
    try { changed = hash(JSON.stringify(inventory())) !== inputHash; } catch { changed = true; }
    error ??= changed ? Error('Source inputs changed during checks; results do not apply to the current source') : null;
    write('result.json', {status: error ? 'failed' : 'passed', startedAt, finishedAt: new Date().toISOString(), sourceRoot: root,
      node: process.version, executable: process.execPath, platform: process.platform, arch: process.arch, inputHash, sourceUnchanged: !changed, commands, error: error?.message ?? null, ...extra});
    process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onTerminate);
    if (error) { console.error(error.message); process.exitCode = signal.signal.reason === 'SIGINT' ? 130 : signal.signal.reason === 'SIGTERM' ? 143 : 1; }
    else console.error('Checks passed.');
    console.error('Reports: ' + out);
  }
  return {out, run, finish, signal: signal.signal};
}
