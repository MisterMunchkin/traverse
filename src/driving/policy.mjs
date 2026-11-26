import {askChoice} from './choice.mjs';
import {MODEL_PINS} from '../model-setup.mjs';
import {need} from './contract.mjs';
import {decisionContext, matchScreen, observedContext} from './context.mjs';

const reportedKeys = ['frontierReportedInputTokens', 'frontierReportedOutputTokens', 'frontierReportedCacheCreationInputTokens', 'frontierReportedCacheReadInputTokens', 'frontierReportedApiCostUsd'];
export const emptyAccounting = () => ({localCalls: 0, frontierCalls: 0, localInputTokens: 0, frontierInputTokens: 0, frontierOutputTokens: 0, costUsd: 0, ...Object.fromEntries(reportedKeys.map(key => [key, 0])), complete: true});
export function addAccounting(total, part) {
  for (const key of ['localCalls', 'frontierCalls']) total[key] += part[key];
  for (const key of ['localInputTokens', 'frontierInputTokens', 'frontierOutputTokens', 'costUsd', ...reportedKeys]) total[key] = total[key] === null || part[key] === null ? null : total[key] + part[key];
  total.complete = total.complete && part.complete;
}
const quantity = n => Number.isFinite(n) && n >= 0 ? n : null;

export function actionOptions(task, observation) {
  const options = [], fields = observation.controls.filter(c => c.role === 'textbox'), resolved = new Map();
  const actionTypes = task.actionTypes ?? ['press', 'fill'];
  for (const [key, value] of Object.entries(task.inputs ?? {})) {
    const found = fields.filter(c => c.identifier === key || c.label === key);
    if (found.length !== 1) continue;
    const values = resolved.get(found[0].id) ?? new Set(); values.add(value); resolved.set(found[0].id, values);
  }
  for (const control of observation.controls) {
    if (control.role === 'textbox') {
      if (!actionTypes.includes('fill')) continue;
      const values = resolved.get(control.id);
      if (!values || values.size !== 1) continue;
      const [value] = values;
      if (control.value === value) continue;
      options.push({id: 'c' + options.length,
        description: `Fill ${JSON.stringify(control.label || control.identifier)} with ${JSON.stringify(value)} (current ${JSON.stringify(control.value)}).`,
        action: {observationId: observation.id, type: 'fill', target: control.id, value}});
    } else {
      for (const type of ['press', 'longpress']) {
        if (!actionTypes.includes(type)) continue;
        const label = JSON.stringify(control.label || control.identifier || control.role);
        options.push({id: 'c' + options.length, description: type === 'press' ? `Press ${label}.` : `Long press ${label} for 800 ms.`, action: {observationId: observation.id, type, target: control.id}});
      }
    }
  }
  return options;
}

export async function decideAction({task, observation, graph, history = [], policy = 'local-first', model = MODEL_PINS.model.name, ask = askChoice, frontier, signal}) {
  need(['local-first', 'frontier'].includes(policy), 'Unknown driving policy');
  const accounting = emptyAccounting(), offered = actionOptions(task, observation), options = offered.map(({id, description}) => ({id, description}));
  const localOptions = [...options, ...(options.length < 2 ? [{id: 'none', description: 'None of the offered controls makes progress.'}] : [])];
  const instructions = `Goal: ${task.goal}\nChoose the current control that makes progress on this goal.`;
  const estimate = state => Math.ceil((JSON.stringify(state).length + instructions.length + JSON.stringify(localOptions).length) / 3);
  const fits = state => estimate(state) <= 1500;
  const budget = state => ({limitTokens: 1500, estimatedInputTokens: estimate(state), reservedTokens: estimate({...state, navigationGraph: {}}), graphTokenBudget: Math.max(0, 1500 - estimate({...state, navigationGraph: {}}))});
  const screen = matchScreen(task.screenMap, observation, graph);
  const {state, receipt: context, frontierState, frontierReceipt} = decisionContext({observed: observedContext(observation), overlays: observation.overlays.map(n => ({role: n.role, label: n.label})), modalScope: observation.modalScope, navigationGraph: graph, history: history.slice(-8),
    ...(screen ? {screen: {status: screen.status, route: screen.route, method: screen.method, runtimeRouteVerified: false}} : {})}, {goal: task.goal, controls: observation.controls, fits, screen});
  context.budget = budget(state);
  const brief = {schema: 'wayfinder-frontier-choice-request/1', goal: task.goal, inputs: task.inputs ?? {}, observationId: observation.id, state, context, options};
  const handoff = () => frontierState ? {...brief, state: frontierState, context: {...frontierReceipt, window: structuredClone(context), budget: budget(frontierState)}} : brief;
  let localEscalation, localEvidence = null;
  const escalation = reason => ({kind: 'escalate', reason, brief: handoff(), accounting, localEvidence});
  try {
    if (signal?.aborted) throw Error('CANCELLED');
    if (!options.length) return escalation('NO_CONTROLS');
    if (policy === 'local-first') {
      const text = JSON.stringify(state);
      if (screen && screen.status !== 'matched') localEscalation = {code: screen.status === 'ambiguous' ? 'SCREEN_AMBIGUOUS' : 'SCREEN_UNKNOWN'};
      else if (options.length > 23) localEscalation = {code: 'TOO_MANY_OPTIONS'};
      else if (!fits(state)) localEscalation = {code: 'CONTEXT_LIMIT'};
      else {
        accounting.localCalls++; accounting.localInputTokens = null;
        try {
          localEvidence = {context, request: {model, state: text, instructions, options: localOptions, keepAlive: '60s', timeoutMs: 10000}};
          const answer = await ask({...localEvidence.request, signal}); localEvidence.response = answer;
          accounting.localInputTokens = quantity(answer.raw?.usage?.input_tokens);
          const probabilities = localOptions.map(o => answer.probabilities?.[o.id]);
          const valid = localOptions.some(o => o.id === answer.choice) && Number.isFinite(answer.confidence) && answer.confidence >= 0 && answer.confidence <= 1 && probabilities.every(p => Number.isFinite(p) && p >= 0 && p <= 1);
          if (!valid) localEscalation = {code: 'INVALID_LOCAL_RESPONSE'};
          else {
            const ranked = [...probabilities].sort((a, b) => b - a), margin = ranked[0] - ranked[1];
            const chosen = answer.probabilities[answer.choice];
            if (answer.choice === 'none') localEscalation = {code: 'NONE'};
            else if (margin < .819 || chosen !== ranked[0]) localEscalation = {code: 'LOW_MARGIN', margin, confidence: answer.confidence};
            else {
              accounting.complete = accounting.localInputTokens !== null;
              return {kind: 'act', via: 'tev1', localEvidence, action: offered.find(o => o.id === answer.choice).action, signals: {margin, confidence: answer.confidence}, accounting};
            }
          }
        } catch (e) { if (localEvidence) localEvidence.error = e.message; if (signal?.aborted) throw e; localEscalation = {code: 'LOCAL_UNAVAILABLE', detail: e.message}; }
      }
      brief.localEscalation = localEscalation;
      accounting.complete = accounting.localInputTokens !== null;
    }
    if (!frontier) return escalation(localEscalation?.code ?? 'FRONTIER_REQUIRED');
    const responseSchema = {type: 'object', properties: {pick: {type: 'string', enum: [...options.map(o => o.id), 'none']}}, required: ['pick'], additionalProperties: false};
    accounting.frontierCalls++; accounting.frontierInputTokens = null; accounting.frontierOutputTokens = null; accounting.costUsd = null; accounting.complete = false;
    for (const key of reportedKeys) accounting[key] = null;
    const result = await frontier({...handoff(), responseSchema, signal});
    need(result && (result.pick === 'none' || offered.some(o => o.id === result.pick)), 'Frontier choice was not offered');
    accounting.frontierInputTokens = quantity(result.usage?.inputTokens); accounting.frontierOutputTokens = quantity(result.usage?.outputTokens); accounting.costUsd = quantity(result.costUsd);
    const reported = result.reportedUsage ?? {};
    const input = [reported.input_tokens, reported.cache_creation_input_tokens, reported.cache_read_input_tokens].map(quantity);
    accounting.frontierReportedInputTokens = input.every(n => n !== null) ? input.reduce((a, b) => a + b, 0) : null;
    accounting.frontierReportedOutputTokens = quantity(reported.output_tokens);
    accounting.frontierReportedCacheCreationInputTokens = quantity(reported.cache_creation_input_tokens);
    accounting.frontierReportedCacheReadInputTokens = quantity(reported.cache_read_input_tokens);
    accounting.frontierReportedApiCostUsd = quantity(result.reportedApiCostUsd);
    accounting.complete = [accounting.localInputTokens, accounting.frontierInputTokens, accounting.frontierOutputTokens, accounting.costUsd].every(n => n !== null);
    if (result.pick === 'none') return escalation('FRONTIER_NONE');
    return {kind: 'act', via: 'frontier', localEvidence, action: offered.find(o => o.id === result.pick).action, accounting, ...(localEscalation ? {localEscalation} : {})};
  } catch (e) { e.decisionAccounting = accounting; e.localEvidence = localEvidence; throw e; }
}
