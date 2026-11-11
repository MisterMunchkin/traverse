import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {digest} from './extractor-pipeline/contract.mjs';
import {atomicJson, exists} from './state.mjs';

const require = (condition, message) => { if (!condition) throw Error(message); };
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || !(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative));
};
function location({project, namespace, key}) {
  const canonicalProject = fs.realpathSync(project);
  require(/^[a-z][a-z-]{0,63}$/.test(namespace), 'Invalid private state namespace');
  const base = process.env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local', 'state');
  require(path.isAbsolute(base), 'XDG_STATE_HOME must be an absolute owned path');
  const directory = path.join(path.resolve(base), 'traverse', namespace);
  require(!inside(canonicalProject, directory), 'Private state must remain outside the repository');
  return {directory, file: path.join(directory, digest(key) + '.json')};
}
function secureDirectory(directory, create) {
  require(typeof process.getuid === 'function', 'Private state records require OS ownership checks');
  const uid = process.getuid();
  let current = path.parse(directory).root;
  for (const part of directory.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!exists(current)) {
      if (!create) return false;
      fs.mkdirSync(current, {mode: 0o700});
    }
    const stat = fs.lstatSync(current);
    require(stat.isDirectory() && !stat.isSymbolicLink(), 'Unsafe state record directory: symlinks and non-directories are refused');
    require(stat.uid === uid || stat.uid === 0, 'Private state ancestry has an unexpected owner');
    // Root-owned sticky system temporary directories are legitimate ancestors,
    // but the grant directory itself must always be private to this user.
    const stickySystem = stat.uid === 0 && (stat.mode & 0o1000) !== 0 && current !== directory;
    require((stat.mode & 0o022) === 0 || stickySystem, 'Private state ancestry is writable by another user');
    if (current === directory)
      require(stat.uid === uid && (stat.mode & 0o077) === 0, 'Private state directory must be private to its owner');
  }
  return true;
}
function privateFile(stat) {
  require(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid() && (stat.mode & 0o077) === 0 && stat.size <= 4 * 1024 * 1024,
    'Unsafe or oversized private state record file');
}
function readPrivate(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd); privateFile(before);
    const bytes = Buffer.alloc(before.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const n = fs.readSync(fd, bytes, count, bytes.length - count, null);
      if (!n) break;
      count += n;
    }
    const after = fs.fstatSync(fd); privateFile(after);
    require(count === before.size && after.size === before.size && after.ino === before.ino && after.dev === before.dev && after.mtimeMs === before.mtimeMs,
      'Private state changed while being read');
    try { return JSON.parse(bytes.subarray(0, count).toString('utf8')); }
    catch { throw Error('Malformed private state record'); }
  } finally { fs.closeSync(fd); }
}
export function preflightPrivateState(inputs) {
  const {directory, file} = location(inputs);
  secureDirectory(directory, false);
  let parent = directory;
  while (!exists(parent)) parent = path.dirname(parent);
  fs.accessSync(parent, fs.constants.W_OK);
  if (exists(file)) readPrivate(file);
}
export function readPrivateState(inputs) {
  const {directory, file} = location(inputs);
  if (!secureDirectory(directory, false) || !exists(file)) return null;
  return readPrivate(file);
}
export function writePrivateState(inputs, value) {
  const {directory, file} = location(inputs);
  preflightPrivateState(inputs);
  secureDirectory(directory, true);
  if (exists(file)) readPrivate(file);
  atomicJson(file, value);
}
