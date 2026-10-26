#!/usr/bin/env node
// Offline process fixture. It never loads a model or accesses a shared service.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
if (process.argv[2] === '--version') {
  if (!process.env.HOME || !path.isAbsolute(process.env.HOME) || !fs.statSync(process.env.HOME).isDirectory()) throw Error('FIXTURE_PRIVATE_HOME_REQUIRED');
  fs.writeFileSync(path.join(process.env.HOME, 'fixture-version-home.json'), JSON.stringify({home: process.env.HOME}));
  console.log('ollama version is 0.40.8');
} else if (process.argv[2] === 'serve') {
  const [host, port] = process.env.OLLAMA_HOST.split(':');
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/version') response.end(JSON.stringify({version: '0.40.8'}));
    else if (request.url.startsWith('/fixture-pull')) {
      const blob = Buffer.from('offline-fixture-model'), hash = createHash('sha256').update(blob).digest('hex');
      const descriptor = {digest: 'sha256:' + hash, size: blob.length};
      const model = new URL(request.url, 'http://fixture').searchParams.get('model') ?? 'tev1:4b';
      const manifest = path.join(process.env.OLLAMA_MODELS, 'manifests-v2/ollama.com/library/tev1', model.split(':')[1]);
      const bytes = JSON.stringify({schemaVersion: 2, config: descriptor, layers: [descriptor]});
      const canonical = path.join(process.env.OLLAMA_MODELS, 'blobs', 'sha256-' + createHash('sha256').update(bytes).digest('hex'));
      fs.mkdirSync(path.dirname(manifest), {recursive: true}); fs.mkdirSync(path.join(process.env.OLLAMA_MODELS, 'blobs'), {recursive: true});
      fs.writeFileSync(canonical, bytes); fs.symlinkSync(path.relative(path.dirname(manifest), canonical), manifest);
      fs.writeFileSync(path.join(process.env.OLLAMA_MODELS, 'blobs', 'sha256-' + hash), blob);
      response.end('{}');
    } else if (request.url === '/v1/systemone') {
      let input = ''; request.on('data', data => { input += data; });
      request.on('end', () => {
        const body = JSON.parse(input), question = Object.values(body.questions)[0], choice = Object.keys(question.criteria)[0];
        response.end(JSON.stringify({answers: {pick: {choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === choice ? 1 : 0]))}}}));
      });
    } else { response.statusCode = 404; response.end('{}'); }
  });
  server.listen(Number(port), host, () => console.error(`Listening on ${host}:${port}`));
  process.on('SIGTERM', () => server.close());
} else if (process.argv[2] === 'pull') {
  const response = await fetch('http://' + process.env.OLLAMA_HOST + '/fixture-pull?model=' + encodeURIComponent(process.argv[3]));
  if (!response.ok) process.exitCode = 1;
  else console.log('Offline fixture model downloaded');
} else {
  console.error('Unsupported offline fixture command'); process.exitCode = 1;
}
