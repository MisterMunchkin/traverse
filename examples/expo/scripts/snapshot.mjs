#!/usr/bin/env node
// Sample-only handoff: no source execution, generic project discovery or graph conversion.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {inspectProject} from '../../../src/project.mjs';
import {PROFILE} from '../../../src/extractor-pipeline/contract.mjs';

export const sampleRoot = fileURLToPath(new URL('../', import.meta.url));
export function snapshot(root = sampleRoot) {
  const result = inspectProject(root,{profile:PROFILE});
  fs.statSync(path.join(root, 'components'));
  for (const file of ['app/_layout.tsx', 'app/index.tsx', 'app/notes/index.tsx', 'app/notes/first.tsx', 'app/notes/edit.tsx']) {
    if (!Object.hasOwn(result.spec.source.files, file)) throw Error(`Missing sample route: ${file}`);
  }
  return {spec: result.spec, provenance: {...result.provenance, schema: 'wayfinder-expo-snapshot/1', limitations: ['Sample-only SDK57/root-app conventions', 'Source inventory, not runtime state or UI effect proof', 'No installed build identity']}};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const {values} = parseArgs({options: {out: {type: 'string'}, help: {type: 'boolean'}}});
    if (values.help) console.log('npm run snapshot -- --out NEW_DIRECTORY\nReads only this sample app/components and routing/package identities. Run npm ci first.');
    else {
      if (!values.out) throw Error('--out NEW_DIRECTORY required');
      const result = snapshot(), out = path.resolve(values.out);
      fs.mkdirSync(out);
      for (const name of ['spec', 'provenance']) fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(result[name], null, 2) + '\n', {flag: 'wx'});
      console.log(JSON.stringify({out, sourceFingerprint: result.provenance.sourceFingerprint, framework: result.spec.framework}, null, 2));
    }
  } catch (error) { console.error(`Snapshot failed: ${error.message}`); process.exitCode = 1; }
}
