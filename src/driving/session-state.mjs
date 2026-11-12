import fs from 'node:fs';
import {digest} from '../extractor-pipeline/contract.mjs';
import {preflightPrivateState, readPrivateState, writePrivateState} from '../private-state.mjs';
import {need} from './contract.mjs';

const schema = 'traverse-private-driving-session/1';
function location(project, name) {
  need(typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name), 'Invalid session name');
  const key = {project: fs.realpathSync(project), name};
  return {project, namespace: 'driving-sessions', key};
}
export function preflightSessionState(project, name) {
  const inputs = location(project, name);
  preflightPrivateState(inputs);
  need(!readPrivateState(inputs), 'Session name already exists; choose a fresh --session name');
}
export function readSessionState(project, name) {
  const inputs = location(project, name), record = readPrivateState(inputs);
  need(record, 'No locally created session; open a fresh session name');
  need(record.schema === schema && digest(record.binding) === digest(inputs.key), 'Invalid private session binding');
  return record.state;
}
export function writeSessionState(project, state) {
  const inputs = location(project, state.name);
  writePrivateState(inputs, {schema, binding: inputs.key, state});
}
