import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {extractNavigationSource} from '../src/source/navigation.mjs';
import {prepare, author, referenceArtifact, artifactHash, review, accept, refresh, read, root, validateArtifact, verifyRequest} from '../src/extractor-pipeline/pipeline.mjs';
import {validateGraph, digest, sourceFingerprint, sha} from '../src/extractor-pipeline/contract.mjs';
import {files, cases, expectedFacts} from '../src/extractor-pipeline/fixtures.mjs';
const example = read(new URL('../fixtures/extractor-pipeline/example-spec.json', import.meta.url));
const trust = 'I reviewed these bytes and trust host execution';
function workspace(t) { const base = process.env.PIPELINE_TEST_EVIDENCE ?? os.tmpdir(); fs.mkdirSync(base, {recursive: true}); const d = fs.mkdtempSync(path.join(base, 'extractor-pipeline-')); if (!process.env.PIPELINE_TEST_EVIDENCE) t.after(() => fs.rmSync(d, {recursive: true, force: true})); return d; }
const spec = (input = files) => ({...structuredClone(example), source: {revision: 'independent-miniature-v1', files: structuredClone(input)}});
const requestAt = (d, name = 'request', input = files) => prepare(spec(input), path.join(d, name));
const approve = a => review(a, 'automated-reference-fixture-review', trust);
const fake = {command: process.execPath, args: [fileURLToPath(new URL('../fixtures/extractor-pipeline/fake-author.mjs', import.meta.url))], identity: {kind: 'fake', provider: 'offline', model: 'reference-copy', effort: 'none'}, timeoutMs: 5000, maxAttempts: 1};

test('reference inventory matches independently written expected facts, guards and uncertainty', () => {
  for (const c of cases) expectedFacts(validateGraph(extractNavigationSource(c.files), c.files), c);
});
test('prepare is immutable and rejects unspecified versions, profiles and source escapes', t => {
  const d = workspace(t), request = requestAt(d); assert.equal(request.sourceFingerprint, sourceFingerprint(files));
  assert.ok(request.requirements.graphContract.validatorSource);
  assert.equal(request.requirements.graphContract.validatorSha256, sha(request.requirements.graphContract.validatorSource));
  assert.deepEqual(request.requirements.artifactTemplate, referenceArtifact(request));
  assert.match(request.requirements.invocation, /EXTRACTOR_REFERENCE_URL/);
  assert.throws(() => requestAt(d), /EEXIST/);
  for (const mutate of [s => s.framework.version = '^6', s => s.framework.package = 'tanstack', s => s.contract = 'runtime/1', s => s.source.files['../secret.ts'] = 'secret']) {
    const s = spec(); mutate(s); assert.throws(() => prepare(s, path.join(d, 'invalid')));
  }
});
test('author → explicit review → independent conformance → pin → changed source refresh has zero author calls', async t => {
  const d = workspace(t), request = requestAt(d), a = await author(request, fake, path.join(d, 'author'));
  assert.equal(read(path.join(d, 'author/author-receipt.json')).generatedByRealAgent, false);
  await assert.rejects(accept(request, a, {}, path.join(d, 'unreviewed')), /missing fields/);
  assert.ok(!fs.existsSync(path.join(d, 'unreviewed')));
  const accepted = await accept(request, a, approve(a), path.join(d, 'accept'));
  const second = requestAt(d, 'changed', cases[1].files);
  const graph = await refresh(accepted, second, path.join(d, 'refresh')); expectedFacts(graph, cases[1]);
  const receipt = read(path.join(d, 'refresh/refresh.json')); assert.equal(receipt.authorCalls, 0); assert.notEqual(receipt.sourceFingerprint, accepted.sourceFingerprint);
  const unchanged = await refresh(accepted, request, path.join(d, 'same'));
  assert.deepEqual(unchanged, read(path.join(d, 'accept/graph.json')));
  assert.equal(fs.readdirSync(path.join(d, 'author')).filter(x => x.startsWith('attempt-')).length, 1);
});
test('source, artifact, review and acceptance tampering fail; config/framework/runtime changes invalidate cache', async t => {
  const d = workspace(t), request = requestAt(d), a = referenceArtifact(request), accepted = await accept(request, a, approve(a), path.join(d, 'accept'));
  const changed = structuredClone(a); changed.files['extract.mjs'] += '\n// changed';
  await assert.rejects(accept(request, changed, approve(a), path.join(d, 'wrong-review')), /review does not bind/);
  const tamperedRequest = structuredClone(request); tamperedRequest.source.files['app/back.tsx'] += ' '; await assert.rejects(refresh(accepted, tamperedRequest, path.join(d, 'tampered')), /request modified/);
  for (const [name, mutate] of [['version', s => s.framework.version = '6.0.1'], ['config', s => s.routing.config.changed = true]]) {
    const s = spec(); mutate(s); const other = prepare(s, path.join(d, name)); await assert.rejects(refresh(accepted, other, path.join(d, name + '-out')), /CACHE_INCOMPATIBLE/);
  }
  for (const key of ['dependencies', 'reference', 'pipeline', 'node']) {
    const altered = structuredClone(accepted); altered.environment[key] = 'changed'; const {acceptanceHash, ...body} = altered; altered.acceptanceHash = digest(body);
    await assert.rejects(refresh(altered, request, path.join(d, key)), /CACHE_INCOMPATIBLE/);
  }
  const modified = structuredClone(accepted); modified.artifact.files['extract.mjs'] += '\n'; await assert.rejects(refresh(modified, request, path.join(d, 'modified')), /acceptance modified/);
});
test('negative inventories fail for the intended structural/provenance/semantic reason', () => {
  const mutations = [
    ['schema', g => g.schema = 'runtime/1', /schema mismatch/],
    ['endpoint', g => g.edges[0].to = '/missing', /missing graph endpoint/],
    ['provenance', g => delete g.edges[0].source, /edge: missing fields/],
    ['hash', g => g.files['app/back.tsx'].sha256 = '0', /provenance manifest mismatch/],
    ['fabricated route', g => g.nodes[0].id = '/invented', /fabricated route identity/],
    ['fabricated resolved target', g => g.edges[0].to = '/(provider)/settings', /fabricated\/ambiguous resolved route/],
    ['capability', g => g.coverage = 'complete-runtime', /unsupported capability/],
    ['effect', g => g.edges[0].effect = {saved: true}, /edge: unsupported fields/],
    ['history', g => g.unresolved.find(x => x.owner === '/back').reason = 'dynamic-target', /strictly equal/],
    ['guard removed', g => g.nodes.forEach(n => n.guards = []), /conformance: guards/],
    ['uncertainty removed', g => { g.unresolved = []; g.stats.unresolved = 0; }, /conformance: retained uncertainty/],
  ];
  for (const [name, mutate, reason] of mutations) { const g = extractNavigationSource(files); mutate(g); assert.throws(() => expectedFacts(validateGraph(g, files), cases[0]), reason, name); }
  const a = referenceArtifact({...prepareForMemory()}); a.coverage = 'runtime'; assert.throws(() => validateArtifact(a), /unsupported capability/);
});
function prepareForMemory() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'extractor-request-')); try { return requestAt(d); } finally { fs.rmSync(d, {recursive: true, force: true}); } }
test('fixed-output and order-sensitive scripts cannot pass conformance; failures are retained', async t => {
  const d = workspace(t), request = requestAt(d);
  for (const [name, code, reason] of [
    ['constant', `process.stdout.write(${JSON.stringify(JSON.stringify(extractNavigationSource(files)))});`, /source provenance manifest mismatch/],
    ['wrong', `import fs from 'node:fs';const {extractNavigationSource}=await import(process.env.EXTRACTOR_REFERENCE_URL);const g=extractNavigationSource(JSON.parse(fs.readFileSync(0,'utf8')));g.edges[0].label='Wrong';process.stdout.write(JSON.stringify(g));`, /REFERENCE_SEMANTICS_MISMATCH/],
    ['order', `import fs from 'node:fs';const {extractNavigationSource}=await import(process.env.EXTRACTOR_REFERENCE_URL);const f=JSON.parse(fs.readFileSync(0,'utf8'));const g=extractNavigationSource(f);g.edges[0].id=Object.keys(f)[0];process.stdout.write(JSON.stringify(g));`, /REFERENCE_SEMANTICS_MISMATCH/],
    ['fabricated-coherent', `import fs from 'node:fs';const {extractNavigationSource}=await import(process.env.EXTRACTOR_REFERENCE_URL);const g=extractNavigationSource(JSON.parse(fs.readFileSync(0,'utf8')));g.edges[0].target='/settings';g.edges[0].to='/(provider)/settings';process.stdout.write(JSON.stringify(g));`, /REFERENCE_SEMANTICS_MISMATCH/],
  ]) { const a = referenceArtifact(request); a.files['extract.mjs'] = code; await assert.rejects(accept(request, a, approve(a), path.join(d, name)), reason); assert.ok(fs.existsSync(path.join(d, name, 'failure.json'))); assert.ok(!fs.existsSync(path.join(d, name, 'accepted.json'))); }
});
test('author failures/repair attempts and extractor hangs are bounded with diagnostics', async t => {
  const d = workspace(t), request = requestAt(d);
  await assert.rejects(author(request, {...fake, args: ['-e', 'process.stdout.write("bad-json")'], maxAttempts: 2}, path.join(d, 'bad')), /AUTHOR_ATTEMPTS_EXHAUSTED/);
  assert.ok(fs.existsSync(path.join(d, 'bad/attempt-2/failure.json'))); assert.ok(!fs.existsSync(path.join(d, 'bad/attempt-3')));
  await assert.rejects(author(request, {...fake, args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 80}, path.join(d, 'author-hang')), /DEADLINE/);
  assert.equal(read(path.join(d, 'author-hang/attempt-1/process.json')).timedOut, true);
  const a = referenceArtifact(request); a.files['extract.mjs'] = 'setInterval(()=>{},1000)';
  await assert.rejects(accept(request, a, approve(a), path.join(d, 'extract-hang'), {timeoutMs: 80}), /DEADLINE/);
  const receipt = read(path.join(d, 'extract-hang/base-forward/process.json')); assert.equal(receipt.timedOut, true); assert.ok(receipt.signal); assert.ok(receipt.elapsedMs < 3000);
  await assert.rejects(author(request, {...fake, maxAttempts: 4}, path.join(d, 'unbounded')), /author attempts/);
});
test('CLI requires exact hash and host trust before execution', t => {
  const d = workspace(t), cli = path.join(root, 'bin/extractor-pipeline.mjs');
  const run = args => execFileSync(process.execPath, [cli, ...args], {encoding: 'utf8', timeout: 10000, stdio: 'pipe'});
  run(['prepare', '--spec', path.join(root, 'fixtures/extractor-pipeline/example-spec.json'), '--out', path.join(d, 'request')]);
  run(['reference', '--request', path.join(d, 'request/request.json'), '--out', path.join(d, 'artifact.json')]);
  const a = read(path.join(d, 'artifact.json')), hash = artifactHash(a);
  assert.throws(() => run(['review', '--artifact', path.join(d, 'artifact.json'), '--hash', hash, '--reviewer', 'test', '--out', path.join(d, 'review.json')]), /host trust acknowledgement/);
  run(['review', '--artifact', path.join(d, 'artifact.json'), '--hash', hash, '--reviewer', 'test-reference', '--trust-host', '--out', path.join(d, 'review.json')]);
  run(['accept', '--request', path.join(d, 'request/request.json'), '--artifact', path.join(d, 'artifact.json'), '--review', path.join(d, 'review.json'), '--out', path.relative(process.cwd(), path.join(d, 'accepted'))]);
  run(['refresh', '--request', path.join(d, 'request/request.json'), '--accepted', path.join(d, 'accepted/accepted.json'), '--out', path.join(d, 'refresh')]);
  assert.equal(read(path.join(d, 'refresh/refresh.json')).authorCalls, 0);
});

test('trusted validation deadline fails after candidate success and retains its own timeout receipt', async t => {
  const d = workspace(t), request = requestAt(d), a = referenceArtifact(request);
  await assert.rejects(accept(request, a, approve(a), path.join(d, 'validation-timeout'), {timeoutMs: 5000, validationTimeoutMs: 1}), /DEADLINE/);
  assert.equal(read(path.join(d, 'validation-timeout/base-forward/process.json')).code, 0);
  const receipt = read(path.join(d, 'validation-timeout/base-forward/validation-process.json'));
  assert.equal(receipt.timedOut, true); assert.ok(receipt.signal); assert.ok(receipt.elapsedMs < 3000);
  assert.ok(!fs.existsSync(path.join(d, 'validation-timeout/accepted.json')));
});

test('consumers reject incomplete or altered authoring contracts even with recomputed request hashes', t => {
  const d = workspace(t), request = requestAt(d);
  for (const key of ['graphContract', 'artifactTemplate', 'invocation']) {
    const altered = structuredClone(request); delete altered.requirements[key];
    const {requestHash, ...body} = altered; altered.requestHash = digest(body);
    assert.throws(() => verifyRequest(altered), /AUTHORING_CONTRACT_MISMATCH/);
  }
  const altered = structuredClone(request); altered.requirements.artifactTemplate.files['extract.mjs'] = 'process.exit(0)';
  const {requestHash, ...body} = altered; altered.requestHash = digest(body);
  assert.throws(() => verifyRequest(altered), /AUTHORING_CONTRACT_MISMATCH/);
});


test('graph version is required and exact at the validation boundary',()=>{
 const graph={...extractNavigationSource(files),schema:'traverse-navigation',schemaVersion:1};
 assert.doesNotThrow(()=>validateGraph(graph,files));
 for(const version of [undefined,null,'1',0,2,1.5]){
  const invalid={...graph,schemaVersion:version};if(version===undefined)delete invalid.schemaVersion;
  assert.throws(()=>validateGraph(invalid,files),/missing fields|schema version mismatch/);
 }
 assert.throws(()=>validateGraph({...graph,schema:'cv-navigation/1'},files),/schema mismatch/);
});

test('authoring and artifact identities bind both navigation schema name and version',t=>{
 const d=workspace(t),current=spec();current.contract={schema:'traverse-navigation',schemaVersion:1};
 const request=prepare(current,path.join(d,'current'));
 assert.deepEqual(request.compatibility.contract,{schema:'traverse-navigation',schemaVersion:1});
 assert.equal(request.requirements.graphContract.schema,'traverse-navigation');
 assert.equal(request.requirements.graphContract.schemaVersion,1);
 assert.deepEqual(request.requirements.output,{schema:'traverse-navigation',schemaVersion:1});
 const artifact=referenceArtifact(request);
 assert.deepEqual(artifact.dependencies.reference,{schema:'traverse-navigation',schemaVersion:1});
 for(const contract of ['cv-navigation/1',{schema:'traverse-navigation'},{schema:'traverse-navigation',schemaVersion:2},{schema:'traverse-navigation',schemaVersion:'1'},{schema:'traverse-navigation',schemaVersion:1,unknown:true}]){
  assert.throws(()=>prepare({...current,contract},path.join(d,'invalid')),/unsupported graph contract/);
 }
 artifact.dependencies.reference={schema:'traverse-navigation',schemaVersion:2};
 assert.throws(()=>validateArtifact(artifact),/unsupported dependencies/);
});
