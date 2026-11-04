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

const barrelSources = (barrel, extra = {}) => ({
  'app/layout.tsx': 'export default function Layout({children}){return children}',
  'app/page.tsx': `import {Nav} from '../components';export default()=> <Nav/>`,
  'app/login/page.tsx': 'export default()=>null',
  'components/index.ts': barrel,
  'components/leaf.tsx': `import Link from 'next/link';export default()=> <Link href="/login"/>`,
  ...extra,
});
const barrelOptions = {profile: 'next-app-source-inventory/1', routeRoot: 'app', aliases: {'@/*': ['./components/*']}};

test('Next barrel value exports preserve owner, navigation source and forwarding provenance', () => {
  const namedLeaf = `import Link from 'next/link';export function Menu(){return <Link href="/login"/>}`;
  const cases = [
    ['named default re-export', `export {default as Nav} from './leaf';`, {}],
    ['renamed named re-export', `export {Menu as Nav} from './leaf';`, {'components/leaf.tsx': namedLeaf}],
    ['star re-export', `export * from './leaf';`, {'components/leaf.tsx': namedLeaf.replace('Menu()', 'Nav()')}],
    ['forwarded imported alias', `import Menu from './leaf';export {Menu as Nav};`, {}],
    ['forwarded default import', `import Menu from './leaf';export default (Menu);`, {'app/page.tsx': `import Nav from '../components';export default()=> <Nav/>`}],
    ['default re-export', `export {default} from './leaf';`, {'app/page.tsx': `import Nav from '../components';export default()=> <Nav/>`}],
    ['wildcard alias chain', `export {Nav} from './forward';`, {'components/forward.ts': `export {default as Nav} from '@/leaf';`}],
  ];
  for (const [name, barrel, extra] of cases) {
    const files = barrelSources(barrel, extra), graph = extractNavigationSource(files, barrelOptions);
    validateGraph(graph, files, barrelOptions);
    assert.deepEqual(graph.edges.map(e => [e.from, e.to]), [['/', '/login']], name);
    assert.deepEqual(graph.edges[0].source, {file: 'components/leaf.tsx', line: 1, endLine: 1, excerpt: '<Link href="/login"/>'}, name);
    assert.deepEqual(graph.edges[0].componentPath, name === 'wildcard alias chain'
      ? ['app/page.tsx', 'components/index.ts', 'components/forward.ts', 'components/leaf.tsx']
      : ['app/page.tsx', 'components/index.ts', 'components/leaf.tsx'], name);
    assert.deepEqual(extractNavigationSource(Object.fromEntries(Object.entries(files).reverse()), barrelOptions), graph, name);
  }
});

test('Next barrel type-only forwarding cannot acquire runtime ownership or require missing type files', () => {
  const files = barrelSources(`
    export type {Ghost} from './ghost';
    export {type Ghost} from './missing-type';
    export type * from './missing-types';
    import type OnlyType from './ghost';export {OnlyType};
    import {type Ghost as OtherType} from './ghost';export {OtherType};
    export * as DeferredNamespace from './ghost';
    export {type Props, default as Nav} from './leaf';
  `, {'components/ghost.tsx': `import Link from 'next/link';export default()=> <Link href="/login" aria-label="Ghost"/>`});
  const graph = extractNavigationSource(files, barrelOptions);
  validateGraph(graph, files, barrelOptions);
  assert.deepEqual(graph.edges.map(e => [e.from, e.to, e.source.file]), [['/', '/login', 'components/leaf.tsx']]);
  assert.deepEqual(graph.unresolved, []);
});

test('Next barrel missing value targets fail at the export declaration', () => {
  for (const declaration of [`export {default as Nav} from './missing';`, `export * from './missing';`]) {
    assert.throws(() => extractNavigationSource(barrelSources('// barrel\n\n' + declaration), barrelOptions), /components\/index.ts:3:.*re-export.*\.\/missing/);
  }
});

test('Next barrel cycles retain reachable navigation once and respect the existing depth bound', () => {
  const files = barrelSources(`export * from './cycle';export {default as Nav} from './leaf';`, {'components/cycle.ts': `export * from './index';`});
  const graph = extractNavigationSource(files, barrelOptions);
  validateGraph(graph, files, barrelOptions);
  assert.deepEqual(graph.edges.map(e => [e.from, e.to]), [['/', '/login']]);
  const deep = barrelSources(`export * from './b1';`);
  for (let i = 1; i <= 5; i++) deep[`components/b${i}.ts`] = i === 5 ? `export {default as Nav} from './leaf';` : `export * from './b${i + 1}';`;
  const boundary = extractNavigationSource(deep, barrelOptions);
  validateGraph(boundary, deep, barrelOptions);
  assert.deepEqual(boundary.edges[0]?.componentPath, ['app/page.tsx', 'components/index.ts', 'components/b1.ts', 'components/b2.ts', 'components/b3.ts', 'components/b4.ts', 'components/b5.ts', 'components/leaf.tsx']);
  deep['components/b5.ts'] = `export * from './b6';`;
  deep['components/b6.ts'] = `export {default as Nav} from './leaf';`;
  const beyond = extractNavigationSource(deep, barrelOptions);
  assert.deepEqual(beyond.edges, []);
  assert.equal(beyond.limits.componentDepth, 8);
});

test('Next baseUrl configuration is rejected before readiness with supported import alternatives', t => {
  for (const filename of ['tsconfig.json', 'jsconfig.json']) for (const baseUrl of ['.', './', 'src', '', null, false]) {
    const dir = fixture(t);
    write(dir, filename, {compilerOptions: {baseUrl}});
    assert.throws(() => inspectProject(dir), /baseUrl.*relative imports.*wildcard aliases/, `${filename}: ${baseUrl}`);
    assert.equal(fs.existsSync(path.join(dir, '.wayfinder')), false);
  }
});

test('Next barrel CLI init and refresh retain navigation and preserve the last graph on unsupported baseUrl', t => {
  const dir = fixture(t), cli = path.join(root, 'bin/traverse.mjs');
  write(dir, 'app/page.tsx', `import {Menu} from '../components';export default()=> <Menu/>`);
  write(dir, 'components/index.ts', `export {default as Menu} from './menu';`);
  const project = inspectProject(dir), artifact = referenceArtifact(createRequest(project.spec));
  write(dir, 'candidate.json', artifact);
  const run = args => spawnSync(process.execPath, [cli, ...args, '--project', dir, '--json'], {cwd: dir, encoding: 'utf8', timeout: 30000});
  const initialized = run(['init', '--adapter', path.join(dir, 'candidate.json'), '--trust-adapter', artifactHash(artifact)]);
  assert.equal(initialized.status, 0, initialized.stdout + initialized.stderr);
  assert.equal(JSON.parse(initialized.stdout).ready, true);
  const saved = path.join(dir, '.wayfinder/graph.json');
  const menu = () => JSON.parse(fs.readFileSync(saved)).inventory.edges.find(e => e.from === '/' && e.source.file === 'components/menu.tsx' && e.label);
  assert.equal(menu()?.to, '/(members)/account');
  assert.deepEqual(menu().componentPath, ['app/page.tsx', 'components/index.ts', 'components/menu.tsx']);
  write(dir, 'components/menu.tsx', nextCases()[1].files['components/menu.tsx']);
  const refreshed = run(['graph', 'refresh']);
  assert.equal(refreshed.status, 0, refreshed.stdout + refreshed.stderr);
  assert.equal(JSON.parse(refreshed.stdout).authorCalls, 0);
  assert.equal(menu()?.to, '/login');
  const valid = fs.readFileSync(saved);
  write(dir, 'jsconfig.json', {compilerOptions: {baseUrl: '.'}});
  const rejected = run(['graph', 'refresh']);
  assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
  assert.match(JSON.parse(rejected.stdout).error, /baseUrl.*relative imports.*wildcard aliases/);
  assert.deepEqual(fs.readFileSync(saved), valid);
  const fresh = fixture(t);
  write(fresh, 'jsconfig.json', {compilerOptions: {baseUrl: './'}});
  const refused = spawnSync(process.execPath, [cli, 'init', '--project', fresh, '--json'], {cwd: fresh, encoding: 'utf8', timeout: 10000});
  assert.equal(refused.status, 1, refused.stdout + refused.stderr);
  assert.equal(JSON.parse(refused.stdout).ready, false);
  assert.match(JSON.parse(refused.stdout).error, /baseUrl/);
  assert.equal(fs.existsSync(path.join(fresh, '.wayfinder')), false);
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
  assert.equal(accepted.conformance.length, 3);
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

test('reference extractor retains the source diagnostic under long execution paths', async t => {
  const dir = fixture(t), request = createRequest(inspectProject(dir).spec), artifact = referenceArtifact(request);
  const accepted = await accept(request, artifact, approval(artifact), path.join(dir, 'accepted'));
  write(dir, 'app/page.tsx', 'export default function(');
  const newer = createRequest(inspectProject(dir).spec);
  // Node's unhandled stack repeats the entrypoint path; the supervisor keeps only
  // its last 500 characters. Make that failure deterministic on short temp roots too.
  const executionRoot = path.join(dir, 'execution-' + 'x'.repeat(180), 'y'.repeat(100));
  fs.mkdirSync(executionRoot, {recursive: true});
  await assert.rejects(refresh(accepted, newer, path.join(executionRoot, 'refresh')), error => {
    assert.match(error.message, /app\/page.tsx:1: Source contains syntax errors/);
    assert.equal(error.record.code, 1);
    assert.deepEqual(JSON.parse(error.record.stderr), {error: 'app/page.tsx:1: Source contains syntax errors', name: 'Error', code: null});
    return true;
  });
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
