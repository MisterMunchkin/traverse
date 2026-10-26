// Pipeline-owned worker. Candidates cannot supply or select this validator.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {extractNavigationSource} from '../source/navigation.mjs';
import {extractionOptions} from './profiles.mjs';
import {validateGraph, digest} from './contract.mjs';
try {
  const {files, compatibility, candidateOutput} = JSON.parse(fs.readFileSync(0, 'utf8'));
  const options=extractionOptions(compatibility);
  const graph = validateGraph(JSON.parse(candidateOutput), files, options);
  const reference = validateGraph(extractNavigationSource(files, options), files, options);
  assert.equal(digest(graph), digest(reference), 'REFERENCE_SEMANTICS_MISMATCH: fabricated or omitted source facts');
  process.stdout.write(JSON.stringify(graph));
} catch (error) {
  // The supervisor truncates exception summaries; retain the actual named violation.
  console.error(JSON.stringify({error: error.message.split('\n')[0], name: error.name, code: error.code ?? null}));
  process.exitCode = 1;
}
