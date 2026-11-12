// Repository-only static site and download bundle; no deployment side effects.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {root, freshOutput, packRelease, verifyRelease} from './release.mjs';
import {renderResearch} from './research-site.mjs';

const source = path.join(root, 'website');
const defaultOutput = path.join(root, '.checks/site/dist');
const assets = ['index.html', 'styles.css', 'site.js', 'mark.svg'];
const researchAssets = ['research.json', 'research-methods.md'];
const types = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.tgz': 'application/gzip', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8'};
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function siteHTML() {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'docs/research/results.json'), 'utf8'));
  return fs.readFileSync(path.join(source, 'index.html'), 'utf8').replace('@@RESEARCH@@', renderResearch(data));
}

export function checkSite() {
  for (const file of assets) if (!fs.statSync(path.join(source, file)).isFile()) throw Error('Missing site asset: ' + file);
  const html = siteHTML();
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  if (new Set(ids).size !== ids.length) throw Error('Duplicate HTML IDs');
  let links = 0;
  for (const [, raw] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    links++;
    if (raw.startsWith('#')) {
      if (!ids.includes(raw.slice(1))) throw Error('Broken page anchor: ' + raw);
    } else if (raw.startsWith('./')) {
      if (![...assets, ...researchAssets, 'security.html', 'downloads/@@ARCHIVE@@', 'downloads/SHA256SUMS', 'downloads/release.json'].includes(raw.slice(2)))
        throw Error('Unknown static asset: ' + raw);
    } else {
      const url = new URL(raw), prefix = '/MisterMunchkin/traverse/blob/main/';
      if (url.origin !== 'https://github.com' || !(url.pathname === '/MisterMunchkin/traverse' || url.pathname.startsWith(prefix)))
        throw Error('Unexpected external resource: ' + raw);
      if (url.pathname === '/MisterMunchkin/traverse') continue;
      const target = path.resolve(root, decodeURIComponent(url.pathname.slice(prefix.length)));
      if (!target.startsWith(root + path.sep) || !fs.statSync(target).isFile()) throw Error('Missing guide: ' + raw);
      if (url.hash) {
        const headings = [...fs.readFileSync(target, 'utf8').matchAll(/^#+ (.+)$/gm)].map(match => match[1].toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, '').replaceAll(' ', '-'));
        if (!headings.includes(url.hash.slice(1))) throw Error('Missing guide heading: ' + raw);
      }
    }
  }
  return {assets: assets.length + researchAssets.length, links, ids: ids.length};
}

export async function buildSite({out = defaultOutput, releaseDir, signal} = {}) {
  if (process.env.CONTEXT === 'production') throw Error('Production deployment remains disabled; use a deploy preview');
  checkSite();
  const supplied = releaseDir ? verifyRelease(path.resolve(releaseDir)) : null;
  out = path.resolve(out);
  if (releaseDir && (path.resolve(releaseDir) === out || path.resolve(releaseDir).startsWith(out + path.sep)))
    throw Error('The supplied release bundle must be outside the site output');
  if (fs.existsSync(out)) {
    if (out !== defaultOutput || !fs.existsSync(path.join(out, '.traverse-site'))) throw Error('Output exists; choose a fresh --out directory');
    freshOutput(path.join(out, 'ownership-check'));
    if (fs.readFileSync(path.join(out, '.traverse-site'), 'utf8') !== 'traverse-static-site/1\n') throw Error('Unknown output ownership');
    fs.rmSync(out, {recursive: true});
  }
  freshOutput(out);
  fs.mkdirSync(out, {recursive: true});
  const downloads = path.join(out, 'downloads');
  const release = supplied ?? await packRelease({out: downloads, signal});
  if (releaseDir) {
    fs.mkdirSync(downloads);
    for (const file of [release.filename, 'SHA256SUMS', 'release.json']) fs.copyFileSync(path.join(releaseDir, file), path.join(downloads, file));
  }
  const substitutions = {VERSION: release.version, ARCHIVE: release.filename,
    BUILD_LABEL: release.kind === 'release' ? 'Experimental release' : 'Candidate build',
    BUILD_NOTE: release.kind === 'release' ? 'This download uses the selected tagged release bundle.' : 'This download is a candidate built from this preview’s source, not a published release.'};
  for (const file of assets) {
    let bytes = fs.readFileSync(path.join(source, file));
    if (file === 'index.html') bytes = Buffer.from(siteHTML().replace(/@@([A-Z_]+)@@/g, (_, key) => {
      if (!(key in substitutions)) throw Error('Unknown website placeholder: ' + key);
      return escape(substitutions[key]);
    }));
    fs.writeFileSync(path.join(out, file), bytes);
  }
  fs.copyFileSync(path.join(root, 'docs/research/results.json'), path.join(out, 'research.json'));
  fs.copyFileSync(path.join(root, 'docs/research.md'), path.join(out, 'research-methods.md'));
  const guidelines = escape(fs.readFileSync(path.join(root, 'docs/security.md'), 'utf8'));
  fs.writeFileSync(path.join(out, 'security.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Traverse security guidelines</title><link rel="stylesheet" href="./styles.css"><main class="wrap"><p><a href="./index.html">Back to Traverse</a></p><h1>Security guidelines</h1><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:inherit">${guidelines}</pre></main></html>\n`);
  fs.writeFileSync(path.join(out, '.traverse-site'), 'traverse-static-site/1\n');
  return {out, release};
}

export function previewSite({out = defaultOutput, port = Number(process.env.PORT ?? 4173)} = {}) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw Error('PORT must be 1..65535');
  const release = verifyRelease(path.join(out, 'downloads'));
  const files = [...assets, ...researchAssets, 'security.html', ...[release.filename, 'SHA256SUMS', 'release.json'].map(file => 'downloads/' + file)];
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!files.includes(file)) { response.writeHead(404); response.end('Not found'); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, {Allow: 'GET, HEAD'}); response.end(); return; }
    const content = fs.readFileSync(path.join(out, file));
    response.writeHead(200, {'Content-Type': types[path.extname(file)] ?? 'text/plain; charset=utf-8', 'Content-Length': content.length,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    response.end(request.method === 'HEAD' ? undefined : content);
  });
  server.listen(port, '127.0.0.1', () => console.log(`Traverse preview: http://127.0.0.1:${port} (loopback only)`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const interrupt = () => controller.abort('SIGINT'), terminate = () => controller.abort('SIGTERM');
  process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
  try {
    const {values, positionals} = parseArgs({options: {out: {type: 'string'}, 'release-dir': {type: 'string'}}, allowPositionals: true});
    if (positionals.length !== 1) throw Error('Usage: node scripts/site.mjs check|build|preview [--out DIRECTORY] [--release-dir DIRECTORY]');
    const [command] = positionals, options = {out: values.out, releaseDir: values['release-dir'], signal: controller.signal};
    if (command === 'check') console.log(JSON.stringify(checkSite()));
    else if (command === 'build') console.log(JSON.stringify(await buildSite(options)));
    else if (command === 'preview') previewSite(options);
    else throw Error('Unknown site command');
  } catch (error) { console.error(error.message); process.exitCode = controller.signal.reason === 'SIGINT' ? 130 : controller.signal.reason === 'SIGTERM' ? 143 : 1; }
  finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); }
}
