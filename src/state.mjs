import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {noSymlinks} from './installation.mjs';

export const exists = file => { try { fs.lstatSync(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
export function readJson(file, maxBytes = 32 * 1024 * 1024) {
  noSymlinks(file);
  const s = fs.statSync(file);
  if (!s.isFile() || s.size > maxBytes) throw Error('Invalid or oversized state file: ' + path.basename(file));
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw Error('Malformed state file: ' + path.basename(file)); }
}
export function directory(dir) {
  noSymlinks(dir); fs.mkdirSync(dir, {recursive: true, mode: 0o700}); noSymlinks(dir);
  if (!fs.statSync(dir).isDirectory()) throw Error('Expected an owned directory');
}
export function atomicJson(file, data) {
  atomicWrite(file, JSON.stringify(data, null, 2) + '\n');
}
export function atomicWrite(file, bytes) {
  noSymlinks(file);
  if (exists(file) && !fs.statSync(file).isFile()) throw Error('Refusing non-file state destination');
  const temporary = path.join(path.dirname(file), '.write-' + randomUUID());
  try {
    fs.writeFileSync(temporary, bytes, {flag: 'wx', mode: 0o600});
    noSymlinks(file); fs.renameSync(temporary, file);
  } finally { if (exists(temporary)) fs.unlinkSync(temporary); }
}
export async function withLock(file, work) {
  noSymlinks(file);
  const owner = JSON.stringify({schema: 'wayfinder-lock/1', id: randomUUID(), pid: process.pid});
  try { fs.writeFileSync(file, owner, {flag: 'wx', mode: 0o600}); }
  catch (e) { if (e.code === 'EEXIST') throw Error('Traverse operation already locked; inspect the owner before removing a stale lock: ' + file); throw e; }
  try { return await work(); }
  finally {
    noSymlinks(file);
    if (exists(file) && fs.readFileSync(file, 'utf8') === owner) fs.unlinkSync(file);
  }
}
