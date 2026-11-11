import fs from 'node:fs';
import {digest} from './extractor-pipeline/contract.mjs';
import {preflightPrivateState, readPrivateState, writePrivateState} from './private-state.mjs';

const require = (condition, message) => { if (!condition) throw Error(message); };
const schema = 'traverse-extractor-execution-grant/1';
function location({project, artifactHash, compatibility, environment}) {
  const binding = {project: fs.realpathSync(project), artifactHash, compatibility: digest(compatibility), environment: digest(environment)};
  return {project, namespace: 'extractor-approvals', key: binding, binding};
}
function bound(accepted, binding) {
  require(accepted && accepted.artifactHash === binding.artifactHash && digest(accepted.artifact) === binding.artifactHash,
    'Private execution approval does not match the pinned extractor');
  require(digest(accepted.compatibility) === binding.compatibility && digest(accepted.environment) === binding.environment,
    'Private execution approval compatibility or environment changed; review required');
}
export function preflightExtractorApproval(inputs) {
  preflightPrivateState(location(inputs));
}
export function readExtractorApproval(inputs) {
  const locationInputs = location(inputs), {binding} = locationInputs;
  const grant = readPrivateState(locationInputs);
  if (!grant) return null;
  require(grant.schema === schema && digest(grant.binding) === digest(binding), 'Private execution approval binding changed; review required');
  bound(grant.accepted, binding);
  return grant.accepted;
}
export function writeExtractorApproval(inputs, accepted) {
  const locationInputs = location(inputs), {binding} = locationInputs;
  bound(accepted, binding);
  writePrivateState(locationInputs, {schema, binding, accepted});
}
