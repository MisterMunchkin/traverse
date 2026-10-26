export const shellQuote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
// Decide from the destination stream: doctor uses stderr, help/version stdout.
function terminal({stream = process.stderr, env = process.env} = {}) {
  const interactive = stream.isTTY === true && env.TERM !== 'dumb' && !env.CI;
  const colour = interactive && !env.NO_COLOR;
  const paint = (code, text) => colour ? `\x1b[${code}m${text}\x1b[0m` : text;
  return {
    interactive,
    brand: paint(36, `${interactive ? '◈ ' : ''}Traverse`),
    heading: text => paint('1;36', text),
    detail: text => paint(2, text),
    status: (status, text) => paint({pass: 32, warn: 33, fail: 31, pending: 33}[status] ?? 36, text),
  };
}

export function helpText({stream = process.stdout, env = process.env} = {}) {
  const t = terminal({stream, env});
  const command = (name, detail) => `  ${t.interactive ? '› ' : ''}${t.heading(name.padEnd(12))}${detail}`;
  return [
    `${t.brand} — reviewed Expo graphs and agent-device driving`,
    '',
    'Usage: traverse init [--project DIRECTORY] [--check|--dry-run] [--json]',
    '       traverse doctor [--project DIRECTORY] [--json]',
    '       traverse init [--provider codex|claude --model ID --effort LEVEL]',
    '       traverse setup [--cache-dir DIRECTORY] [--check|--dry-run] [--json]',
    '       traverse graph <refresh|check|watch> [--project DIRECTORY] [--json]',
    '       traverse device <capabilities|list|boot|shutdown> ...',
    '       traverse session <open|observe|act|close> ...',
    '       traverse drive --task FILE --session NAME --platform PLATFORM --app APP ...',
    '       traverse snapshot --out NEW_DIRECTORY [--project DIRECTORY] [--json]',
    '       traverse extractor <prepare|reference|author|inspect|review|accept|refresh> ...',
    '       traverse --help | --version',
    '',
    t.heading('Commands'),
    command('init', 'Set up this repository: graph and guided project defaults'),
    command('setup', 'Set up this machine: install and verify shared Ollama + tev1'),
    command('graph', 'Generate, check or watch the repository graph'),
    command('device', 'List, boot or shut down an explicit device via agent-device'),
    command('session', 'Open, observe, act and close an owned runner session'),
    command('drive', 'Run the bounded local-first or frontier control loop'),
    command('doctor', 'Check the runtime and project; show how to fix failures'),
    command('snapshot', 'Save a source inventory in a new output directory'),
    command('extractor', 'Prepare, review and reuse navigation extractors'),
    '',
    t.heading('Options'),
    '  --project DIRECTORY  Select a project (default: current directory)',
    '  --json               Machine results; graph watch emits NDJSON',
    '  --check | --dry-run   Inspect init or model setup without changing files',
    '  --migrate            Explicitly migrate legacy init state; keep a backup',
    '  --no-interactive     Init: graph only; skip the preferences wizard',
    '  --agents CHOICE      Init: optional repo guidance; shared|skip',
    '  --provider NAME      Project setup: codex or claude (existing CLI login)',
    '  --model ID           Project setup: exact provider model ID',
    '  --effort LEVEL       Provider effort or default; init lists model-specific levels',
    '  --policy MODE        Project setup: local-first (default) or frontier',
    '  --max-steps N        Project setup: UI action attempt limit (default 20)',
    '  --timeout-ms N       Project setup: driving deadline (default 120000ms)',
    '  --model              Doctor checks actual local decision capability',
    '  --cache-dir DIR      Select a managed runtime cache for setup/doctor',
    '  --runtime-archive F  Setup: import the pinned local runtime archive',
    '  --models-dir DIR     Setup: import an explicitly selected model store',
    '  --adapter FILE       Init: inspect a generated or supplied adapter',
    '  --trust-adapter HASH  Init: trust exactly the reviewed adapter bytes',
    '  --accepted FILE      Graph refresh: use existing reviewed acceptance',
    '  --help | --version   Show this guide or the installed version',
    '',
    t.heading('Examples'),
    '  traverse init',
    '  traverse setup',
    '  traverse doctor',
    '  traverse graph check',
    '  traverse graph watch',
    '  traverse snapshot --out .wayfinder/snapshots/first',
    '',
    'Install the CLI globally or as a repo dev dependency; init acts on each project.',
    'Init: arrows choose, Enter continues, Esc goes back, Ctrl-C cancels before writes.',
    'Edit .wayfinder/settings.json or rerun init to change project defaults.',
    'Piped/JSON init skips the wizard; missing adapters return a review step.',
    'First scripted preferences require --provider, --model and --effort.',
    'Machine setup downloads several GB; init never downloads models.',
    'Compatibility: setup --project DIRECTORY still edits existing project defaults.',
    t.detail('Profiles: Expo Router57; static app/ or src/app/ routing, npm lockfile. JS/TS config is never executed.'),
    t.detail('No parent or sibling discovery.'),
  ].join('\n');
}

export function drivingHelpText(mode, options) {
  const t = terminal({stream: process.stdout, ...options});
  const usage = {
    device: ['traverse device capabilities [--json]', 'traverse device list --platform ios|android [--json]', 'traverse device boot|shutdown --platform ios|android --device ID [--json]'],
    session: ['traverse session open --session NAME --platform web|ios|android --app APP [--device ID]', 'traverse session observe --session NAME [--json]', 'traverse session act --session NAME --action FILE [--json]', 'traverse session close --session NAME [--shutdown] [--json]'],
    drive: ['traverse drive --task FILE --session NAME --platform web|ios|android --app APP [--device ID]', '  [--policy local-first|frontier] [--frontier-config FILE] [--cache-dir DIR]', '  [--provider codex|claude --model ID --effort LEVEL]', '  [--record] [--max-steps N] [--timeout-ms N] [--json]'],
  };
  return [`${t.brand} — ${mode}`, '', t.heading('Usage'), ...usage[mode].map(s => '  ' + s), '',
    '  --project DIRECTORY  Explicit supported project (default: current directory)',
    '  --agent-device FILE  Absolute executable (default: agent-device on PATH)',
    '  --json               One machine result on stdout', '',
    'Native ID means an iOS UDID or Android serial; web uses an HTTP(S) URL.',
    'Sessions/receipts live under ignored .wayfinder/local/sessions; choose a fresh name.',
    'Local-first requires machine setup. Project setup selects the frontier provider.',
    'Driving reads .wayfinder/settings.json; explicit run flags override without saving.',
    'Without saved limits: 20 actions and 120000ms. Targets and recording are per run.',
    'An explicit --frontier-config overrides the saved provider; do not mix provider flags.',
    'Task declares goal, optional field inputs and nonempty exact UI expectations.',
    'Create/delete devices are unsupported. Automatic close preserves the device.',
  ].join('\n');
}
export function drivingText(result, options) {
  const t = terminal(options);
  return [`${t.brand} — ${result.status ?? result.operation ?? 'Runner capabilities'}`,
    ...(result.runnerSession ? [`  Session: ${result.session}`] : []),
    ...(result.observation ? [`  Observation: ${result.observation.id}`, `  Controls: ${result.observation.controls.length}`, '  Next: use --json to inspect exact current controls and build an action file.'] : []),
    ...(result.resultFile ? [`  Result: ${result.resultFile}`, `  Elapsed: ${Math.round(result.elapsedMs)} ms`, `  Accounting: ${result.accounting.complete ? 'complete reported usage' : 'incomplete — unknown usage/cost retained'}`] : []),
    ...(result.escalation ? [result.cleanupErrors?.length ? '  Session cleanup needs attention; inspect the saved result before another run.' : '  Session closed. This attempt cannot be continued.', '  Next: after cleanup, start a new run with --frontier-config FILE or inspect the saved escalation.'] : []),
    ...(result.schema === 'wayfinder-device-result/1' ? ['  ' + JSON.stringify(result.data ?? result.lifecycle)] : []),
  ].join('\n');
}

export function versionText(version, {stream = process.stdout, env = process.env} = {}) {
  const t = terminal({stream, env});
  return t.interactive ? `${t.brand} ${t.detail('v' + version)}` : version;
}

export function doctorText(report, options) {
  const t = terminal(options);
  const names = {
    'node-version': 'Node.js', 'parser-version': 'TypeScript parser',
    'package-source': 'Package source', 'extractor-smoke': 'Extractor smoke test',
    'project-config': 'Project configuration', 'project-frontier': 'Project driving defaults',
    'installation-metadata': 'Installation metadata', config: 'Installation configuration',
    'source-integrity': 'Source integrity',
    'project-graph': 'Repository graph', 'managed-model-installation': 'Managed tev1 installation',
    'managed-model-decision': 'Managed tev1 decision check',
  };
  const ready = t.status(report.readiness.configuration ? 'pass' : 'fail', report.readiness.configuration ? 'READY' : 'NOT READY');
  const lines = [`${t.brand} — Configuration: ${ready}.`, ''];
  for (const check of report.checks) {
    const icon = t.interactive ? ({pass: '✓', warn: '!', fail: '×', pending: '○'}[check.status] ?? '?') + ' ' : '';
    const status = t.status(check.status, icon + check.status.toUpperCase());
    const name = names[check.name] ? `${names[check.name]} (${check.name})` : check.name;
    lines.push(`  ${status}  ${name}`);
    lines.push(`    ${t.detail(typeof check.evidence === 'string' ? check.evidence : JSON.stringify(check.evidence))}`);
    if (check.remediation) lines.push(`    ${check.status === 'fail' ? 'Fix' : 'Note'}: ${check.remediation}`);
    lines.push('');
  }
  lines.push(report.readiness.configuration ? '  Configuration checks passed.' : '  Resolve the required failures above, then rerun this command.');
  return lines.join('\n');
}

// Finite lines are intentional: no spinner timers or ANSI sequences to clean up.
export const progress = (json=false) => message => { if(!json) process.stderr.write(`  - ${message}\n`); };
export function initText(r, {command='traverse', projectOption=false}={}) {
  const status=r.mode==='dry-run'?'Preview — no files changed':r.mode==='check'?(r.ready?'Project configuration is ready':'Project setup required'):r.created?'Project ready':'Project already initialised';
  const target=projectOption?' --project '+shellQuote(r.projectRoot):'';
  const agents=r.agentIntegration;
  const guidance=agents?`  Agent guidance: ${agents.selection==='skip'?'skipped; existing files unchanged':`${agents.selection} — ${r.mode==='dry-run'?'preview':agents.ready?agents.changed?'saved':'ready':'setup required'}`}\n`:'';
  return `\nTraverse · ${status}\n  Project: ${r.projectRoot}\n${r.settingsFile?`  Settings: ${r.settingsFile}\n  Change defaults: ${command} init${target}\n`:`  Configure driving defaults: ${command} init${target}\n`}${guidance}  Next: ${command} ${r.ready?'doctor':'init'}${target}\n`;
}
export function installText(r,{verbose=false}={}) {
  const status=r.mode==='dry-run'?'Preview — no files changed':r.mode==='check'?(r.ready?'Installation ready':'Setup required'):r.created?.length?'Installation complete':'Already installed';
  return `\nTraverse · ${status}\n  Location: ${r.prefix}\n  ${r.ready?'Extractor tools are ready.':'Run the installer to finish setup.'}\n${verbose?`  Source: ${r.sourceRoot}\n  Node: ${r.node.executable}\n`:''}  Next: ${shellQuote(r.prefix+'/bin/traverse')} init\n`;
}


export function setupText(result, {cacheOption = false, runtimeArchive, modelsDir} = {}) {
  const cache = cacheOption ? ' --cache-dir ' + shellQuote(result.cacheDir) : '';
  const imports = (runtimeArchive ? ' --runtime-archive ' + shellQuote(runtimeArchive) : '') + (modelsDir ? ' --models-dir ' + shellQuote(modelsDir) : '');
  const status = result.mode === 'dry-run' ? 'Model setup preview — no files changed' : result.ready ? result.created ? 'Managed tev1 installation complete' : 'Managed tev1 installation ready' : 'Managed model setup required';
  const next = result.ready ? '  Next: inside your supported Expo project:\n    traverse init\n    traverse doctor --model' + cache : '  Next: traverse setup' + cache + imports;
  return `\nTraverse · ${status}\n  Cache: ${result.cacheDir}\n  Model: ${result.model.name}\n${result.reason ? '  ' + result.reason + '\n' : ''}${next}\n`;
}

// Runs only around real asynchronous work; never animate while reading user input.
export function initProgress({json=false,stream=process.stderr,env=process.env}={}){
 const animate=!json&&stream.isTTY===true&&!env.NO_COLOR&&env.TERM!=='dumb'&&!env.CI;
 const frames=['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];let timer=null,label='',frame=0,active=false,rendered=false;
 const clear=()=>{if(timer)clearInterval(timer);timer=null;active=false;if(rendered)stream.write('\r\x1b[2K');rendered=false;};
 const update=text=>{if(json)return;label=text;if(animate&&active){rendered=true;stream.write(`\r\x1b[2K\x1b[36m${frames[frame++%frames.length]}\x1b[0m ${label}`);}else stream.write(`  - ${label}\n`);};
 return {update,close:clear,async run(text,work){clear();active=true;update(text);if(animate){timer=setInterval(()=>update(label),90);timer.unref();}try{const result=await work();clear();if(animate)stream.write(`  ✓ ${label}\n`);return result;}catch(error){clear();throw error;}}};
}
