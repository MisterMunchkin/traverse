import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {setTimeout as pause} from 'node:timers/promises';
import {directory, atomicJson} from '../state.mjs';

// A private server exists only for this operation. Never attach to/restart a daemon.
export async function withOwnedOllama({binary, models, directory: runDir, runtimeHome, version, signal, startupMs = 15000}, work) {
  if (signal?.aborted) throw Error('CANCELLED');
  directory(runDir); directory(runtimeHome);
  const port = await new Promise((resolve, reject) => {
    const reservation = net.createServer(); reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', () => { const p = reservation.address().port; reservation.close(() => resolve(p)); });
  });
  const address = `127.0.0.1:${port}`, baseUrl = 'http://' + address;
  const env = {PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH ?? ''), HOME: runtimeHome,
    OLLAMA_HOST: address, OLLAMA_MODELS: models, OLLAMA_NO_CLOUD: '1', OLLAMA_KEEP_ALIVE: '0', OLLAMA_NUM_PARALLEL: '1', OLLAMA_MAX_LOADED_MODELS: '1'};
  let log = '', failure, outcome, childClosed = false;
  const cancellation = new AbortController(), operationSignal = signal ? AbortSignal.any([signal, cancellation.signal]) : cancellation.signal;
  const logFile = path.join(runDir, 'server.log'); fs.writeFileSync(logFile, '', {flag: 'wx', mode: 0o600});
  const child = spawn(binary, ['serve'], {cwd: path.dirname(binary), env, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
  const alive = () => { if (!child.pid) return false; try { process.kill(-child.pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; } };
  const kill = value => { if (child.pid) try { process.kill(-child.pid, value); } catch (e) { if (e.code !== 'ESRCH') failure ??= e; } };
  const fail = error => { failure ??= error; cancellation.abort(); kill('SIGTERM'); };
  const abort = () => kill('SIGTERM');
  try {
    child.once('error', fail); child.once('exit', (code, received) => { outcome = {code, signal: received}; });
    child.once('close', () => { childClosed = true; });
    const append = bytes => {
      if (failure) return;
      try {
        if (log.length + bytes.length > 2 * 1024 * 1024) throw Error('Owned runtime output limit');
        fs.appendFileSync(logFile, bytes); log += bytes;
      } catch (error) { fail(error); }
    };
    child.stdout.on('data', append); child.stderr.on('data', append);
    operationSignal.addEventListener('abort', abort, {once: true});
    if (operationSignal.aborted) abort();
    atomicJson(path.join(runDir, 'server-owner.json'), {pid: child.pid ?? null, binary, models, address});
    const deadline = Date.now() + startupMs; let ready = false;
    while (Date.now() < deadline) {
      if (operationSignal.aborted) throw failure ?? Error('CANCELLED');
      if (failure) throw failure;
      if (outcome) throw Error('Owned runtime exited before readiness');
      // The owned child's successful bind must precede probing the port.
      if (log.includes('Listening on ' + address)) {
        try {
          const r = await fetch(baseUrl + '/api/version', {signal: AbortSignal.any([AbortSignal.timeout(500), operationSignal])});
          if (r.ok && (await r.json()).version === version && alive() && !outcome) { ready = true; break; }
        } catch { /* bounded readiness retry */ }
      }
      await pause(25);
    }
    if (!ready) throw Error('Owned runtime readiness deadline');
    const result = await work({baseUrl, env, signal: operationSignal});
    if (operationSignal.aborted) throw failure ?? Error('CANCELLED');
    return result;
  } catch (error) { failure ??= error; throw failure; } finally {
    operationSignal.removeEventListener('abort', abort); cancellation.abort();
    kill('SIGTERM');
    // Reap the owned child before probing its group; a terminating Darwin leader can yield EPERM.
    const pending = () => !childClosed || alive();
    let deadline = Date.now() + 1500;
    while (pending() && Date.now() < deadline) await pause(25);
    if (pending()) kill('SIGKILL');
    deadline = Date.now() + 1500;
    while (pending() && Date.now() < deadline) await pause(25);
    atomicJson(path.join(runDir, 'server-outcome.json'), {pid: child.pid ?? null, ...outcome, groupEmpty: !pending(), cancelled: !!signal?.aborted, error: failure?.message ?? null});
    if (pending()) throw Error('Owned runtime process group did not exit');
    if (failure) throw failure;
  }
}
