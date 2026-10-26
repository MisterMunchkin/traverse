export class Tev1Error extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code; // 'unavailable' | 'timeout' | 'http' | 'malformed' | 'invalid-request'
    this.details = details;
  }
}

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 24; // tev1 was trained on 2-24 options; the endpoint accepts up to 26

// options: ordered [{id, description}]. Callers add a `none` option themselves; the endpoint does not.
export function buildChoiceRequest({model = 'tev1', state, name = 'pick', instructions, options, keepAlive}) {
  if (!Array.isArray(options) || options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    throw new Tev1Error('invalid-request', `a choice question needs ${MIN_OPTIONS}-${MAX_OPTIONS} options, got ${options?.length ?? 0}`);
  }
  if (new Set(options.map(o => o.id)).size !== options.length) throw new Tev1Error('invalid-request', 'option ids must be unique');
  const body = {
    model,
    state,
    questions: {[name]: {type: 'choice', instructions, criteria: Object.fromEntries(options.map(o => [o.id, o.description]))}},
  };
  if (keepAlive !== undefined) body.keep_alive = keepAlive;
  return body;
}

// Resolves to {choice, probabilities, confidence, elapsedMs, raw}; every failure is a Tev1Error.
export async function askChoice({baseUrl = 'http://127.0.0.1:11434', timeoutMs = 20000, fetchImpl = fetch, name = 'pick', signal, ...request}) {
  const body = buildChoiceRequest({name, ...request});
  const started = performance.now();
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/v1/systemone`, {
      method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error.name === 'TimeoutError') throw new Tev1Error('timeout', `no answer from ${baseUrl} within ${timeoutMs} ms`);
    throw new Tev1Error('unavailable', `cannot reach ${baseUrl}: ${error.cause?.code ?? error.message}`);
  }
  if (!response.ok) throw new Tev1Error('http', `HTTP ${response.status}`, {status: response.status, body: await response.text().catch(() => '')});
  let raw;
  try {
    raw = await response.json();
  } catch {
    throw new Tev1Error('malformed', 'response body is not JSON');
  }
  const answer = raw?.answers?.[name];
  if (!answer || typeof answer.choice !== 'string' || typeof answer.confidence !== 'number' || typeof answer.probabilities !== 'object' || answer.probabilities === null) {
    throw new Tev1Error('malformed', `response has no usable answers.${name}`, {raw});
  }
  if (!request.options.some(o => o.id === answer.choice)) {
    throw new Tev1Error('malformed', `choice ${JSON.stringify(answer.choice)} is not one of the offered option ids`, {raw});
  }
  return {choice: answer.choice, probabilities: answer.probabilities, confidence: answer.confidence, elapsedMs: Math.round(performance.now() - started), raw};
}
