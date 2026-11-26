import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {normalizeObservation, expectationHolds} from '../src/driving/contract.mjs';
import {createAgentDeviceRunner} from '../src/driving/agent-device.mjs';

const target = {platform: 'android', app: 'org.example.app', device: 'fixture-serial'};
const system = 'com.android.systemui';
function screen({clock = '11:22', extra = false, suffix = ''} = {}) {
  const chrome = [
    {bundleId: system, type: 'android.widget.TextView', identifier: system + ':id/clock', label: clock, rect: {x: 5, y: 0, width: 40, height: 20}},
    ...(extra ? [{bundleId: system, type: 'android.widget.ImageView', label: 'Signal full', rect: {x: 50, y: 0, width: 10, height: 20}}] : []),
  ];
  return {appBundleId: target.app, nodes: [...chrome,
    {bundleId: target.app, type: 'android.widget.FrameLayout', rect: {x: 0, y: 0, width: 100, height: 200}},
    {bundleId: target.app, type: 'android.widget.Button', label: 'Save', hittable: true, rect: {x: 10, y: 50, width: 80, height: 40}, parentIndex: chrome.length},
  ].map((n, index) => ({...n, index, ref: 'e' + index + suffix}))};
}
function runner(t, snapshots) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'traverse-android-')));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const calls = [];
  const r = createAgentDeviceRunner({executable: '/fixture/agent-device', session: 'android-owned', directory: dir, target,
    execute: async (command, args) => {
      calls.push(args);
      const data = args[0] === 'snapshot' ? snapshots.shift() : {message: 'acknowledged'};
      assert.ok(data, 'unexpected snapshot');
      return {command, args, code: 0, signal: null, stdout: JSON.stringify({success: true, data}), stderr: '', elapsedMs: 1};
    }});
  return {r, calls};
}

test('Android clock and signal changes preserve the app action and use its refreshed ref', async t => {
  const {r, calls} = runner(t, [screen(), screen({clock: '11:23', extra: true, suffix: '~s2'}), screen({clock: '11:23', extra: true, suffix: '~s3'})]);
  const o = await r.observe();
  assert.deepEqual(o.controls.map(n => n.label), ['Save']);
  const result = await r.act({observationId: o.id, type: 'press', target: o.controls[0].id});
  assert.equal(result.execution, 'acknowledged');
  assert.deepEqual(calls.find(args => args[0] === 'press').slice(0, 2), ['press', '@e3~s2']);
  assert.equal(expectationHolds({visible: [{label: '11:23'}]}, result.observation), false);
});

for (const [name, change] of [
  ['text', n => {n.label = 'Delete';}],
  ['enabled state', n => {n.enabled = false;}],
  ['geometry', n => {n.rect.x = 11;}],
  ['visibility', n => {n.visibleToUser = false;}],
  ['modal', n => {n.type = 'android.app.Dialog';}],
]) test(`Android real app ${name} change rejects before dispatch`, async t => {
  const changed = screen(); change(changed.nodes.at(-1));
  const {r, calls} = runner(t, [screen(), changed]);
  const o = await r.observe();
  await assert.rejects(r.act({observationId: o.id, type: 'press', target: o.controls[0].id}), {code: 'STALE_OBSERVATION'});
  assert.deepEqual(calls.map(args => args[0]), ['snapshot', 'snapshot']);
});

for (const [name, change] of [
  ['foreign app under the requested top-level identity', s => {for (const n of s.nodes) if (n.bundleId === target.app) n.bundleId = 'org.example.browser';}],
  ['mixed app windows', s => {s.nodes.at(-1).bundleId = 'org.example.browser';}],
  ['missing node ownership', s => {delete s.nodes.at(-1).bundleId;}],
  ['system-only screen', s => {s.nodes.splice(1);}],
  ['unknown SystemUI window', s => {s.nodes.push({index: 9, bundleId: system, type: 'android.widget.FrameLayout', label: 'Notification shade'});}],
  ['system permission dialog', s => {s.nodes.push({index: 9, bundleId: system, type: 'android.app.Dialog', identifier: system + ':id/clock'});}],
]) test(`Android rejects ${name}`, () => {
  const s = screen(); change(s);
  assert.throws(() => normalizeObservation(s, {target}), {code: 'INVALID_OBSERVATION'});
});

test('foreign post-action observation leaves the action acknowledged and effect unverified', async t => {
  const foreign = screen(); foreign.nodes.forEach(n => {if (n.bundleId === target.app) n.bundleId = 'org.example.browser';});
  const {r, calls} = runner(t, [screen(), screen(), foreign]);
  const o = await r.observe();
  await assert.rejects(r.act({observationId: o.id, type: 'press', target: o.controls[0].id}), e => {
    assert.equal(e.code, 'INVALID_OBSERVATION');
    assert.equal(e.actionEvidence.execution, 'acknowledged');
    assert.equal(e.actionEvidence.effect, 'unverified');
    return true;
  });
  assert.equal(calls.filter(args => args[0] === 'press').length, 1);
});

test('navigation chrome never supplies app controls or expectation evidence', () => {
  const s = screen();
  s.nodes.push({index: 9, bundleId: system, type: 'android.widget.FrameLayout', identifier: system + ':id/navigation_bar_frame'});
  s.nodes.push({index: 10, parentIndex: 9, bundleId: system, type: 'android.widget.ImageView', label: 'Home', hittable: true, ref: 'e10'});
  const o = normalizeObservation(s, {target});
  assert.deepEqual(o.nodes.map(n => n.label), ['', 'Save']);
  assert.equal(expectationHolds({visible: [{label: 'Home'}]}, o), false);
});

test('a standalone Wi-Fi status icon is excluded only inside a known status band', () => {
  const s = screen({extra: true});
  s.nodes[1].identifier = system + ':id/wifi_signal';
  const o = normalizeObservation(s, {target});
  assert.deepEqual(o.nodes.map(n => n.label), ['', 'Save']);
  s.nodes[1].rect.y = 70;
  assert.throws(() => normalizeObservation(s, {target}), {code: 'INVALID_OBSERVATION'});
});

for (const [name, change] of [
  ['missing parent', s => {s.nodes.at(-1).parentIndex = 99;}],
  ['cross-owner parent', s => {s.nodes.at(-1).parentIndex = 0;}],
  ['cyclic hierarchy', s => {s.nodes[1].parentIndex = 2;}],
  ['duplicate index', s => {s.nodes.at(-1).index = 0;}],
]) test(`Android rejects ${name} before projecting chrome away`, () => {
  const s = screen(); change(s);
  assert.throws(() => normalizeObservation(s, {target}), {code: 'INVALID_OBSERVATION'});
});

test('hidden app ancestors cannot establish foreground ownership through a visible child', () => {
  const s = screen(); s.nodes[1].visibleToUser = false;
  assert.throws(() => normalizeObservation(s, {target}), {code: 'INVALID_OBSERVATION'});
});
