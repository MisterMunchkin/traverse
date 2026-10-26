import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import {initProject} from '../src/project.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const modulePath = new URL('../src/graph.mjs', import.meta.url);
async function api() { assert.ok(fs.existsSync(modulePath), 'Repository graph lifecycle is not implemented'); return import(modulePath.href); }
function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wayfinder-graph-')));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  for (const name of ['app', 'components', 'app.json', 'tsconfig.json', 'package.json', 'package-lock.json', 'node_modules/expo/package.json', 'node_modules/expo-router/package.json']) {
    const dest = path.join(dir, name); fs.mkdirSync(path.dirname(dest), {recursive: true}); fs.cpSync(path.join(root, 'examples/expo', name), dest, {recursive: true});
  }
  return dir;
}
const graphFile = dir => path.join(dir, '.wayfinder/graph.json');

test('a graph is portable, deterministic and refreshes source edits without an author', async t => {
  const {refreshGraph, checkGraph} = await api(); const project = fixture(t); initProject({project});
  const config = fs.readFileSync(path.join(project, '.wayfinder/project.json'), 'utf8');
  assert.equal(JSON.parse(config).schema, 'wayfinder-project/2'); assert.ok(!config.includes(project));
  assert.equal((await checkGraph(project)).ready, false);
  const first = await refreshGraph({project}); assert.equal(first.ready, true); assert.equal(first.authorCalls, 0);
  const bytes = fs.readFileSync(graphFile(project));
  assert.equal((await checkGraph(project)).ready, true);
  assert.equal((await refreshGraph({project})).authorCalls, 0); assert.deepEqual(fs.readFileSync(graphFile(project)), bytes);
  fs.writeFileSync(path.join(project, 'app/extra.tsx'), 'export default()=>null');
  assert.equal((await checkGraph(project)).ready, false);
  await refreshGraph({project});
  const graph = JSON.parse(fs.readFileSync(graphFile(project))); assert.equal(graph.schema, 'wayfinder-repository-graph/1');
  assert.ok(graph.inventory.nodes.some(n => n.id === '/extra')); assert.ok(!JSON.stringify(graph).includes(project));
  fs.unlinkSync(path.join(project, 'app/extra.tsx')); assert.equal((await checkGraph(project)).ready, false);
  await refreshGraph({project}); assert.deepEqual(fs.readFileSync(graphFile(project)), bytes);
});

test('cloning portable config, extractor and graph does not copy machine execution state', async t => {
  const {refreshGraph, checkGraph} = await api(); const first = fixture(t), second = fixture(t); initProject({project: first}); await refreshGraph({project: first});
  const target = path.join(second, '.wayfinder'); fs.mkdirSync(target);
  for (const file of ['project.json', 'extractor', 'graph.json', '.gitignore']) fs.cpSync(path.join(first, '.wayfinder', file), path.join(target, file), {recursive: true});
  assert.equal((await checkGraph(second)).ready, true); assert.equal(fs.existsSync(path.join(target, 'local')), false);
  await refreshGraph({project: second}); assert.equal((await checkGraph(second)).ready, true);
});

test('changed extractor bytes refuse execution and failed refresh preserves the graph', async t => {
  const {refreshGraph, checkGraph} = await api(); const project = fixture(t); initProject({project}); await refreshGraph({project});
  const before = fs.readFileSync(graphFile(project));
  const file = path.join(project, '.wayfinder/extractor/artifact.json'), artifact = JSON.parse(fs.readFileSync(file));
  artifact.files['extract.mjs'] = "throw Error('UNTRUSTED-MUST-NOT-RUN')"; fs.writeFileSync(file, JSON.stringify(artifact));
  assert.equal((await checkGraph(project)).ready, false);
  await assert.rejects(refreshGraph({project}), /reviewed acceptance|review.*accept/i);
  assert.deepEqual(fs.readFileSync(graphFile(project)), before);
});

test('explicit migration preserves legacy config and existing installation files', async t => {
  await api(); const project = fixture(t); initProject({project});
  const file = path.join(project, '.wayfinder/project.json'), portable = JSON.parse(fs.readFileSync(file));
  const legacy = {...portable, schema: 'wayfinder-project/1', projectRoot: project}; fs.writeFileSync(file, JSON.stringify(legacy));
  const before = fs.readFileSync(file); fs.mkdirSync(path.join(project, '.wayfinder/install')); fs.writeFileSync(path.join(project, '.wayfinder/install/keep'), 'old installation');
  assert.throws(() => initProject({project}), /--migrate/); assert.deepEqual(fs.readFileSync(file), before);
  initProject({project, migrate: true}); assert.equal(JSON.parse(fs.readFileSync(file)).schema, 'wayfinder-project/2');
  assert.deepEqual(fs.readFileSync(path.join(project, '.wayfinder/local/project-v1.json')), before);
  assert.equal(fs.readFileSync(path.join(project, '.wayfinder/install/keep'), 'utf8'), 'old installation');
});

test('watch observes edits, preserves the last valid graph on failure and stops cleanly', async t => {
  const {watchGraph, checkGraph} = await api(); const project = fixture(t); initProject({project});
  const controller = new AbortController(); const events = []; let original, complete = false;
  const deadline = setTimeout(() => controller.abort(), 25000); t.after(() => clearTimeout(deadline));
  await watchGraph({project, signal: controller.signal, debounceMs: 30, onEvent: event => {
    assert.equal(event.schema, 'wayfinder-graph-watch-event/1');
    events.push(event);
    if (event.status === 'ready' && !original) {
      original = fs.readFileSync(graphFile(project)); fs.writeFileSync(path.join(project, 'app.json'), '{');
    } else if (event.status === 'stale') {
      assert.deepEqual(fs.readFileSync(graphFile(project)), original);
      fs.copyFileSync(path.join(root, 'examples/expo/app.json'), path.join(project, 'app.json'));
      fs.writeFileSync(path.join(project, 'app/watched.tsx'), 'export default()=>null');
    } else if (event.status === 'ready' && JSON.parse(fs.readFileSync(graphFile(project))).inventory.nodes.some(n => n.id === '/watched')) {
      complete = true; controller.abort();
    }
  }});
  clearTimeout(deadline); assert.equal(complete, true); assert.ok(events.some(e => e.status === 'stale'));
  assert.equal((await checkGraph(project)).ready, true);
  assert.equal(fs.existsSync(path.join(project, '.wayfinder/local/graph.lock')), false);
  await pause(40);
});

test('source changes during extraction preserve the old graph and report stale inputs', async t => {
  const {refreshGraph, checkGraph} = await api(); const project = fixture(t); initProject({project}); await refreshGraph({project});
  const before = fs.readFileSync(graphFile(project));
  await assert.rejects(refreshGraph({project, onProgress: () => fs.appendFileSync(path.join(project, 'app/index.tsx'), '\n// concurrent source edit\n')}), /changed during graph generation/);
  assert.deepEqual(fs.readFileSync(graphFile(project)), before); assert.equal((await checkGraph(project)).ready, false);
});

test('explicitly reviewed custom artifacts refresh, while a clone needs its own execution acceptance', async t => {
  const {refreshGraph} = await api(); const {projectStatus} = await import('../src/project.mjs');
  const {createRequest, review, accept} = await import('../src/extractor-pipeline/pipeline.mjs');
  const project = fixture(t); initProject({project}); await refreshGraph({project});
  const file = path.join(project, '.wayfinder/extractor/artifact.json'), artifact = JSON.parse(fs.readFileSync(file));
  artifact.files['extract.mjs'] += '\n// reviewed fixture variant\n'; fs.writeFileSync(file, JSON.stringify(artifact));
  const out = path.join(project, '.wayfinder/local/explicit-acceptance');
  const request = createRequest(projectStatus(project).spec);
  await accept(request, artifact, review(artifact, 'offline fixture reviewer', 'I reviewed these bytes and trust host execution'), out);
  assert.equal((await refreshGraph({project, accepted: path.join(out, 'accepted.json')})).ready, true);
  assert.equal((await refreshGraph({project})).authorCalls, 0);
  const clone = fixture(t); fs.mkdirSync(path.join(clone, '.wayfinder'));
  for (const name of ['project.json', 'extractor', 'graph.json']) fs.cpSync(path.join(project, '.wayfinder', name), path.join(clone, '.wayfinder', name), {recursive: true});
  await assert.rejects(refreshGraph({project: clone}), /explicit reviewed acceptance/);
});

test('watch rejects src/app created inside an existing src directory and recovers after removal', async t => {
  const {watchGraph, refreshGraph, checkGraph} = await api(); const project = fixture(t); initProject({project});
  fs.mkdirSync(path.join(project, 'src')); await refreshGraph({project});
  const previous = fs.readFileSync(graphFile(project)), controller = new AbortController(); let phase = 0, recovered = false, eventDeadline;
  const deadline = setTimeout(() => controller.abort(), 20000); t.after(() => { clearTimeout(deadline); clearTimeout(eventDeadline); });
  await watchGraph({project, signal: controller.signal, debounceMs: 30, onEvent: event => {
    if (phase === 0 && event.status === 'ready') {
      phase = 1; fs.mkdirSync(path.join(project, 'src/app'));
      eventDeadline = setTimeout(() => controller.abort(), 3000);
    } else if (phase === 1 && event.status === 'stale') {
      assert.match(event.reason, /src\/app/); assert.deepEqual(fs.readFileSync(graphFile(project)), previous);
      clearTimeout(eventDeadline); phase = 2; fs.rmdirSync(path.join(project, 'src/app'));
    } else if (phase === 2 && event.status === 'ready') { recovered = true; controller.abort(); }
  }});
  clearTimeout(deadline); clearTimeout(eventDeadline);
  assert.equal(recovered, true, `Expected unsupported-root stale event and recovery; reached phase ${phase}`);
  assert.equal((await checkGraph(project)).ready, true); assert.equal(fs.existsSync(path.join(project, '.wayfinder/local/graph.lock')), false);
});
