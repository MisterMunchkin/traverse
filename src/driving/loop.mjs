import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {directory, atomicJson, exists} from '../state.mjs';
import {need, validateTask, expectationHolds} from './contract.mjs';
import {decideAction, emptyAccounting, addAccounting} from './policy.mjs';

// The runtime supervisor completes teardown after work returns. Its failure is part of the attempt.
export async function withDecisionRuntime({supervise, work, directory: dir, signal, record = false}) {
  let result;
  const start = performance.now();
  try { await supervise(async runtime => { result = await work(runtime); return result; }); }
  catch (e) {
    if (!result) result = {schema: 'wayfinder-drive-result/1', status: signal?.aborted ? 'cancelled' : /deadline|timeout/i.test(e.message) ? 'timeout' : 'failed',
      uiVerified: false, steps: 0, accounting: emptyAccounting(), recording: {requested: record, status: record ? 'not-started' : 'not-requested', file: record ? path.join(dir, 'recording.mp4') : null}, cleanupErrors: [], elapsedMs: performance.now() - start, resultFile: path.join(dir, 'result.json'), exitCode: signal?.aborted ? 130 : 1};
    else { result.cleanupErrors.push('model-runtime: ' + e.message); if (result.status === 'verified') { result.status = 'cleanup-failed'; result.exitCode = 1; } }
    result.error = e.message;
    atomicJson(result.resultFile, result);
  }
  return result;
}

export async function drive({runner, task, graph, directory: dir, ask, localModel, frontier, signal, maxSteps = 20, timeoutMs = 120000, policy = 'local-first', record = false, onProgress = () => {}}) {
  validateTask(task);
  need(Number.isInteger(maxSteps) && maxSteps >= 1 && maxSteps <= 100, 'Step limit must be 1..100');
  need(Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 1800000, 'Driving timeout must be 1..1800000ms');
  need(['local-first', 'frontier'].includes(policy), 'Unknown driving policy');
  if (policy === 'frontier') need(typeof frontier === 'function', 'Frontier control requires an explicit frontier');
  directory(dir);
  const resultFile = path.join(dir, 'result.json'), eventsFile = path.join(dir, 'events.jsonl');
  need(!exists(resultFile) && !exists(eventsFile), 'Driving output already exists');
  fs.writeFileSync(eventsFile, '', {flag: 'wx', mode: 0o600});
  const start = performance.now(), deadline = AbortSignal.timeout(timeoutMs), operationSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const accounting = emptyAccounting(), history = [], cleanupErrors = [];
  let status = 'failed', error = null, observation, lastAction, escalation, steps = 0, opened = false, recordingAttempted = false, uiVerified = false;
  const recording = {requested: record, status: record ? 'pending' : 'not-requested', file: record ? path.join(dir, 'recording.mp4') : null};
  const event = (type, detail) => { const value = {type, elapsedMs: performance.now() - start, ...detail}; fs.appendFileSync(eventsFile, JSON.stringify(value) + '\n'); onProgress(value); };
  function check() { if (operationSignal.aborted) throw Error(signal?.aborted ? 'CANCELLED' : 'DRIVING_TIMEOUT'); }
  try {
    atomicJson(path.join(dir, 'inputs.json'), {schema: 'wayfinder-driving-inputs/1', task, graph, graphHash: createHash('sha256').update(JSON.stringify(graph)).digest('hex'), runner: {name: runner.name, session: runner.session, target: runner.target}, policy, timeoutMs, maxSteps, record});
    check(); opened = true; await runner.open({signal: operationSignal});
    event('opened', {});
    if (record) { recordingAttempted = true; await runner.startRecording(recording.file, {signal: operationSignal}); recording.status = 'started'; }
    observation = await runner.observe({signal: operationSignal});
    for (;;) {
      check();
      uiVerified = expectationHolds(task.expect, observation);
      event('observed', {observationId: observation.id, uiVerified});
      if (uiVerified) { status = 'verified'; break; }
      if (steps >= maxSteps) { status = 'step-limit'; break; }
      let decision;
      try { decision = await decideAction({task, observation, graph, history, policy, model: localModel, ask, frontier, signal: operationSignal}); }
      catch (e) { if (e.decisionAccounting) addAccounting(accounting, e.decisionAccounting); throw e; }
      addAccounting(accounting, decision.accounting); event('decision', decision); check();
      if (decision.kind === 'escalate') { status = 'needs-frontier'; escalation = decision; break; }
      steps++;
      lastAction = await runner.act(decision.action, {signal: operationSignal});
      event('action', lastAction);
      need(lastAction.observation, 'Action effect remains unobserved');
      observation = lastAction.observation;
      history.push({action: decision.action, via: decision.via, execution: lastAction.execution, effect: lastAction.effect});
      if (history.length > 8) history.shift();
    }
  } catch (e) {
    error = e.message; lastAction = e.actionEvidence ?? lastAction;
    status = signal?.aborted ? 'cancelled' : deadline.aborted || /DEADLINE|TIMEOUT/i.test(error) ? 'timeout' : 'failed';
    event('failure', {error, lastAction, localEvidence: e.localEvidence ?? null});
  } finally {
    if (opened) {
      try { await runner.screenshot(path.join(dir, 'final.png')); } catch (e) { cleanupErrors.push('screenshot: ' + e.message); }
      if (recordingAttempted) {
        try {
          await runner.stopRecording();
          need(exists(recording.file) && fs.statSync(recording.file).isFile() && fs.statSync(recording.file).size > 0, 'Recording was acknowledged but no nonempty artifact was saved');
          recording.status = 'stopped'; recording.bytes = fs.statSync(recording.file).size; recording.playbackVerified = false;
        }
        catch (e) { recording.status = 'failed'; cleanupErrors.push('stopRecording: ' + e.message); }
      }
      try { await runner.close(); } catch (e) { cleanupErrors.push('close: ' + e.message); }
    }
  }
  if (cleanupErrors.length && status === 'verified') status = 'cleanup-failed';
  const result = {schema: 'wayfinder-drive-result/1', status, uiVerified, steps, elapsedMs: performance.now() - start, policy, accounting,
    recording, cleanupErrors, error, lastAction: lastAction ?? null, escalation: escalation ?? null, observationId: observation?.id ?? null, resultFile, eventsFile,
    exitCode: status === 'verified' ? 0 : status === 'needs-frontier' ? 2 : status === 'cancelled' ? 130 : 1};
  atomicJson(resultFile, result); return result;
}
