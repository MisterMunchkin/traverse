import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createFrontier} from '../src/frontier/provider.mjs';
import {decideAction, emptyAccounting, addAccounting} from '../src/driving/policy.mjs';
import {drive} from '../src/driving/loop.mjs';
import {normalizeObservation} from '../src/driving/contract.mjs';
import {providerFixture} from './support/provider-fixture.mjs';
const target = {platform: 'web', app: 'http://fixture'};
const observation = saved => normalizeObservation({nodes: [{role: 'button', label: saved ? 'Saved' : 'Save', ref: 'e1'}]}, {target});
const task = {goal: 'Save', expect: {visible: [{label: 'Saved'}]}};
const graph = {nodes: [], edges: []};
const reported = {input_tokens: 5, cache_creation_input_tokens: 7, cache_read_input_tokens: 11, output_tokens: 3};
const decide = frontier => decideAction({task, graph, observation: observation(false), policy: 'frontier', frontier});

test('Claude auxiliary usage reaches the saved drive summary without becoming attributed usage or subscription charges', async t => {
  const f = providerFixture(t, 'claude', 'structured-auxiliary');
  const frontier = await createFrontier({settings: f.profile, directory: path.join(f.dir, 'requests'), env: f.env});
  let presses = 0;
  const runner = {target, open: async () => {}, close: async () => {}, screenshot: async () => {},
    observe: async () => observation(presses === 2), act: async () => { presses++; return {execution: 'acknowledged', effect: 'unverified', observation: observation(presses === 2)}; }};
  const result = await drive({runner, task, graph, directory: path.join(f.dir, 'drive'), policy: 'frontier', frontier});
  assert.equal(result.status, 'verified');
  assert.equal(result.accounting.frontierCalls, 2);
  assert.equal(result.accounting.frontierReportedInputTokens, 100); // result counters, not result + modelUsage
  assert.equal(result.accounting.frontierReportedOutputTokens, 6);
  assert.equal(result.accounting.frontierReportedApiCostUsd, .04);
  assert.equal(result.accounting.frontierInputTokens, null);
  assert.equal(result.accounting.frontierOutputTokens, null);
  assert.equal(result.accounting.costUsd, null);
  assert.equal(result.accounting.complete, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(result.resultFile)).accounting, result.accounting);
});

test('reported input includes cache creation and reads once, with separate cache subtotals', async () => {
  const {accounting} = await decide(async () => ({pick: 'c0', reportedUsage: reported, reportedApiCostUsd: .02}));
  assert.equal(accounting.frontierReportedInputTokens, 23);
  assert.equal(accounting.frontierReportedCacheCreationInputTokens, 7);
  assert.equal(accounting.frontierReportedCacheReadInputTokens, 11);
  assert.equal(accounting.frontierReportedOutputTokens, 3);
  assert.equal(accounting.frontierReportedApiCostUsd, .02);
  assert.equal(accounting.costUsd, null);
});

for (const missing of ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) test(`partial report missing ${missing} never becomes a complete input total`, async () => {
  const usage = {...reported}; delete usage[missing];
  const {accounting} = await decide(async () => ({pick: 'none', reportedUsage: usage}));
  assert.equal(accounting.frontierReportedInputTokens, null);
  assert.equal(accounting.frontierReportedOutputTokens, 3);
  assert.equal(accounting.frontierReportedApiCostUsd, null);
});

test('missing, invalid and failed reports stay unknown across aggregation', async () => {
  for (const frontier of [async () => ({pick: 'c0'}), async () => ({pick: 'none', reportedUsage: {input_tokens: -1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: Infinity}, reportedApiCostUsd: -1}), async () => { throw Error('DEADLINE'); }]) {
    const total = emptyAccounting();
    const known = await decide(async () => ({pick: 'c0', reportedUsage: reported, reportedApiCostUsd: .02}));
    addAccounting(total, known.accounting);
    let part; try { part = (await decide(frontier)).accounting; } catch (e) { part = e.decisionAccounting; }
    addAccounting(total, part); addAccounting(total, known.accounting);
    assert.equal(total.frontierReportedInputTokens, null);
    assert.equal(total.frontierReportedOutputTokens, null);
    assert.equal(total.frontierReportedApiCostUsd, null);
    assert.equal(total.frontierCalls, 3);
  }
});
