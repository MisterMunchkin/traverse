import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {runProcess} from '../runtime/process.mjs';
import {CONTRACT, json, digest, sha, object, text, relative, compatibility, sourceFingerprint} from './contract.mjs';
import {conformanceCases,conformanceFacts,extractionOptions} from './profiles.mjs';

export const root = fileURLToPath(new URL('../../', import.meta.url));
const here = fileURLToPath(new URL('.', import.meta.url));
export const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
export const write = (filename, value) => fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
function fresh(directory) { fs.mkdirSync(directory, {recursive: false}); }
function exact(value, expected, reason) { assert.equal(digest(value), digest(expected), reason); }
function authoringRequirements(compatible) {
  const validatorSource = fs.readFileSync(path.join(here, 'contract.mjs'), 'utf8');
  return {graphContract: {schema: CONTRACT, validatorSource, validatorSha256: sha(validatorSource)}, artifactTemplate: artifactFor(compatible), invocation: 'Node ESM entrypoint receives snapshot file-map JSON on stdin and writes cv-navigation/1 JSON on stdout. EXTRACTOR_REFERENCE_URL exports extractNavigationSource(files, {routeRoot, aliases}); use the exact compatibility routing facts in the template. Only Node builtins and this pinned reference are supported dependencies. No install/network/config evaluation is needed.', output: CONTRACT, coverage: 'partial-static-source', entrypoint: 'Node ESM; snapshot JSON on stdin; inventory JSON on stdout', trust: 'Returned code is not executed until exact-hash host review', forbidden: ['runtime visibility claims', 'business effect claims', 'editing pipeline contract or conformance'], supportedDependencies: {reference: CONTRACT, typescript: '6.0.3'}};
}
export function createRequest(spec) {
  const compatible = compatibility(spec);
  const request = {schema: 'extractor-request/1', compatibility: compatible, source: spec.source, sourceFingerprint: sourceFingerprint(spec.source.files), requirements: authoringRequirements(compatible)};
  return {...request, requestHash: digest(request)};
}
export function prepare(spec, directory) {
  directory = path.resolve(directory);
  const request = createRequest(spec);
  fresh(directory); write(path.join(directory, 'request.json'), request);
  return request;
}
export function verifyRequest(request) {
  object(request, ['schema', 'compatibility', 'source', 'sourceFingerprint', 'requirements', 'requestHash']);
  assert.equal(request.schema, 'extractor-request/1'); const {requestHash, ...body} = request;
  assert.equal(requestHash, digest(body), 'request modified');
  compatibility({...request.compatibility, source: request.source});
  assert.equal(request.sourceFingerprint, sourceFingerprint(request.source.files), 'snapshot modified');
  exact(request.requirements, authoringRequirements(request.compatibility), 'AUTHORING_CONTRACT_MISMATCH: prepare a fresh request');
  return request;
}
export function artifactHash(artifact) { validateArtifact(artifact); return digest(artifact); }
export function validateArtifact(a) {
  object(a, ['schema', 'compatibility', 'entrypoint', 'files', 'dependencies', 'coverage', 'unsupported']);
  assert.equal(a.schema, 'extractor-artifact/1');
  compatibility({...a.compatibility, source: {revision: 'validation', files: {'app/index.tsx': 'export default()=>null'}}});
  assert.equal(a.coverage, 'partial-static-source', 'unsupported capability claim');
  assert.deepEqual(a.unsupported, ['runtime visibility', 'business/API effects', 'unresolved dynamic targets', 'history-dependent targets', 'imperative helper call graph']);
  assert.deepEqual(a.dependencies, {reference: CONTRACT, typescript: '6.0.3'}, 'unsupported dependencies');
  assert.ok(a.files && typeof a.files === 'object' && !Array.isArray(a.files));
  assert.ok(Object.keys(a.files).length > 0 && Object.keys(a.files).length <= 20);
  for (const [name, content] of Object.entries(a.files)) { assert.ok(relative(name) && name.endsWith('.mjs'), 'artifact files must be relative .mjs'); text(content); }
  assert.ok(Buffer.byteLength(json(a)) < 1024 * 1024, 'artifact size limit');
  assert.ok(Object.hasOwn(a.files, a.entrypoint), 'missing entrypoint'); return a;
}
export function referenceArtifact(request) {
  verifyRequest(request);
  return artifactFor(request.compatibility);
}
export function bundledArtifact(request){return request.compatibility.profile==='expo-source-inventory/1'?referenceArtifact(request):null;}
function artifactFor(compatible) {
  return {schema: 'extractor-artifact/1', compatibility: compatible, entrypoint: 'extract.mjs', dependencies: {reference: CONTRACT, typescript: '6.0.3'}, coverage: 'partial-static-source', unsupported: ['runtime visibility', 'business/API effects', 'unresolved dynamic targets', 'history-dependent targets', 'imperative helper call graph'], files: {'extract.mjs': `import fs from 'node:fs';\nconst {extractNavigationSource}=await import(process.env.EXTRACTOR_REFERENCE_URL);\nprocess.stdout.write(JSON.stringify(extractNavigationSource(JSON.parse(fs.readFileSync(0,'utf8'))${compatible.profile==='expo-source-inventory/1'?'':','+JSON.stringify(extractionOptions(compatible))})));\n`}};
}
export function review(a, reviewer, acknowledgement) {
  text(reviewer, 'reviewer'); assert.equal(acknowledgement, 'I reviewed these bytes and trust host execution', 'explicit host trust acknowledgement required');
  return {schema: 'extractor-review/1', artifactHash: artifactHash(a), reviewer, acknowledgement};
}
function reviewed(a, r) {
  object(r, ['schema', 'artifactHash', 'reviewer', 'acknowledgement']); assert.equal(r.schema, 'extractor-review/1');
  exact(r, review(a, r.reviewer, r.acknowledgement), 'review does not bind these artifact bytes');
}
function treeHashes(directory) {
  const result = {};
  function walk(dir, prefix = '') { for (const entry of fs.readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) { const key = prefix + entry.name, full = path.join(dir, entry.name); assert.ok(!entry.isSymbolicLink(), 'dependency symlink unsupported'); if (entry.isDirectory()) walk(full, key + '/'); else result[key] = sha(fs.readFileSync(full)); } }
  walk(directory); return result;
}
export function environmentIdentity() {
  const require = createRequire(new URL('../../package.json', import.meta.url));
  const tsPackage = require.resolve('typescript/package.json'), ts = read(tsPackage);
  assert.equal(ts.version, '6.0.3', 'reference dependency mismatch');
  const paths = ['src/source/navigation.mjs', 'src/source/ast.mjs', 'package.json', 'npm-shrinkwrap.json', 'src/runtime/process.mjs', 'src/project-profile.mjs'];
  return {node: process.version, platform: process.platform, arch: process.arch, dependencies: {typescript: {version: ts.version, treeHash: digest(treeHashes(path.dirname(tsPackage)))}}, reference: Object.fromEntries(paths.map(p => [p, sha(fs.readFileSync(path.join(root, p)))])), pipeline: Object.fromEntries(['contract.mjs', 'fixtures.mjs', 'pipeline.mjs', 'validate-worker.mjs','profiles.mjs'].map(p => [p, sha(fs.readFileSync(path.join(here, p)))]))};
}
async function command(command, args, options, recordPath) {
  const startedAt = new Date().toISOString(), start = performance.now();
  try { const r = await runProcess(command, args, options); write(recordPath, {...r, startedAt, timeoutMs: options.timeoutMs, node: process.version, platform: process.platform, arch: process.arch, cwd: options.cwd, timedOut: false}); return r; }
  catch (error) { write(recordPath, {...(error.record ?? {command, args, code: null, signal: null, stdout: '', stderr: '', elapsedMs: performance.now() - start}), startedAt, timeoutMs: options.timeoutMs, node: process.version, platform: process.platform, arch: process.arch, cwd: options.cwd, timedOut: error.message.startsWith('DEADLINE:'), error: error.message}); throw error; }
}
export async function author(request, config, directory) {
  directory = path.resolve(directory);
  verifyRequest(request);
  object(config, ['command', 'args', 'identity', 'timeoutMs', 'maxAttempts']);
  text(config.command); assert.ok(path.isAbsolute(config.command), 'absolute author command required');
  assert.ok(Array.isArray(config.args) && config.args.every(x => typeof x === 'string'));
  object(config.identity, ['kind', 'provider', 'model', 'effort']); assert.ok(['fake', 'agent'].includes(config.identity.kind));
  for (const k of ['provider', 'model', 'effort']) text(config.identity[k], k);
  assert.ok(Number.isInteger(config.timeoutMs) && config.timeoutMs >= 1 && config.timeoutMs <= 120000, 'author timeout 1..120000ms');
  assert.ok(Number.isInteger(config.maxAttempts) && config.maxAttempts >= 1 && config.maxAttempts <= 3, 'author attempts 1..3');
  fresh(directory); write(path.join(directory, 'request.json'), request); write(path.join(directory, 'config.json'), config);
  let diagnostic = null;
  for (let i = 1; i <= config.maxAttempts; i++) {
    const attempt = path.join(directory, `attempt-${i}`); fresh(attempt);
    try {
      const r = await command(config.command, config.args, {cwd: attempt, input: json({request, execution: config.identity, previousDiagnostic: diagnostic}), timeoutMs: config.timeoutMs, maxBytes: 2 * 1024 * 1024}, path.join(attempt, 'process.json'));
      const artifact = JSON.parse(r.stdout); validateArtifact(artifact); exact(artifact.compatibility, request.compatibility, 'author compatibility mismatch');
      write(path.join(directory, 'artifact.json'), artifact); write(path.join(directory, 'author-receipt.json'), {requestHash: request.requestHash, artifactHash: artifactHash(artifact), declaredIdentity: config.identity, identityAttested: false, attempts: i, generatedByRealAgent: config.identity.kind === 'agent' ? 'unverified: inspect provider receipts' : false}); return artifact;
    } catch (e) { diagnostic = e.message; write(path.join(attempt, 'failure.json'), {error: diagnostic}); }
  }
  throw Error(`AUTHOR_ATTEMPTS_EXHAUSTED: ${diagnostic}`);
}
async function execute(a, r, files, directory, timeoutMs, validationTimeoutMs, signal) {
  reviewed(a, r); assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30000, 'execution timeout 1..30000ms');
  assert.ok(Number.isInteger(validationTimeoutMs) && validationTimeoutMs > 0 && validationTimeoutMs <= 30000, 'validation timeout 1..30000ms'); fresh(directory);
  const code = path.join(directory, 'code'); fresh(code);
  for (const [name, content] of Object.entries(a.files)) { const full = path.join(code, name); fs.mkdirSync(path.dirname(full), {recursive: true}); fs.writeFileSync(full, content, {flag: 'wx', mode: 0o444}); }
  write(path.join(directory, 'input.json'), files);
  try {
    const record = await command(process.execPath, [path.join(code, a.entrypoint)], {cwd: code, input: JSON.stringify(files), timeoutMs, signal, maxBytes: 16 * 1024 * 1024, env: {PATH: path.dirname(process.execPath), EXTRACTOR_REFERENCE_URL: pathToFileURL(path.join(root, 'src/source/navigation.mjs')).href}}, path.join(directory, 'process.json'));
    const validation = await command(process.execPath, [path.join(here, 'validate-worker.mjs')], {cwd: directory, input: JSON.stringify({files, compatibility:a.compatibility, candidateOutput: record.stdout}), timeoutMs: validationTimeoutMs, signal, maxBytes: 16 * 1024 * 1024, env: {PATH: path.dirname(process.execPath)}}, path.join(directory, 'validation-process.json'));
    const graph = JSON.parse(validation.stdout);
    write(path.join(directory, 'graph.json'), graph); return graph;
  } catch (error) { write(path.join(directory, 'failure.json'), {error: error.message}); throw error; }
}
export async function accept(request, artifact, approval, directory, {timeoutMs = 5000, validationTimeoutMs = timeoutMs, signal} = {}) {
  directory = path.resolve(directory);
  verifyRequest(request); reviewed(artifact, approval); exact(artifact.compatibility, request.compatibility, 'artifact incompatible'); fresh(directory);
  write(path.join(directory, 'artifact.json'), artifact); write(path.join(directory, 'review.json'), approval);
  const environment = environmentIdentity();
  try {
    const results = [];
    for (const fixture of conformanceCases(request.compatibility)) {
      const graphs = [];
      for (const reverse of [false, true]) {
        const input = reverse ? Object.fromEntries(Object.entries(fixture.files).reverse()) : fixture.files;
        const graph = await execute(artifact, approval, input, path.join(directory, `${fixture.name}-${reverse ? 'reverse' : 'forward'}`), timeoutMs, validationTimeoutMs, signal);
        conformanceFacts(graph, fixture); graphs.push(graph);
      }
      exact(graphs[0], graphs[1], 'NONDETERMINISTIC_GRAPH'); results.push({fixture: fixture.name, graphHash: digest(graphs[0]), sourceFingerprint: graphs[0].sourceFingerprint});
    }
    assert.notEqual(results[0].graphHash, results[1].graphHash, 'source-change check failed');
    const graph = await execute(artifact, approval, request.source.files, path.join(directory, 'requested-source'), timeoutMs, validationTimeoutMs, signal);
    exact(environmentIdentity(), environment, 'environment changed during conformance');
    const body = {schema: 'extractor-acceptance/1', artifact, artifactHash: artifactHash(artifact), review: approval, compatibility: request.compatibility, environment, sourceFingerprint: request.sourceFingerprint, sourceRevision: request.source.revision, requestHash: request.requestHash, conformance: results};
    const accepted = {...body, acceptanceHash: digest(body)}; write(path.join(directory, 'accepted.json'), accepted); write(path.join(directory, 'graph.json'), graph); return accepted;
  } catch (error) { write(path.join(directory, 'failure.json'), {error: error.message}); throw error; }
}
export async function refresh(accepted, request, directory, {timeoutMs = 5000, validationTimeoutMs = timeoutMs, signal} = {}) {
  directory = path.resolve(directory);
  verifyRequest(request);
  object(accepted, ['schema', 'artifact', 'artifactHash', 'review', 'compatibility', 'environment', 'sourceFingerprint', 'sourceRevision', 'requestHash', 'conformance', 'acceptanceHash']);
  const {acceptanceHash, ...body} = accepted; assert.equal(accepted.schema, 'extractor-acceptance/1'); assert.equal(acceptanceHash, digest(body), 'acceptance modified');
  assert.equal(artifactHash(accepted.artifact), accepted.artifactHash, 'artifact modified'); reviewed(accepted.artifact, accepted.review);
  exact(accepted.compatibility, request.compatibility, 'CACHE_INCOMPATIBLE: framework/config/contract');
  const environment = environmentIdentity(); exact(accepted.environment, environment, 'CACHE_INCOMPATIBLE: runtime/dependency/validator; reaccept required');
  fresh(directory);
  try {
    const graph = await execute(accepted.artifact, accepted.review, request.source.files, path.join(directory, 'execution'), timeoutMs, validationTimeoutMs, signal);
    exact(environmentIdentity(), environment, 'environment changed during refresh');
    write(path.join(directory, 'graph.json'), graph); write(path.join(directory, 'refresh.json'), {acceptanceHash, artifactHash: accepted.artifactHash, sourceFingerprint: request.sourceFingerprint, sourceRevision: request.source.revision, graphHash: digest(graph), authorCalls: 0, environment}); return graph;
  } catch (error) { write(path.join(directory, 'failure.json'), {error: error.message}); throw error; }
}
