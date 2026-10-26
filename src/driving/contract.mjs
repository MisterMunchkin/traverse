import {createHash, randomUUID} from 'node:crypto';

export const need = (condition, message, code = 'INVALID_INPUT') => {
  if (!condition) throw Object.assign(Error(message), {code});
};
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const roles = {textfield: 'textbox', textview: 'textbox', searchfield: 'textbox', edittext: 'textbox', textarea: 'textbox', securetextfield: 'securetextbox', cell: 'button', switch: 'switch', alertdialog: 'alert'};
const roleOf = n => { const role = String(n.role || n.type || '').toLowerCase(); return roles[role] ?? role; };
const visible = n => n.visible !== false && n.hidden !== true && n.hiddenAbove !== true && n.hiddenBelow !== true && n.hiddenContentAbove !== true && n.hiddenContentBelow !== true;
const enabled = n => n.enabled !== false && n.disabled !== true;

export function validateTarget(target) {
  need(object(target) && ['web', 'ios', 'android'].includes(target.platform), 'Choose platform web, ios or android');
  need(typeof target.app === 'string' && target.app.trim() && !target.app.startsWith('-') && !target.app.includes('\0'), 'An explicit app or URL is required');
  if (target.platform === 'web') {
    let url; try { url = new URL(target.app); } catch {}
    need(url && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'Web app must be an HTTP(S) URL without credentials');
    need(target.device === undefined, 'Web target does not accept a device');
  } else need(typeof target.device === 'string' && /^[A-Za-z0-9_.:-]+$/.test(target.device), 'Native driving needs an explicit UDID or serial');
  return target;
}

export function normalizeObservation(data, {target = null, id = randomUUID()} = {}) {
  need(object(data) && data.truncated !== true, 'A truncated observation cannot be used', 'INVALID_OBSERVATION');
  need(Array.isArray(data.nodes) && data.nodes.length > 0 && data.nodes.length <= 10000, 'Snapshot has no usable nodes', 'INVALID_OBSERVATION');
  const nodes = data.nodes.map((n, i) => {
    need(object(n), 'Malformed snapshot node', 'INVALID_OBSERVATION');
    const role = roleOf(n), rawRef = n.ref;
    const ref = typeof rawRef === 'string' && rawRef ? (rawRef.startsWith('@') ? rawRef : '@' + rawRef) : null;
    need(ref === null || /^@e\d+(?:~s\d+)?$/.test(ref), 'Unsupported snapshot reference', 'INVALID_OBSERVATION');
    return {id: 'control-' + i, index: n.index ?? i, parent: n.parentIndex ?? null, role, label: String(n.label ?? ''),
      identifier: n.identifier ?? null, value: role === 'securetextbox' ? null : (n.value ?? (role === 'textbox' ? '' : null)),
      visible: visible(n), enabled: enabled(n), hittable: n.hittable ?? null, ref, ...(n.rect ? {rect: n.rect} : {})};
  });
  const indices = new Map(nodes.map(n => [n.index, n]));
  need(indices.size === nodes.length, 'Snapshot indexes are ambiguous', 'INVALID_OBSERVATION');
  for (const n of nodes) {
    const seen = new Set([n.index]);
    for (let p = indices.get(n.parent); p; p = indices.get(p.parent)) {
      need(!seen.has(p.index), 'Snapshot hierarchy contains a cycle', 'INVALID_OBSERVATION');
      seen.add(p.index); n.visible &&= p.visible; n.enabled &&= p.enabled;
    }
  }
  const overlays = nodes.filter(n => n.visible && ['alert', 'dialog'].includes(n.role));
  if (target?.platform !== 'web' && target?.app?.includes('.') && data.appBundleId && !overlays.length)
    need(data.appBundleId === target.app, 'Snapshot belongs to another app', 'INVALID_OBSERVATION');
  function beneath(node, ancestor) {
    const seen = new Set();
    for (let p = node; p && !seen.has(p.index); p = indices.get(p.parent)) {
      if (p === ancestor) return true;
      seen.add(p.index);
    }
    return false;
  }
  const leaves = overlays.filter(parent => !overlays.some(child => child !== parent && beneath(child, parent)));
  const active = leaves.length === 1 ? leaves[0] : null;
  // Only a unique innermost modal authorizes actions; unordered modal roots remain ambiguous.
  const inOverlay = node => !overlays.length || (active !== null && beneath(node, active));
  const controls = nodes.filter(n => n.visible && n.enabled && n.hittable !== false && n.ref && ['button', 'link', 'textbox', 'switch', 'checkbox'].includes(n.role) && inOverlay(n));
  const semantic = nodes.map(({ref, ...n}) => n);
  return {schema: 'wayfinder-observation/1', id, target, capturedAt: new Date().toISOString(),
    fingerprint: hash({target, app: data.appBundleId ?? null, nodes: semantic}),
    app: data.appBundleId ?? null, nodes, controls, overlays, modalScope: {status: !overlays.length ? 'none' : active ? 'active' : 'ambiguous', activeId: active?.id ?? null}};
}

export function validateAction(action) {
  need(object(action), 'Action must be an object');
  need(typeof action.observationId === 'string' && action.observationId, 'Action requires observationId');
  need(['press', 'fill', 'scroll', 'back'].includes(action.type), 'Unsupported action type');
  const keys = ['observationId', 'type', ...(['press', 'fill'].includes(action.type) ? ['target'] : []), ...(action.type === 'fill' ? ['value'] : action.type === 'scroll' ? ['direction'] : [])];
  need(Object.keys(action).every(k => keys.includes(k)) && keys.every(k => Object.hasOwn(action, k)), 'Action has unknown or missing fields');
  if (keys.includes('target')) need(typeof action.target === 'string' && action.target, 'Action target is required');
  if (action.type === 'fill') need(typeof action.value === 'string' && action.value.length <= 10000, 'Fill needs a bounded string value');
  if (action.type === 'scroll') need(['up', 'down', 'top', 'bottom'].includes(action.direction), 'Invalid scroll direction');
  return action;
}

function selector(s) {
  need(object(s) && Object.keys(s).length > 0 && Object.entries(s).every(([k, v]) => ['label', 'role', 'identifier', 'value'].includes(k) && typeof v === 'string'), 'Expectation needs an exact nonempty UI selector');
}
export const matches = (node, s) => Object.entries(s).every(([key, value]) => node[key] === value);
export function validateTask(task) {
  need(object(task) && typeof task.goal === 'string' && task.goal.trim() && task.goal.length <= 20000, 'Task requires a bounded goal');
  need(Object.keys(task).every(k => ['goal', 'inputs', 'expect'].includes(k)), 'Unknown task field');
  need(task.inputs === undefined || (object(task.inputs) && Object.values(task.inputs).every(v => typeof v === 'string' && v.length <= 10000)), 'Task inputs must map field labels or identifiers to text');
  need(object(task.expect) && Object.keys(task.expect).every(k => ['visible', 'absent', 'fields'].includes(k)), 'Task needs observable expectations');
  let total = 0;
  for (const key of ['visible', 'absent', 'fields']) if (task.expect[key] !== undefined) {
    need(Array.isArray(task.expect[key]), 'Expectation must be a list');
    for (const s of task.expect[key]) { selector(s); if (key === 'fields') need(Object.hasOwn(s, 'value'), 'Field expectation needs value'); }
    total += task.expect[key].length;
  }
  need(total > 0, 'Task needs a nonempty observable expectation');
  return task;
}
export function expectationHolds(expect, observation) {
  const nodes = observation.nodes.filter(n => n.visible);
  return (expect.visible ?? []).every(s => nodes.some(n => matches(n, s))) &&
    (expect.absent ?? []).every(s => !nodes.some(n => matches(n, s))) &&
    (expect.fields ?? []).every(s => {
      const {value, ...identity} = s, found = nodes.filter(n => n.role === 'textbox' && matches(n, identity));
      return found.length === 1 && found[0].value === value;
    });
}
