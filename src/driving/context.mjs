import {createHash} from 'node:crypto';
import {matches, validateScreenMap} from './contract.mjs';

export function matchScreen(screenMap, observation, graph) {
  if (screenMap === undefined) return null;
  validateScreenMap(screenMap, graph);
  const visible = observation.nodes.filter(n => n.visible);
  const potential = Object.entries(screenMap).map(([route, selectors]) => ({route, matches: selectors.map(s => visible.filter(n => matches(n, s)))})).filter(entry => entry.matches.every(nodes => nodes.length > 0));
  const evidence = {method: 'visible-selector-match', observationId: observation.id, runtimeRouteVerified: false,
    mapHash: createHash('sha256').update(JSON.stringify(screenMap)).digest('hex')};
  if (!potential.length) return {...evidence, status: 'unknown', route: null, nodeIds: []};
  if (potential.length !== 1 || potential[0].matches.some(nodes => nodes.length !== 1))
    return {...evidence, status: 'ambiguous', route: null, candidates: potential.map(entry => entry.route), nodeIds: []};
  return {...evidence, status: 'matched', route: potential[0].route, nodeIds: [...new Set(potential[0].matches.flat().map(n => n.id))]};
}

export function observedContext(observation) {
  return observation.nodes.filter(n => n.visible).map(({ref, rect, visible, ...node}) =>
    Object.fromEntries(Object.entries(node).filter(([key, value]) => value !== null || !['parent', 'identifier', 'value'].includes(key))));
}

// Provenance remains in driving inputs.json, bound by graphHash. This projection
// is decision context, never evidence of the installed build or current route.
const provenance = new Set(['source', 'file', 'line', 'endLine', 'excerpt', 'componentPath']);
function semantic(value) {
  if (Array.isArray(value)) return value.map(semantic);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !provenance.has(key)).map(([key, child]) => [key, semantic(child)]));
  return value;
}
const collections = ['nodes', 'edges', 'sites', 'unresolved', 'registrations'];
function counts(graph) { return Object.fromEntries(collections.map(key => [key, graph[key]?.length ?? 0])); }
function namedInGoal(goal, name) {
  if (typeof name !== 'string' || name.length <= 1) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}_/\\-])${escaped}($|[^\\p{L}\\p{N}_/\\-])`, 'u').test(goal);
}

export function decisionContext(state, {goal, controls, fits, screen = null}) {
  const graph = state.navigationGraph;
  const graphHash = createHash('sha256').update(JSON.stringify(graph)).digest('hex');
  const {files, parser, sourceFingerprint, stats, ...facts} = graph;
  const compact = semantic(facts);
  const complete = {...state, navigationGraph: compact};
  const receipt = {graphHash, scope: 'complete', omitted: Object.fromEntries(collections.map(key => [key, 0])), ...(screen ? {screen} : {})};
  if (screen && screen.status !== 'matched') return {state: complete, receipt};
  const anchored = screen?.status === 'matched';
  if ((!anchored && fits(complete)) || graph.schema !== 'traverse-navigation' || !collections.every(key => Array.isArray(graph[key]))) return {state: complete, receipt};

  const labels = new Set(controls.map(c => c.label).filter(Boolean));
  const names = new Set(graph.nodes.filter(n => [n.id, n.url, n.title].some(name => namedInGoal(goal, name))).map(n => n.id));
  const matched = row => labels.has(row.label);
  const seeds = graph.edges.filter(matched);
  const matchedSites = graph.sites.filter(matched);
  // A source site can connect an unresolved/history-dependent action to its owner.
  const siteFiles = new Set(anchored ? [] : matchedSites.map(s => s.source?.file ?? s.file).filter(Boolean));
  const matchedUnresolved = graph.unresolved.filter(row => matched(row) || siteFiles.has(row.source?.file));
  const owners = new Set(anchored ? [screen.route] : [...names, ...seeds.map(e => e.owner), ...matchedUnresolved.map(e => e.owner)].filter(Boolean));
  if (!owners.size) return {state: complete, receipt: {...receipt, selection: 'no-reliable-seed'}};

  // Include all facts of every matching owner, not just the winning label, and
  // follow automatic redirects. Destination guards/registrations stay attached.
  const nodes = new Set(owners);
  const selectedEdges = new Set();
  const selectedUnresolved = new Set();
  const sourceFiles = new Set(siteFiles);
  let changed = true;
  function include(set, value) {
    if (value && !set.has(value)) { set.add(value); changed = true; }
  }
  function sources(row) {
    include(sourceFiles, row.source?.file);
    for (const file of row.componentPath ?? []) include(sourceFiles, file);
  }
  while (changed) {
    changed = false;
    for (const node of graph.nodes) if (nodes.has(node.id)) include(sourceFiles, node.file);
    for (const edge of graph.edges) {
      if (!owners.has(edge.owner) && !(edge.kind === 'redirect' && nodes.has(edge.owner))) continue;
      selectedEdges.add(edge);
      for (const id of [edge.owner, edge.from, edge.to]) include(nodes, id);
      sources(edge);
    }
    for (const row of graph.unresolved) {
      if (!nodes.has(row.owner) && (anchored || !matched(row) && !sourceFiles.has(row.source?.file))) continue;
      selectedUnresolved.add(row);
      for (const id of [row.owner, ...(row.candidates ?? [])]) include(nodes, id);
      sources(row);
    }
  }
  const edges = graph.edges.filter(e => selectedEdges.has(e));
  const selectedNodes = graph.nodes.filter(n => nodes.has(n.id));
  const location = row => row.source?.file && Number.isInteger(row.source?.line) ? JSON.stringify([row.source.file, row.source.line]) : null;
  const locations = new Set([...edges, ...selectedUnresolved].map(location).filter(Boolean));
  const selected = {...facts, nodes: selectedNodes, edges,
    sites: graph.sites.filter(s => anchored ? locations.has(location(s)) : matched(s) || sourceFiles.has(s.source?.file ?? s.file)),
    unresolved: graph.unresolved.filter(e => selectedUnresolved.has(e)),
    registrations: graph.registrations.filter(r => nodes.has(r.to))};
  const before = counts(graph), after = counts(selected);
  const omitted = Object.fromEntries(collections.map(key => [key, before[key] - after[key]]));
  const context = {scope: anchored ? 'screen-window' : 'retrieved', observedRoute: null, ...(anchored ? {matchedRoute: screen.route} : {}), omitted};
  return {state: {...state, navigationGraph: {...semantic(selected), context}}, receipt: {...receipt, ...context},
    ...(anchored ? {frontierState: complete, frontierReceipt: {...receipt, expandedFrom: 'screen-window'}} : {})};
}
