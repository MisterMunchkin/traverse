// Bounded Next App Router profile. No configuration or application code is executed.
import path from 'node:path';
import ts from 'typescript';
import {CONTRACT, manifest, sourceFingerprint, sha} from '../extractor-pipeline/contract.mjs';
import {parseTsx, loc, unwrap, attrValue, attrExpression, hasSpread, findFunction} from './ast.mjs';

const literal = value => value?.kind === 'literal' ? value.value : undefined;
const sourceAt = (sf, node) => ({...loc(sf, node), endLine: sf.getLineAndCharacterOfPosition(node.end).line + 1, excerpt: node.getText(sf).slice(0, 260)});
const fail = (sf, node, message) => { throw Error(`${sf.fileName}:${loc(sf, node).line}: ${message}`); };
function conditions(sf, node) {
  const result = [];
  for (let n = node.parent; n; n = n.parent) {
    let expression, truthy = true;
    if (ts.isIfStatement(n)) { expression = n.expression; truthy = node.pos >= n.thenStatement.pos && node.end <= n.thenStatement.end; }
    if (ts.isConditionalExpression(n)) { expression = n.condition; truthy = node.pos >= n.whenTrue.pos && node.end <= n.whenTrue.end; }
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(n.operatorToken.kind) && node.pos >= n.right.pos) { expression = n.left; truthy = n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken; }
    if (expression) result.push({expression: expression.getText(sf), truthy, ...loc(sf, expression)});
  }
  return result;
}
function targets(sf, expression) {
  const n = expression && unwrap(expression);
  if (!n) return [];
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return [{path: n.text, conditions: []}];
  if (ts.isConditionalExpression(n)) {
    const branches = [[n.whenTrue, true], [n.whenFalse, false]].map(([value, truthy]) => targets(sf, value).map(t => ({...t, conditions: [...t.conditions, {expression: n.condition.getText(sf), truthy, ...loc(sf, n.condition)}]})));
    // A partly computed conditional is uncertain as a whole, never a complete static choice.
    return branches.every(branch => branch.length) ? branches.flat() : [];
  }
  // Templates, URL objects, variables and computed values remain uncertain.
  return [];
}
function localFile(files, file, spec, aliases) {
  let stem;
  const alias = Object.keys(aliases).sort().find(key => spec.startsWith(key.slice(0, -1)));
  if (alias) stem = aliases[alias][0].replace(/^\.\//, '').replace('*', spec.slice(alias.length - 1));
  else if (spec.startsWith('.')) stem = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
  else return undefined;
  return [stem, ...['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'].map(ext => stem + ext)].find(name => Object.hasOwn(files, name)) ?? null;
}
function routeScore(target, pattern) {
  const want = target.split('/').filter(Boolean), have = pattern.split('/').filter(Boolean);
  let score = '', i = 0;
  for (; i < have.length; i++) {
    const part = have[i];
    if (/^\[\[\.\.\.[\w-]+\]\]$/.test(part)) return score + '1';
    if (/^\[\.\.\.[\w-]+\]$/.test(part)) return want.length > i ? score + '2' : null;
    if (want[i] === undefined) return null;
    if (/^\[[\w-]+\]$/.test(part)) score += '3';
    else if (part === want[i]) score += '4';
    else return null;
  }
  return want.length === i ? score + '5' : null;
}
function resolve(target, nodes) {
  if (!target.startsWith('/') || target.startsWith('//')) return {reason: /^(?:[a-z]+:|\/\/)/i.test(target) ? 'external-target' : 'relative-target', candidates: []};
  const pathname = target.split(/[?#]/)[0];
  const ranked = nodes.map(n => [n, routeScore(pathname, n.url)]).filter(([, score]) => score !== null);
  const best = ranked.map(([, score]) => score).sort().at(-1);
  const matches = ranked.filter(([, score]) => score === best).map(([n]) => n.id);
  return matches.length === 1 ? {to: matches[0]} : {reason: matches.length ? 'ambiguous-route' : 'missing-route', candidates: matches.sort()};
}
export function extractNextSource(input, {routeRoot = 'app', aliases = {}} = {}) {
  const files = Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)));
  const nodes = [], sites = [], imports = new Map(), layouts = [];
  for (const [file, text] of Object.entries(files)) {
    const sf = /\.[jt]sx$/.test(file) ? parseTsx(file, text) : ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS);
    if (sf.parseDiagnostics.length) fail(sf, sf, 'Source contains syntax errors');
    if (file.startsWith(routeRoot + '/')) {
      const parts = file.slice(routeRoot.length + 1).split('/'), base = parts.pop();
      if (parts.some(p => p.startsWith('@') || /^\(\./.test(p))) fail(sf, sf, 'Parallel/intercepting routes require another profile');
      if(parts.some((part,i)=>part.includes('[')&&!/^\[(?:[\w-]+|\.\.\.[\w-]+)\]$/.test(part)&&!/^\[\[\.\.\.[\w-]+\]\]$/.test(part)||/\.\.\./.test(part)&&i!==parts.length-1))fail(sf,sf,'Unsupported dynamic segment; catch-all must be terminal');
      if (!parts.some(p => p.startsWith('_')) && /^(page|layout)\.[jt]sx?$/.test(base)) {
        const exports = sf.statements.filter(s => ts.isExportAssignment(s) || ts.getModifiers(s)?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword));
        const expression = exports[0] && ts.isExportAssignment(exports[0]) ? unwrap(exports[0].expression) : null;
        if (exports.length !== 1 || expression && !(ts.isArrowFunction(expression) || ts.isFunctionExpression(expression) || ts.isIdentifier(expression) && findFunction(sf, expression.text)) || !expression && !ts.isFunctionDeclaration(exports[0])) fail(sf, sf, 'page/layout requires a direct default export; lazy/generated exports are unsupported');
        if (base.startsWith('layout.')) {
          if (layouts.some(other => path.posix.dirname(other) === path.posix.dirname(file))) fail(sf, sf, 'Ambiguous layout files in one route directory');
          layouts.push(file);
        }
        else {
          const id = '/' + parts.join('/');
          if (nodes.some(n => n.id === id)) fail(sf, sf, 'Duplicate page route');
          nodes.push({id, url: '/' + parts.filter(p => !/^\(.*\)$/.test(p)).join('/'), file, role: null, registrations: [], guards: []});
        }
      }
    }
    const links = new Set(), hooks = new Set(), redirects = new Set(), routers = new Set(), bindings = new Map(), used = new Set(), forwarded = new Set(), reexports = [];
    for (const n of sf.statements) if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.importClause) {
      const spec = n.moduleSpecifier.text, clause = n.importClause;
      if (clause.isTypeOnly) continue;
      if (['next/dynamic', 'next/router'].includes(spec)) fail(sf, n, `${spec} requires another extraction profile`);
      if (['next/link', 'next/navigation'].includes(spec) && clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) fail(sf, n, 'Namespace navigation imports require another extraction profile');
      if (spec === 'next/link' && clause.namedBindings) fail(sf, n, 'next/link requires a default import in this profile');
      if (spec === 'next/link' && clause.name) links.add(clause.name.text);
      const local = localFile(files, file, spec, aliases);
      if (clause.name && local !== undefined) bindings.set(clause.name.text, local);
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const b of clause.namedBindings.elements) {
        if (b.isTypeOnly) continue;
        const name = (b.propertyName ?? b.name).text;
        if (spec === 'next/navigation') {
          if (name === 'useRouter') hooks.add(b.name.text);
          if (['redirect', 'permanentRedirect'].includes(name)) redirects.add(b.name.text);
        }
        if (local !== undefined) bindings.set(b.name.text, local);
      }
    }
    // Keep value forwarding in the same file-level ownership graph as JSX imports.
    // Namespace exports remain deferred; erased type-only dependencies own no UI.
    for (const n of sf.statements) {
      if (ts.isExportDeclaration(n) && !n.isTypeOnly && (!n.exportClause || ts.isNamedExports(n.exportClause))) {
        const values = n.exportClause?.elements.filter(b => !b.isTypeOnly);
        if (values?.length === 0) continue;
        if (n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
          const spec = n.moduleSpecifier.text, dest = localFile(files, file, spec, aliases);
          if (dest === null) fail(sf, n, `Missing local component re-export input: ${spec}`);
          if (dest !== undefined) reexports.push(dest);
        } else if (!n.moduleSpecifier) {
          for (const b of values ?? []) forwarded.add((b.propertyName ?? b.name).text);
        }
      } else if (ts.isExportAssignment(n) && !n.isExportEquals) {
        const value = unwrap(n.expression);
        if (ts.isIdentifier(value)) forwarded.add(value.text);
      }
    }
    const collect = n => {
      if (ts.isVariableDeclaration(n) && n.initializer && ts.isCallExpression(unwrap(n.initializer)) && hooks.has(unwrap(n.initializer).expression.getText(sf))) {
        if (!ts.isIdentifier(n.name) || !(n.parent.flags & ts.NodeFlags.Const)) fail(sf, n, 'useRouter requires a const identifier binding');
        routers.add(n.name.text);
      }
      if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) used.add(n.tagName.getText(sf).split('.')[0]);
      ts.forEachChild(n, collect);
    };
    collect(sf);
    const tracked = new Set([...links, ...hooks, ...redirects, ...routers]), declarations = new Set();
    const boundNames = name => !name ? [] : ts.isIdentifier(name) ? [name.text] : ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name) ? name.elements.flatMap(e => ts.isBindingElement(e) ? boundNames(e.name) : []) : [];
    const checkBindings = n => {
      if (ts.isParameter(n) || ts.isVariableDeclaration(n) || ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassExpression(n)) for (const name of boundNames(n.name).filter(name => tracked.has(name))) {
        if (!routers.has(name) || declarations.has(name) || !ts.isVariableDeclaration(n) || !ts.isIdentifier(n.name)) fail(sf, n, 'Shadowed navigation binding is unsupported');
        declarations.add(name);
      }
      ts.forEachChild(n, checkBindings);
    };
    checkBindings(sf);
    imports.set(file, [...new Set([...bindings].filter(([name]) => used.has(name) || forwarded.has(name)).map(([name, dest]) => {
      if (!dest) fail(sf, sf, `Missing local component input: ${name}`);
      return dest;
    }).concat(reexports))]);
    const add = (n, method, kind, expression, values, label = null, pureNavigation = true) => sites.push({file, method, kind, expression, targets: values, label, pureNavigation, conditions: conditions(sf, n), source: sourceAt(sf, n)});
    const walk = n => {
      if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && links.has(n.tagName.getText(sf))) {
        const expression = attrExpression(n, 'href'), value = literal(attrValue(sf, n, 'href'));
        add(n, 'Link', 'action', expression?.getText(sf) ?? value ?? null, hasSpread(n) ? [] : expression ? targets(sf, expression) : typeof value === 'string' ? [{path: value, conditions: []}] : [], literal(attrValue(sf, n, 'aria-label')) ?? null);
      }
      if (ts.isCallExpression(n)) {
        if (redirects.has(n.expression.getText(sf))) add(n, 'Redirect', 'redirect', n.arguments[0]?.getText(sf) ?? null, targets(sf, n.arguments[0]));
        if (ts.isPropertyAccessExpression(n.expression) && routers.has(n.expression.expression.getText(sf))) {
          const method = n.expression.name.text;
          if (method === 'forward') fail(sf, n, 'router.forward is deferred; history cannot be resolved statically');
          if (['push', 'replace', 'back'].includes(method)) {
            const fn = n.parent, pure = ts.isArrowFunction(fn) && unwrap(fn.body) === n;
            add(n, method, method === 'back' ? 'history' : 'action', n.arguments[0]?.getText(sf) ?? null, targets(sf, n.arguments[0]), null, pure);
          }
        }
      }
      ts.forEachChild(n, walk);
    };
    walk(sf);
  }
  if (!nodes.length) throw Error(`No page source files found under ${routeRoot}/`);
  if (!layouts.some(file => path.posix.dirname(file) === routeRoot)) throw Error(`${routeRoot}/layout: missing root layout; grouped root layouts require another profile`);
  const edges = [], unresolved = [];
  for (const owner of nodes) {
    const queue = [[owner.file], ...layouts.filter(file => owner.file.startsWith(path.posix.dirname(file) + '/')).map(file => [owner.file, file])], seen = new Set();
    for (let i = 0; i < queue.length; i++) {
      const chain = queue[i], file = chain.at(-1);
      if (seen.has(file) || chain.length > 8) continue;
      seen.add(file);
      for (const site of sites.filter(s => s.file === file)) {
        const common = {owner: owner.id, componentPath: chain, source: site.source, method: site.method, expression: site.expression};
        if (site.kind === 'history' || !site.targets.length) { unresolved.push({...common, reason: site.kind === 'history' ? 'history-dependent' : 'dynamic-target'}); continue; }
        for (const target of site.targets) {
          const result = resolve(target.path, nodes), fields = {...common, target: target.path, conditions: [...site.conditions, ...target.conditions], label: site.label, pureNavigation: site.pureNavigation, kind: site.kind};
          if (result.to) edges.push({id: 'nav-' + sha(JSON.stringify([owner.id, sites.indexOf(site), site.source, target.path, target.conditions])).slice(0, 16), from: owner.id, to: result.to, ...fields});
          else unresolved.push({...fields, ...result});
        }
      }
      for (const next of imports.get(file) ?? []) queue.push([...chain, next]);
    }
  }
  return {...CONTRACT, parser: 'typescript@' + ts.version, files: manifest(files), sourceFingerprint: sourceFingerprint(files), nodes, registrations: [], sites, edges, unresolved, coverage: 'partial-static-source', limits: {componentDepth: 8, unsupported: ['runtime visibility', 'business/API effects', 'unresolved dynamic targets', 'history-dependent targets', 'imperative helper call graph']}, stats: {files: Object.keys(files).length, nodes: nodes.length, registrations: 0, edges: edges.length, unresolved: unresolved.length}};
}
