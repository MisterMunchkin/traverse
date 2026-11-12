// Public historical aggregates only; never reads lab archives or runs models.
const count = value => Number.isSafeInteger(value) && value >= 0;
const measurement = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const requireValue = (ok, message) => { if (!ok) throw Error(message); };
const number = value => value.toLocaleString('en-US');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function studyMetrics(study) {
  const control = study?.arms?.sol, assisted = study?.arms?.['sol-tev1'], paired = study?.paired;
  requireValue(control && assisted && paired, 'Missing browser study measurements');
  for (const arm of [control, assisted]) {
    requireValue(['planned', 'retained', 'completed', 'frontierCalls', 'frontierInput', 'localCalls', 'localInput'].every(key => count(arm[key])), 'Missing or invalid study measurement');
    requireValue(arm.retained > 0 && arm.completed <= arm.retained && arm.retained <= arm.planned, 'Invalid study completion denominator');
  }
  requireValue(count(paired.both) && paired.both > 0 && paired.both <= Math.min(control.completed, assisted.completed), 'Matched time needs common completions');
  requireValue(measurement(paired.solMs) && paired.solMs > 0 && measurement(paired.assistedMs), 'Missing matched time measurement');
  requireValue(control.frontierCalls > 0 && control.frontierInput > 0, 'Missing nonzero usage baseline measurement');
  const reduction = (a, b) => (1 - b / a) * 100;
  return {
    time: {control: paired.solMs / 1000, assisted: paired.assistedMs / 1000, reduction: reduction(paired.solMs, paired.assistedMs), common: paired.both},
    input: {control: control.frontierInput, assisted: assisted.frontierInput, reduction: reduction(control.frontierInput, assisted.frontierInput)},
    requests: {control: control.frontierCalls, assisted: assisted.frontierCalls, reduction: reduction(control.frontierCalls, assisted.frontierCalls)},
    completion: {control: `${control.completed}/${control.retained}`, assisted: `${assisted.completed}/${assisted.retained}`},
    attempts: {control: control.retained, assisted: assisted.retained},
    local: {calls: assisted.localCalls, input: assisted.localInput},
  };
}

function chart({id, title, metric, label, format, caption}) {
  const scale = Math.max(metric.control, metric.assisted);
  const rows = [['Sol alone', metric.control, 'control'], ['Sol + tev1', metric.assisted, 'assisted']].map(([name, value, arm]) => `
    <div class="result-bar-row"><div class="result-bar-label"><span>${name}</span><strong>${format(value)}</strong></div><div class="result-bar-track" aria-hidden="true"><span class="result-bar result-bar-${arm}" style="width:${(value / scale * 100).toFixed(1)}%"></span></div></div>`).join('');
  const change = metric.reduction === 0 ? 'unchanged' : metric.reduction > 0 ? 'less' : 'more';
  return `<figure class="result-chart" aria-labelledby="${id}"><figcaption id="${id}">${title}</figcaption><p class="result-delta">${Math.abs(metric.reduction).toFixed(1)}%<span>${change} ${label}</span></p>${rows}<p class="result-caption">${caption}</p></figure>`;
}

export function renderResearch(source) {
  requireValue(source?.schema === 'traverse-research-summary/1', 'Unsupported research summary');
  const fresh = source.studies?.['browser-fresh'], pilot = source.studies?.['browser-pilot'];
  for (const study of [fresh, pilot]) requireValue(/^[a-f0-9]{64}$/.test(study?.sourceSha256 ?? ''), 'Missing aggregate evidence identity');
  const current = studyMetrics(fresh), earlier = studyMetrics(pilot);
  const allAttempts = `${number(current.attempts.control)} control / ${number(current.attempts.assisted)} assisted attempts; failures retained.`;
  return `<section class="section wrap research-section" id="results" aria-labelledby="results-title">
    <div class="section-heading"><div><p class="eyebrow">MEASURED ON A BROWSER FIXTURE</p><h2 id="results-title">Keep the frontier model<br>for the harder choices.</h2></div><p class="section-intro">Can a small local model handle routine UI choices? This historical browser study compares frontier-only decisions with local tev1 assistance. Both arms used the same Sol 6.1 model at medium effort for planning and escalation.</p></div>
    <div class="study-context"><span class="badge badge-green">HISTORICAL LAB STUDY</span><p>Fresh browser comparison · 21 October 2026 · ${number(current.attempts.control + current.attempts.assisted)} retained attempts. Both arms had the same supplied graph, driver and budgets. These measurements predate the packaged Traverse release.</p></div>
    <div class="results-grid">
      ${chart({id: 'result-time', title: 'Matched driving time', metric: current.time, label: 'matched driving time', format: value => value.toFixed(1) + ' s', caption: `Totals for ${number(current.time.common)} common completions. Startup and preparation excluded; not per-task latency.`})}
      ${chart({id: 'result-input', title: 'Frontier input tokens', metric: current.input, label: 'frontier input tokens', format: number, caption: allAttempts})}
      ${chart({id: 'result-requests', title: 'Frontier requests', metric: current.requests, label: 'frontier requests', format: number, caption: allAttempts})}
    </div>
    <p class="result-axis-note">Every bar starts at zero. Each chart uses its own unit and scale; shorter bars mean less time or frontier usage.</p>
    <div class="results-context-grid"><article class="results-completion"><h3>Completion stayed visible.</h3><p>Each study has its own cases and denominator. These are separate comparisons, not a learning curve.</p><div class="results-table-scroll"><table><caption>Completed / retained attempts</caption><thead><tr><th scope="col">Study</th><th scope="col">Sol alone</th><th scope="col">Sol + tev1</th></tr></thead><tbody><tr><th scope="row">Fresh comparison</th><td>${current.completion.control}</td><td>${current.completion.assisted}</td></tr><tr><th scope="row">Earlier pilot</th><td>${earlier.completion.control}</td><td>${earlier.completion.assisted}</td></tr></tbody></table></div><p class="result-caption">The earlier pilot completed fewer assisted attempts. In the fresh study, the control’s one failure happened during browser startup, before model decisions; it is not evidence of a reliability advantage for tev1.</p></article>
    <aside class="results-explainer"><p class="eyebrow">WHAT MOVED LOCALLY?</p><h3>Routine decisions,<br>not the whole task.</h3><p>The assisted arm made <strong>${number(current.local.calls)} local queries</strong> with <strong>${number(current.local.input)} reported local input tokens</strong>. Work moved to the local model; it did not disappear.</p><p>The frontier still handles escalation. Subscription charges, energy and local hardware costs were not measured. These token savings are not a dollar-savings estimate.</p><a class="text-link" href="#quick-start">Try source extraction first <span aria-hidden="true">↓</span></a></aside></div>
    <details class="research-methods"><summary><span>How the comparison was run—and what it does not establish</span><span class="expand-icon" aria-hidden="true">+</span></summary><div class="research-methods-body"><p>The fresh study used 12 new source start/target pairs on a known fixture graph. Each arm ran every goal twice, counterbalanced, with the same repaired browser driver, supplied partial graph and action/time budgets. The control made no tev1 calls; assistance used the historical shared-map tev1:4b ranker and frontier escalation. No retries or policy tuning occurred during the comparison.</p><p>Large frontier context contributed to the savings. The fixture used short paths and synthetic records/forms; it was not a held-out application. Earlier experiments also found regressions and confident wrong choices. Results do not establish production safety, native performance, tail latency or the performance of the current quantized model/runtime.</p><p><a href="./research-methods.md">Study methods and negative results (Markdown)</a> · <a href="./research.json">All five aggregate summaries (JSON)</a></p><p class="result-caption">Fresh-study aggregate SHA-256: <code>${escape(fresh.sourceSha256)}</code>. Aggregate hashes identify retained historical evidence; raw requests, private source and recordings are not distributed here.</p></div></details>
    <div class="results-validation"><div><span class="badge badge-outline">PACKAGE CHECKS ARE SEPARATE</span><h3>Research explains the idea. Release checks test the package.</h3></div><p>The contributor gate checks CLI and graph fixtures, the Expo example and an isolated TGZ dev-dependency install. Those checks do not measure model performance. Packaged live browser/native tasks and recording playback still need observed validation.</p><a class="text-link" href="https://github.com/MisterMunchkin/traverse/blob/main/docs/driving.md#validation-coverage">Read validation coverage <span aria-hidden="true">↗</span></a></div>
  </section>`;
}
