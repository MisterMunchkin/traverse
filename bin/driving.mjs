import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';

export async function drivingMain(mode, args, {signal} = {}) {
  const started = performance.now();
  const operation = mode === 'drive' ? null : args[0]?.startsWith('-') ? null : args.shift();
  const {values: v} = parseArgs({args, options: {
    project: {type: 'string'}, json: {type: 'boolean'}, help: {type: 'boolean'}, 'agent-device': {type: 'string'},
    session: {type: 'string'}, platform: {type: 'string'}, device: {type: 'string'}, app: {type: 'string'}, action: {type: 'string'}, shutdown: {type: 'boolean'},
    provider: {type:'string'}, model: {type:'string'}, effort: {type:'string'}, task: {type: 'string'}, policy: {type: 'string'}, 'frontier-config': {type: 'string'}, 'cache-dir': {type: 'string'}, record: {type: 'boolean'}, 'max-steps': {type: 'string'}, 'timeout-ms': {type: 'string'},
  }});
  if (v.help) { const {drivingHelpText} = await import('../src/presentation.mjs'); console.log(drivingHelpText(mode)); return; }
  const common = ['project', 'json', 'help', 'agent-device'];
  const allowed = mode === 'drive' ? [...common, 'session', 'platform', 'device', 'app', 'task', 'policy', 'provider', 'model', 'effort', 'frontier-config', 'cache-dir', 'record', 'max-steps', 'timeout-ms'] :
    mode === 'device' ? [...common, ...(operation === 'capabilities' ? [] : ['platform', 'device'])] : [...common, 'session', ...(operation === 'open' ? ['platform', 'device', 'app'] : operation === 'act' ? ['action'] : operation === 'close' ? ['shutdown'] : [])];
  if (Object.keys(v).some(k => !allowed.includes(k))) throw Error('Unsupported option for this operation; run traverse ' + mode + ' --help');
  if (mode === 'session' && !['open', 'observe', 'act', 'close'].includes(operation)) throw Error('Choose session open, observe, act or close');
  const {need, validateTarget, validateAction, validateTask} = await import('../src/driving/contract.mjs');
  const {readJson, atomicJson, directory} = await import('../src/state.mjs');
  const {deviceCommand, sessionCommand, drivingProject, newSession, lockSession} = await import('../src/driving/sessions.mjs');
  const progress = message => { if (!v.json) process.stderr.write('  - ' + message + '\n'); };
  const options = {project: v.project, name: v.session, executable: v['agent-device'], signal, shutdown: !!v.shutdown};
  let result;
  if (mode === 'device') result = await deviceCommand(operation, {...options, platform: v.platform, device: v.device});
  else {
    need(typeof v.session === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v.session), 'Choose an explicit --session name');
    if (mode === 'drive' || operation === 'open') options.target = validateTarget({platform: v.platform, app: v.app, ...(v.device ? {device: v.device} : {})});
    if (operation === 'act') { need(v.action, 'Choose --action FILE'); options.action = validateAction(readJson(path.resolve(v.action), 65536)); }
    if (mode === 'session') result = await sessionCommand(operation, options);
    else {
      need(v.task, 'Choose --task FILE'); const task = validateTask(readJson(path.resolve(v.task), 1024 * 1024));
      const {readSettings,frontierChoices,resolveProviderExecutable}=await import('../src/settings.mjs');
      const saved=readSettings(path.resolve(v.project??process.cwd()));
      const policy = v.policy ?? saved?.driving.policy ?? 'local-first', maxSteps = Number(v['max-steps'] ?? saved?.driving.maxSteps ?? 20), timeoutMs = Number(v['timeout-ms'] ?? saved?.driving.timeoutMs ?? 120000);
      need(['local-first', 'frontier'].includes(policy), 'Policy must be local-first or frontier');
      need(Number.isInteger(maxSteps) && maxSteps >= 1 && maxSteps <= 100, 'Step limit must be 1..100');
      need(Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 1800000, 'Timeout must be 1..1800000ms');
      const supplied=['provider','model','effort'].some(k=>v[k]!==undefined);
      need(!v['frontier-config']||!supplied,'Choose --frontier-config or built-in provider flags, not both');
      const profile=!v['frontier-config']&&(saved||supplied)?frontierChoices(saved,{provider:v.provider,model:v.model,effort:v.effort}):null;
      need(policy!=='frontier'||v['frontier-config']||profile,'Frontier control needs project setup or --frontier-config FILE');
      if(profile)resolveProviderExecutable(profile.provider);
      let configuration;
      if (v['frontier-config']) {
        configuration = readJson(path.resolve(v['frontier-config']), 65536);
        need(configuration.schema === 'wayfinder-frontier-command/1' && Object.keys(configuration).sort().join() === 'args,command,schema', 'Invalid frontier command configuration');
        need(typeof configuration.command === 'string' && path.isAbsolute(configuration.command) && fs.statSync(configuration.command).isFile(), 'Frontier command must be an absolute executable');
        fs.accessSync(configuration.command, fs.constants.X_OK);
        need(Array.isArray(configuration.args) && configuration.args.every(a => typeof a === 'string' && !a.includes('\0')), 'Frontier args must be strings');
      }
      progress('Checking the current graph and configured runners');
      const project = await drivingProject(v.project, signal);
      let runtime;
      if (policy === 'local-first') {
        const {runtimeStatus} = await import('../src/model-setup.mjs'); runtime = await runtimeStatus({cacheDir: v['cache-dir'], deep: true});
        need(runtime.ready, 'Managed tev1 unavailable; run traverse setup before local-first driving');
      } else need(!v['cache-dir'], '--cache-dir applies to local-first driving only');
      const session = await newSession(project.root, options), dir = path.join(session.directory, 'drive'); directory(dir);
      atomicJson(path.join(dir, 'graph-identity.json'), project.graphStatus);
      const {runProcess} = await import('../src/runtime/process.mjs');
      let frontier = configuration ? async request => {
        const {signal: requestSignal, ...body} = request;
        const number = fs.readdirSync(dir).filter(f => /^frontier-.*\.json$/.test(f)).length + 1;
        let receipt;
        try { receipt = await runProcess(configuration.command, configuration.args, {cwd: project.root, input: JSON.stringify(body), timeoutMs: Math.min(45000, timeoutMs), signal: requestSignal, maxBytes: 1024 * 1024}); }
        catch (e) { atomicJson(path.join(dir, 'frontier-' + number + '.json'), {...e.record, error: e.message}); throw e; }
        atomicJson(path.join(dir, 'frontier-' + number + '.json'), receipt); return JSON.parse(receipt.stdout);
      } : undefined;
      if(profile){const {createFrontier}=await import('../src/frontier/provider.mjs');
        try{frontier=await createFrontier({settings:profile,directory:path.join(dir,'frontier'),signal,timeoutMs:Math.min(45000,timeoutMs)});}
        catch(e){atomicJson(path.join(dir,'frontier-startup-failure.json'),{error:e.message,process:e.record??null});throw e;}
      }
      const preferences={frontier:profile??(configuration?{provider:'external-command'}:null),driving:{policy,maxSteps,timeoutMs}};
      atomicJson(path.join(dir,'preferences.json'),preferences);
      const {drive, withDecisionRuntime} = await import('../src/driving/loop.mjs');
      const preparedMs = performance.now() - started;
      const run = ask => lockSession(session, () => drive({runner: session.runner, task, graph: project.graph, directory: dir, ask, localModel: runtime?.model.name, frontier, signal, policy, maxSteps, timeoutMs, record: !!v.record, onProgress: event => { const messages = {opened: 'Target opened', observed: event.uiVerified ? 'Expected UI state observed' : 'Current UI captured', decision: event.kind === 'escalate' ? 'Frontier required: ' + event.reason : 'Selected action via ' + event.via, action: 'Action acknowledged; resulting UI captured', failure: 'Attempt failed; preserving evidence'}; if (messages[event.type]) progress(messages[event.type]); }}));
      if (runtime) {
        const {withOwnedOllama} = await import('../src/runtime/ollama.mjs'); const {askChoice} = await import('../src/driving/choice.mjs');
        result = await withDecisionRuntime({directory: dir, signal, record: !!v.record,
          supervise: work => withOwnedOllama({binary: runtime.binary, models: runtime.models, directory: path.join(dir, 'model-server'), runtimeHome: path.join(runtime.cacheDir, 'runtime-home'), version: runtime.runtimeVersion, signal}, work),
          work: ({baseUrl, signal: modelSignal}) => run(request => askChoice({...request, baseUrl, signal: AbortSignal.any([request.signal, modelSignal])}))});
      } else result = await run();
      result.preferences=preferences;
      result.timings = {preflightMs: preparedMs, drivingMs: result.elapsedMs, totalMs: performance.now() - started};
      atomicJson(result.resultFile, result);
    }
  }
  if (v.json) console.log(JSON.stringify(result));
  else { const {drivingText} = await import('../src/presentation.mjs'); console.error(drivingText(result)); }
  process.exitCode = result.exitCode;
}
