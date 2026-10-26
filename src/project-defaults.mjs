import {settingsSnapshot, settingsPath, projectChoices} from './settings.mjs';

export const preferenceKeys=['provider','model','effort','policy','max-steps','timeout-ms'];
export const preferenceOptions=Object.fromEntries(preferenceKeys.map(key=>[key,{type:'string'}]));
export const interactiveTerminal=()=>process.stdin.isTTY&&process.stderr.isTTY&&process.env.TERM!=='dumb'&&!process.env.CI;

// Read one snapshot before interaction; saveSettings checks these exact bytes under its lock.
export async function prepareProjectDefaults(project,values,{signal,interactive=false,required=false,agentIntegration}={}) {
  if(values.check&&values['dry-run'])throw Error('Choose --check or --dry-run');
  const supplied=preferenceKeys.some(key=>values[key]!==undefined);
  if(values.check&&supplied)throw Error('Project --check reads saved settings; omit setting overrides');
  if(values['no-interactive']&&supplied)throw Error('Graph-only --no-interactive cannot be combined with project preference flags');
  const {settings:current,bytes:before}=settingsSnapshot(project);
  let desired=null,selectedAgents;
  if(!values.check){
    if(interactive){
      const {setupWizard}=await import('./setup-wizard.mjs');
      const {agentIntegration:selection,...settings}=await setupWizard(current,{signal,agentIntegration});
      desired={...current,...settings};selectedAgents=selection;
    }else if(supplied||required){
      if(!current&&(!values.provider||!values.model||!values.effort))throw Error('Noninteractive project configuration requires --provider, --model and --effort; use an interactive terminal for the wizard');
      desired=projectChoices(current,{provider:values.provider,model:values.model,effort:values.effort,policy:values.policy,maxSteps:values['max-steps']===undefined?undefined:Number(values['max-steps']),timeoutMs:values['timeout-ms']===undefined?undefined:Number(values['timeout-ms'])});
    }
  }
  return {current,before,desired,file:settingsPath(project),selectedAgents};
}
