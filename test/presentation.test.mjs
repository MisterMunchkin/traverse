import test from 'node:test';
import assert from 'node:assert/strict';
import * as presentation from '../src/presentation.mjs';
import {doctorText} from '../src/installation.mjs';

const tty = {stream: {isTTY: true}, env: {TERM: 'xterm-256color'}};
const pipe = {stream: {isTTY: false}, env: {TERM: 'xterm-256color', FORCE_COLOR: '3'}};
const ansi = /\x1b\[[0-9;]*m/;
const strip = value => value.replace(/\x1b\[[0-9;]*m/g, '');
const report = {
  readiness: {extractor: false, configuration: false},
  checks: [
    {name: 'node-version', status: 'pass', evidence: {version: '22.21.1'}},
    {name: 'optional-frontier', status: 'warn', evidence: 'Not configured'},
    {name: 'project-config', status: 'fail', evidence: 'Project setup required', remediation: 'Run traverse init'},
  ],
};

test('terminal help has branded sections and copyable commands without loading a project', () => {
  assert.equal(typeof presentation.helpText, 'function');
  const text = presentation.helpText(tty);
  assert.match(text, ansi);
  const plain = strip(text);
  for (const section of ['◈ Traverse', 'Commands', 'Options', 'Examples']) assert.ok(plain.includes(section), section);
  assert.match(plain, /Usage: traverse init/);
  assert.match(plain, /traverse snapshot --out \.wayfinder\/snapshots\/first/);
  assert.doesNotMatch(plain, /Native\s+[^\n]*driving\s*:|validation.*pending|require-driving/i);
});

test('terminal version is branded and redirected version remains bare semver', () => {
  assert.equal(typeof presentation.versionText, 'function');
  assert.match(presentation.versionText('0.2.1', tty), ansi);
  assert.equal(strip(presentation.versionText('0.2.1', tty)), '◈ Traverse v0.2.1');
  assert.equal(presentation.versionText('0.2.1', pipe), '0.2.1');
});

test('terminal doctor reports configuration failures with evidence and remediation', () => {
  const text = doctorText(report, tty);
  assert.match(text, ansi);
  const plain = strip(text);
  for (const label of ['✓ PASS', '! WARN', '× FAIL', '22.21.1', 'Run traverse init']) assert.ok(plain.includes(label), label);
  assert.match(plain, /Configuration: NOT READY/);
  assert.doesNotMatch(plain, /Native\s+[^\n]*driving\s*:|VALIDATION PENDING/i);
});

for (const [label, options] of [
  ['redirected stream even with FORCE_COLOR', pipe],
  ['dumb terminal', {...tty, env: {TERM: 'dumb', FORCE_COLOR: '3'}}],
  ['CI', {...tty, env: {TERM: 'xterm-256color', CI: 'true', FORCE_COLOR: '3'}}],
]) test(`${label} keeps human output plain`, () => {
  assert.equal(typeof presentation.helpText, 'function');
  assert.equal(typeof presentation.versionText, 'function');
  for (const text of [presentation.helpText(options), presentation.versionText('0.2.1', options), doctorText(report, options)]) {
    assert.doesNotMatch(text, /\x1b|[◈✓×○]/);
  }
  assert.equal(presentation.versionText('0.2.1', options), '0.2.1');
});

test('nonempty NO_COLOR suppresses colour but retains terminal status icons', () => {
  assert.equal(typeof presentation.helpText, 'function');
  assert.equal(typeof presentation.versionText, 'function');
  const options = {...tty, env: {TERM: 'xterm-256color', NO_COLOR: '1', FORCE_COLOR: '3'}};
  for (const text of [presentation.helpText(options), presentation.versionText('0.2.1', options), doctorText(report, options)]) assert.doesNotMatch(text, /\x1b/);
  assert.match(doctorText(report, options), /✓ PASS/);
});

test('empty NO_COLOR does not disable terminal colour', () => {
  assert.match(doctorText(report, {...tty, env: {TERM: 'xterm-256color', NO_COLOR: ''}}), ansi);
});


test('an explicit failed model check cannot produce a ready configuration summary', () => {
  const text = strip(doctorText({readiness: {extractor: true, configuration: false}, checks: [
    {name: 'extractor-smoke', status: 'pass', severity: 'required', evidence: 'healthy'},
    {name: 'managed-model-decision', status: 'fail', severity: 'required', evidence: 'model missing', remediation: 'Run traverse setup'},
  ]}, tty));
  assert.match(text, /Configuration: NOT READY/);
  assert.doesNotMatch(text, /Required checks passed|Source extraction is ready/);
  assert.match(text, /Run traverse setup/);
});

test('frontier escalation guidance starts a new run after the session is closed', () => {
  const text = presentation.drivingText({status: 'needs-frontier', escalation: {reason: 'LOW_MARGIN'}, cleanupErrors: []}, pipe);
  assert.match(text, /session.*closed/i); assert.match(text, /new run/i); assert.match(text, /--frontier-config/);
  assert.doesNotMatch(text, /current controls|resume/i);
});


test('escalation with failed cleanup does not claim that the session closed successfully', () => {
  const text = presentation.drivingText({status: 'needs-frontier', escalation: {reason: 'LOW_MARGIN'}, cleanupErrors: ['close: failed']}, pipe);
  assert.match(text, /cleanup.*attention/i); assert.doesNotMatch(text, /session closed/i);
});
