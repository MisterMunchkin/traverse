import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID, createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {runProcess} from './runtime/process.mjs';
import {root, environmentIdentity} from './extractor-pipeline/pipeline.mjs';

const OWNER = 'wayfinder-checkout-install/1';
export const DEFAULT_PREFIX = path.join(os.homedir(), '.local/share/traverse');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (error) { if (error instanceof SyntaxError) throw Error('Malformed JSON file; inspect it locally'); throw error; } };
const write = (p, data) => fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', {flag: 'wx', mode: 0o600});
const ensure = (condition, message) => { if (!condition) throw Error(message); };
const exists = p => { try { fs.lstatSync(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const plain = x => x && typeof x === 'object' && !Array.isArray(x);
function shape(x, keys, label) { ensure(plain(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k)), `${label}: malformed fields`); }
export function noSymlinks(destination, {label = 'destination'} = {}) {
  const absolute = path.resolve(destination), parts = absolute.split(path.sep).filter(Boolean);
  let p = path.parse(absolute).root;
  for (const part of parts) { p = path.join(p, part); if (exists(p)) ensure(!fs.lstatSync(p).isSymbolicLink(), `Symlink ${label} refused; choose a canonical owned path`); }
}
const absolute = p => typeof p === 'string' && path.isAbsolute(p) && !p.includes('\0');
function executable(p) { ensure(absolute(p), 'Executable requires an absolute path'); fs.accessSync(p, fs.constants.X_OK); ensure(fs.statSync(p).isFile(), 'Executable is not a file'); }
function findExecutable(name) {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) { const p = path.resolve(dir, name); try { executable(p); return p; } catch {} }
  throw Error(`${name} not found; supply its explicit path`);
}
function nodeRequirements() { return ['package.json'].map(p => read(path.join(root, p)).engines.node); }
function checkNode() {
  const version = process.versions.node.split('.').map(Number);
  for (const engine of nodeRequirements()) {
    const m = /^>=(\d+)\.(\d+)(?:\.(\d+))?$/.exec(engine); ensure(m, 'Unsupported declared Node engine; update installer explicitly');
    const min = m.slice(1).map(n => Number(n ?? 0));
    ensure(version[0] > min[0] || version[0] === min[0] && (version[1] > min[1] || version[1] === min[1] && version[2] >= min[2]), `Node ${process.versions.node} is incompatible; required ${engine}`);
  }
  return {observed: process.versions.node, required: nodeRequirements(), executable: process.execPath};
}
function configuredProject(p) {
  ensure(p === null || absolute(p), 'Project must be an explicit absolute checkout path or null');
  if (p !== null) ensure(fs.statSync(p).isDirectory() && exists(path.join(p, '.git')), 'Configured project is not an available checkout');
}
function validateConfig(config) {
  shape(config, ['schema', 'project', 'tools'], 'config'); ensure(config.schema === 'wayfinder-config/1', 'Unsupported config schema');
  configuredProject(config.project);
  shape(config.tools, ['agentDevice', 'ollama', 'frontier', 'models'], 'optional tools');
  for (const value of Object.values(config.tools)) ensure(value === null || absolute(value), 'Optional tool paths must be absolute paths or null');
  return config;
}
const ownSources = ['install.sh', 'bin/install.mjs', 'bin/traverse.mjs', 'bin/extractor-pipeline.mjs', 'bin/setup.mjs', 'bin/init.mjs', 'src/project-profile.mjs','src/adapter-init.mjs','src/project-defaults.mjs', 'src/agent-integration.mjs', 'src/skills/traverse.md', 'bin/graph.mjs', 'bin/driving.mjs', 'src/installation.mjs', 'src/project.mjs', 'src/presentation.mjs', 'src/state.mjs', 'src/graph.mjs', 'src/model-setup.mjs', 'src/model-pins.json', 'src/runtime/ollama.mjs', 'src/settings.mjs', 'src/setup-wizard.mjs', 'src/frontier/provider.mjs', 'src/frontier/codex-worker.mjs', 'src/frontier/config.mjs', 'src/frontier/models.mjs', 'package.json', ...['contract', 'agent-device', 'sessions', 'choice', 'policy', 'loop'].map(name => 'src/driving/' + name + '.mjs')];
function sourceIdentity() {
  const environment = environmentIdentity();
  return {sources: Object.fromEntries(ownSources.map(p => [p, sha(fs.readFileSync(path.join(root, p)))])), reference: environment.reference, pipeline: environment.pipeline, dependencies: environment.dependencies};
}
function parserStatus() {
  const declared = read(path.join(root, 'package.json')).dependencies.typescript;
  const lock = read(path.join(root, 'npm-shrinkwrap.json'));
  const locked = lock.packages['node_modules/typescript'].version;
  ensure(declared === locked, 'Parser manifest/lock version mismatch');
  // Match extraction's normal package resolution, including npm's hoisted layout.
  const require = createRequire(new URL('../package.json', import.meta.url));
  let observed = null; try { observed = read(require.resolve('typescript/package.json')).version; } catch {}
  return {required: declared, observed, ready: observed === declared};
}
const shellQuote = s => "'" + s.replaceAll("'", "'\"'\"'") + "'";
function launcher(prefix, node) {
  return `#!/bin/sh\n# Owned by ${OWNER}; configured paths are literal data.\nset -eu\nnode=${shellQuote(node)}\ncli=${shellQuote(path.join(root, 'bin/traverse.mjs'))}\nextractor=${shellQuote(path.join(root, 'bin/extractor-pipeline.mjs'))}\nprefix=${shellQuote(prefix)}\nif [ ! -x "$node" ] || [ ! -f "$cli" ]; then\n  json=false\n  for argument do if [ "$argument" = --json ]; then json=true; fi; done\n  if [ "$json" = true ]; then\n    printf '%s\\n' '{"schema":"wayfinder-doctor/2","readiness":{"extractor":false,"configuration":false},"checks":[{"name":"launcher-runtime","status":"fail","severity":"required","evidence":"Configured Node or checkout CLI is missing","remediation":"Restore the recorded checkout/Node or install into a fresh prefix"}],"exitCode":1}'\n  else printf '%s\\n' 'Traverse: configured Node or source CLI missing; restore it or use a fresh installation.' >&2; fi\n  exit 1\nfi\nif [ "\${1-}" = extractor ]; then\n  shift\n  "$node" "$cli" --installation "$prefix" extractor-preflight\n  exec "$node" "$extractor" "$@"\nfi\nexec "$node" "$cli" --installation "$prefix" "$@"\n`;
}
function metadata(prefix) {
  noSymlinks(prefix);
  for (const p of ['installation.json', 'config.json', 'bin', 'bin/traverse', 'logs', 'npm-cache', 'npmrc', 'npm-globalrc']) noSymlinks(path.join(prefix, p));
  const m = read(path.join(prefix, 'installation.json'));
  shape(m, ['schema', 'id', 'prefix', 'sourceRoot', 'node', 'nodeVersion', 'state', 'sourceIdentity', 'launcherSha256'], 'installation metadata');
  ensure(m.schema === OWNER && /^[0-9a-f-]{36}$/.test(m.id), 'Unowned installation prefix');
  ensure(m.prefix === prefix && m.sourceRoot === root && absolute(m.node), 'Installation belongs to another prefix/checkout');
  ensure(['preparing', 'ready'].includes(m.state), 'Invalid installation state');
  const lp = path.join(prefix, 'bin/traverse');
  if (exists(lp)) ensure(m.launcherSha256 && sha(fs.readFileSync(lp)) === m.launcherSha256, 'Conflicting/unowned launcher; refusing overwrite');
  return m;
}
function replaceOwnedMetadata(prefix, m) {
  const p = path.join(prefix, 'installation.json'); noSymlinks(p);
  const temporary = path.join(prefix, '.installation-' + randomUUID() + '.json'); write(temporary, m); fs.renameSync(temporary, p);
}
function installOptions(options) {
  checkNode();
  const prefix = path.resolve(options.prefix ?? DEFAULT_PREFIX); noSymlinks(prefix);
  if (options.node) { ensure(absolute(options.node), '--node requires an absolute path'); executable(options.node); ensure(fs.realpathSync(options.node) === fs.realpathSync(process.execPath), 'Selected Node is not the executing Node; invoke install.sh with --node'); }
  if (options.project !== undefined) configuredProject(options.project);
  const timeoutMs = Number(options.timeoutMs ?? 120000); ensure(Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 120000, 'Setup timeout must be 1..120000ms');
  return {prefix, timeoutMs};
}
export async function install(options = {}) {
  const step = options.onProgress ?? (() => {});
  step('Checking Node and installation');
  const {prefix, timeoutMs} = installOptions(options), current = exists(prefix) ? metadata(prefix) : null;
  const configPath = path.join(prefix, 'config.json'), launcherPath = path.join(prefix, 'bin/traverse');
  let config = {schema: 'wayfinder-config/1', project: options.project ?? null, tools: {agentDevice: null, ollama: null, frontier: null, models: null}};
  if (current) {
    ensure(current.node === process.execPath && current.nodeVersion === process.versions.node, 'Installation Node changed; use the recorded Node or a fresh prefix');
    if (exists(configPath)) config = validateConfig(read(configPath));
    else ensure(current.state === 'preparing', 'Ready installation config is missing');
    if (options.project !== undefined) ensure(config.project === options.project, 'Existing project configuration differs; edit owned config explicitly');
  }
  const parser = parserStatus();
  if (current?.state === 'ready') {
    ensure(JSON.stringify(current.sourceIdentity) === JSON.stringify(sourceIdentity()), 'Installation source/dependencies changed; inspect and use a fresh prefix');
    ensure(exists(launcherPath), 'Ready installation launcher is missing; inspect and use a fresh prefix');
  }
  const plan = {schema: 'wayfinder-install-result/2', mode: options.check ? 'check' : options.dryRun ? 'dry-run' : 'install', prefix, sourceRoot: root, node: checkNode(), parser, changes: current?.state === 'ready' ? [] : ['owned metadata/config/launcher', ...(parser.ready ? [] : ['locked parser dependency setup'])]};
  if (options.check || options.dryRun) return {...plan, ready: !!current && current.state === 'ready' && parser.ready, exitCode: options.check && (!current || current.state !== 'ready' || !parser.ready) ? 1 : 0};
  if (current?.state === 'ready') return {...plan, ready: true, created: [], exitCode: 0};
  step('Preparing installation folder');
  let m = current;
  if (!m) {
    fs.mkdirSync(prefix, {recursive: true, mode: 0o700});
    m = {schema: OWNER, id: randomUUID(), prefix, sourceRoot: root, node: process.execPath, nodeVersion: process.versions.node, state: 'preparing', sourceIdentity: null, launcherSha256: null};
    write(path.join(prefix, 'installation.json'), m);
  }
  if (!parser.ready) {
    step('Installing the locked TypeScript parser');
    const packageDir = root; noSymlinks(packageDir); noSymlinks(path.join(packageDir, 'node_modules'));
    const npm = options.npm ?? findExecutable('npm'); executable(npm);
    fs.mkdirSync(path.join(prefix, 'logs'), {recursive: true});
    for (const name of ['npmrc', 'npm-globalrc']) if (!exists(path.join(prefix, name))) fs.writeFileSync(path.join(prefix, name), '', {flag: 'wx', mode: 0o600});
    const args = ['ci', '--prefix', packageDir, '--ignore-scripts', '--no-audit', '--no-fund', '--cache', path.join(prefix, 'npm-cache'), '--userconfig', path.join(prefix, 'npmrc'), '--globalconfig', path.join(prefix, 'npm-globalrc')];
    const log = path.join(prefix, 'logs', 'npm-' + randomUUID() + '.json'); let record;
    try { record = await runProcess(npm, args, {cwd: packageDir, timeoutMs, maxBytes: 2 * 1024 * 1024, env: {PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH ?? '')}}); }
    catch (e) { record = {...e.record, error: e.message}; }
    write(log, {...record, command: npm, args, timeoutMs, timedOut: record.error?.startsWith('DEADLINE:') ?? false});
    ensure(!record.error && record.code === 0, 'Parser dependency setup failed; inspect owned prefix logs and retry with a working explicit npm path');
    ensure(parserStatus().ready, 'Dependency setup did not provide the locked parser; inspect owned prefix logs');
  }
  step('Verifying source and parser');
  const identity = sourceIdentity();
  fs.mkdirSync(path.join(prefix, 'bin'), {recursive: true, mode: 0o700});
  if (!exists(configPath)) write(configPath, config);
  step('Creating the Traverse command');
  const content = launcher(prefix, process.execPath);
  if (exists(launcherPath)) ensure(sha(fs.readFileSync(launcherPath)) === sha(content), 'Conflicting launcher');
  else fs.writeFileSync(launcherPath, content, {flag: 'wx', mode: 0o755});
  m = {...m, state: 'ready', sourceIdentity: identity, launcherSha256: sha(content)}; replaceOwnedMetadata(prefix, m);
  return {...plan, parser: parserStatus(), ready: true, created: [launcherPath, configPath, path.join(prefix, 'installation.json')], exitCode: 0};
}
export function finalizeDoctor(report) {
  const configuration = report.checks.every(c => c.severity !== 'required' || c.status === 'pass');
  return {...report, readiness: {...report.readiness, configuration}, exitCode: configuration ? 0 : 1};
}

export async function doctor(prefix) {
  const checks = [], add = (name, status, severity, evidence, remediation = null) => checks.push({name, status, severity, evidence, remediation});
  let m, config, nodeOK = false, sourceOK = false, parserOK = false;
  try { prefix = path.resolve(prefix); m = metadata(prefix); ensure(m.state === 'ready', 'Installation setup is incomplete'); add('installation-metadata', 'pass', 'required', {state: m.state, sourceRoot: m.sourceRoot, prefix}); }
  catch { add('installation-metadata', 'fail', 'required', 'Missing, malformed, conflicting or incomplete owned installation', 'Inspect installation.json and use a fresh owned prefix if ownership cannot be verified'); }
  if (m) {
    try { config = validateConfig(read(path.join(prefix, 'config.json'))); add('config', 'pass', 'required', {projectConfigured: config.project !== null}); }
    catch { add('config', 'fail', 'required', 'Configuration is missing, malformed or its explicit project is unavailable', 'Repair config.json using the documented schema; its bytes are never overwritten on rerun'); }
    try { const evidence = checkNode(); ensure(m.node === process.execPath && m.nodeVersion === process.versions.node, 'Node changed'); nodeOK = true; add('node-version', 'pass', 'required', evidence); }
    catch { add('node-version', 'fail', 'required', 'Node selection/version no longer matches supported installation', 'Restore the recorded supported Node or install into a fresh prefix'); }
    try { const parser = parserStatus(); ensure(parser.ready, 'parser missing'); parserOK = true; add('parser-version', 'pass', 'required', parser); }
    catch { add('parser-version', 'fail', 'required', 'Locked TypeScript dependency is missing or incompatible', 'Restore dependencies with the recorded checkout lockfile through an explicit install'); }
    try { ensure(JSON.stringify(m.sourceIdentity) === JSON.stringify(sourceIdentity()), 'Source changed'); sourceOK = true; add('source-integrity', 'pass', 'required', {pinnedFilesMatched: true}); }
    catch { add('source-integrity', 'fail', 'required', 'Checkout executable bytes or parser dependency identity changed', 'Inspect changes, then use a fresh prefix to acknowledge the new source version'); }
  }
  if (m && config && nodeOK && sourceOK && parserOK) {

    try { const r = await extractorSmoke(); add('extractor-smoke', 'pass', 'required', {...JSON.parse(r.stdout), code: r.code, signal: r.signal, elapsedMs: r.elapsedMs, timeoutMs: 5000}); }
    catch (e) { add('extractor-smoke', 'fail', 'required', {code: e.record?.code ?? null, signal: e.record?.signal ?? null, timedOut: e.message.startsWith('DEADLINE:')}, 'Repair the pinned source/parser; inspect the offline extraction failure before driving'); }
  } else add('extractor-smoke', 'fail', 'required', 'Not run because required preflight failed', 'Resolve required checks first');
  const extractor = checks.every(c => c.severity !== 'required' || c.status === 'pass');
  for (const name of ['agentDevice', 'ollama', 'frontier', 'models']) {
    const p = config?.tools?.[name];
    if (!p) continue;
    let available = false;
    try { available = name === 'models' ? fs.statSync(p).isDirectory() : (fs.accessSync(p, fs.constants.X_OK), fs.statSync(p).isFile()); } catch {}
    add('optional-' + name, available ? 'pass' : 'fail', 'required', {configured: true, pathAvailable: available, versionObserved: null, executed: false}, available ? null : 'Restore the explicitly configured path or clear the unused tool entry in config.json');
  }
  return finalizeDoctor({schema: 'wayfinder-doctor/2', readiness: {extractor}, checks});
}
export {doctorText} from './presentation.mjs';

async function extractorSmoke() {
  const script = `import assert from 'node:assert/strict';import {extractNavigationSource} from ${JSON.stringify(new URL('./source/navigation.mjs', import.meta.url).href)};const g=extractNavigationSource({'app/index.tsx':"import {router} from 'expo-router';export default()=> <Button onPress={()=>router.push('/next')}/>",'app/next.tsx':'export default()=>null'});assert.equal(g.schema,'traverse-navigation');assert.equal(g.schemaVersion,1);assert.equal(g.nodes.length,2);assert.equal(g.edges.length,1);assert.equal(g.edges[0].from,'/');assert.equal(g.edges[0].to,'/next');console.log(JSON.stringify({schema:g.schema,schemaVersion:g.schemaVersion,routes:g.nodes.length,edges:g.edges.length,sourceFingerprint:g.sourceFingerprint}));`;
  return runProcess(process.execPath, ['--input-type=module', '-e', script], {cwd: root, timeoutMs: 5000, maxBytes: 65536, env: {PATH: path.dirname(process.execPath)}});
}

export async function runtimeDoctor() {
  const checks = [];
  async function check(name, action) {
    try { checks.push({name,status:"pass",severity:"required",evidence:await action(),remediation:null}); }
    catch { checks.push({name,status:"fail",severity:"required",evidence:"Required runtime check failed",remediation:"Restore the supported Node and locked package dependencies; reinstall the archive if needed"}); }
  }
  await check("node-version",checkNode);
  await check("parser-version",()=>{const p=parserStatus();ensure(p.ready,"Locked parser missing");return p;});
  await check("package-source",()=>{const e=environmentIdentity();return {sourceIdentityAvailable:true,typescript:e.dependencies.typescript.version};});
  await check("extractor-smoke",async()=>{const r=await extractorSmoke();return {...JSON.parse(r.stdout),code:r.code,signal:r.signal};});
  const extractor=checks.every(c=>c.severity!=="required"||c.status==="pass");
  return finalizeDoctor({schema:"wayfinder-doctor/2",readiness:{extractor},checks});
}
