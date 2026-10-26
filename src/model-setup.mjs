import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash, randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {noSymlinks} from './installation.mjs';
import {runProcess} from './runtime/process.mjs';
import {withOwnedOllama} from './runtime/ollama.mjs';
import {askChoice} from './driving/choice.mjs';
import {directory, exists, readJson, atomicJson, withLock} from './state.mjs';

export const MODEL_PINS = JSON.parse(fs.readFileSync(new URL('./model-pins.json', import.meta.url)));
export const DEFAULT_MODEL_CACHE = path.join(os.homedir(), '.cache/wayfinder');
const OWNER = 'wayfinder-model-cache/1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function fileHash(file) {
  const hash = createHash('sha256'); for await (const chunk of fs.createReadStream(file)) hash.update(chunk); return hash.digest('hex');
}
function manifestPath(models, model) {
  const match = /^tev1:([a-zA-Z0-9][a-zA-Z0-9._-]*)$/.exec(model.name);
  if (!match || !/^[a-f0-9]{64}$/.test(model.digest)) throw Error('Managed model must name an explicit tev1 tag and SHA-256 digest');
  return path.join(models, 'manifests-v2/ollama.com/library/tev1', match[1]);
}
function selection({pins = MODEL_PINS, platform = process.platform, arch = process.arch, cacheDir = DEFAULT_MODEL_CACHE} = {}) {
  const runtime = pins.runtimes[platform + '-' + arch];
  if (!runtime) throw Error(`Unsupported managed runtime platform: ${platform}/${arch}; no tested release pin`);
  const cache = path.resolve(cacheDir); noSymlinks(cache);
  manifestPath(path.join(cache, 'models'), pins.model);
  return {pins, runtime, cache, platform, arch};
}
async function modelFiles(models, model, deep) {
  const named = manifestPath(models, model), file = path.join(models, 'blobs', 'sha256-' + model.digest);
  noSymlinks(path.dirname(named)); noSymlinks(file);
  const reference = fs.lstatSync(named);
  if (reference.isSymbolicLink()) {
    if (path.resolve(path.dirname(named), fs.readlinkSync(named)) !== file) throw Error('Model reference must point to its pinned canonical blob in the owned store');
  } else {
    noSymlinks(named);
    if (!reference.isFile() || await fileHash(named) !== model.digest) throw Error('Model reference digest mismatch');
  }
  const data = readJson(file, 1024 * 1024);
  if (await fileHash(file) !== model.digest) throw Error('Model manifest digest mismatch');
  const descriptors = [data.config, ...data.layers];
  for (const d of descriptors) {
    if (!/^sha256:[a-f0-9]{64}$/.test(d?.digest) || !Number.isSafeInteger(d.size) || d.size < 1) throw Error('Invalid model blob descriptor');
    const blob = path.join(models, 'blobs', d.digest.replace(':', '-')); noSymlinks(blob);
    const s = fs.statSync(blob);
    if (!s.isFile() || s.size !== d.size || (deep && await fileHash(blob) !== d.digest.slice(7))) throw Error('Model blob checksum/size mismatch');
  }
  return {manifest: data, descriptors, canonical: file};
}
async function runtimeTree(root) {
  const files = {};
  async function walk(dir, depth = 0) {
    if (depth > 16) throw Error('Runtime directory depth');
    for (const item of fs.readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, item.name), name = path.relative(root, full);
      if (item.isSymbolicLink()) {
        if (!fs.realpathSync(full).startsWith(root + path.sep)) throw Error('Runtime link escapes owned archive');
        files[name] = {link: fs.readlinkSync(full)};
      } else if (item.isDirectory()) await walk(full, depth + 1);
      else if (item.isFile()) files[name] = {sha256: await fileHash(full)};
      else throw Error('Unsupported runtime archive entry');
    }
  }
  await walk(root); return files;
}
function owned(cache) {
  const owner = readJson(path.join(cache, 'owner.json'), 4096);
  if (owner.schema !== OWNER || typeof owner.id !== 'string') throw Error('Cache is not owned by Traverse');
  return owner;
}
export async function runtimeStatus(options = {}) {
  const s = selection(options), result = {schema: 'wayfinder-model-status/1', cacheDir: s.cache, model: s.pins.model, runtimeVersion: s.runtime.version, ready: false, contentVerified: false};
  if (!exists(s.cache)) return {...result, reason: 'Managed model is not installed; run traverse setup'};
  try {
    owned(s.cache);
    if (!exists(path.join(s.cache, 'installation.json'))) {
      const failureFile = path.join(s.cache, 'setup-failure.json');
      if (exists(failureFile)) {
        const failure = readJson(failureFile, 16384);
        if (failure.schema === 'wayfinder-setup-failure/1') return {...result, reason: `Setup did not finish during ${failure.stage}: ${failure.error}. Details: ${failure.runDirectory}`};
      }
      return {...result, reason: `Setup is incomplete; run traverse setup to retry. Previous attempt details: ${path.join(s.cache, 'runs')}`};
    }
    const metadata = readJson(path.join(s.cache, 'installation.json'), 1024 * 1024);
    if (metadata.schema !== 'wayfinder-managed-runtime/1' || metadata.state !== 'ready' || metadata.platform !== s.platform || metadata.arch !== s.arch || metadata.archiveSha256 !== s.runtime.archiveSha256 || metadata.model !== s.pins.model.name || metadata.modelDigest !== s.pins.model.digest) throw Error('Managed runtime pin/state mismatch');
    const runtime = path.join(s.cache, 'runtime'), binary = path.join(runtime, s.runtime.executable); noSymlinks(binary); fs.accessSync(binary, fs.constants.X_OK);
    if (await fileHash(binary) !== metadata.binarySha256) throw Error('Runtime binary checksum mismatch');
    if (options.deep && sha(JSON.stringify(await runtimeTree(runtime))) !== metadata.runtimeTreeSha256) throw Error('Runtime tree checksum mismatch');
    await modelFiles(path.join(s.cache, 'models'), s.pins.model, options.deep);
    return {...result, ready: true, contentVerified: !!options.deep, binary, models: path.join(s.cache, 'models')};
  } catch (e) { return {...result, reason: e.message}; }
}
async function download(url, destination, signal, onProgress) {
  const response = await fetch(url, {signal: AbortSignal.any([AbortSignal.timeout(600000), ...(signal ? [signal] : [])])});
  if (!response.ok || !response.body) throw Error('Runtime download failed: HTTP ' + response.status);
  const total = Number(response.headers.get('content-length')); let bytes = 0, last = 0;
  const source = Readable.fromWeb(response.body);
  source.on('data', chunk => { bytes += chunk.length; if (bytes > 512 * 1024 * 1024) source.destroy(Error('Runtime archive size limit')); if (Date.now() - last > 1500) { last = Date.now(); onProgress(`Downloading runtime: ${Math.round(bytes / 1048576)} MiB${total ? ' / ' + Math.round(total / 1048576) + ' MiB' : ''}`); } });
  await pipeline(source, fs.createWriteStream(destination, {flags: 'wx', mode: 0o600}), {signal});
}
export async function setupRuntime(options = {}) {
  const s = selection(options), {check = false, dryRun = false, runtimeArchive, modelsDir, onProgress = () => {}, signal} = options;
  if (check && dryRun) throw Error('Choose --check or --dry-run');
  if (signal?.aborted) throw Error('CANCELLED');
  if (check || dryRun) return {...await runtimeStatus(options), schema: 'wayfinder-setup/1', mode: check ? 'check' : 'dry-run', created: false};
  if (exists(s.cache)) {
    try { owned(s.cache); } catch { throw Error('Existing cache is not owned by Traverse; choose a new --cache-dir'); }
  } else {
    directory(s.cache); atomicJson(path.join(s.cache, 'owner.json'), {schema: OWNER, id: randomUUID()});
  }
  return withLock(path.join(s.cache, 'setup.lock'), async () => {
    const runDir = path.join(s.cache, 'runs', randomUUID()); directory(runDir);
    const archive = path.join(runDir, 'runtime.tgz');
    let stage = 'runtime download';
    try {
      if (exists(path.join(s.cache, 'installation.json'))) {
        stage = 'installation verification';
        const status = await runtimeStatus({...options, deep: true});
        if (!status.ready) throw Error(status.reason + '; preserve this cache and use a fresh --cache-dir');
        stage = 'decision check';
        onProgress('Checking the installed tev1 decision endpoint');
        await checkReadyModel(status, runDir, signal);
        return {...status, schema: 'wayfinder-setup/1', mode: 'setup', created: false, decisionReady: true};
      }
      onProgress('Preparing pinned Ollama ' + s.runtime.version);
      if (runtimeArchive) { noSymlinks(path.resolve(runtimeArchive)); fs.copyFileSync(runtimeArchive, archive, fs.constants.COPYFILE_EXCL); }
      else await download(s.runtime.url, archive, signal, onProgress);
      stage = 'runtime verification';
      if (await fileHash(archive) !== s.runtime.archiveSha256) throw Error('Runtime archive checksum mismatch');
      const listing = await runProcess('tar', ['-tzf', archive], {timeoutMs: 30000, signal});
      if (listing.stdout.split('\n').filter(Boolean).some(name => path.isAbsolute(name) || name.split('/').includes('..'))) throw Error('Unsafe runtime archive path');
      const stagedRuntime = path.join(runDir, 'runtime'); directory(stagedRuntime);
      await runProcess('tar', ['-xzf', archive, '-C', stagedRuntime], {timeoutMs: 30000, signal});
      const tree = await runtimeTree(stagedRuntime), binary = path.join(stagedRuntime, s.runtime.executable); noSymlinks(binary);
      const runtimeHome = path.join(s.cache, 'runtime-home'); directory(runtimeHome);
      const version = await runProcess(binary, ['--version'], {cwd: stagedRuntime, timeoutMs: 10000, signal, env: {PATH: path.dirname(process.execPath), HOME: runtimeHome, OLLAMA_HOST: '127.0.0.1:1'}});
      if (!(version.stdout + version.stderr).includes(s.runtime.version)) throw Error('Runtime version mismatch');
      const models = path.join(runDir, 'models'); directory(models);
      stage = 'model import';
      if (modelsDir) {
        onProgress('Importing explicitly selected model assets');
        const source = path.resolve(modelsDir); noSymlinks(source);
        const {descriptors, canonical} = await modelFiles(source, s.pins.model, true);
        directory(path.dirname(manifestPath(models, s.pins.model))); directory(path.join(models, 'blobs'));
        const destination = path.join(models, 'blobs', path.basename(canonical));
        fs.copyFileSync(canonical, destination, fs.constants.COPYFILE_EXCL);
        fs.copyFileSync(canonical, manifestPath(models, s.pins.model), fs.constants.COPYFILE_EXCL);
        for (const d of new Map(descriptors.map(d => [d.digest, d])).values()) fs.copyFileSync(path.join(source, 'blobs', d.digest.replace(':', '-')), path.join(models, 'blobs', d.digest.replace(':', '-')), fs.constants.COPYFILE_EXCL);
      }
      stage = 'runtime startup';
      await withOwnedOllama({binary, models, directory: path.join(runDir, 'server'), runtimeHome, version: s.runtime.version, signal}, async ({baseUrl, env, signal: operationSignal}) => {
        if (!modelsDir) {
          stage = 'model download';
          onProgress(`Downloading pinned ${s.pins.model.name} model; this is a one-time multi-GB download`);
          const pull = await runProcess(binary, ['pull', s.pins.model.name], {cwd: stagedRuntime, env, signal: operationSignal, timeoutMs: 1800000, maxBytes: 8 * 1024 * 1024});
          atomicJson(path.join(runDir, 'pull.json'), pull);
        }
        stage = 'model verification';
        onProgress('Verifying model manifest and blob checksums');
        await modelFiles(models, s.pins.model, true);
        stage = 'decision check';
        onProgress('Checking tev1 with a real choice request');
        await decisionProbe({baseUrl, model: s.pins.model.name, signal: operationSignal, runDir});
      });
      stage = 'installation publication';
      for (const name of ['runtime', 'models']) if (exists(path.join(s.cache, name))) throw Error('Conflicting partial cache; preserve it and select a fresh --cache-dir');
      fs.renameSync(stagedRuntime, path.join(s.cache, 'runtime')); fs.renameSync(models, path.join(s.cache, 'models'));
      atomicJson(path.join(s.cache, 'installation.json'), {schema: 'wayfinder-managed-runtime/1', state: 'ready', platform: s.platform, arch: s.arch, runtimeVersion: s.runtime.version, archiveSha256: s.runtime.archiveSha256, binarySha256: await fileHash(path.join(s.cache, 'runtime', s.runtime.executable)), runtimeTreeSha256: sha(JSON.stringify(tree)), model: s.pins.model.name, modelDigest: s.pins.model.digest, decisionVerified: true});
      return {...await runtimeStatus(options), schema: 'wayfinder-setup/1', mode: 'setup', created: true, contentVerified: true, decisionReady: true};
    } catch (e) {
      if (e.record) atomicJson(path.join(runDir, 'failed-process.json'), e.record);
      const error = (e.record?.stderr || e.message).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').trim().slice(-2000);
      const failure = {schema: 'wayfinder-setup-failure/1', stage, error, runDirectory: runDir, cancelled: !!signal?.aborted};
      atomicJson(path.join(runDir, 'failure.json'), failure);
      atomicJson(path.join(s.cache, 'setup-failure.json'), failure);
      throw Error(signal?.aborted ? 'CANCELLED' : `Setup failed during ${stage}: ${error}. Details: ${runDir}`, {cause: e});
    }
  });
}
async function decisionProbe({baseUrl, model, signal, runDir}) {
  const result = await askChoice({baseUrl, model, signal, state: 'The correct answer is ready.', instructions: 'Select ready.', options: [{id: 'ready', description: 'The answer is ready.'}, {id: 'unavailable', description: 'The answer is unavailable.'}], keepAlive: 0});
  if (result.choice !== 'ready' || !Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1 || ['ready', 'unavailable'].some(key => !Number.isFinite(result.probabilities[key]) || result.probabilities[key] < 0 || result.probabilities[key] > 1) || Math.abs(result.probabilities.ready + result.probabilities.unavailable - 1) > 0.001) throw Error('Managed decision endpoint smoke check failed');
  atomicJson(path.join(runDir, 'choice.json'), result.raw);
}
async function checkReadyModel(status, runDir, signal) {
  await withOwnedOllama({binary: status.binary, models: status.models, directory: path.join(runDir, 'server'), runtimeHome: path.join(status.cacheDir, 'runtime-home'), version: status.runtimeVersion, signal}, async ({baseUrl, signal: operationSignal}) => {
    await decisionProbe({baseUrl, model: status.model.name, signal: operationSignal, runDir});
  });
}
export async function checkModel(options = {}) {
  const status = await runtimeStatus({...options, deep: true});
  if (!status.ready) return {...status, decisionReady: false};
  const runDir = path.join(status.cacheDir, 'runs', randomUUID()); directory(runDir);
  await checkReadyModel(status, runDir, options.signal);
  return {...status, decisionReady: true};
}
