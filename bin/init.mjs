import path from 'node:path';
import {directory,withLock} from '../src/state.mjs';
import {parseArgs} from 'node:util';
import {preferenceOptions, preferenceKeys, interactiveTerminal} from '../src/project-defaults.mjs';
import {helpText, initText, initProgress, shellQuote} from '../src/presentation.mjs';
import {validateAgentSelection,agentSnapshot,installedAgents,planAgentIntegration,checkAgentSnapshot,applyAgentIntegration,agentIntegrationReport} from '../src/agent-integration.mjs';

export async function initMain(args,{signal,command='traverse',installationPrefix}={}) {
  const {values:v}=parseArgs({args,options:{project:{type:'string'},agents:{type:'string'},adapter:{type:'string'},'trust-adapter':{type:'string'},json:{type:'boolean'},check:{type:'boolean'},'dry-run':{type:'boolean'},migrate:{type:'boolean'},'no-interactive':{type:'boolean'},help:{type:'boolean'},...preferenceOptions}});
  if(v.help){console.log(helpText());return;}
  if(v.project!==undefined&&!v.project.trim())throw Error('--project requires a project directory');
  if(v['trust-adapter']!==undefined&&!v.adapter)throw Error('--trust-adapter requires --adapter FILE');
  if(v.adapter!==undefined&&!v.adapter.trim())throw Error('--adapter requires a file');
  const loading=initProgress({json:v.json});
  try {
  if(v.agents!==undefined)validateAgentSelection(v.agents);
  if(v['no-interactive']&&v.agents!==undefined&&v.agents!=='skip')throw Error('Graph-only --no-interactive cannot install agent guidance; omit it when using --agents');
  if(installationPrefix){const {doctor}=await import('../src/installation.mjs');if(!(await loading.run('Checking Traverse installation',()=>doctor(installationPrefix))).readiness.extractor)throw Error('Installation is not ready; run the recorded Traverse doctor before project setup');}
  const {initProject}=await import('../src/project.mjs');
  // Preflight is read-only. A fresh wizard can cancel before even .wayfinder exists.
  const preview=await loading.run('Inspecting project routing',async()=>initProject({project:v.project,dryRun:true,migrate:v.migrate}));
  const {prepareProjectDefaults}=await import('../src/project-defaults.mjs');
  const interactive=!v.check&&!v['dry-run']&&!v.json&&!v['no-interactive']&&v.agents===undefined&&!preferenceKeys.some(key=>v[key]!==undefined)&&interactiveTerminal();
  const snapshot=interactive||v.agents!==undefined&&v.agents!=='skip'?agentSnapshot(preview.projectRoot):undefined;
  const defaults=await prepareProjectDefaults(preview.projectRoot,v,{signal,interactive,agentIntegration:interactive?installedAgents(snapshot):undefined});
  if(signal?.aborted)throw Object.assign(Error('Project initialization cancelled'),{code:'CANCELLED'});
  const selection=defaults.selectedAgents??v.agents;
  const agents=selection===undefined?null:planAgentIntegration(preview.projectRoot,selection,{snapshot});
  if(agents)checkAgentSnapshot(agents);
  const mutating=!v.check&&!v['dry-run'];
  const {prepareAdapter,publishAdapter,preflightInitialization}=await import('../src/adapter-init.mjs');
  const preflight=()=>preflightInitialization(preview.projectRoot,{settings:defaults.desired,agents,graphLockOwned:true});
  async function finishInit(){
  if(mutating)preflight();
  let staged;
  if(!v.check&&!v['dry-run']){
    staged=await prepareAdapter({project:preview.projectRoot,settings:defaults.desired??defaults.current,adapter:v.adapter,trust:v['trust-adapter'],interactive:!v.json&&!v['no-interactive']&&interactiveTerminal(),signal,progress:loading});
    if(staged.kind==='review-required'){
      const resumeArgs=['init','--project',preview.projectRoot,...preferenceKeys.flatMap(key=>v[key]===undefined?[]:['--'+key,v[key]]),...(v.agents===undefined?[]:['--agents',v.agents]),'--adapter',staged.artifact,'--trust-adapter',staged.artifactHash];
      const result={...preview,mode:'init',ready:false,adapter:{...staged,resumeArgs},exitCode:1};
      if(v.json)console.log(JSON.stringify(result));else console.error(`Traverse · Adapter needs review\n  Inspect: ${staged.artifact}\n  Then: ${command} ${resumeArgs.map(shellQuote).join(' ')}`);
      process.exitCode=1;return;
    }
    if(agents)checkAgentSnapshot(agents);
  }
  if(defaults.desired){const {settingsSnapshot}=await import('../src/settings.mjs');if(settingsSnapshot(preview.projectRoot).bytes?.toString()!==defaults.before?.toString())throw Error('Project settings changed during initialization; project state preserved');}
  if(signal?.aborted)throw Object.assign(Error('Project initialization cancelled'),{code:'CANCELLED'});
  if(mutating)preflight();
  const result=initProject({project:preview.projectRoot,dryRun:v['dry-run'],check:v.check,migrate:v.migrate,onProgress:loading.update});
  const {checkGraph}=await import('../src/graph.mjs');
  if(!v.check&&!v['dry-run']){
    result.graph=publishAdapter(staged);
    result.adapter={kind:staged.kind,authorCalls:staged.authorCalls};
  }
  else if(result.ready){result.graph=await loading.run('Checking repository graph',()=>checkGraph(result.projectRoot,{signal}));result.ready=result.graph.ready;result.exitCode=v.check&&!result.ready?1:0;}
  if(agents){
    result.agentIntegration=v.check||v['dry-run']?agentIntegrationReport(agents):await loading.run('Installing repository agent guidance',()=>applyAgentIntegration(agents,{signal}));
    if(v.check&&!result.agentIntegration.ready){result.ready=false;result.exitCode=1;}
  }
  let settings=defaults.desired??defaults.current,changed=false;
  if(defaults.desired&&!v['dry-run']){
    const {saveSettings}=await import('../src/settings.mjs');
    const saved=await loading.run('Saving project defaults',()=>saveSettings(result.projectRoot,defaults.desired,{before:defaults.before,signal}));
    settings=saved.settings;changed=saved.changed;
  }
  if(settings){result.settings=settings;result.settingsFile=defaults.file;result.settingsChanged=changed;}
  if(v.json)console.log(JSON.stringify(result));else console.error(initText(result,{command,projectOption:!!installationPrefix||!!v.project}));
  process.exitCode=result.exitCode;
  }
  if(mutating){
    preflightInitialization(preview.projectRoot,{settings:defaults.desired,agents});
    const local=path.join(preview.projectRoot,'.wayfinder/local');directory(local);
    await withLock(path.join(local,'graph.lock'),finishInit);
  }else await finishInit();
  } finally {loading.close();}
}
