import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {noSymlinks} from './installation.mjs';
import {exists, directory, atomicWrite, withLock} from './state.mjs';

export const AGENT_CHOICES=['skip','shared'];
const shared=['.agents/skills/traverse/SKILL.md','AGENTS.md'];
const previousShared=['.agents/skills/wayfinder/SKILL.md','AGENTS.md'];
const legacy=['.claude/skills/wayfinder/SKILL.md','CLAUDE.md'];
const skillNames=[shared[0],previousShared[0],legacy[0]];
const names=[...new Set([...shared,...previousShared,...legacy])];
const same=(a,b)=>a===null?b===null:b!==null&&a.equals(b);
const begin='<!-- BEGIN Wayfinder agent guidance -->',end='<!-- END Wayfinder agent guidance -->';
const maxBytes=1024*1024;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(ok,message)=>{if(!ok)throw Error(message);};
const signed=(body,kind)=>body+`<!-- Wayfinder ${kind} sha256:${sha(body)} -->\n`;
function owned(text,kind){
 const footer=new RegExp(`<!-- Wayfinder ${kind} sha256:([a-f0-9]{64}) -->\\n$`).exec(text);
 return !!footer&&sha(text.slice(0,footer.index))===footer[1];
}
export function validateAgentSelection(selection){need(AGENT_CHOICES.includes(selection),'--agents must be shared or skip');return selection;}
function instructionTarget(root,file,target){
 // Walk before normalizing: linked/../file still traverses linked on the filesystem.
 let current=path.dirname(file),relative=target;
 if(path.isAbsolute(target)){
  need(target===root||target.startsWith(root+path.sep),`Agent guidance symlink leaves the project: ${file}; use an in-project instruction file`);
  current=root;relative=target.slice(root.length+1);
 }
 const parts=relative.split(path.sep);
 for(const [index,part] of parts.entries()){
  if(part===''||part==='.')continue;
  if(part==='..'){
   need(current!==root,`Agent guidance symlink leaves the project: ${file}; use an in-project instruction file`);
   current=path.dirname(current);continue;
  }
  current=path.join(current,part);
  if(index<parts.length-1){
   const stat=fs.lstatSync(current);
   need(!stat.isSymbolicLink()&&stat.isDirectory(),`Agent guidance parent must be a regular directory, not a symlink: ${file}`);
   current=fs.realpathSync.native(current);
  }
 }
 return current;
}
function readDestination(root,name){
 noSymlinks(root,{label:'project'});root=fs.realpathSync.native(root);
 let file=path.join(root,name);const links=[],seen=new Set(),instruction=name===shared[1]||name===legacy[1];
 for(;;){
  const relative=path.relative(root,file);
  need(relative!==''&&relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative),`Agent guidance symlink leaves the project: ${name}; use an in-project instruction file`);
  noSymlinks(path.dirname(file),{label:'agent guidance parent'});
  if(!exists(file)){
   need(links.length===0,`Dangling agent guidance symlink: ${name}; restore its in-project target`);
   return {bytes:null,destination:relative,links};
  }
  if(!fs.lstatSync(file).isSymbolicLink())break;
  need(instruction,`Symlink agent skill refused: ${name}; use a regular skill file`);
  need(!seen.has(file)&&links.length<40,`Cyclic or excessive agent guidance symlink chain: ${name}`);
  seen.add(file);const target=fs.readlinkSync(file);links.push({name:relative,target});file=instructionTarget(root,file,target);
 }
 const stat=fs.statSync(file);need(stat.isFile()&&stat.size<=maxBytes,`Agent guidance must be a regular file under 1 MiB: ${name}`);
 const bytes=fs.readFileSync(file);need(bytes.length<=maxBytes,`Agent guidance exceeds 1 MiB: ${name}`);
 need(Buffer.from(bytes.toString('utf8')).equals(bytes),`Agent guidance must be UTF-8: ${name}`);return {bytes,destination:path.relative(root,fs.realpathSync.native(file)),links};
}
// Snapshot errors are deferred: choosing Skip must not reject unrelated custom files.
export function agentSnapshot(root){
 return Object.fromEntries(names.map(name=>{
  try{return [name,readDestination(root,name)];}catch(error){return [name,{error:error.message}];}
 }));
}
function blockRange(text,name){
 const starts=text.split(begin).length-1,ends=text.split(end).length-1;
 need(starts===ends&&starts<=1,`Conflicting Traverse guidance block: ${name}; preserve it before rerunning init`);
 if(!starts)return null;
 const start=text.indexOf(begin),finish=text.indexOf(end);
 need(finish>start&&(start===0||text[start-1]==='\n')&&(finish+end.length===text.length||text[finish+end.length]==='\n'),`Malformed Traverse guidance block: ${name}`);
 need(owned(text.slice(start+begin.length+1,finish),'guidance'),`Customized Traverse guidance block: ${name}; preserve it before rerunning init`);
 return {start,finish:finish+end.length};
}
export function installedAgents(snapshot){
 const present=[shared,previousShared,legacy].some(([skill,instructions])=>{
  try{return owned(snapshot[skill].bytes?.toString('utf8')??'','skill')&&!!blockRange(snapshot[instructions].bytes?.toString('utf8')??'',instructions);}catch{return false;}
 });
 return present?'shared':'skip';
}
export function planAgentIntegration(root,selection,{snapshot=agentSnapshot(root)}={}){
 validateAgentSelection(selection);const entries=[];
 if(selection==='skip')return {root,selection,entries};
 for(const name of names)need(!snapshot[name].error,snapshot[name].error);
 const skillDestinations=skillNames.map(name=>snapshot[name].destination);
 for(const name of [shared[1],legacy[1]])need(!skillDestinations.includes(snapshot[name].destination),`Agent instruction and skill destinations overlap: ${name}; use separate instruction and skill files`);
 const [skillName,instructionName]=shared;
 const skill=signed(fs.readFileSync(new URL('./skills/traverse.md',import.meta.url),'utf8'),'skill');
 const before=snapshot[skillName].bytes;
 need(before===null||owned(before.toString('utf8'),'skill'),`Existing or customized Traverse skill: ${skillName}; preserve it before rerunning init`);
 entries.push({name:skillName,before,after:Buffer.from(skill)});
 const text=snapshot[instructionName].bytes?.toString('utf8')??'',range=blockRange(text,instructionName);
 const body=`Use Traverse for navigation-graph maintenance and UI driving in this repository.\nRead \`${skillName}\` before using it; follow this repository's task and permission instructions.\n`;
 const block=begin+'\n'+signed(body,'guidance')+end;
 const after=range?text.slice(0,range.start)+block+text.slice(range.finish):text+(text&&!text.endsWith('\n')?'\n':'')+block+'\n';
 entries.push({name:snapshot[instructionName].destination,before:snapshot[instructionName].bytes,after:Buffer.from(after)});
 // Migrate only intact Traverse-owned v0.8 content. Unrelated instructions survive.
 const oldInstructions=legacy[1];
 for(const oldSkill of skillNames.slice(1)){
  const oldBytes=snapshot[oldSkill].bytes;
  need(oldBytes===null||owned(oldBytes.toString('utf8'),'skill'),`Existing or customized Traverse skill: ${oldSkill}; preserve it before rerunning init`);
  entries.push({name:oldSkill,before:oldBytes,after:null});
 }
 // An instruction alias can make shared guidance and legacy cleanup the same write.
 if(snapshot[oldInstructions].destination!==snapshot[instructionName].destination){
  const oldText=snapshot[oldInstructions].bytes?.toString('utf8')??'',oldRange=blockRange(oldText,oldInstructions);
  let remaining=snapshot[oldInstructions].bytes;
  if(oldRange){
   const onlyBlock=oldRange.start===0&&(oldRange.finish===oldText.length||oldRange.finish===oldText.length-1&&oldText.endsWith('\n'));
   remaining=onlyBlock?(snapshot[oldInstructions].links.length?Buffer.alloc(0):null):Buffer.from(oldText.slice(0,oldRange.start)+oldText.slice(oldRange.finish));
  }
  entries.push({name:snapshot[oldInstructions].destination,before:snapshot[oldInstructions].bytes,after:remaining});
 }
 for(const entry of entries)need(entry.after===null||entry.after.length<=maxBytes,`Generated agent guidance would exceed 1 MiB: ${entry.name}; move some instructions to another file before rerunning init`);
 return {root,selection,entries,snapshot};
}
export function agentIntegrationReport(plan,{applied=false}={}){
 const changed=plan.entries.filter(e=>!same(e.before,e.after));
 return {schema:'wayfinder-agent-integration/1',selection:plan.selection,ready:applied||changed.length===0,changed:applied&&changed.length>0,changes:changed.map(e=>e.name),removals:changed.filter(e=>e.after===null).map(e=>e.name)};
}
export function checkAgentSnapshot(plan){
 for(const [name,before] of Object.entries(plan.snapshot??{})){
  const actual=readDestination(plan.root,name);
  need(same(actual.bytes,before.bytes)&&actual.destination===before.destination&&JSON.stringify(actual.links)===JSON.stringify(before.links),`Agent guidance changed during configuration: ${name}; rerun traverse init to preserve the newer file`);
 }
}
export async function applyAgentIntegration(plan,{signal}={}){
 const cancelled=()=>{if(signal?.aborted)throw Object.assign(Error('Agent integration cancelled'),{code:'CANCELLED'});};cancelled();
 if(!plan.entries.length)return agentIntegrationReport(plan,{applied:true});
 const local=path.join(plan.root,'.wayfinder/local');directory(local);
 return withLock(path.join(local,'agents.lock'),async()=>{
  cancelled();checkAgentSnapshot(plan);
  for(const entry of plan.entries){
   if(same(entry.before,entry.after))continue;
   const file=path.join(plan.root,entry.name);
   if(entry.after===null)fs.unlinkSync(file);
   else{directory(path.dirname(file));atomicWrite(file,entry.after);}
  }
  return agentIntegrationReport(plan,{applied:true});
 });
}
