import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const CONTRACT = Object.freeze({schema: 'traverse-navigation', schemaVersion: 1});
export const PROFILE = 'expo-source-inventory/1';
export const sha = value => createHash('sha256').update(value).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export const json = value => JSON.stringify(canonical(value));
export const digest = value => sha(json(value));
export function object(value, required, optional = [], label = 'object') {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label}: expected object`);
  assert.ok(required.every(k => Object.hasOwn(value, k)), `${label}: missing fields`);
  assert.ok(Object.keys(value).every(k => [...required, ...optional].includes(k)), `${label}: unsupported fields`);
}
export function text(value, label = 'string') { assert.ok(typeof value === 'string' && value.length > 0, `${label}: expected nonempty string`); }
export function relative(name) { return typeof name === 'string' && /^[\w@()+.[\] /-]+$/.test(name) && !name.startsWith('/') && name.split('/').every(p => p && p !== '.' && p !== '..') && !name.includes('\\'); }
export function validateFiles(files) {
  assert.ok(files && typeof files === 'object' && !Array.isArray(files), 'snapshot files required');
  assert.ok(Object.keys(files).length > 0 && Object.keys(files).length <= 10000, 'snapshot file count');
  for (const [name, content] of Object.entries(files)) {
    assert.ok(relative(name) && /\.[jt]sx?$/.test(name), `invalid source path: ${name}`);
    assert.ok(typeof content === 'string', 'source text required');
  }
  assert.ok(Buffer.byteLength(json(files)) <= 16 * 1024 * 1024, 'snapshot size limit');
}
export function manifest(files) {
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([name, content]) => [name, {sha256: sha(content), bytes: Buffer.byteLength(content)}]));
}
export const sourceFingerprint = files => sha(JSON.stringify(manifest(files)));
export function compatibility(spec) {
  object(spec, ['framework', 'routing', 'contract', 'profile', 'source']);
  object(spec.framework, ['package', 'version']);
  assert.equal(spec.framework.package, 'expo-router', 'unsupported framework: new profile/conformance required');
  assert.match(spec.framework.version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/, 'exact framework version required');
  assert.deepEqual(spec.contract, CONTRACT, 'unsupported graph contract; prepare a fresh Traverse request and review the new artifact');
  assert.ok([PROFILE,'expo-source-inventory/2'].includes(spec.profile), 'unsupported profile: independent conformance required');
  object(spec.routing, ['config', 'conventions']);
  assert.ok(spec.routing.config && typeof spec.routing.config === 'object' && !Array.isArray(spec.routing.config), 'routing config object required');
  if(spec.profile===PROFILE) assert.deepEqual(spec.routing.conventions, {routeRoot: 'app', componentAlias: '@/'}, 'unsupported conventions');
  else { assert.ok(['app','src/app'].includes(spec.routing.conventions.routeRoot),'unsupported route root'); assert.equal(spec.routing.conventions.componentAlias,'@/'); assert.ok(spec.routing.config.aliases&&typeof spec.routing.config.aliases==='object','static aliases required'); }
  object(spec.source, ['revision', 'files']); text(spec.source.revision, 'source revision'); validateFiles(spec.source.files);
  return {framework: spec.framework, routing: spec.routing, contract: spec.contract, profile: spec.profile};
}
const array = (x, label) => assert.ok(Array.isArray(x), `${label}: array required`);
const bool = (x, label) => assert.equal(typeof x, 'boolean', `${label}: boolean required`);
const nullableText = x => assert.ok(x === null || typeof x === 'string', 'nullable string required');
const url = id => '/' + id.split('/').filter(p => p && !/^\(.*\)$/.test(p)).join('/');
const role = id => id.split('/').find(p => ['provider', 'client', '(provider)', '(client)'].includes(p))?.replace(/[()]/g, '') ?? null;
const matches = (a, b) => { const x = a.split('/').filter(Boolean), y = b.split('/').filter(Boolean); return x.length === y.length && x.every((p, i) => p === y[i] || /^\[.+\]$/.test(y[i]) || /^\[.+\]$/.test(p) || p.includes('${')); };
export function validateGraph(g, files, {routeRoot="app"}={}) {
  const routeId=file=>"/"+file.slice(routeRoot.length+1).replace(/\.[jt]sx?$/,"").replace(/(^|\/)index$/,"").replace(/\/$/,"");
  object(g, ['schema', 'schemaVersion', 'parser', 'sourceFingerprint', 'files', 'nodes', 'registrations', 'sites', 'edges', 'unresolved', 'coverage', 'limits', 'stats'], [], 'inventory');
  assert.equal(g.schema, CONTRACT.schema, 'schema mismatch'); assert.equal(g.schemaVersion, CONTRACT.schemaVersion, 'schema version mismatch'); assert.equal(g.coverage, 'partial-static-source', 'unsupported capability');
  assert.equal(g.parser, 'typescript@6.0.3', 'parser identity');
  assert.deepEqual(g.files, manifest(files), 'source provenance manifest mismatch');
  assert.equal(g.sourceFingerprint, sourceFingerprint(files), 'source fingerprint mismatch');
  assert.deepEqual(g.limits, {componentDepth: 8, unsupported: ['runtime visibility', 'business/API effects', 'unresolved dynamic targets', 'history-dependent targets', 'imperative helper call graph']}, 'unsupported capability/limits');
  for (const name of ['nodes', 'registrations', 'sites', 'edges', 'unresolved']) array(g[name], name);
  const location = (s, excerpt = false) => {
    object(s, excerpt ? ['file', 'line', 'endLine', 'excerpt'] : ['file', 'line'], [], 'source location');
    assert.ok(Object.hasOwn(files, s.file), 'missing source provenance file');
    const lines = files[s.file].split('\n');
    assert.ok(Number.isInteger(s.line) && s.line >= 1 && s.line <= lines.length, 'source line bounds');
    if (excerpt) {
      assert.ok(Number.isInteger(s.endLine) && s.endLine >= s.line && s.endLine <= lines.length, 'source endLine bounds');
      text(s.excerpt); assert.ok(lines.slice(s.line - 1, s.endLine).join('\n').includes(s.excerpt), 'fabricated source excerpt');
    }
  };
  const conditions = cs => { array(cs, 'conditions'); for (const c of cs) { object(c, ['expression', 'truthy', 'file', 'line']); text(c.expression); bool(c.truthy); location({file: c.file, line: c.line}); assert.ok(files[c.file].split('\n')[c.line - 1].includes(c.expression.split('\n')[0]), 'fabricated guard'); } };
  const registration = r => { object(r, ['to', 'navigator', 'hidden', 'title', 'presentation', 'guards', 'source']); text(r.to); assert.ok(['Stack', 'Tabs'].includes(r.navigator)); bool(r.hidden); nullableText(r.title); nullableText(r.presentation); conditions(r.guards); location(r.source, true); };
  const ids = new Set();
  for (const n of g.nodes) {
    object(n, ['id', 'url', 'file', 'role', 'registrations', 'guards'], ['title'], 'node');
    assert.ok(Object.hasOwn(files, n.file) && n.file.startsWith(routeRoot+'/') && !/(^|\/)(?:_|\+)/.test(n.file.slice(routeRoot.length+1)), 'fabricated route file');
    assert.equal(n.id, routeId(n.file), 'fabricated route identity'); assert.equal(n.url, url(n.id), 'fabricated route URL'); assert.equal(n.role, role(n.id));
    assert.ok(!ids.has(n.id), 'duplicate node'); ids.add(n.id); array(n.registrations, 'registrations'); n.registrations.forEach(registration); conditions(n.guards); if (n.title !== undefined) text(n.title);
  }
  const expectedIds = Object.keys(files).filter(f => f.startsWith(routeRoot+'/') && !/(^|\/)(?:_|\+)/.test(f.slice(routeRoot.length+1))).map(routeId).sort();
  assert.deepEqual([...ids].sort(), expectedIds, 'missing/fabricated routes');
  g.registrations.forEach(registration);
  const common = e => {
    assert.ok(ids.has(e.owner), 'missing owner endpoint'); location(e.source, true);
    array(e.componentPath, 'component path'); assert.ok(e.componentPath.length > 0 && e.componentPath.length <= 8, 'component depth');
    assert.equal(e.componentPath[0], g.nodes.find(n => n.id === e.owner).file, 'component owner provenance'); assert.equal(e.componentPath.at(-1), e.source.file, 'component source provenance');
    assert.ok(e.componentPath.every(f => Object.hasOwn(files, f)), 'component file provenance');
    assert.ok(['push', 'replace', 'navigate', 'dismissTo', 'back', 'dismiss', 'dismissAll', 'Link', 'Redirect'].includes(e.method), 'method'); nullableText(e.expression);
  };
  const action = e => { text(e.target); conditions(e.conditions); nullableText(e.label); bool(e.pureNavigation); assert.ok(['action', 'redirect'].includes(e.kind)); if (e.disabled !== undefined) { object(e.disabled, ['kind'], ['value', 'text', 'pattern', 'regex', 'captures']); assert.ok(['literal', 'expr', 'template'].includes(e.disabled.kind)); } };
  const endpoints = target => g.nodes.filter(n => matches(target, target.split('/').some(p => /^\(.+\)$/.test(p)) ? n.id : n.url));
  const candidates = e => { let ns = endpoints(e.target); const ownerRole = role(e.owner); if (ns.length > 1 && ownerRole) { const same = ns.filter(n => n.role === ownerRole); if (same.length) ns = same; } return ns.map(n => n.id).sort(); };
  const edgeIds = new Set();
  for (const e of g.edges) {
    object(e, ['id', 'from', 'to', 'owner', 'componentPath', 'source', 'method', 'expression', 'target', 'conditions', 'label', 'pureNavigation', 'kind'], ['disabled'], 'edge');
    text(e.id); assert.ok(!edgeIds.has(e.id), 'duplicate edge'); edgeIds.add(e.id); common(e); action(e);
    assert.equal(e.from, e.owner); assert.ok(ids.has(e.from) && ids.has(e.to), 'missing graph endpoint');
    assert.ok(e.target.startsWith('/'), 'fabricated resolved target'); assert.deepEqual(candidates(e), [e.to], 'fabricated/ambiguous resolved route');
    assert.ok(!['back', 'dismiss', 'dismissAll'].includes(e.method), 'history cannot be resolved');
  }
  for (const e of g.unresolved) {
    object(e, ['owner', 'componentPath', 'source', 'method', 'expression', 'reason'], ['target', 'conditions', 'label', 'pureNavigation', 'kind', 'disabled', 'candidates'], 'unresolved'); common(e);
    assert.ok(['history-dependent', 'dynamic-target', 'ambiguous-route', 'missing-route', 'relative-target', 'external-target'].includes(e.reason), 'uncertainty reason');
    if (['history-dependent', 'dynamic-target'].includes(e.reason)) { assert.equal(e.target, undefined, 'uncertain target must remain unresolved'); assert.equal(['back', 'dismiss', 'dismissAll'].includes(e.method), e.reason === 'history-dependent'); }
    else { action(e); array(e.candidates, 'unresolved candidates'); assert.ok(e.candidates.every(id => ids.has(id)), 'unresolved endpoint'); if (e.reason === 'ambiguous-route') { assert.ok(candidates(e).length > 1); assert.deepEqual([...e.candidates].sort(), candidates(e)); } }
  }
  for (const s of g.sites) {
    object(s, ['file', 'kind', 'method', 'targets', 'expression', 'conditions', 'source', 'label', 'pureNavigation'], ['disabled'], 'site');
    assert.equal(s.file, s.source.file); location(s.source, true); conditions(s.conditions); array(s.targets, 'targets'); nullableText(s.expression); nullableText(s.label); bool(s.pureNavigation);
    assert.ok(['action', 'redirect', 'history'].includes(s.kind));
    for (const t of s.targets) { object(t, ['path', 'conditions'], ['template']); text(t.path); conditions(t.conditions); if (t.template !== undefined) bool(t.template); }
  }
  assert.deepEqual(g.stats, {files: Object.keys(files).length, nodes: g.nodes.length, registrations: g.registrations.length, edges: g.edges.length, unresolved: g.unresolved.length}, 'stats mismatch');
  // Stable content excludes execution metadata; order of set-like top-level collections is immaterial.
  const result = canonical(g);
  for (const name of ['nodes', 'edges', 'unresolved', 'registrations', 'sites']) result[name].sort((a, b) => json(a).localeCompare(json(b)));
  return result;
}
