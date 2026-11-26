import {createHash, randomUUID} from 'node:crypto';

export const need = (condition, message, code = 'INVALID_INPUT') => {
  if (!condition) throw Object.assign(Error(message), {code});
};
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const roles = {textfield: 'textbox', textview: 'textbox', searchfield: 'textbox', edittext: 'textbox', textarea: 'textbox', securetextfield: 'securetextbox', cell: 'button', switch: 'switch', alertdialog: 'alert'};
const androidRoles = {'android.widget.button': 'button', 'android.widget.imagebutton': 'button', 'android.widget.edittext': 'textbox', 'android.widget.switch': 'switch', 'android.widget.checkbox': 'checkbox', 'android.app.alertdialog': 'alert', 'android.app.dialog': 'dialog'};
const semanticRoles = new Set(['button', 'link', 'textbox', 'securetextbox', 'switch', 'checkbox', 'alert', 'dialog']);
function roleOf(n, platform) {
  const rawRole = String(n.role ?? '').toLowerCase(), rawType = String(n.type ?? '').toLowerCase();
  const normalize = raw => androidRoles[raw] ?? roles[raw] ?? raw;
  const role = normalize(rawRole), type = normalize(rawType);
  const conflict = semanticRoles.has(role) && semanticRoles.has(type) && role !== type;
  if (platform !== 'web' && ['alert', 'dialog'].some(modal => role === modal || type === modal))
    need(!conflict && n.password !== true, 'Conflicting native modal semantics', 'INVALID_OBSERVATION');
  if (n.password === true || role === 'securetextbox' || type === 'securetextbox') return 'securetextbox';
  if (platform === 'web') return role || type;
  if (conflict) return 'unknown';
  return semanticRoles.has(type) ? type : semanticRoles.has(role) ? role : rawRole || rawType;
}
const visible = n => n.visible !== false && n.visibleToUser !== false && n.hidden !== true && n.hiddenAbove !== true && n.hiddenBelow !== true && n.hiddenContentAbove !== true && n.hiddenContentBelow !== true;
const enabled = n => n.enabled !== false && n.disabled !== true && n.interactionBlocked !== 'covered';

// Android's top-level appBundleId can describe the session's requested app even
// after another app opens. Node ownership is required before projecting app UI.
function androidAppNodes(nodes, target) {
  const system = 'com.android.systemui';
  const indexed = new Map(nodes.map((n, i) => [n.index ?? i, n]));
  need(indexed.size === nodes.length, 'Snapshot indexes are ambiguous', 'INVALID_OBSERVATION');
  const roots = new Map();
  for (const [index, node] of indexed) {
    need(typeof node.bundleId === 'string' && node.bundleId.length > 0, 'Android foreground ownership is unknown; snapshot nodes need bundleId', 'INVALID_OBSERVATION');
    need(node.bundleId === target.app || node.bundleId === system, 'Snapshot belongs to another app', 'INVALID_OBSERVATION');
    let root = node;
    const seen = new Set([index]);
    while (root.parentIndex !== undefined && root.parentIndex !== null) {
      const parent = indexed.get(root.parentIndex);
      need(parent && !seen.has(root.parentIndex) && parent.bundleId === node.bundleId, 'Android snapshot hierarchy has unknown or conflicting ownership', 'INVALID_OBSERVATION');
      seen.add(root.parentIndex); root = parent;
    }
    roots.set(node, root);
  }
  const statusRoots = new Set(['clock', 'mobile_combo', 'battery'].map(id => `${system}:id/${id}`));
  const validRect = r => object(r) && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k])) && r.width > 0 && r.height > 0;
  const statusBands = nodes.filter(n => roots.get(n) === n && n.bundleId === system && statusRoots.has(n.identifier) && validRect(n.rect)).map(n => n.rect);
  for (const n of nodes.filter(n => n.bundleId === system)) {
    const root = roots.get(n), role = roleOf(n, 'android');
    const navigation = root.identifier === `${system}:id/navigation_bar_frame` && root.type === 'android.widget.FrameLayout';
    const status = statusRoots.has(root.identifier) && ['android.widget.TextView', 'android.widget.FrameLayout', 'android.widget.LinearLayout'].includes(root.type);
    // Android may expose status icons as independent, identifier-less roots.
    // Accept only noninteractive images in a known status bar's vertical band.
    const icon = root.type === 'android.widget.ImageView' && (!root.identifier || root.identifier === `${system}:id/wifi_signal`) && validRect(root.rect) && statusBands.some(r => root.rect.y >= r.y && root.rect.y + root.rect.height <= r.y + r.height);
    need((navigation || status || icon) && !['alert', 'dialog', 'textbox', 'securetextbox'].includes(role) &&
      (navigation || (!semanticRoles.has(role) && n.hittable !== true && n.editable !== true)),
    'Android system surface is not recognized passive chrome; foreground ownership is unknown', 'INVALID_OBSERVATION');
  }
  const appNodes = nodes.filter(n => n.bundleId === target.app);
  need(appNodes.some(n => visible(n)), 'Android foreground ownership is unknown; no requested-app nodes', 'INVALID_OBSERVATION');
  // Keep app-relative identities stable when chrome nodes are inserted/removed.
  const positions = new Map(appNodes.map((n, i) => [n.index ?? nodes.indexOf(n), i]));
  return appNodes.map((n, i) => ({...n, index: i, parentIndex: n.parentIndex == null ? null : positions.get(n.parentIndex)}));
}

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
  need(data.nodes.every(object), 'Malformed snapshot node', 'INVALID_OBSERVATION');
  const sourceNodes = target?.platform === 'android' && target.app ? androidAppNodes(data.nodes, target) : data.nodes;
  const nodes = sourceNodes.map((n, i) => {
    need(object(n), 'Malformed snapshot node', 'INVALID_OBSERVATION');
    const role = roleOf(n, target?.platform), rawRef = n.ref;
    const ref = typeof rawRef === 'string' && rawRef ? (rawRef.startsWith('@') ? rawRef : '@' + rawRef) : null;
    need(ref === null || /^@e\d+(?:~s\d+)?$/.test(ref), 'Unsupported snapshot reference', 'INVALID_OBSERVATION');
    return {id: 'control-' + i, index: n.index ?? i, parent: n.parentIndex ?? null, role, label: String(n.label ?? ''),
      identifier: n.identifier ?? null, value: role === 'securetextbox' ? null : (n.value ?? (role === 'textbox' ? '' : null)),
      visible: visible(n), enabled: enabled(n), hittable: n.hittable ?? null, ref, ...(n.rect ? {rect: n.rect} : {}),
      ...(target?.platform === 'android' && target.app ? {bundleId: n.bundleId} : {})};
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
  if (target?.platform === 'android' && target.app)
    need(nodes.some(n => n.visible), 'Android foreground ownership is unknown; no visible requested-app nodes', 'INVALID_OBSERVATION');
  const overlays = nodes.filter(n => n.visible && ['alert', 'dialog'].includes(n.role));
  if (target?.platform !== 'web' && target?.app?.includes('.') && data.appBundleId)
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
  need(['press', 'longpress', 'fill', 'scroll', 'back'].includes(action.type), 'Unsupported action type');
  const keys = ['observationId', 'type', ...(['press', 'longpress', 'fill'].includes(action.type) ? ['target'] : []), ...(action.type === 'fill' ? ['value'] : action.type === 'scroll' ? ['direction'] : [])];
  const optional = action.type === 'longpress' ? ['durationMs'] : [];
  need(Object.keys(action).every(k => keys.includes(k) || optional.includes(k)) && keys.every(k => Object.hasOwn(action, k)), 'Action has unknown or missing fields');
  if (Object.hasOwn(action, 'durationMs')) need(Number.isInteger(action.durationMs) && action.durationMs >= 1 && action.durationMs <= 10000, 'Longpress durationMs must be an integer from 1 to 10000');
  if (keys.includes('target')) need(typeof action.target === 'string' && action.target, 'Action target is required');
  if (action.type === 'fill') need(typeof action.value === 'string' && action.value.length <= 10000, 'Fill needs a bounded string value');
  if (action.type === 'scroll') need(['up', 'down', 'top', 'bottom'].includes(action.direction), 'Invalid scroll direction');
  return action;
}

function selector(s) {
  need(object(s) && Object.keys(s).length > 0 && Object.entries(s).every(([k, v]) => ['label', 'role', 'identifier', 'value'].includes(k) && typeof v === 'string'), 'Expectation needs an exact nonempty UI selector');
}
export const matches = (node, s) => Object.entries(s).every(([key, value]) => node[key] === value);
export function validateScreenMap(screenMap, graph) {
  if (screenMap === undefined) return;
  need(object(screenMap) && Object.keys(screenMap).length > 0 && Object.keys(screenMap).length <= 256, 'screenMap must map 1..256 graph routes to visible selectors');
  for (const [route, selectors] of Object.entries(screenMap)) {
    need(route.startsWith('/') && route.length <= 1000 && !/[\x00-\x1f]/.test(route), 'screenMap requires graph route IDs');
    need(Array.isArray(selectors) && selectors.length > 0 && selectors.length <= 8, 'screenMap routes need 1..8 visible selectors');
    for (const s of selectors) {
      need(object(s) && Object.entries(s).every(([key, value]) => ['label', 'role', 'identifier', 'value'].includes(key) && typeof value === 'string' && value.length <= 1000) && (s.label?.trim() || s.identifier?.trim()), 'screenMap selectors need a nonempty label or identifier and exact bounded string fields');
    }
    if (graph !== undefined) need(Array.isArray(graph?.nodes) && graph.nodes.filter(n => n.id === route).length === 1, `screenMap route is not a unique graph node: ${route}`);
  }
}
export function validateTask(task, {graph} = {}) {
  need(object(task) && typeof task.goal === 'string' && task.goal.trim() && task.goal.length <= 20000, 'Task requires a bounded goal');
  need(Object.keys(task).every(k => ['goal', 'inputs', 'expect', 'actionTypes', 'screenMap'].includes(k)), 'Unknown task field');
  validateScreenMap(task.screenMap, graph);
  if (task.actionTypes !== undefined) need(Array.isArray(task.actionTypes) && task.actionTypes.length > 0 && new Set(task.actionTypes).size === task.actionTypes.length && task.actionTypes.every(type => ['press', 'fill', 'longpress'].includes(type)), 'actionTypes must be a nonempty unique list of press, fill or longpress');
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
