import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const recorded = JSON.parse(fs.readFileSync(path.join(root, 'docs/research/results.json')));
function example() {
  return {planned: 6, retained: 6, sourceSha256: 'a'.repeat(64),
    arms: {sol: {planned: 3, retained: 3, completed: 2, frontierCalls: 10, frontierInput: 1000, localCalls: 0, localInput: 0},
      'sol-tev1': {planned: 3, retained: 3, completed: 3, frontierCalls: 4, frontierInput: 250, localCalls: 8, localInput: 500}},
    paired: {both: 2, solMs: 100000, assistedMs: 60000}};
}

test('website includes source-backed graphs, both completion outcomes and downloadable methods without JavaScript', t => {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'traverse-metrics-')));
  t.after(() => fs.rmSync(work, {recursive: true, force: true}));
  const out = path.join(work, 'site');
  const built = spawnSync(process.execPath, [path.join(root, 'scripts/site.mjs'), 'build', '--out', out], {cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024});
  assert.equal(built.status, 0, built.stderr);
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(html, /id="results"/);
  assert.match(html, /43\.9%/);
  assert.match(html, /88\.1%/);
  assert.match(html, /1,206,982/);
  assert.match(html, /143,528/);
  assert.match(html, /23\/24/);
  assert.match(html, /24\/24/);
  assert.match(html, /12\/12/);
  assert.match(html, /11\/12/);
  assert.match(html, /startup/i);
  assert.match(html, /historical/i);
  assert.match(html, /costs.*not measured/i);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'research.json'))), recorded);
  assert.equal(fs.readFileSync(path.join(out, 'research-methods.md'), 'utf8'), fs.readFileSync(path.join(root, 'docs/research.md'), 'utf8'));
});

test('study arithmetic keeps common-completion time separate from all-attempt usage', async () => {
  const {studyMetrics} = await import('../scripts/research-site.mjs');
  const result = studyMetrics(example());
  assert.deepEqual(result.time, {control: 100, assisted: 60, reduction: 40, common: 2});
  assert.deepEqual(result.input, {control: 1000, assisted: 250, reduction: 75});
  assert.deepEqual(result.requests, {control: 10, assisted: 4, reduction: 60});
  assert.deepEqual(result.completion, {control: '2/3', assisted: '3/3'});
});

test('missing or zero-denominator measurements are refused rather than advertised as savings', async () => {
  const {studyMetrics} = await import('../scripts/research-site.mjs');
  const missing = example(); delete missing.arms.sol.frontierInput;
  assert.throws(() => studyMetrics(missing), /measurement/i);
  const zero = example(); zero.paired.both = 0;
  assert.throws(() => studyMetrics(zero), /common|matched/i);
  const impossible = example(); impossible.arms.sol.completed = 4;
  assert.throws(() => studyMetrics(impossible), /completion/i);
});

test('a slower and more token-heavy result is shown as an increase, not a saving', async () => {
  const {renderResearch} = await import('../scripts/research-site.mjs');
  const source = structuredClone(recorded);
  source.studies['browser-fresh'] = example();
  source.studies['browser-fresh'].paired.assistedMs = 150000;
  source.studies['browser-fresh'].arms['sol-tev1'].frontierInput = 1250;
  const html = renderResearch(source);
  assert.match(html, /50\.0%/);
  assert.match(html, /more matched driving time/);
  assert.match(html, /25\.0%/);
  assert.match(html, /more frontier input tokens/);
  assert.match(html, /width:66\.7%/);
});
