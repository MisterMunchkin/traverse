import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {runProcess} from '../src/runtime/process.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
for (const implementation of ['graph.mjs', 'project.mjs', 'project-profile.mjs', 'project-next.mjs', 'state.mjs']) test(`graph identity and publication bind ${implementation} implementation bytes`, async t => {
  const parent = process.env.INSTALLER_TEST_EVIDENCE ?? fs.realpathSync(os.tmpdir()); fs.mkdirSync(parent, {recursive: true});
  const dir = fs.mkdtempSync(path.join(parent, 'generator-identity-')), copied = path.join(dir, 'package'), project = path.join(dir, 'expo');
  fs.mkdirSync(copied); fs.mkdirSync(project);
  if (!process.env.INSTALLER_TEST_EVIDENCE) t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  for (const name of ['src', 'package.json', 'npm-shrinkwrap.json', 'node_modules/typescript']) {
    const dest = path.join(copied, name); fs.mkdirSync(path.dirname(dest), {recursive: true}); fs.cpSync(path.join(root, name), dest, {recursive: true, mode: fs.constants.COPYFILE_FICLONE});
  }
  for (const name of ['app', 'components', 'app.json', 'tsconfig.json', 'package.json', 'package-lock.json', 'node_modules/expo/package.json', 'node_modules/expo-router/package.json']) {
    const dest = path.join(project, name); fs.mkdirSync(path.dirname(dest), {recursive: true}); fs.cpSync(path.join(root, 'examples/expo', name), dest, {recursive: true});
  }
  const driver = path.join(dir, 'driver.mjs');
  fs.writeFileSync(driver, `
import fs from 'node:fs';import path from 'node:path';
import {initProject} from './package/src/project.mjs';import {refreshGraph,checkGraph} from './package/src/graph.mjs';
const project=path.join(import.meta.dirname,'expo'),file=path.join(import.meta.dirname,'package/src',${JSON.stringify(implementation)});
initProject({project});await refreshGraph({project});const graph=path.join(project,'.wayfinder/graph.json'),before=fs.readFileSync(graph);
fs.appendFileSync(file,'\\n// generator-only fixture change\\n');const checked=await checkGraph(project);
let error;try{await refreshGraph({project,onProgress:()=>fs.appendFileSync(file,'\\n// concurrent generator change\\n')});}catch(e){error=e.message;}
fs.writeFileSync(path.join(import.meta.dirname,'result.json'),JSON.stringify({stale:!checked.ready,reason:checked.reason,publicationRefused:!!error,error,oldGraphPreserved:fs.readFileSync(graph).equals(before)}));
`);
  const outcome = await runProcess(process.execPath, [driver], {timeoutMs: 30000});
  fs.writeFileSync(path.join(dir, 'process.json'), JSON.stringify(outcome, null, 2));
  const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json')));
  assert.equal(result.stale, true, JSON.stringify(result)); assert.equal(result.publicationRefused, true); assert.match(result.error, /changed during graph generation/); assert.equal(result.oldGraphPreserved, true);
});
