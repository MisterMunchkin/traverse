// Repository-only static site tooling; no framework, package install or deployment.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'website');
const output = path.join(root, '.checks/site/dist');
const files = ['index.html', 'styles.css', 'site.js', 'mark.svg'];
const types = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml'};

function check() {
  for (const file of files) if (!fs.statSync(path.join(source, file)).isFile()) throw Error('Missing site asset: ' + file);
  const html = fs.readFileSync(path.join(source, 'index.html'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  if (new Set(ids).size !== ids.length) throw Error('Duplicate HTML IDs');
  let links = 0;
  for (const [, raw] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    links++;
    if (raw.startsWith('#')) {
      if (!ids.includes(raw.slice(1))) throw Error('Broken page anchor: ' + raw);
    } else if (raw.startsWith('./')) {
      if (!files.includes(raw.slice(2))) throw Error('Unknown static asset: ' + raw);
    } else {
      const url = new URL(raw);
      if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/MisterMunchkin/traverse')) throw Error('Unexpected external resource: ' + raw);
      if (url.pathname === '/MisterMunchkin/traverse') continue;
      const prefix = '/MisterMunchkin/traverse/blob/main/';
      if (!url.pathname.startsWith(prefix)) throw Error('Unexpected repository link: ' + raw);
      const relative = decodeURIComponent(url.pathname.slice(prefix.length));
      const target = path.resolve(root, relative);
      if (!target.startsWith(root) || !fs.statSync(target).isFile()) throw Error('Missing guide: ' + raw);
      if (url.hash) {
        const headings = [...fs.readFileSync(target, 'utf8').matchAll(/^#+ (.+)$/gm)].map(match => match[1].toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, '').replaceAll(' ', '-'));
        if (!headings.includes(url.hash.slice(1))) throw Error('Missing guide heading: ' + raw);
      }
    }
  }
  console.log(`Site check passed: ${files.length} local assets, ${links} links, ${ids.length} unique IDs; all repository paths and guide anchors resolve locally.`);
}

const command = process.argv[2];
if (command === 'check') check();
else if (command === 'build') {
  check();
  fs.mkdirSync(output, {recursive: true});
  for (const file of files) fs.copyFileSync(path.join(source, file), path.join(output, file));
  console.log('Static build: ' + output);
} else if (command === 'preview') {
  for (const file of files) if (!fs.existsSync(path.join(output, file))) throw Error('Run npm run site:build first');
  const port = Number(process.env.PORT ?? 4173);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw Error('PORT must be 1..65535');
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!files.includes(file)) { response.writeHead(404); response.end('Not found'); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, {Allow: 'GET, HEAD'}); response.end(); return; }
    const content = fs.readFileSync(path.join(output, file));
    response.writeHead(200, {'Content-Type': types[path.extname(file)], 'Content-Length': content.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    response.end(request.method === 'HEAD' ? undefined : content);
  });
  server.listen(port, '127.0.0.1', () => console.log(`Traverse preview: http://127.0.0.1:${port} (loopback only)`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
} else {
  console.error('Usage: node scripts/site.mjs check|build|preview');
  process.exitCode = 1;
}
