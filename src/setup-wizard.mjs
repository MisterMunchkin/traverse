import readline from 'node:readline';
import {effortChoices, DRIVING_DEFAULTS, defaultModel, validateSettings, SETTINGS_SCHEMA} from './settings.mjs';
import {discoverModels} from './frontier/models.mjs';

// One finite interaction; only provider metadata is read before the final save.
export async function setupWizard(current,{input=process.stdin,output=process.stderr,signal,agentIntegration,loadModels=discoverModels}={}){
 const cancelled=()=>Object.assign(Error('Project setup cancelled; settings unchanged'),{code:'CANCELLED'});
 if(signal?.aborted)throw cancelled();
 const value={schema:SETTINGS_SCHEMA,frontier:{provider:'codex',model:defaultModel('codex'),effort:'medium',...current?.frontier},driving:{...DRIVING_DEFAULTS,...current?.driving}};
 if(agentIntegration!==undefined)value.agentIntegration=agentIntegration;
 const fields=[
  {title:'Frontier provider',key:'provider',choices:[['codex','Codex'],['claude','Claude']]},
  {title:'Frontier model',key:'model'},
  {title:'Reasoning effort',key:'effort'},
  {title:'Default driving mode',key:'policy',choices:[['local-first','tev1 + frontier'],['frontier','Frontier only']]},
  {title:'Maximum UI actions per run (1–100)',key:'maxSteps',subtitle:['Each attempted tap, field fill, scroll or Back counts as one.','Screen checks and model decisions do not count.']},
  {title:'Driving timeout in seconds (0.001–1800)',key:'timeoutMs'},
  ...(agentIntegration===undefined?[]:[{title:'Add agent guidance to this repository? (optional)',key:'agentIntegration',subtitle:['One shared skill in .agents/skills; separate from the frontier provider.','Install migrates intact old Traverse copies; Skip leaves guidance unchanged.'],choices:[['skip','Skip'],['shared','Install shared skill']]}]),
  {title:agentIntegration===undefined?'Save these project defaults?':'Save this project setup?',key:'save',choices:[['save',agentIntegration===undefined?'Save settings':'Save project setup'],['cancel','Cancel without saving']]}
 ];
 const get=f=>f.key==='save'?'save':f.key==='agentIntegration'?value.agentIntegration:(f.key in value.frontier?value.frontier[f.key]:f.key==='timeoutMs'?String(value.driving.timeoutMs/1000):String(value.driving[f.key]));
 let step=0,lines=0,error='',cursor=0,selected=0,drafts={},manual=false,finished=false,loading=null,notice='';
 const catalogs=new Map(),pending=new Set();
 const models=()=>catalogs.get(value.frontier.provider)?.models??[];
 const colour=!process.env.NO_COLOR,paint=(n,s)=>colour?`\x1b[${n}m${s}\x1b[0m`:s;
 function enter(){
  const f=fields[step];
  if(f.key==='effort')f.choices=effortChoices(value.frontier,models()).map(v=>[v,v==='default'?'Provider default (no effort override)':v]);
  if(f.key==='model'){
   f.title=manual?'Exact model ID':'Frontier model';
   f.choices=manual?undefined:[...models().map(m=>[m.id,`${m.label} · ${m.id}${m.hidden?' (hidden)':''}`]),...(!models().some(m=>m.id===value.frontier.model)?[[value.frontier.model,`${value.frontier.model} (saved/default ID; not in catalog)`]]:[]),['__manual__','Enter an exact model ID…']];
  }
  selected=Math.max(0,f.choices?.findIndex(c=>c[0]===get(f))??0);drafts[step]??=String(get(f));cursor=drafts[step].length;error='';
 }
 function draw(){
  if(finished)return;
  if(lines)readline.moveCursor(output,0,-lines);
  readline.cursorTo(output,0);readline.clearScreenDown(output);
  const f=fields[step],text=[paint('1;36',`◈ Traverse · Project setup ${step+1}/${fields.length}`),''];
  if(f.key==='save'){text.push(`  ${value.frontier.provider} · ${value.frontier.model} · ${value.frontier.effort}`,`  ${value.driving.policy} · ${value.driving.maxSteps} UI action attempts · ${value.driving.timeoutMs/1000}s driving deadline`);if(agentIntegration!==undefined)text.push(`  Agent guidance: ${value.agentIntegration}`);text.push('');}
  text.push(paint('1',f.title));
  if(f.subtitle)text.push(...f.subtitle.map(line=>paint('2',line)));
  if(f.key==='model'&&loading)text.push(`  Loading ${value.frontier.provider} model catalog…`);
  else{
   if(f.key==='model')text.push(paint('2',notice||'Models reported by this CLI; availability depends on your account.'));
   if(f.choices){
    const start=Math.max(0,Math.min(selected-4,f.choices.length-9)),end=Math.min(start+9,f.choices.length);
    text.push(...f.choices.slice(start,end).map(([id,label],i)=>`${i+start===selected?paint('36','›'):' '} ${label}`));
    if(f.choices.length>9)text.push(paint('2',`  ${start+1}–${end} of ${f.choices.length} choices · scroll ↑/↓`));
   }else text.push('› '+drafts[step]);
  }
  text.push(error?paint('31',error):'',paint('2','↑/↓ choose · Enter continue · Esc back · Ctrl-C cancel'));
  output.write(text.join('\n')+'\n');lines=text.length;
 }
 return new Promise((resolve,reject)=>{
  const wasRaw=input.isRaw,wasFlowing=input.readableFlowing;readline.emitKeypressEvents(input);input.setRawMode(true);input.resume();
  const finish=(err,result)=>{
   if(finished)return;finished=true;loading?.abort();input.off('keypress',key);signal?.removeEventListener('abort',abort);input.setRawMode(!!wasRaw);if(wasFlowing!==true)input.pause();
   Promise.allSettled([...pending]).then(()=>err?reject(err):resolve(result));
  };
  const abort=()=>finish(cancelled());
  const load=()=>{
   const provider=value.frontier.provider;
   if(catalogs.has(provider)){notice=catalogs.get(provider).unresolved?'Some aliases lack exact IDs; update the provider CLI or enter an exact ID manually.':'';return;}
   const controller=new AbortController();loading=controller;notice='';
   const task=Promise.resolve().then(()=>loadModels(provider,{signal:controller.signal})).then(catalog=>{
    if(controller.signal.aborted||finished)return;
    catalogs.set(provider,catalog);notice=catalog.unresolved?'Some aliases lack exact IDs; update the provider CLI or enter an exact ID manually.':'';
   },e=>{if(!controller.signal.aborted&&!finished)notice=e.message;}).finally(()=>{
    pending.delete(task);if(loading!==controller||finished)return;loading=null;enter();draw();
   });pending.add(task);
  };
  const key=(text,k={})=>{
   if(k.ctrl&&k.name==='c'){finish(cancelled());return;}
   if(k.name==='escape'){
    if(loading){loading.abort();loading=null;}
    if(step===1&&manual){manual=false;}else if(step){step--;}
    enter();draw();return;
   }
   if(loading)return;
   const f=fields[step];
   if(f.choices){
    if(k.name==='up')selected=(selected+f.choices.length-1)%f.choices.length;
    if(k.name==='down')selected=(selected+1)%f.choices.length;
   }else{
    let draft=drafts[step];
    if(k.ctrl&&k.name==='u'){draft='';cursor=0;}
    else if(k.name==='left')cursor=Math.max(0,cursor-1);
    else if(k.name==='right')cursor=Math.min(draft.length,cursor+1);
    else if(k.name==='home'||k.ctrl&&k.name==='a')cursor=0;
    else if(k.name==='end'||k.ctrl&&k.name==='e')cursor=draft.length;
    else if(k.name==='backspace'&&cursor){draft=draft.slice(0,cursor-1)+draft.slice(cursor);cursor--;}
    else if(k.name==='delete')draft=draft.slice(0,cursor)+draft.slice(cursor+1);
    else if(!k.ctrl&&!k.meta&&text&&!/[\x00-\x1f\x7f]/.test(text)&&draft.length+text.length<=200){draft=draft.slice(0,cursor)+text+draft.slice(cursor);cursor+=text.length;}
    drafts[step]=draft;
   }
   if(k.name==='return'){
    const next=f.choices?f.choices[selected][0]:drafts[step].trim();
    if(f.key==='model'&&next==='__manual__'){manual=true;enter();draw();return;}
    if(f.key==='save'){finish(next==='save'?null:cancelled(),next==='save'?value:null);return;}
    const candidate=structuredClone(value);
    if(f.key==='agentIntegration')candidate.agentIntegration=next;
    else if(f.key in candidate.frontier)candidate.frontier[f.key]=next;
    else candidate.driving[f.key]=f.key==='policy'?next:f.key==='timeoutMs'?Number(next)*1000:Number(next);
    if(f.key==='provider'&&next!==value.frontier.provider){candidate.frontier.model=defaultModel(next);manual=false;delete drafts[1];}
    try{
     if(['provider','model'].includes(f.key)){
      const choices=effortChoices(candidate.frontier,catalogs.get(candidate.frontier.provider)?.models);
      if(!choices.includes(candidate.frontier.effort))candidate.frontier.effort=models().find(m=>m.id===next)?.defaultEffort??choices[0];
     }
     validateSettings(candidate);
    }catch(e){error=e.message;draw();return;}
    Object.assign(value,candidate);if(f.key==='model')drafts[step]=next;step++;enter();if(fields[step].key==='model')load();
   }
   draw();
  };
  input.on('keypress',key);signal?.addEventListener('abort',abort,{once:true});enter();draw();if(signal?.aborted)abort();
 });
}

export async function confirmAdapter({file,hash,input=process.stdin,output=process.stderr,signal}){
 const cancelled=()=>Object.assign(Error('Adapter review cancelled; project state unchanged'),{code:'CANCELLED'});
 if(signal?.aborted)throw cancelled();
 output.write(`\nAdapter ready for code review\n  File: ${file}\n  SHA256: ${hash}\n  This code runs on your host. Inspect all files in the artifact before trusting it.\n`);
 let selected=0;output.write('› Cancel without running\n  I reviewed these bytes and trust host execution\n');
 return new Promise((resolve,reject)=>{
  const raw=input.isRaw,flowing=input.readableFlowing;readline.emitKeypressEvents(input);input.setRawMode(true);input.resume();let finished=false;
  const finish=error=>{if(finished)return;finished=true;input.off('keypress',key);signal?.removeEventListener('abort',abort);input.setRawMode(!!raw);if(flowing!==true)input.pause();error?reject(error):resolve(true);};
  const abort=()=>finish(cancelled());
  const key=(_text,k={})=>{if(k.ctrl&&k.name==='c'||k.name==='escape'){finish(cancelled());return;}if(k.name==='up'||k.name==='down'){selected=1-selected;output.write(`  Selected: ${selected?'I reviewed these bytes and trust host execution':'Cancel without running'}\n`);}if(k.name==='return')finish(selected?null:cancelled());};
  input.on('keypress',key);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 });
}
