import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {initProject, inspectProject} from '../src/project.mjs';
import {prepareAdapter, publishAdapter} from '../src/adapter-init.mjs';
import {refreshGraph} from '../src/graph.mjs';
import {createRequest, referenceArtifact, artifactHash} from '../src/extractor-pipeline/pipeline.mjs';
import {readExtractorApproval} from '../src/extractor-approval.mjs';
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const progress = {close() {}, run(_label, work) { return work(); }};
function fixtures(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'traverse-approval-transfer-')));
  const previous = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = path.join(root, 'private-state');
  t.after(() => { if (previous === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = previous; fs.rmSync(root, {recursive: true, force: true}); });
  const projects = ['owner', 'recipient'].map(name => {
    const project = path.join(root, name); fs.mkdirSync(project);
    for (const file of ['app', 'components', 'app.json', 'tsconfig.json', 'package.json', 'package-lock.json', 'node_modules/expo/package.json', 'node_modules/expo-router/package.json']) {
      const to = path.join(project, file); fs.mkdirSync(path.dirname(to), {recursive: true});
      fs.cpSync(path.join(packageRoot, 'examples/expo', file), to, {recursive: true});
    }
    initProject({project}); return project;
  });
  return {root, owner: projects[0], recipient: projects[1]};
}
async function approveOwner(f) {
  const artifact = referenceArtifact(createRequest(inspectProject(f.owner).spec));
  // Exact packaged reference code plus a comment; no new behavior or attack payload.
  artifact.files['extract.mjs'] += '\n// synthetic reviewed custom variant\n';
  const file = path.join(f.root, 'reviewed-reference.json'); fs.writeFileSync(file, JSON.stringify(artifact));
  const staged = await prepareAdapter({project: f.owner, adapter: file, trust: artifactHash(artifact), progress});
  publishAdapter(staged);
  fs.cpSync(path.join(f.owner, '.wayfinder'), path.join(f.recipient, '.wayfinder'), {recursive: true});
  return {artifact, file};
}
test('copying repository-local acceptance receipts does not grant init execution permission in another project', async t => {
  const f = fixtures(t); await approveOwner(f);
  const result = await prepareAdapter({project: f.recipient, progress});
  assert.equal(result.kind, 'review-required');
  assert.equal(result.ready, false);
  assert.equal(result.authorCalls, 0);
});
test('copying repository-local acceptance receipts does not grant graph refresh execution permission', async t => {
  const f = fixtures(t); await approveOwner(f);
  await assert.rejects(refreshGraph({project: f.recipient}), /reviewed acceptance|review.*accept/i);
});
test('recipient-local explicit approval permits owner reruns and zero-author refresh', async t => {
  const f = fixtures(t); await approveOwner(f);
  const result = await prepareAdapter({project: f.owner, progress});
  assert.equal(result.kind, 'pinned');
  assert.equal(result.authorCalls, 0);
  assert.equal((await refreshGraph({project: f.owner})).authorCalls, 0);
});

function grantFile(f) {
  const directory = path.join(f.root, 'private-state/traverse/extractor-approvals');
  return fs.readdirSync(directory).map(name => path.join(directory, name))
    .find(file => JSON.parse(fs.readFileSync(file)).binding.project === f.owner);
}
test('a recipient can explicitly approve the same reviewed bytes and then rerun', async t => {
  const f = fixtures(t), {artifact, file} = await approveOwner(f);
  publishAdapter(await prepareAdapter({project: f.recipient, adapter: file, trust: artifactHash(artifact), progress}));
  assert.equal((await prepareAdapter({project: f.recipient, progress})).kind, 'pinned');
  assert.equal((await refreshGraph({project: f.recipient})).authorCalls, 0);
});
test('a private grant containing different extractor bytes is refused before refresh', async t => {
  const f = fixtures(t); await approveOwner(f);
  const file = grantFile(f), grant = JSON.parse(fs.readFileSync(file));
  grant.accepted.artifact.files['extract.mjs'] += '\n// different benign bytes\n';
  fs.writeFileSync(file, JSON.stringify(grant));
  await assert.rejects(prepareAdapter({project: f.owner, progress}), /pinned extractor/i);
});
for (const field of ['compatibility', 'environment']) test(`a private grant rejects changed embedded ${field}`, async t => {
  const f = fixtures(t); await approveOwner(f);
  const file = grantFile(f), grant = JSON.parse(fs.readFileSync(file));
  grant.accepted[field].syntheticChange = true;
  fs.writeFileSync(file, JSON.stringify(grant));
  await assert.rejects(prepareAdapter({project: f.owner, progress}), /compatibility or environment changed/i);
});
test('a grant bound to another canonical project is refused', async t => {
  const f = fixtures(t); await approveOwner(f);
  const file = grantFile(f), grant = JSON.parse(fs.readFileSync(file));
  grant.binding.project = f.recipient; fs.writeFileSync(file, JSON.stringify(grant));
  await assert.rejects(prepareAdapter({project: f.owner, progress}), /binding changed/i);
});
test('approval state inside a repository is refused without fallback to its local receipts', async t => {
  const f = fixtures(t); await approveOwner(f);
  process.env.XDG_STATE_HOME = f.owner;
  await assert.rejects(prepareAdapter({project: f.owner, progress}), /outside the repository/i);
});
test('symlinked approval storage is refused', async t => {
  const f = fixtures(t); await approveOwner(f);
  const state = process.env.XDG_STATE_HOME, moved = state + '-moved';
  fs.renameSync(state, moved); fs.symlinkSync(moved, state);
  await assert.rejects(prepareAdapter({project: f.owner, progress}), /symlink/i);
});
test('nonprivate grant files are refused', async t => {
  const f = fixtures(t); await approveOwner(f);
  fs.chmodSync(grantFile(f), 0o644);
  await assert.rejects(prepareAdapter({project: f.owner, progress}), /private state record file/i);
});
test('nonprivate grant directories are refused', async t => {
  const f = fixtures(t); await approveOwner(f);
  fs.chmodSync(path.dirname(grantFile(f)), 0o755);
  await assert.rejects(prepareAdapter({project: f.owner, progress}), /private to its owner/i);
});
test('group-writable state ancestry is refused', async t => {
  const f = fixtures(t); await approveOwner(f);
  fs.chmodSync(process.env.XDG_STATE_HOME, 0o770);
  await assert.rejects(prepareAdapter({project: f.owner, progress}), /writable by another user/i);
});
test('hard-linked private grant files are refused', async t => {
  const f = fixtures(t); await approveOwner(f);
  fs.linkSync(grantFile(f), path.join(f.root, 'second-link'));
  await assert.rejects(prepareAdapter({project: f.owner, progress}), /private state record file/i);
});
test('a failed private grant write preserves the previous pinned artifact and graph', async t => {
  const f = fixtures(t), {artifact} = await approveOwner(f);
  const pinned = path.join(f.owner, '.wayfinder/extractor/artifact.json');
  const graph = path.join(f.owner, '.wayfinder/graph.json');
  const before = {artifact: fs.readFileSync(pinned), graph: fs.readFileSync(graph)};
  artifact.files['extract.mjs'] += '\n// second reviewed synthetic variant\n';
  const file = path.join(f.root, 'second-reference.json'); fs.writeFileSync(file, JSON.stringify(artifact));
  const staged = await prepareAdapter({project: f.owner, adapter: file, trust: artifactHash(artifact), progress});
  fs.chmodSync(process.env.XDG_STATE_HOME, 0o770);
  assert.throws(() => publishAdapter(staged), /writable by another user/i);
  assert.deepEqual(fs.readFileSync(pinned), before.artifact);
  assert.deepEqual(fs.readFileSync(graph), before.graph);
});
for (const field of ['compatibility', 'environment']) test(`changed current ${field} cannot reuse a prior grant`, async t => {
  const f = fixtures(t); await approveOwner(f);
  const grant = JSON.parse(fs.readFileSync(grantFile(f)));
  const inputs = {project: f.owner, artifactHash: grant.binding.artifactHash,
    compatibility: grant.accepted.compatibility, environment: grant.accepted.environment};
  inputs[field] = {...inputs[field], syntheticChangedIdentity: true};
  assert.equal(readExtractorApproval(inputs), null);
});
