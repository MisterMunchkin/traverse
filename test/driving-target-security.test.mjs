import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeObservation} from '../src/driving/contract.mjs';

const dialog = (appBundleId, role) => ({appBundleId, nodes: [
  {index: 0, role: 'button', label: 'Background action', ref: 'e0'},
  {index: 1, role, label: 'Edit profile'},
  {index: 2, parentIndex: 1, role: 'textbox', label: 'Name', value: '', ref: 'e2'},
  {index: 3, parentIndex: 1, role: 'button', label: 'Save', ref: 'e3'},
]});

for (const platform of ['ios', 'android']) {
  const target = {platform, app: 'com.traverse.requested', device: 'SYNTHETIC-DEVICE'};
  for (const role of ['alert', 'dialog', 'alertdialog']) {
    test(`${platform}: a foreign app's ${role} cannot authorize controls`, () => {
      assert.throws(
        () => normalizeObservation(dialog('com.unrelated.app', role), {target}),
        error => error.code === 'INVALID_OBSERVATION',
      );
    });
    test(`${platform}: a requested-app ${role} preserves its own controls`, () => {
      const observation = normalizeObservation(dialog('com.traverse.requested', role), {target});
      assert.deepEqual(observation.controls.map(control => control.label), ['Name', 'Save']);
      assert.equal(observation.modalScope.status, 'active');
    });
  }
}
