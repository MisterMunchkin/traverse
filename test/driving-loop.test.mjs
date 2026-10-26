import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const load = () => import('../src/driving/loop.mjs');
const policy = () => import('../src/driving/policy.mjs');
const task = {goal: 'Save the profile name', inputs: {Name: 'Updated'}, expect: {visible: [{label: 'Saved'}]}};
const snapshot = async (saved = false, value = '') => {
  const {normalizeObservation} = await import('../src/driving/contract.mjs');
  return normalizeObservation({nodes: [
    {role: 'heading', label: saved ? 'Saved' : 'Edit profile'},
    {role: 'textbox', label: 'Name', value, ref: 'e1'},
    {role: 'button', label: 'Save', ref: 'e2'},
  ]}, {target: {platform: 'web', app: 'http://fixture'}});
};
const graph = {schema: 'cv-navigation/1', nodes: [{id: '/', path: '/'}], edges: [], coverage: 'partial'};
function directory(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wayfinder-loop-')));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true})); return dir;
}
function runner() {
  const calls = []; let saved = false, value = '';
  return {calls, name: 'fixture', session: 'private', target: {platform: 'web', app: 'http://fixture'},
    open: async () => calls.push('open'), close: async () => calls.push('close'),
    observe: async () => snapshot(saved, value),
    act: async a => { calls.push(a.type); if (a.type === 'fill') value = a.value; else saved = value === 'Updated'; return {execution: 'acknowledged', effect: 'unverified', observation: await snapshot(saved, value)}; },
    startRecording: async file => { calls.push('record-start'); fs.writeFileSync(file, 'fixture recording'); }, stopRecording: async () => calls.push('record-stop'), screenshot: async () => calls.push('screenshot')};
}

test('policy gives tev1 one shared graph and escalates low margin to an offered frontier choice', async () => {
  const {decideAction} = await policy(), observation = await snapshot(); let captured, request;
  const result = await decideAction({task, observation, graph, history: [], ask: async q => {
    captured = q; return {choice: 'c0', confidence: .51, probabilities: {c0: .51, c1: .49}, raw: {usage: {input_tokens: 12}}, elapsedMs: 1};
  }, frontier: async q => { request = q; return {pick: 'c1', usage: {inputTokens: 30, outputTokens: 2}, costUsd: .001}; }});
  assert.equal(JSON.parse(captured.state).navigationGraph.nodes[0].path, '/');
  assert.ok(captured.options.every(o => !o.description.includes('navigationGraph')));
  assert.equal(result.via, 'frontier'); assert.equal(result.action.type, 'press');
  assert.equal(request.localEscalation.code, 'LOW_MARGIN');
  assert.deepEqual(request.options.map(o => o.id), ['c0', 'c1']);
  assert.equal(result.accounting.localCalls, 1); assert.equal(result.accounting.frontierCalls, 1);
});

test('frontier-only control never calls the local model and rejects an unoffered choice', async () => {
  const {decideAction} = await policy(), observation = await snapshot(); let calls = 0;
  await assert.rejects(decideAction({task, observation, graph, history: [], policy: 'frontier', ask: async () => { calls++; }, frontier: async () => ({pick: 'invented'})}), /offered/i);
  assert.equal(calls, 0);
});

test('local outage returns a self-contained escalation without inventing a frontier call', async () => {
  const {decideAction} = await policy(), observation = await snapshot();
  const result = await decideAction({task, observation, graph, history: [], ask: async () => { throw Error('offline'); }});
  assert.equal(result.kind, 'escalate'); assert.equal(result.reason, 'LOCAL_UNAVAILABLE');
  assert.equal(result.brief.goal, task.goal); assert.equal(result.brief.observationId, observation.id);
  assert.equal(result.accounting.frontierCalls, 0); assert.equal(result.accounting.localInputTokens, null);
});

test('bounded loop fills, saves and verifies live state before recording/closing the owned session', async t => {
  const {drive} = await load(), r = runner();
  const result = await drive({runner: r, task, graph, directory: directory(t), record: true, policy: 'frontier', frontier: async q => ({pick: q.options.find(o => /Fill/.test(o.description))?.id ?? q.options[0].id, usage: {inputTokens: 10, outputTokens: 1}, costUsd: .001})});
  assert.equal(result.status, 'verified'); assert.equal(result.steps, 2);
  assert.deepEqual(r.calls, ['open', 'record-start', 'fill', 'press', 'screenshot', 'record-stop', 'close']);
  assert.equal(result.accounting.frontierCalls, 2); assert.equal(result.accounting.frontierInputTokens, 20);
  assert.equal(result.accounting.costUsd, .002); assert.equal(result.accounting.complete, true);
  assert.equal(JSON.parse(fs.readFileSync(result.resultFile)).status, 'verified');
});

test('an acknowledged action is not task completion and exhausted attempts retain unknown usage', async t => {
  const {drive} = await load(), r = runner();
  const result = await drive({runner: r, task, graph, directory: directory(t), policy: 'frontier', maxSteps: 1, frontier: async () => ({pick: 'c1'})});
  assert.equal(result.status, 'step-limit'); assert.equal(result.accounting.frontierInputTokens, null);
  assert.equal(result.accounting.costUsd, null); assert.equal(result.accounting.complete, false);
  assert.equal(r.calls.at(-1), 'close');
});

test('timeout preserves an uncertain action and cleanup without replaying it', async t => {
  const {drive} = await load(), r = runner(); let attempts = 0;
  r.act = async () => { attempts++; throw Object.assign(Error('DEADLINE: post-observation'), {actionEvidence: {execution: 'acknowledged', effect: 'unverified', observation: null}}); };
  const result = await drive({runner: r, task, graph, directory: directory(t), policy: 'frontier', frontier: async () => ({pick: 'c1'})});
  assert.equal(result.status, 'timeout'); assert.equal(attempts, 1);
  assert.equal(result.lastAction.execution, 'acknowledged'); assert.equal(r.calls.at(-1), 'close');
});

test('recording or close failure remains visible even when the UI expectation passes', async t => {
  const {drive} = await load();
  for (const stage of ['stopRecording', 'close']) {
    const r = runner(); r[stage] = async () => { throw Error(stage + ' failed'); };
    const result = await drive({runner: r, task: {...task, expect: {visible: [{label: 'Edit profile'}]}}, graph, directory: directory(t), record: true, policy: 'frontier', frontier: async () => ({pick: 'none'})});
    assert.equal(result.status, 'cleanup-failed'); assert.equal(result.uiVerified, true);
    assert.ok(result.cleanupErrors.some(e => e.includes(stage)));
  }
});

test('a recording acknowledgement without a saved artifact cannot be reported as captured', async t => {
  const {drive} = await load(), r = runner(); r.startRecording = async () => {};
  const result = await drive({runner: r, task: {...task, expect: {visible: [{label: 'Edit profile'}]}}, graph, directory: directory(t), record: true, policy: 'frontier', frontier: async () => ({pick: 'none'})});
  assert.equal(result.status, 'cleanup-failed'); assert.equal(result.recording.status, 'failed');
});

test('pre-cancelled loop and invalid task do not launch a target', async t => {
  const {drive} = await load(), r = runner(), cancellation = new AbortController(); cancellation.abort();
  const result = await drive({runner: r, task, graph, directory: directory(t), signal: cancellation.signal});
  assert.equal(result.status, 'cancelled'); assert.deepEqual(r.calls, []);
  await assert.rejects(drive({runner: r, task: {...task, expect: {}}, graph, directory: directory(t)}), /nonempty/);
  assert.deepEqual(r.calls, []);
});

test('runtime teardown failure updates the saved attempt instead of leaving a verified result', async t => {
  const {withDecisionRuntime, drive} = await load(), dir = directory(t), r = runner();
  const result = await withDecisionRuntime({directory: dir,
    supervise: async work => { await work({}); throw Error('runtime cleanup failed'); },
    work: () => drive({runner: r, task: {...task, expect: {visible: [{label: 'Edit profile'}]}}, graph, directory: dir, policy: 'frontier', frontier: async () => ({pick: 'none'})})});
  assert.equal(result.status, 'cleanup-failed'); assert.equal(result.uiVerified, true);
  assert.equal(JSON.parse(fs.readFileSync(result.resultFile)).status, 'cleanup-failed');
});


test('local driving uses the managed model identity on the wire and in its decision receipts', async t => {
  const {drive} = await load(); const {askChoice} = await import('../src/driving/choice.mjs');
  const observed = []; let installedModel;
  const server = http.createServer((request, response) => {
    let raw = ''; request.on('data', bytes => { raw += bytes; });
    request.on('end', () => {
      const body = JSON.parse(raw); observed.push(body); response.setHeader('content-type', 'application/json');
      if (body.model !== installedModel) { response.statusCode = 404; response.end(JSON.stringify({error: 'model is not installed'})); return; }
      const keys = Object.keys(body.questions.pick.criteria);
      response.end(JSON.stringify({answers: {pick: {choice: keys[0], confidence: 1, probabilities: Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 1 : 0]))}}, usage: {input_tokens: 8}}));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const selected of [undefined, 'tev1:verified-fixture-tag']) {
    installedModel = selected ?? 'tev1:4b-q8_0'; const dir = directory(t); const start = observed.length;
    const result = await drive({runner: runner(), task, graph, directory: dir, localModel: selected, ask: request => askChoice({...request, baseUrl: `http://127.0.0.1:${server.address().port}`})});
    assert.equal(result.status, 'verified', JSON.stringify(result.escalation));
    assert.equal(result.accounting.frontierCalls, 0);
    assert.equal(observed.length - start, 2);
    assert.ok(observed.slice(start).every(body => body.model === installedModel));
    const events = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(events.filter(event => event.type === 'decision').every(event => event.localEvidence.request.model === installedModel));
  }
});
