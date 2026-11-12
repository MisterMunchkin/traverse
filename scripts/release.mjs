// Repository-only distribution tooling. Never publishes or installs a package.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {noSymlinks} from '../src/installation.mjs';
import {runProcess} from '../src/runtime/process.mjs';

export const root = fs.realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const blocked = new Set(['node_modules', '.next', '.wayfinder', '.checks', '.netlify', '.agentic', '.git', 'website']);
function git(args) {
  const result = spawnSync('git', args, {cwd: root, encoding: 'utf8', timeout: 10000});
  return result.status === 0 ? result.stdout.trim() : null;
}
export function freshOutput(requested) {
  const out = path.resolve(requested);
  if (out === root || out.startsWith(root + path.sep) && !out.startsWith(path.join(root, '.checks') + path.sep))
    throw Error('Output must be under .checks/ or outside the source checkout');
  noSymlinks(out);
  if (fs.existsSync(out)) throw Error('Output already exists; choose a fresh directory');
  return out;
}
export function verifyRelease(directory) {
  noSymlinks(path.resolve(directory));
  for (const file of ['release.json', 'SHA256SUMS']) {
    noSymlinks(path.join(directory, file));
    if (!fs.statSync(path.join(directory, file)).isFile()) throw Error('Release input must be a regular file: ' + file);
  }
  const release = read(path.join(directory, 'release.json'));
  const manifest = read(path.join(root, 'package.json'));
  if (release.schema !== 'traverse-release/1' || release.name !== manifest.name || release.version !== manifest.version ||
      release.filename !== `mistermunchkin-traverse-${manifest.version}.tgz` || !['candidate', 'release'].includes(release.kind))
    throw Error('Release metadata does not match this package');
  const archive = path.join(directory, release.filename);
  noSymlinks(archive);
  if (!fs.statSync(archive).isFile()) throw Error('Release archive must be a regular file');
  const bytes = fs.readFileSync(archive);
  if (release.sha256 !== digest(bytes) || release.bytes !== bytes.length ||
      fs.readFileSync(path.join(directory, 'SHA256SUMS'), 'utf8') !== `${release.sha256}  ${release.filename}\n`)
    throw Error('Release archive checksum/integrity mismatch');
  return release;
}
export async function packRelease({out: requested, tag, signal} = {}) {
  const manifest = read(path.join(root, 'package.json'));
  if (manifest.name !== '@mistermunchkin/traverse' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version))
    throw Error('Unexpected package identity/version');
  if (tag !== undefined && tag !== `v${manifest.version}`) throw Error('Release tag must match package version: v' + manifest.version);
  const commit = git(['rev-parse', 'HEAD']);
  const status = git(['status', '--porcelain', '--untracked-files=normal']);
  const dirty = status === null ? null : status !== '';
  if (tag && (!commit || dirty !== false || git(['rev-parse', `refs/tags/${tag}^{commit}`]) !== commit))
    throw Error('Tagged release requires a clean checkout of the exact release tag');
  const out = freshOutput(requested ?? path.join(root, '.checks/release', manifest.version));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'traverse-pack-'));
  try {
    for (const file of ['user.npmrc', 'global.npmrc']) fs.writeFileSync(path.join(scratch, file), '');
    const npm = process.env.npm_execpath;
    const command = npm && path.isAbsolute(npm) ? process.execPath : 'npm';
    const args = [...(command === process.execPath ? [npm] : []), 'pack', '--ignore-scripts', '--json', '--pack-destination', scratch];
    const env = {PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH ?? ''), HOME: scratch,
      TMPDIR: scratch, CI: '1', NO_COLOR: '1', npm_config_userconfig: path.join(scratch, 'user.npmrc'), npm_config_globalconfig: path.join(scratch, 'global.npmrc'),
      npm_config_cache: path.join(scratch, 'cache'), npm_config_offline: 'true', npm_config_update_notifier: 'false'};
    const packed = await runProcess(command, args, {cwd: root, env, timeoutMs: 60000, maxBytes: 8 * 1024 * 1024, signal});
    const records = JSON.parse(packed.stdout);
    if (records.length !== 1 || records[0].name !== manifest.name || records[0].version !== manifest.version) throw Error('Unexpected npm pack identity');
    const record = records[0], filename = `mistermunchkin-traverse-${manifest.version}.tgz`;
    if (record.filename !== filename) throw Error('Unexpected archive filename');
    const files = record.files.map(({path: relative}) => {
      if (path.isAbsolute(relative) || relative.split('/').some(part => part === '..' || blocked.has(part)))
        throw Error('Private/generated path in release archive: ' + relative);
      noSymlinks(path.join(root, relative));
      return {path: relative, sha256: digest(fs.readFileSync(path.join(root, relative)))};
    });
    for (const required of ['LICENSE', 'README.md', 'docs/security.md', 'src/source/navigation.mjs', 'npm-shrinkwrap.json'])
      if (!files.some(file => file.path === required)) throw Error('Missing release file: ' + required);
    const archive = fs.readFileSync(path.join(scratch, filename));
    const release = {schema: 'traverse-release/1', name: manifest.name, version: manifest.version,
      kind: tag ? 'release' : 'candidate', tag: tag ?? null, commit, dirty, filename,
      sha256: digest(archive), bytes: archive.length, files};
    fs.mkdirSync(out, {recursive: true});
    fs.writeFileSync(path.join(out, filename), archive);
    fs.writeFileSync(path.join(out, 'SHA256SUMS'), `${release.sha256}  ${filename}\n`);
    fs.writeFileSync(path.join(out, 'release.json'), JSON.stringify(release, null, 2) + '\n');
    return release;
  } finally { fs.rmSync(scratch, {recursive: true, force: true}); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const interrupt = () => controller.abort('SIGINT'), terminate = () => controller.abort('SIGTERM');
  process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
  try {
    const {values, positionals} = parseArgs({options: {out: {type: 'string'}, tag: {type: 'string'}}, allowPositionals: true});
    if (positionals.length !== 1 || !['pack', 'verify'].includes(positionals[0])) throw Error('Usage: node scripts/release.mjs pack|verify --out DIRECTORY [--tag vVERSION]');
    const release = positionals[0] === 'pack' ? await packRelease({...values, signal: controller.signal}) : verifyRelease(values.out ?? path.join(root, '.checks/release', read(path.join(root, 'package.json')).version));
    console.log(JSON.stringify(release));
  } catch (error) { console.error(error.message); process.exitCode = controller.signal.reason === 'SIGINT' ? 130 : controller.signal.reason === 'SIGTERM' ? 143 : 1; }
  finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); }
}
