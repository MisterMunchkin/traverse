import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {projectStatus} from '../project.mjs';
import {checkGraph} from '../graph.mjs';
import {noSymlinks} from '../installation.mjs';
import {directory, readJson, atomicJson, withLock, exists} from '../state.mjs';
import {runProcess} from '../runtime/process.mjs';
import {need, validateTarget} from './contract.mjs';
import {createAgentDeviceRunner, resolveAgentDevice, RUNNER_CAPABILITIES} from './agent-device.mjs';

const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const schema = 'wayfinder-driving-session/1';
function sessionLocation(project, name) {
  need(typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name), 'Session name must be 1..64 letters, digits, _ or -');
  const dir = path.join(project, '.wayfinder/local/sessions', name); noSymlinks(dir); return dir;
}
export async function drivingProject(project = process.cwd(), signal) {
  const p = projectStatus(project), status = await checkGraph(p.root, {signal});
  need(status.ready, 'Repository graph is stale or invalid; run traverse graph refresh');
  return {root: p.root, graph: readJson(status.graph).inventory, graphStatus: status};
}
function wrapRunner(state, dir, options) {
  const write = () => atomicJson(path.join(dir, 'session.json'), state);
  const runner = createAgentDeviceRunner({executable: state.executable, session: state.runnerSession, directory: path.join(dir, 'runner'), target: state.target, signal: options.signal, timeoutMs: options.commandTimeoutMs ?? 15000});
  const open = runner.open, close = runner.close;
  runner.open = async context => { state.status = 'opening'; write(); const result = await open(context); state.status = 'open'; write(); return result; };
  runner.close = async context => {
    try { const result = await close(context); state.status = 'closed'; write(); return result; }
    catch (e) { state.status = 'close-failed'; write(); throw e; }
  };
  return runner;
}
export async function newSession(project, options) {
  validateTarget(options.target);
  const dir = sessionLocation(project, options.name), executable = resolveAgentDevice(options.executable);
  need(!exists(dir), 'Session name already exists; choose a fresh --session name');
  const version = await runProcess(executable, ['--version'], {timeoutMs: 10000, signal: options.signal, maxBytes: 65536});
  need(/^\d+\.\d+\.\d+(?:[^\r\n]*)?$/.test(version.stdout.trim()), 'agent-device version is unrecognized');
  directory(path.dirname(dir)); fs.mkdirSync(dir, {mode: 0o700});
  const state = {schema, name: options.name, runnerSession: 'wf-' + randomUUID(), target: options.target, executable, executableSha256: hash(executable), version: version.stdout.trim(), status: 'prepared', createdAt: new Date().toISOString()};
  atomicJson(path.join(dir, 'session.json'), state);
  return {state, directory: dir, runner: wrapRunner(state, dir, options)};
}
export function existingSession(project, options) {
  const dir = sessionLocation(project, options.name), state = readJson(path.join(dir, 'session.json'), 65536);
  need(state.schema === schema && state.name === options.name && /^wf-[0-9a-f-]{36}$/.test(state.runnerSession), 'Unowned or invalid session metadata');
  validateTarget(state.target);
  const executable = resolveAgentDevice(options.executable ?? state.executable);
  need(executable === state.executable && hash(executable) === state.executableSha256, 'Session runner executable changed; restore its recorded bytes before continuing');
  return {state, directory: dir, runner: wrapRunner(state, dir, options)};
}
export const lockSession = (session, work) => withLock(path.join(session.directory, 'session.lock'), work);
export async function sessionCommand(operation, options) {
  const project = operation === 'open' ? await drivingProject(options.project, options.signal) : {root: path.resolve(options.project ?? process.cwd())};
  const session = operation === 'open' ? await newSession(project.root, options) : existingSession(project.root, options);
  return lockSession(session, async () => {
    const result = {schema: 'wayfinder-session-result/1', session: session.state.name, runnerSession: session.state.runnerSession, directory: session.directory};
    const r = session.runner;
    if (operation === 'open') {
      try { await r.open(); result.observation = await r.observe(); }
      catch (e) { try { await r.close(); } catch (cleanup) { e.cleanupError = cleanup.message; } throw e; }
    } else if (operation === 'close') {
      need(!options.shutdown || session.state.target.platform !== 'web', 'Shutdown applies to native devices only');
      if (session.state.status !== 'closed') await r.close({shutdown: options.shutdown});
    } else {
      need(session.state.status === 'open', 'Session is not open; use a fresh session name');
      if (operation === 'observe') result.observation = await r.observe();
      else if (operation === 'act') result.action = await r.act(options.action);
      else throw Error('Unknown session operation');
    }
    return {...result, status: session.state.status, exitCode: 0};
  });
}

export async function deviceCommand(operation, {platform, device, executable, signal}) {
  if (operation === 'capabilities') return {schema: 'wayfinder-device-result/1', runner: 'agent-device', ...RUNNER_CAPABILITIES, exitCode: 0};
  need(['list', 'boot', 'shutdown'].includes(operation), 'Unsupported device operation; create/delete are unavailable in the built-in runner');
  need(['ios', 'android'].includes(platform), 'Device lifecycle needs platform ios or android');
  if (operation !== 'list' || device !== undefined) need(typeof device === 'string' && /^[A-Za-z0-9_.:-]+$/.test(device), 'Boot/shutdown require an explicit --device UDID or serial');
  const command = resolveAgentDevice(executable), session = 'wf-device-' + randomUUID();
  const args = [operation === 'list' ? 'devices' : operation === 'boot' ? 'boot' : 'close', ...(operation === 'shutdown' ? ['--shutdown'] : []), '--platform', platform,
    ...(device ? [platform === 'ios' ? '--udid' : '--serial', device] : []), '--session', session, '--json'];
  const receipt = await runProcess(command, args, {timeoutMs: 30000, signal, maxBytes: 4 * 1024 * 1024});
  const response = JSON.parse(receipt.stdout); need(response.success === true, 'Device lifecycle command failed');
  return {schema: 'wayfinder-device-result/1', operation, platform, device: device ?? null, data: response.data, receipt, exitCode: 0};
}
