#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {prepare, author, referenceArtifact, artifactHash, review, accept, refresh, read, write} from '../src/extractor-pipeline/pipeline.mjs';
const usage = `Local source-inventory pipeline (no device/model server required)
  prepare --spec SPEC.json --out NEW_DIR
  reference --request REQUEST.json --out NEW_ARTIFACT.json
  author --request REQUEST.json --config CONFIG.json --out NEW_DIR
  inspect --artifact ARTIFACT.json
  review --artifact ARTIFACT.json --hash EXACT_SHA256 --reviewer NAME --trust-host --out NEW_REVIEW.json
  accept --request REQUEST.json --artifact ARTIFACT.json --review REVIEW.json --out NEW_DIR
  refresh --request REQUEST.json --accepted ACCEPTED.json --out NEW_DIR
Review only after reading all artifact bytes/dependencies. --trust-host acknowledges
unrestricted host execution; the cache and subprocess are NOT a security sandbox.
Candidate and validation deadlines default to 5000ms each; --timeout and
--validation-timeout set them independently (1..30000ms). No automatic repairs after execution. Author attempts (1..3) cover command/format
failures only. A revised candidate requires a new hash review and acceptance.`;
export async function extractorMain(args = process.argv.slice(2)) {
const {values: v, positionals} = parseArgs({args, allowPositionals: true, options: Object.fromEntries(['spec', 'request', 'config', 'artifact', 'hash', 'reviewer', 'review', 'accepted', 'out', 'timeout', 'validation-timeout'].map(k => [k, {type: 'string'}]).concat([['trust-host', {type: 'boolean'}], ['help', {type: 'boolean'}]]))});
if (v.help || !positionals.length) { console.log(usage); return; }
const required = key => { if (!v[key]) throw Error(`--${key} required`); return v[key]; };
const load = key => read(required(key));
try {
  const mode = positionals[0]; let result;
  if (mode === 'prepare') result = prepare(load('spec'), required('out'));
  else if (mode === 'reference') { result = referenceArtifact(load('request')); write(required('out'), result); }
  else if (mode === 'author') result = await author(load('request'), load('config'), required('out'));
  else if (mode === 'inspect') { const a = load('artifact'); result = {artifactHash: artifactHash(a), artifact: a, warning: 'Read every file and dependency before review. Host execution is not isolated.'}; }
  else if (mode === 'review') { const a = load('artifact'); if (artifactHash(a) !== required('hash')) throw Error('review hash mismatch'); result = review(a, required('reviewer'), v['trust-host'] ? 'I reviewed these bytes and trust host execution' : ''); write(required('out'), result); }
  else if (mode === 'accept') result = await accept(load('request'), load('artifact'), load('review'), required('out'), {timeoutMs: v.timeout ? Number(v.timeout) : 5000, validationTimeoutMs: v['validation-timeout'] ? Number(v['validation-timeout']) : (v.timeout ? Number(v.timeout) : 5000)});
  else if (mode === 'refresh') result = await refresh(load('accepted'), load('request'), required('out'), {timeoutMs: v.timeout ? Number(v.timeout) : 5000, validationTimeoutMs: v['validation-timeout'] ? Number(v['validation-timeout']) : (v.timeout ? Number(v.timeout) : 5000)});
  else throw Error(`Unknown command ${mode}`);
  console.log(JSON.stringify(mode === 'inspect' ? result : {command: mode, out: v.out, hash: result.acceptanceHash ?? result.requestHash ?? result.artifactHash ?? result.sourceFingerprint ?? artifactHash(result)}, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }

}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await extractorMain();
