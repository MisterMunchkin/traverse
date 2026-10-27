import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {inspectProject, initProject} from '../src/project.mjs';
import {extractNavigationSource} from '../src/source/navigation.mjs';
import {validateGraph, digest} from '../src/extractor-pipeline/contract.mjs';
import {nextCases, nextFacts} from '../src/extractor-pipeline/fixtures-next.mjs';
import {extractionOptions} from '../src/extractor-pipeline/profiles.mjs';
import {createRequest, referenceArtifact, accept, refresh, review, artifactHash, environmentIdentity} from '../src/extractor-pipeline/pipeline.mjs';
import {checkGraph, refreshGraph, watchGraph} from '../src/graph.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const write = (root, name, value) => { fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true}); fs.writeFileSync(path.join(root, name), typeof value === 'string' ? value : JSON.stringify(value)); };
function fixture(t, routeRoot = 'app') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'traverse-next-')));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const dependencies = {next: '16.0.11', react: '19.2.9', 'react-dom': '19.2.9'};
  write(dir, 'package.json', {dependencies});
  write(dir, 'package-lock.json', {lockfileVersion: 3, packages: {'': {dependencies}, ...Object.fromEntries(Object.entries(dependencies).map(([name, version]) => ['node_modules/' + name, {version}]))}});
  for (const [name, version] of Object.entries(dependencies)) write(dir, `node_modules/${name}/package.json`, {name, version});
  for (const [name, text] of Object.entries(nextCases(routeRoot)[0].files)) write(dir, name, text);
  return dir;
}
const extract = project => extractNavigationSource(project.spec.source.files, extractionOptions(project.spec));
const approval = artifact => review(artifact, 'synthetic fixture exact-byte review', 'I reviewed these bytes and trust host execution');

for (const routeRoot of ['app', 'src/app']) test(`Next ${routeRoot}: deterministic independent pages, layouts, params, redirects and uncertainty`, t => {
  const dir = fixture(t, routeRoot), project = inspectProject(dir), options = extractionOptions(project.spec);
  assert.equal(project.config.profile, 'next-app-source-inventory/1');
  assert.deepEqual(project.provenance.versions, {next: '16.0.11', react: '19.2.9', 'react-dom': '19.2.9'});
  for (const c of nextCases(routeRoot)) {
    const g = extractNavigationSource(c.files, options); nextFacts(validateGraph(g, c.files, options), c);
    assert.deepEqual(extractNavigationSource(Object.fromEntries(Object.entries(c.files).reverse()), options), g);
  }
  assert.equal(fs.existsSync(path.join(dir, '.wayfinder')), false);
});

test('Next alias/JS inputs retain original source paths and bounded config hashes', t => {
  const dir = fixture(t, 'src/app');
  write(dir, 'src/app/page.tsx', `import Menu from '@/menu';export default()=> <Menu/>`);
  write(dir, 'jsconfig.json', {compilerOptions: {paths: {'@/*': ['./components/*']}}});
  write(dir, 'next.config.mjs', 'export default {};');
  write(dir, 'src/app/logo.png', 'not-source');
  const p = inspectProject(dir), g = extract(p);
  assert.ok(p.provenance.inputHashes['next.config.mjs']);
  assert.ok(p.provenance.inputHashes['jsconfig.json']);
  assert.ok(!g.files['src/app/logo.png']);
  assert.ok(g.edges.some(e => e.source.file === 'components/menu.tsx' && e.componentPath[0] === 'src/app/page.tsx'));
});

test('Next unsupported inputs fail precisely without executing config or writing state', t => {
  const mutations = [
    ['next.config.ts', `throw Error('MUST-NOT-EXECUTE'); export default {env:{secret:process.env.SECRET}}`, /next.config.ts:1:.*never executed/],
    ['next.config.js', 'module.exports={basePath:"/custom"}', /basePath/],
    ['app/@modal/page.tsx', 'export default()=>null', /app\/@modal\/page.tsx:1: Parallel/],
    ['app/(.)photos/page.tsx', 'export default()=>null', /intercepting/],
    ['app/lazy/page.tsx', "import dynamic from 'next/dynamic';export default dynamic(()=>import('./other'))", /lazy\/generated/],
    ['app/broken/page.tsx', 'export default function(', /syntax errors/],
    ['app/layout.jsx', 'export default()=>null', /Ambiguous layout/],
    ['app/shadow/page.tsx', "import {redirect} from 'next/navigation';export default function Page(){const f=function redirect(){redirect('/login')};return null}", /Shadowed navigation/],
    ['app/namespace/page.tsx', "import * as nav from 'next/navigation';export default function Page(){nav.redirect('/login');return null}", /Namespace navigation/],
    ['app/reexport/page.tsx', "export {default} from './generated'", /direct default export/],
    ['app/missing/page.tsx', "import Missing from './absent';export default()=> <Missing/>", /Missing local component input/],
    ['app/docs/[...all]/nested/page.tsx', 'export default()=>null', /catch-all must be terminal/],
    ['middleware.ts', 'throw Error("MUST-NOT-EXECUTE")', /middleware.ts:.*deferred/],
    ['pages/index.tsx', 'export default()=>null', /Pages Router/],
    ['src/app/page.tsx', 'export default()=>null', /ambiguous roots/],
    ['tsconfig.json', {compilerOptions:{paths:{'@/*':['/absolute/*']}}}, /project-relative/],
    ['tsconfig.json', {extends: './generated.json'}, /inherited/],
    ['tsconfig.json', {compilerOptions: {paths: {'@/*': ['../private/*']}}}, /project-relative/],
    ['tsconfig.json', {compilerOptions: {paths: {'@/*': ['./src/*'], '@/ui/*': ['./components/*']}}}, /overlapping/],
    ['node_modules/next/package.json', {name: 'next', version: '16.1.0'}, /incompatible.*next/],
    ['node_modules/react/package.json', {name: 'react', version: '18.2.0'}, /incompatible.*react/],
  ];
  for (const [name, value, expected] of mutations) {
    const dir = fixture(t); write(dir, name, value);
    assert.throws(() => extract(inspectProject(dir)), expected, name);
    assert.equal(fs.existsSync(path.join(dir, '.wayfinder')), false);
  }
  const dir = fixture(t); fs.rmSync(path.join(dir, 'package-lock.json'));
  assert.throws(() => inspectProject(dir), /ENOENT.*package-lock.json/);
});

test('Next static route priority, catchalls, groups and dynamic targets are honest', t => {
  const dir = fixture(t);
  write(dir, 'app/page.tsx', 'import Link from "next/link";export default()=> <><Link href="/posts/new"/><Link href="/same"/><Link href={`/posts/${id}`}/><Link href="//external.test"/><Link href="/login" {...props}/></>');
  write(dir, 'app/posts/new/page.tsx', 'export default()=>null');
  write(dir, 'app/(a-b)/same/page.tsx', 'export default()=>null');
  write(dir, 'app/(a_b)/same/page.tsx', 'export default()=>null');
  const p = inspectProject(dir), g = extract(p); validateGraph(g, p.spec.source.files, extractionOptions(p.spec));
  assert.ok(g.edges.some(e => e.from === '/' && e.target === '/posts/new' && e.to === '/posts/new'));
  assert.ok(g.unresolved.some(e => e.reason === 'ambiguous-route' && e.candidates.join() === '/(a-b)/same,/(a_b)/same'));
  assert.equal(g.unresolved.filter(e => e.owner === '/' && e.reason === 'dynamic-target').length, 2);
  assert.ok(g.unresolved.some(e => e.reason === 'external-target' && e.target === '//external.test'));
  const forged = structuredClone(g); forged.nodes[0].id = '/fabricated';
  assert.throws(() => validateGraph(forged, p.spec.source.files, extractionOptions(p.spec)), /fabricated route identity/);
});

test('Next mixed dynamic branches, repeated controls and destructured shadowing retain uncertainty', t => {
  const dir=fixture(t);
  write(dir,'app/util.ts','export const identity = <T>(value: T): T => value;');
  write(dir,'app/page.tsx', `import Link from 'next/link';export default()=> <><Link href={signedIn ? '/login' : unknown}/><Link href="/login"/><Link href="/login"/></>`);
  let p=inspectProject(dir),g=extract(p);validateGraph(g,p.spec.source.files,extractionOptions(p.spec));
  assert.ok(g.unresolved.some(e=>e.owner==='/'&&e.reason==='dynamic-target'));
  assert.equal(g.edges.filter(e=>e.from==='/'&&e.source.file==='app/page.tsx').length,2);
  assert.equal(new Set(g.edges.map(e=>e.id)).size,g.edges.length);
  write(dir,'app/guard/page.tsx', "import {redirect} from 'next/navigation';export default function Page(){signedIn || redirect('/login');return null}");
  p=inspectProject(dir);g=extract(p);assert.deepEqual(g.edges.find(e=>e.from==='/guard'&&e.kind==='redirect').conditions.map(c=>[c.expression,c.truthy]),[['signedIn',false]]);
  write(dir,'app/page.tsx', `import Link from 'next/link';export default function Page({Link}){return <Link href="/login"/>}`);
  assert.throws(()=>extract(inspectProject(dir)),/Shadowed navigation binding/);
});

test('Next acceptance, exact trust, independent rejection and source refresh reuse shared pipeline', async t => {
  const dir = fixture(t), project = inspectProject(dir), request = createRequest(project.spec), artifact = referenceArtifact(request);
  const changed = structuredClone(artifact); changed.files['extract.mjs'] += '\n// changed';
  await assert.rejects(accept(request, changed, approval(artifact), path.join(dir, 'unreviewed')), /review does not bind/);
  const accepted = await accept(request, artifact, approval(artifact), path.join(dir, 'accepted'));
  assert.equal(accepted.conformance.length, 2);
  const altered = structuredClone(artifact);
  altered.files['extract.mjs'] = artifact.files['extract.mjs'].replace('process.stdout.write(JSON.stringify(', 'const g=(').replace(')));', '));g.edges[0].label="Fabricated";process.stdout.write(JSON.stringify(g));');
  await assert.rejects(accept(request, altered, approval(altered), path.join(dir, 'fabricated')), /REFERENCE_SEMANTICS_MISMATCH/);
  write(dir, 'components/menu.tsx', nextCases()[1].files['components/menu.tsx']);
  const newer = createRequest(inspectProject(dir).spec);
  const g = await refresh(accepted, newer, path.join(dir, 'refreshed'));
  nextFacts(g, nextCases()[1]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'refreshed/refresh.json'))).authorCalls, 0);
  const incompatible = structuredClone(newer); incompatible.compatibility.routing.config.aliases = {'@/*': ['./components/*']};
  const different = createRequest({...incompatible.compatibility, source: newer.source});
  await assert.rejects(refresh(accepted, different, path.join(dir, 'incompatible')), /CACHE_INCOMPATIBLE/);
  const identity = environmentIdentity();
  for (const file of ['src/source/next.mjs', 'src/project-next.mjs']) assert.ok(identity.reference[file]);
  assert.ok(identity.pipeline['fixtures-next.mjs']);
});

test('Next CLI graph lifecycle and existing runtime preflight consume unchanged graph contract', async t => {
  const dir = fixture(t), cli = path.join(root, 'bin/traverse.mjs'), p = inspectProject(dir);
  const artifact = referenceArtifact(createRequest(p.spec)), file = path.join(dir, 'candidate.json'); write(dir, 'candidate.json', artifact);
  const result = spawnSync(process.execPath, [cli, 'init', '--adapter', file, '--trust-adapter', artifactHash(artifact), '--json'], {cwd: dir, encoding: 'utf8', timeout: 30000});
  assert.equal(result.status, 0, result.stdout + result.stderr); assert.equal(JSON.parse(result.stdout).ready, true);
  const {drivingProject} = await import('../src/driving/sessions.mjs');
  assert.equal((await drivingProject(dir)).graph.schemaVersion, 1);
  const saved = path.join(dir, '.wayfinder/graph.json'), before = fs.readFileSync(saved);
  write(dir, 'components/menu.tsx', nextCases()[1].files['components/menu.tsx']);
  assert.equal((await checkGraph(dir)).ready, false);
  assert.equal((await refreshGraph({project: dir})).authorCalls, 0);
  assert.equal((await checkGraph(dir)).ready, true);
  assert.notEqual(digest(fs.readFileSync(saved)), digest(before));
  const valid = fs.readFileSync(saved); write(dir, 'app/page.tsx', 'export default function(');
  await assert.rejects(refreshGraph({project: dir}), /syntax errors/);
  assert.deepEqual(fs.readFileSync(saved), valid, 'failed extraction preserves last valid graph');
});

test('Next watch refreshes accepted code and reports unsupported config as stale', async t => {
  const dir = fixture(t), p = inspectProject(dir), artifact = referenceArtifact(createRequest(p.spec));
  initProject({project: dir}); write(dir, '.wayfinder/extractor/artifact.json', artifact);
  // The pipeline approval receipt is host-local; authorize the same bytes through init.
  const result=spawnSync(process.execPath,[path.join(root,'bin/traverse.mjs'),'init','--adapter',path.join(dir,'.wayfinder/extractor/artifact.json'),'--trust-adapter',artifactHash(artifact),'--json'],{cwd:dir,encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stdout+result.stderr);
  const controller = new AbortController(), events = [];
  const deadline = setTimeout(() => controller.abort(), 15000); t.after(() => clearTimeout(deadline));
  const saved = path.join(dir, '.wayfinder/graph.json'); let valid;
  await watchGraph({project: dir, signal: controller.signal, debounceMs: 15, onEvent(event) {
    events.push(event);
    if (events.length === 1) write(dir, 'components/menu.tsx', nextCases()[1].files['components/menu.tsx']);
    else if (events.length === 2) { valid = fs.readFileSync(saved); write(dir, 'next.config.mjs', 'export default {basePath:"/custom"}'); }
    else controller.abort();
  }});
  assert.deepEqual(events.map(e => e.status), ['ready', 'ready', 'stale']);
  assert.ok(events.slice(0, 2).every(e => e.authorCalls === 0));
  assert.deepEqual(fs.readFileSync(saved), valid);
});
