import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {projectStatus} from './project.mjs';
import {noSymlinks} from './installation.mjs';
import {directory, exists, readJson, atomicJson, withLock} from './state.mjs';
import {sha, digest, canonical} from './extractor-pipeline/contract.mjs';
import {createRequest, prepare, bundledArtifact, artifactHash, review, accept, refresh, environmentIdentity} from './extractor-pipeline/pipeline.mjs';
import {runProcess} from './runtime/process.mjs';

const SCHEMA = 'wayfinder-repository-graph/1';
const validator = fileURLToPath(new URL('./extractor-pipeline/validate-worker.mjs', import.meta.url));
const paths = root => ({folder: path.join(root, '.wayfinder'), local: path.join(root, '.wayfinder/local'), artifact: path.join(root, '.wayfinder/extractor/artifact.json'), graph: path.join(root, '.wayfinder/graph.json')});
function bindings(project, artifact, environment) {
  return {sourceFingerprint: project.provenance.sourceFingerprint, configuration: digest(project.config), routingInputs: project.provenance.inputHashes,
    extractor: artifactHash(artifact), generator: {dependencies: environment.dependencies, reference: environment.reference, pipeline: environment.pipeline, lifecycle: Object.fromEntries(['graph.mjs', 'project.mjs', 'project-profile.mjs', 'state.mjs'].map(name => [name, sha(fs.readFileSync(new URL(name, import.meta.url)))]))}};
}
// Init supplies an independently validated inventory before publishing any public project state.
export function prepareGraphPublication(project,artifact,inventory){
 const inputs=bindings(project,artifact,environmentIdentity());
 return {projectRoot:project.root,document:canonical({schema:SCHEMA,inputs,inventory})};
}
export function publishGraphPublication({projectRoot,document}){
 const graph=paths(projectRoot).graph;atomicJson(graph,document);
 return {schema:'wayfinder-graph-result/1',projectRoot,graph,ready:true,graphHash:digest(document),sourceFingerprint:document.inputs.sourceFingerprint,coverage:document.inventory.coverage,authorCalls:0,exitCode:0};
}
async function validateInventory(inventory, files, signal, compatibility) {
  const result = await runProcess(process.execPath, [validator], {input: JSON.stringify({files, compatibility, candidateOutput: JSON.stringify(inventory)}), timeoutMs: 5000, signal, maxBytes: 16 * 1024 * 1024, env: {PATH: path.dirname(process.execPath)}});
  return JSON.parse(result.stdout);
}
export async function checkGraph(project = process.cwd(), {signal} = {}) {
  const root = path.resolve(project), location = paths(root);
  try {
    const current = projectStatus(root), artifact = readJson(location.artifact, 1024 * 1024), saved = readJson(location.graph);
    if (saved.schema !== SCHEMA || Object.keys(saved).sort().join() !== 'inputs,inventory,schema') throw Error('Graph envelope schema is invalid');
    if (digest(saved.inputs) !== digest(bindings(current, artifact, environmentIdentity()))) throw Error('Graph is stale: source, routing, extractor or generator changed');
    const inventory = await validateInventory(saved.inventory, current.spec.source.files, signal, current.config);
    if (digest(inventory) !== digest(saved.inventory)) throw Error('Graph inventory is invalid');
    return {schema: 'wayfinder-graph-status/1', projectRoot: root, graph: location.graph, ready: true, sourceFingerprint: saved.inputs.sourceFingerprint, graphHash: digest(saved), coverage: inventory.coverage, authorCalls: 0, exitCode: 0};
  } catch (e) {
    if (signal?.aborted) throw Error('CANCELLED');
    return {schema: 'wayfinder-graph-status/1', projectRoot: root, graph: location.graph, ready: false, reason: e.record ? 'Graph validation failed; inspect the graph and run traverse graph refresh' : e.message, exitCode: 1};
  }
}
export async function refreshGraph({project = process.cwd(), accepted: acceptedFile, signal, onProgress = () => {}} = {}) {
  if (signal?.aborted) throw Error('CANCELLED');
  const initial = projectStatus(project), location = paths(initial.root);
  for (const file of Object.values(location)) noSymlinks(file);
  directory(location.local);
  return withLock(path.join(location.local, 'graph.lock'), async () => {
    const current = projectStatus(initial.root), request = createRequest(current.spec), builtin = bundledArtifact(request), environment = environmentIdentity();
    if (!exists(location.artifact)) {
      if(!builtin)throw Error("No adapter is pinned; run traverse init to generate and review it");
      const folder = path.dirname(location.artifact);
      if (exists(folder) && fs.readdirSync(folder).length) throw Error('Unowned extractor directory; preserve its files before setup');
      directory(folder); atomicJson(location.artifact, builtin);
    }
    const artifact = readJson(location.artifact, 1024 * 1024), hash = artifactHash(artifact), isBuiltin = !!builtin && hash === artifactHash(builtin);
    const expected = bindings(current, artifact, environment);
    const cache = path.join(location.local, 'acceptances', digest({artifact: hash, compatibility: request.compatibility, environment}) + '.json');
    let accepted;
    if (acceptedFile) {
      accepted = readJson(path.resolve(acceptedFile));
      if (accepted.artifactHash !== hash) throw Error('Explicit reviewed acceptance does not match the repo extractor');
    } else if (exists(cache)) accepted = readJson(cache);
    else if (!isBuiltin) throw Error('Extractor requires explicit reviewed acceptance: inspect/review/accept it, then use graph refresh --accepted ACCEPTED.json');
    const runDir = path.join(location.local, 'runs', randomUUID()); directory(runDir);
    prepare(current.spec, path.join(runDir, 'request'));
    try {
      onProgress('Generating graph from the current source snapshot');
      let inventory;
      if (!accepted) {
        // Only the exact package reference is trusted here. Changed repo code never takes this path.
        const approval = review(builtin, 'Traverse bundled reference ' + hash, 'I reviewed these bytes and trust host execution');
        accepted = await accept(request, builtin, approval, path.join(runDir, 'acceptance'), {signal});
        inventory = readJson(path.join(runDir, 'acceptance/graph.json'));
      } else inventory = await refresh(accepted, request, path.join(runDir, 'refresh'), {signal});
      if (signal?.aborted) throw Error('CANCELLED');
      const latest = projectStatus(current.root), latestArtifact = readJson(location.artifact, 1024 * 1024);
      if (digest(expected) !== digest(bindings(latest, latestArtifact, environmentIdentity()))) throw Error('Source or extractor changed during graph generation; previous graph preserved; retry refresh');
      const document = canonical({schema: SCHEMA, inputs: expected, inventory});
      directory(path.dirname(cache)); atomicJson(cache, accepted);
      atomicJson(location.graph, document);
      const result = {schema: 'wayfinder-graph-result/1', projectRoot: current.root, graph: location.graph, ready: true, graphHash: digest(document), sourceFingerprint: expected.sourceFingerprint, authorCalls: 0, coverage: inventory.coverage, exitCode: 0};
      atomicJson(path.join(runDir, 'result.json'), result); return result;
    } catch (e) { atomicJson(path.join(runDir, 'failure.json'), {error: e.message, cancelled: !!signal?.aborted, previousGraphPreserved: exists(location.graph)}); throw e; }
  });
}

export async function watchGraph({project = process.cwd(), signal, debounceMs = 150, onEvent = () => {}} = {}) {
  const root = path.resolve(project);
  const inspected=projectStatus(root),modern=inspected.config.profile==='expo-source-inventory/2';
  // Keep source subscriptions stable: adding child watches can restart native streams.
  const sourceRoots=modern?[...new Set([...inspected.provenance.includedDirectories,...Object.values(inspected.config.routing.config.aliases).map(values=>values[0].replace(/^\.\//,'').slice(0,-2)).filter(s=>s&&s!=='.')].map(s=>s.split('/')[0]))]:['app','components'];
  if (!Number.isInteger(debounceMs) || debounceMs < 1 || debounceMs > 10000) throw Error('Invalid watch debounce');
  if (signal?.aborted) return {schema: 'wayfinder-graph-watch/1', stopped: true};
  projectStatus(root);
  const cancellation = new AbortController(), combined = signal ? AbortSignal.any([signal, cancellation.signal]) : cancellation.signal;
  const inputNames = new Set([...sourceRoots.map(s=>s.split('/')[0]),'app', 'components', 'src', 'node_modules', 'package.json', 'package-lock.json', 'app.json', 'tsconfig.json', 'app.config.js', 'app.config.ts', 'app.config.mjs', 'app.config.cjs', 'metro.config.js', 'metro.config.cjs', 'metro.config.mjs', 'babel.config.js', 'babel.config.cjs']);
  const watchers = new Map(); let timer, busy = false, dirty = false, closed = false, failure;
  return new Promise((resolve, reject) => {
    function finish() { if (!busy && closed) { signal?.removeEventListener('abort', abort); if (failure) reject(failure); else resolve({schema: 'wayfinder-graph-watch/1', stopped: true}); } }
    function stop(error) { failure ??= error; closed = true; clearTimeout(timer); cancellation.abort(); for (const w of watchers.values()) w.close(); watchers.clear(); finish(); }
    function abort() { stop(); }
    function queue() { if (closed) return; dirty = true; clearTimeout(timer); timer = setTimeout(() => { void run(); }, debounceMs); }
    function syncWatchers() {
      const desired = new Map([[root, false]]);
      let changed = false;
      for (const name of [...sourceRoots, 'app', 'components', 'src', 'node_modules', 'node_modules/expo', 'node_modules/expo-router', '.wayfinder', '.wayfinder/extractor']) {
        const dir = path.join(root, name);
        try { noSymlinks(dir); if (exists(dir) && fs.statSync(dir).isDirectory()) desired.set(dir, sourceRoots.includes(name) || name === 'app' || name === 'components' || modern && name==='src'); } catch { /* refresh reports invalid inputs */ }
      }
      for (const [dir, watcher] of watchers) if (!desired.has(dir)) { watcher.close(); watchers.delete(dir); changed = true; }
      for (const [dir, recursive] of desired) if (!watchers.has(dir)) {
        try {
          const watcher = fs.watch(dir, {recursive}, (_event, filename) => {
            const name = filename?.toString();
            if (dir === root && name && !inputNames.has(name)) return;
            if (!modern && dir === path.join(root, 'src') && name && name !== 'app') return;
            if (dir === path.join(root, '.wayfinder') && name && name !== 'project.json' && name !== 'extractor') return;
            if (dir === path.join(root, 'node_modules') && name && !['expo', 'expo-router'].includes(name)) return;
            syncWatchers(); queue();
          });
          watcher.on('error', () => { watcher.close(); watchers.delete(dir); queue(); }); watchers.set(dir, watcher); changed = true;
        } catch { queue(); }
      }
      return changed;
    }
    async function run() {
      if (closed) return finish();
      if (busy) { dirty = true; return; }
      busy = true; dirty = false; let event;
      try { event = {...await refreshGraph({project: root, signal: combined}), schema: 'wayfinder-graph-watch-event/1', status: 'ready'}; }
      catch (e) { event = {schema: 'wayfinder-graph-watch-event/1', status: 'stale', ready: false, reason: e.message}; }
      try { if (!closed) await onEvent(event); }
      catch (e) { stop(e); }
      finally { busy = false; if (closed) finish(); else { if (syncWatchers() || dirty) queue(); } }
    }
    signal?.addEventListener('abort', abort, {once: true});
    syncWatchers(); void run();
  });
}
