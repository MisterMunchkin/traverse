import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const load = () => import('../src/driving/agent-device.mjs');
const contract = () => import('../src/driving/contract.mjs');
const web = (value = '', suffix = '') => ({nodes: [
  {index: 0, role: 'heading', label: 'Profile'},
  {index: 1, role: 'textbox', label: 'Name', value, ref: 'e1' + suffix},
  {index: 2, role: 'button', label: 'Save', ref: 'e2' + suffix},
  {index: 3, role: 'button', label: 'Disabled', disabled: true, ref: 'e3'},
  {index: 4, role: 'button', label: 'Hidden', visible: false, ref: 'e4'},
]});
function fixture(t, snapshots, fail = null) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wayfinder-runner-')));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const calls = [];
  const execute = async (command, args) => {
    calls.push({command, args});
    if (fail?.(args, calls)) throw Error('DEADLINE: fixture command');
    const data = args[0] === 'snapshot' ? snapshots.shift() : {message: 'acknowledged'};
    assert.ok(data, 'unexpected extra snapshot');
    return {command, args, code: 0, signal: null, stdout: JSON.stringify({success: true, data}), stderr: '', elapsedMs: 1};
  };
  return {dir, calls, execute};
}

test('observation separates live controls from graph context and preserves opaque pinned refs', async () => {
  const {normalizeObservation} = await contract();
  const o = normalizeObservation(web('', '~s7'), {target: {platform: 'web', app: 'http://127.0.0.1'}});
  assert.equal(o.schema, 'wayfinder-observation/1');
  assert.deepEqual(o.controls.map(c => c.label), ['Name', 'Save']);
  assert.equal(o.controls[0].ref, '@e1~s7');
  assert.equal(o.controls[0].value, '');
  assert.equal(o.route, undefined);
  assert.ok(o.id); assert.ok(o.fingerprint);
});

test('native modal scopes offered actions to descendants and keeps unknown overlays visible', async () => {
  const {normalizeObservation} = await contract();
  const o = normalizeObservation({nodes: [
    {index: 0, type: 'Button', label: 'Checkout', ref: 'e0'},
    {index: 1, type: 'Alert', label: 'Allow notifications?', ref: 'e1'},
    {index: 2, parentIndex: 1, type: 'Button', label: 'Allow', ref: 'e2'},
    {index: 3, parentIndex: 1, type: 'Button', label: 'Not now', ref: 'e3'},
    {index: 4, type: 'SecureTextField', label: 'Password', value: 'private', ref: 'e4'},
  ]}, {target: {platform: 'ios', app: 'fixture'}});
  assert.deepEqual(o.controls.map(c => c.label), ['Allow', 'Not now']);
  assert.equal(o.overlays[0].label, 'Allow notifications?');
  assert.ok(!JSON.stringify(o).includes('private'));
  assert.throws(() => normalizeObservation({nodes: [], truncated: true}), /truncated/i);
});

test('controls inherit hidden/disabled ancestors and a foreign native app cannot supply actions', async () => {
  const {normalizeObservation} = await contract();
  const o = normalizeObservation({nodes: [
    {index: 0, role: 'group', visible: false},
    {index: 1, parentIndex: 0, role: 'button', label: 'Hidden child', ref: 'e1'},
    {index: 2, role: 'group', enabled: false},
    {index: 3, parentIndex: 2, role: 'button', label: 'Disabled child', ref: 'e3'},
    {index: 4, role: 'button', label: 'Visible', ref: 'e4'},
  ]});
  assert.deepEqual(o.controls.map(c => c.label), ['Visible']);
  assert.throws(() => normalizeObservation({appBundleId: 'com.other', nodes: [{type: 'Button', ref: 'e1'}]}, {target: {platform: 'ios', app: 'com.requested', device: 'UDID'}}), /app/i);
});

test('act revalidates semantic state and uses fresh refs before confirming a field value', async t => {
  const f = fixture(t, [web(), web('', '~s8'), web('Updated', '~s9')]);
  const {createAgentDeviceRunner} = await load();
  const r = createAgentDeviceRunner({executable: '/fixture/agent-device', session: 'owned-123', directory: f.dir, target: {platform: 'web', app: 'http://fixture'}, execute: f.execute});
  const o = await r.observe(), field = o.controls.find(c => c.label === 'Name');
  const result = await r.act({observationId: o.id, type: 'fill', target: field.id, value: 'Updated'});
  assert.equal(result.execution, 'acknowledged');
  assert.equal(result.observation.controls.find(c => c.label === 'Name').value, 'Updated');
  const fill = f.calls.find(c => c.args[0] === 'fill');
  assert.deepEqual(fill.args.slice(0, 3), ['fill', '@e1~s8', 'Updated']);
  assert.ok(fill.args.includes('owned-123'));
  assert.equal(fs.readdirSync(path.join(f.dir, 'commands')).length, 4);
});

test('changed UI rejects an old action without dispatching and returns the new observation', async t => {
  const f = fixture(t, [web(), web('Someone else edited')]);
  const {createAgentDeviceRunner} = await load();
  const r = createAgentDeviceRunner({executable: '/fixture/ad', session: 'owned', directory: f.dir, target: {platform: 'web', app: 'http://fixture'}, execute: f.execute});
  const o = await r.observe();
  await assert.rejects(r.act({observationId: o.id, type: 'press', target: o.controls[1].id}), e => {
    assert.equal(e.code, 'STALE_OBSERVATION'); assert.ok(e.actionEvidence.observation); return true;
  });
  assert.ok(f.calls.every(c => c.args[0] === 'snapshot'));
});

test('a missing post-action observation preserves acknowledgement and uncertain effect without retry', async t => {
  const f = fixture(t, [web(), web()], (args, calls) => args[0] === 'snapshot' && calls.length === 4);
  const {createAgentDeviceRunner} = await load();
  const r = createAgentDeviceRunner({executable: '/fixture/ad', session: 'owned', directory: f.dir, target: {platform: 'web', app: 'http://fixture'}, execute: f.execute});
  const o = await r.observe();
  await assert.rejects(r.act({observationId: o.id, type: 'press', target: o.controls[1].id}), e => {
    assert.equal(e.actionEvidence.execution, 'acknowledged'); assert.equal(e.actionEvidence.effect, 'unverified'); return true;
  });
  assert.equal(f.calls.filter(c => c.args[0] === 'press').length, 1);
});

test('runner pins native target on open and only its session on subsequent commands/cleanup', async t => {
  const f = fixture(t, [web()]);
  const {createAgentDeviceRunner} = await load();
  const r = createAgentDeviceRunner({executable: '/fixture/ad', session: 'owned', directory: f.dir, target: {platform: 'ios', app: 'dev.fixture', device: 'EXPLICIT-UDID'}, execute: f.execute});
  await r.open(); await r.observe(); await r.close();
  assert.deepEqual(f.calls[0].args.slice(0, 6), ['open', 'dev.fixture', '--platform', 'ios', '--udid', 'EXPLICIT-UDID']);
  assert.ok(f.calls[1].args.includes('owned')); assert.ok(!f.calls[1].args.includes('--udid'));
  assert.ok(!f.calls.at(-1).args.includes('--shutdown'));
  assert.deepEqual(r.capabilities.lifecycle, {list: true, boot: true, shutdown: true, create: false, delete: false});
});

test('unknown actions and stale observation IDs fail before any UI command', async t => {
  const f = fixture(t, [web()]); const {createAgentDeviceRunner} = await load();
  const r = createAgentDeviceRunner({executable: '/fixture/ad', session: 'owned', directory: f.dir, target: {platform: 'web', app: 'http://fixture'}, execute: f.execute});
  const o = await r.observe();
  await assert.rejects(r.act({observationId: o.id, type: 'delete-simulator'}), /action/i);
  await assert.rejects(r.act({observationId: 'old', type: 'press', target: o.controls[1].id}), /observation/i);
  assert.equal(f.calls.length, 1);
});

test('native class roles and Android class types preserve semantic buttons without promoting generic views', async () => {
  const {normalizeObservation} = await contract();
  for (const [platform, nodes] of [
    ['ios', [{type: 'Button', role: 'RCTViewComponentView'}, {type: 'Other', role: 'RCTViewComponentView'}]],
    ['android', [{type: 'android.widget.Button'}, {type: 'android.widget.TextView'}, {type: 'android.view.View'}]],
  ]) {
    const o = normalizeObservation({nodes: nodes.map((n, i) => ({...n, label: i ? 'Text' : 'Dismiss', ref: `e${i}`, hittable: true}))}, {target: {platform}});
    assert.deepEqual(o.controls.map(c => [c.role, c.label]), [['button', 'Dismiss']]);
  }
});

test('native secure fields, invisible and covered ancestors, and conflicting roles fail closed', async () => {
  const {normalizeObservation} = await contract();
  const o = normalizeObservation({nodes: [
    {index: 0, type: 'android.widget.EditText', password: true, value: 'secret', ref: 'e0'},
    {index: 1, type: 'android.view.View', visibleToUser: false},
    {index: 2, parentIndex: 1, type: 'android.widget.Button', ref: 'e2'},
    {index: 3, type: 'android.view.View', interactionBlocked: 'covered'},
    {index: 4, parentIndex: 3, type: 'android.widget.Button', ref: 'e4'},
    {index: 5, type: 'Button', role: 'textbox', ref: 'e5'},
    {index: 6, type: 'android.widget.EditText', label: 'Name', ref: 'e6'},
  ]}, {target: {platform: 'android'}});
  assert.deepEqual(o.controls.map(c => c.label), ['Name']);
  assert.ok(!JSON.stringify(o).includes('secret'));
  assert.equal(o.controls[0].role, 'textbox');
});

test('longpress uses refreshed native refs, bounded duration and observes after release', async t => {
  const screen = suffix => ({nodes: [{type: 'Button', role: 'RCTViewComponentView', label: 'Hold', ref: 'e1' + suffix}]});
  const f = fixture(t, [screen(''), screen('~s8'), screen('~s9')]);
  const {createAgentDeviceRunner} = await load();
  const r = createAgentDeviceRunner({executable: '/fixture/ad', session: 'owned', directory: f.dir, target: {platform: 'ios', app: 'fixture', device: 'UDID'}, execute: f.execute});
  const o = await r.observe();
  const result = await r.act({observationId: o.id, type: 'longpress', target: 'control-0', durationMs: 900});
  assert.equal(result.execution, 'acknowledged');
  assert.equal(result.effect, 'unverified');
  assert.deepEqual(f.calls.map(c => c.args[0]), ['snapshot', 'snapshot', 'longpress', 'snapshot']);
  assert.deepEqual(f.calls[2].args.slice(0, 3), ['longpress', '@e1~s8', '900']);
  assert.ok(r.capabilities.actions.includes('longpress'));
});

test('longpress validates duration and does not retry uncertain dispatch', async t => {
  const {validateAction} = await contract();
  const action = {observationId: 'o', type: 'longpress', target: 'control-2'};
  assert.doesNotThrow(() => validateAction(action));
  for (const durationMs of [0, -1, 10001, 1.5, '800', null]) assert.throws(() => validateAction({...action, durationMs}), /duration/i);
  assert.throws(() => validateAction({...action, type: 'press', durationMs: 800}), /fields/i);
  const f = fixture(t, [web(), web('', '~s8')], args => args[0] === 'longpress');
  const {createAgentDeviceRunner} = await load();
  const r = createAgentDeviceRunner({executable: '/fixture/ad', session: 'owned', directory: f.dir, target: {platform: 'web', app: 'http://fixture'}, execute: f.execute});
  const o = await r.observe();
  await assert.rejects(r.act({...action, observationId: o.id}), e => {
    assert.equal(e.actionEvidence.execution, 'uncertain'); return true;
  });
  assert.deepEqual(f.calls.find(c => c.args[0] === 'longpress').args.slice(0, 3), ['longpress', '@e2~s8', '800']);
  assert.equal(f.calls.filter(c => c.args[0] === 'longpress').length, 1);
});

test('conflicting native modal roles reject the observation instead of exposing background controls', async () => {
  const {normalizeObservation} = await contract();
  for (const [type, role, password] of [['Dialog', 'alert'], ['Dialog', 'button'], ['SecureTextField', 'alert'], ['Dialog', 'RCTViewComponentView', true]]) {
    assert.throws(() => normalizeObservation({nodes: [
      {index: 0, type, role, password},
      {index: 1, parentIndex: 0, type: 'Button', label: 'Cancel', ref: 'e1'},
      {index: 2, type: 'Button', label: 'Background Delete', ref: 'e2'},
    ]}, {target: {platform: 'ios'}}), /modal/i);
  }
});
