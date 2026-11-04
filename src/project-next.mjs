import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {noSymlinks} from './installation.mjs';
import {CONTRACT, compatibility, manifest, sha, sourceFingerprint} from './extractor-pipeline/contract.mjs';

export const NEXT_PROFILE = 'next-app-source-inventory/1';
const exists = name => { try { fs.lstatSync(name); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
export function inspectNextProject(root) {
  const hashes = {};
  function read(name) {
    const full = path.join(root, name); noSymlinks(full, {label: 'input'});
    const stat = fs.statSync(full), limit = name === 'package-lock.json' ? 16 : 1;
    if (!stat.isFile() || stat.size > limit * 1024 * 1024) throw Error(`${name}: expected regular input under ${limit} MiB`);
    const text = fs.readFileSync(full, 'utf8'); hashes[name] = sha(text); return text;
  }
  const json = name => { try { return JSON.parse(read(name)); } catch (e) { if (e instanceof SyntaxError) throw Error(`${name}: malformed JSON`); throw e; } };
  const pkg = json('package.json'), lock = json('package-lock.json'), versions = {};
  if (![2, 3].includes(lock.lockfileVersion)) throw Error('package-lock.json: npm lockfile v2 or v3 required');
  for (const [name, version] of [['next', '16.0'], ['react', '19.2'], ['react-dom', '19.2']]) {
    const installed = json(`node_modules/${name}/package.json`), declared = pkg.dependencies?.[name];
    const range = /^(~?)(\d+\.\d+)\.(\d+)$/.exec(declared ?? '');
    if (!range || range[2] !== version || installed.name !== name || !new RegExp(`^${version.replace('.', '\\.')}\\.\\d+$`).test(installed.version ?? '') || installed.version !== lock.packages?.[`node_modules/${name}`]?.version || declared !== lock.packages?.['']?.dependencies?.[name] || (range[1] ? Number(installed.version.split('.')[2]) < Number(range[3]) : declared !== installed.version)) throw Error(`Missing/incompatible installed, declared or locked ${name}; this profile requires ${version}.x exact/tilde npm dependencies; run npm ci`);
    versions[name] = installed.version;
  }
  if (versions.react !== versions['react-dom']) throw Error('react/react-dom installed versions must match');
  for (const name of ['pages', 'src/pages', 'middleware.ts', 'middleware.js', 'src/middleware.ts', 'src/middleware.js', 'proxy.ts', 'proxy.js', 'src/proxy.ts', 'src/proxy.js']) if (exists(path.join(root, name))) throw Error(`${name}: Pages Router and middleware/proxy routing are deferred`);
  const roots = ['app', 'src/app'].filter(name => exists(path.join(root, name)));
  if (roots.length !== 1) throw Error('Choose exactly one App Router root: app/ or src/app/; missing/ambiguous roots are unsupported');
  const routeRoot = roots[0], aliases = {};
  const configs = ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.cjs'].filter(name => exists(path.join(root, name)));
  if (configs.length > 1) throw Error('Ambiguous next.config inputs; select one static empty configuration');
  for (const name of configs) {
    const sf = ts.createSourceFile(name, read(name), ts.ScriptTarget.Latest, true);
    const exports = sf.statements.filter(n => ts.isExportAssignment(n) || ts.isExpressionStatement(n) && ts.isBinaryExpression(n.expression) && n.expression.left.getText(sf) === 'module.exports');
    const value = exports[0] && (ts.isExportAssignment(exports[0]) ? exports[0].expression : exports[0].expression.right);
    if (sf.parseDiagnostics.length || sf.statements.length !== 1 || exports.length !== 1 || !ts.isObjectLiteralExpression(value) || value.properties.length) throw Error(`${name}:1: only a direct empty static config is supported; basePath, rewrites, redirects, pageExtensions, functions and wrappers require another profile; config is never executed`);
  }
  if (exists(path.join(root, 'jsconfig.json')) && exists(path.join(root, 'tsconfig.json'))) throw Error('Ambiguous tsconfig.json/jsconfig.json inputs');
  for (const name of ['tsconfig.json', 'jsconfig.json'].filter(name => exists(path.join(root, name)))) {
    const parsed = ts.parseConfigFileTextToJson(name, read(name));
    if (parsed.error) throw Error(`${name}: malformed JSON`);
    const config = parsed.config;
    if (config.extends) throw Error(`${name}: inherited configuration requires another profile`);
    if (Object.hasOwn(config.compilerOptions ?? {}, 'baseUrl')) throw Error(`${name}: baseUrl is unsupported, including '.' and './'; use relative imports or project-relative wildcard aliases`);
    Object.assign(aliases, config.compilerOptions?.paths ?? {});
    for (const [key, values] of Object.entries(aliases)) if (!/^[\w@/-]+\/\*$/.test(key) || !Array.isArray(values) || values.length !== 1 || typeof values[0] !== 'string' || !(values[0]==='./*'||/^(?:\.\/)?[\w-]+(?:\/[\w-]+)*\/\*$/.test(values[0])) || values[0].replace(/^\.\//, '').split('/').some(p => !p || p === '..' || ['node_modules', '.git', '.wayfinder'].includes(p))) throw Error(`${name}: aliases require one project-relative wildcard target`);
    const keys = Object.keys(aliases);
    if (keys.some(a => keys.some(b => a !== b && a.startsWith(b.slice(0, -1))))) throw Error(`${name}: overlapping aliases are unsupported`);
  }
  const includedDirectories = [], files = {}; let count = 0, bytes = 0;
  function walk(relative, depth = 0) {
    const full = path.join(root, relative); noSymlinks(full, {label: 'input'});
    if (depth > 16 || !fs.statSync(full).isDirectory()) throw Error(`${relative}: invalid/deep source directory`);
    for (const entry of fs.readdirSync(full, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++count > 10000) throw Error('Source entry count exceeds 10000');
      const name = relative + '/' + entry.name;
      if (entry.isSymbolicLink()) throw Error(`Symlink input is unsupported: ${name}`);
      if (entry.isDirectory()) { if (!['node_modules', '.git', '.wayfinder', '.next'].includes(entry.name)) walk(name, depth + 1); }
      else if (/\.[jt]sx?$/.test(name) && !/\.d\.ts$/.test(name)) {
        const source = read(name); delete hashes[name]; bytes += Buffer.byteLength(source);
        if (bytes > 16 * 1024 * 1024) throw Error('Source size exceeds 16 MiB');
        files[name] = source;
      }
    }
  }
  const directories = [...new Set([routeRoot, 'components', 'src', ...Object.values(aliases).map(v => v[0].replace(/^\.\//, '').slice(0, -2)).filter(Boolean)])].sort();
  for (const name of directories) if (exists(path.join(root, name)) && !includedDirectories.some(parent => name.startsWith(parent + '/'))) { walk(name); includedDirectories.push(name); }
  if (!Object.keys(files).some(name => name.startsWith(routeRoot + '/') && /\/page\.[jt]sx?$/.test(name))) throw Error(`No page source files found under ${routeRoot}/`);
  const fingerprint = sourceFingerprint(files), settings = {framework: {package: 'next', version: versions.next}, routing: {config: {aliases, versions}, conventions: {routeRoot}}, contract: CONTRACT, profile: NEXT_PROFILE};
  const spec = {...settings, source: {revision: `content-sha256:${fingerprint}`, files}}; compatibility(spec);
  return {root, config: {schema: 'wayfinder-project/2', ...settings}, spec, provenance: {schema: 'wayfinder-project-snapshot/1', revisionKind: 'content-addressed-source-not-git-or-build', sourceFingerprint: fingerprint, sourceManifest: manifest(files), inputHashes: hashes, versions, includedDirectories, limitations: ['Next16.0/React19.2 default App Router conventions; configuration is never executed', 'Partial file-level declared navigation, not runtime visibility or auth proof', 'No installed build identity']}};
}
