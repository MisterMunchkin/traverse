import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {runProcess} from '../runtime/process.mjs';
import {directory, atomicJson, readJson, exists} from '../state.mjs';
import {need, validateTarget, normalizeObservation, validateAction} from './contract.mjs';

export const RUNNER_CAPABILITIES = Object.freeze({actions: ['press', 'fill', 'scroll', 'back'], recording: true,
  lifecycle: {list: true, boot: true, shutdown: true, create: false, delete: false}});

export function resolveAgentDevice(selection) {
  const locations = selection ? [selection] : (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map(dir => path.resolve(dir, 'agent-device'));
  for (const location of locations) {
    if (!path.isAbsolute(location)) continue;
    try { fs.accessSync(location, fs.constants.X_OK); if (fs.statSync(location).isFile()) return fs.realpathSync(location); } catch {}
  }
  throw Error('agent-device executable unavailable; install it or select an absolute --agent-device path');
}

export function createAgentDeviceRunner({executable, session, directory: dir, target, execute = runProcess, signal, timeoutMs = 15000, remainingMs = () => Infinity}) {
  validateTarget(target);
  need(typeof executable === 'string' && path.isAbsolute(executable), 'Runner needs an absolute agent-device executable');
  need(typeof session === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(session), 'Invalid runner session');
  directory(dir); directory(path.join(dir, 'commands'));
  const observationFile = path.join(dir, 'observation.json');
  let last = exists(observationFile) ? readJson(observationFile) : null;
  async function command(args, cleanup = false, operationSignal) {
    const ms = cleanup ? timeoutMs : Math.min(timeoutMs, Math.floor(remainingMs()));
    need(ms > 0, 'Driving deadline reached', 'TIMEOUT');
    const argv = [...args, '--session', session, '--json'], file = path.join(dir, 'commands', randomUUID() + '.json');
    let record;
    const combined = signal && operationSignal ? AbortSignal.any([signal, operationSignal]) : operationSignal ?? signal;
    try { record = await execute(executable, argv, {timeoutMs: ms, signal: cleanup ? undefined : combined, maxBytes: 4 * 1024 * 1024}); }
    catch (e) { atomicJson(file, {schema: 'wayfinder-device-command/1', ...e.record, command: executable, args: argv, timeoutMs: ms, error: e.message}); throw e; }
    atomicJson(file, {schema: 'wayfinder-device-command/1', ...record, timeoutMs: ms});
    let response; try { response = JSON.parse(record.stdout); } catch { throw Error('agent-device returned malformed JSON; inspect the command receipt'); }
    need(response.success === true && response.data !== undefined, 'agent-device command failed; inspect the command receipt', 'DEVICE_COMMAND_FAILED');
    return response.data;
  }
  async function observe({signal: operationSignal} = {}) {
    const observation = normalizeObservation(await command(['snapshot'], false, operationSignal), {target});
    atomicJson(path.join(dir, 'observation-' + observation.id + '.json'), observation);
    atomicJson(observationFile, observation); last = observation; return observation;
  }
  async function act(action, {signal: operationSignal} = {}) {
    validateAction(action);
    need(last && last.id === action.observationId, 'Action needs the latest observation', 'STALE_OBSERVATION');
    const selected = last, evidence = {schema: 'wayfinder-action/1', action, execution: 'not-dispatched', effect: 'unverified', observation: null};
    const start = performance.now(), receipt = path.join(dir, 'action-' + randomUUID() + '.json');
    try {
      const fresh = await observe({signal: operationSignal}); evidence.observation = fresh;
      need(fresh.fingerprint === selected.fingerprint, 'UI changed; select again from the new observation', 'STALE_OBSERVATION');
      let args;
      if (action.type === 'press' || action.type === 'fill') {
        const control = fresh.controls.find(c => c.id === action.target);
        need(control, 'Target is not a current enabled control', 'INVALID_TARGET');
        need(action.type !== 'fill' || control.role === 'textbox', 'Fill target must be an editable field');
        args = action.type === 'fill' ? ['fill', control.ref, action.value] : ['press', control.ref];
      } else {
        need(!fresh.overlays.length, 'Use an observed dialog control before scrolling or navigating back', 'INVALID_TARGET');
        args = action.type === 'scroll' ? ['scroll', action.direction] : ['back'];
      }
      evidence.execution = 'uncertain';
      evidence.acknowledgement = await command(args, false, operationSignal);
      evidence.execution = 'acknowledged'; evidence.observation = null;
      evidence.observation = await observe({signal: operationSignal});
      return evidence;
    } catch (e) { evidence.error = e.message; e.actionEvidence = evidence; throw e; }
    finally { evidence.elapsedMs = performance.now() - start; atomicJson(receipt, evidence); }
  }
  return {
    name: 'agent-device', session, target, directory: dir, capabilities: RUNNER_CAPABILITIES, observe, act,
    open: ({signal: operationSignal} = {}) => command(['open', target.app, '--platform', target.platform, ...(target.platform === 'web' ? [] : [target.platform === 'ios' ? '--udid' : '--serial', target.device])], false, operationSignal),
    close: ({shutdown = false} = {}) => command(['close', ...(shutdown ? ['--shutdown'] : [])], true),
    startRecording: (file, {signal: operationSignal} = {}) => command(['record', 'start', path.resolve(file)], false, operationSignal),
    stopRecording: () => command(['record', 'stop'], true),
    screenshot: file => command(['screenshot', path.resolve(file)], true),
  };
}
