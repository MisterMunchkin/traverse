import path from 'node:path';
import {parseArgs} from 'node:util';
import {setupRuntime} from '../src/model-setup.mjs';
import {helpText, progress, setupText} from '../src/presentation.mjs';
import {preferenceOptions, preferenceKeys, interactiveTerminal, prepareProjectDefaults} from '../src/project-defaults.mjs';

export async function setupMain(args, {signal} = {}) {
  const {values: v} = parseArgs({args, options: {project:{type:'string'},...preferenceOptions,'cache-dir': {type: 'string'}, 'runtime-archive': {type: 'string'}, 'models-dir': {type: 'string'}, check: {type: 'boolean'}, 'dry-run': {type: 'boolean'}, json: {type: 'boolean'}, help: {type: 'boolean'}}});
  if (v.help) { console.log(helpText()); return; }
  if(v.project!==undefined){
    if(!v.project.trim())throw Error('--project requires a project directory');
    if(['cache-dir','runtime-archive','models-dir'].some(k=>v[k]!==undefined))throw Error('Project setup does not install models; use traverse setup separately for machine assets');
    const {projectStatus}=await import('../src/project.mjs');
    const {saveSettings}=await import('../src/settings.mjs');
    const project=projectStatus(v.project);
    const supplied=preferenceKeys.some(key=>v[key]!==undefined);
    const {current,before,desired,file}=await prepareProjectDefaults(project.root,v,{signal,interactive:!supplied&&!v.json&&!v['dry-run']&&!v.check&&interactiveTerminal(),required:true});
    let result;
    if(v.check){
      result={schema:'wayfinder-project-setup/1',projectRoot:project.root,settingsFile:file,mode:'check',settings:current,ready:!!current,changed:false,exitCode:current?0:1};
    }else{
      result=v['dry-run']?{schema:'wayfinder-project-setup/1',projectRoot:project.root,settingsFile:file,mode:'dry-run',settings:desired,ready:!!current&&JSON.stringify(current)===JSON.stringify(desired),changed:false,exitCode:0}:await saveSettings(project.root,desired,{before,signal});
    }
    if(v.json)console.log(JSON.stringify(result));
    else {const {shellQuote}=await import('../src/presentation.mjs');console.error(`\nTraverse · ${result.mode==='dry-run'?'Project setup preview — no files changed':result.ready?'Project defaults ready':'Project setup required'}\n  Settings: ${file}\n  Change provider/model/effort, driving mode or limits by editing this file\n  or rerun: traverse init --project ${shellQuote(project.root)}\n  Next: traverse doctor --project ${shellQuote(project.root)}\n`);}
    process.exitCode=result.exitCode;return;
  }
  if(preferenceKeys.some(key=>v[key]!==undefined))throw Error('Use traverse init to configure project defaults');
  const result = await setupRuntime({cacheDir: v['cache-dir'], runtimeArchive: v['runtime-archive'], modelsDir: v['models-dir'], check: v.check, dryRun: v['dry-run'], signal, onProgress: progress(v.json)});
  result.exitCode = v.check && !result.ready ? 1 : 0;
  if (v.json) console.log(JSON.stringify(result));
  else console.error(setupText(result, {cacheOption: v['cache-dir'] !== undefined, runtimeArchive: v['runtime-archive'] && path.resolve(v['runtime-archive']), modelsDir: v['models-dir'] && path.resolve(v['models-dir'])}));
  process.exitCode = result.exitCode;
}
