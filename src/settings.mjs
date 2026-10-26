import fs from 'node:fs';
import path from 'node:path';
import {noSymlinks} from './installation.mjs';
import {projectStatus,initProject} from './project.mjs';
import {exists, atomicJson, withLock, directory} from './state.mjs';
import {need, object} from './driving/contract.mjs';

export const SETTINGS_SCHEMA='wayfinder-settings/1';
export const EFFORTS=['low','medium','high','xhigh','max'];
export const validModelId=(provider,model)=>typeof model==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,199}$/.test(model)&&(provider!=='claude'||/^claude-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(model));
export const validEffort=effort=>typeof effort==='string'&&/^[a-z][a-z0-9_-]{0,31}$/.test(effort);
// Catalog capabilities govern the picker; persisted settings remain readable offline.
export function effortChoices(frontier,models=[]){
 const model=models.find(m=>m.id===frontier.model);
 if(model)return model.efforts.length?model.efforts:['default'];
 return ['default',...EFFORTS];
}
export const DRIVING_DEFAULTS={policy:'local-first',maxSteps:20,timeoutMs:120000};
export const defaultModel=provider=>provider==='claude'?'claude-opus-5-5':'gpt-6.1-sol';
export const settingsPath=project=>path.join(path.resolve(project),'.wayfinder/settings.json');
export function validateSettings(value){
 need(object(value)&&value.schema===SETTINGS_SCHEMA,'Unsupported project settings; preserve .wayfinder/settings.json and inspect its schema');
 const f=value.frontier,d=value.driving;
 need(object(f)&&Object.keys(f).sort().join()==='effort,model,provider','Frontier settings require provider, model and effort only');
 need(['codex','claude'].includes(f.provider),'Provider must be codex or claude');
 need(validModelId(f.provider,f.model),'Choose an exact model ID without spaces, aliases or option prefixes');
 need(validEffort(f.effort),'Choose a provider effort level or default; letters, numbers, underscores and hyphens only');
 need(object(d)&&Object.keys(d).sort().join()==='maxSteps,policy,timeoutMs','Driving defaults require policy, maxSteps and timeoutMs only');
 need(['local-first','frontier'].includes(d.policy),'Policy must be local-first or frontier');
 need(Number.isInteger(d.maxSteps)&&d.maxSteps>=1&&d.maxSteps<=100,'Step limit must be 1..100');
 need(Number.isInteger(d.timeoutMs)&&d.timeoutMs>=1&&d.timeoutMs<=1800000,'Timeout must be 1..1800000ms');
 return value;
}
export function readSettings(project){
 return settingsSnapshot(project).settings;
}
export function settingsSnapshot(project){
 const file=settingsPath(project);noSymlinks(file);
 if(!exists(file))return {settings:null,bytes:null};
 const stat=fs.statSync(file);need(stat.isFile()&&stat.size<=65536,'Project settings must be a regular file under 64 KiB');
 const bytes=fs.readFileSync(file);need(bytes.length<=65536,'Project settings exceed 64 KiB');
 let value;try{value=JSON.parse(bytes);}catch{throw Error('Malformed .wayfinder/settings.json; inspect it locally');}
 return {settings:validateSettings(value),bytes};
}
export function frontierChoices(current,options={}){
 const previous=current?.frontier??{};
 if(options.provider!==undefined&&options.provider!==previous.provider)need(options.model&&options.effort,'Changing provider requires an explicit model and effort');
 const frontier={provider:options.provider??previous.provider,model:options.model??previous.model,effort:options.effort??previous.effort};
 validateSettings({schema:SETTINGS_SCHEMA,frontier,driving:DRIVING_DEFAULTS});return frontier;
}
export function projectChoices(current,options={}){
 return validateSettings({...current,schema:SETTINGS_SCHEMA,frontier:frontierChoices(current,options),driving:{...DRIVING_DEFAULTS,...current?.driving,...Object.fromEntries(Object.entries({policy:options.policy,maxSteps:options.maxSteps,timeoutMs:options.timeoutMs}).filter(([,v])=>v!==undefined))}});
}
export async function saveSettings(project,value,{before=null,signal}={}){
 const file=settingsPath(project);validateSettings(value);projectStatus(project);noSymlinks(file);
 need(Buffer.byteLength(JSON.stringify(value))<=65536,'Project settings exceed 64 KiB');
 if(signal?.aborted)throw Error('CANCELLED');
 const local=path.join(project,'.wayfinder/local');directory(local);
 return withLock(path.join(local,'settings.lock'),async()=>{
  if(signal?.aborted)throw Error('CANCELLED');
  const actual=exists(file)?fs.readFileSync(file):null;
  need(actual===null?before===null:before!==null&&actual.equals(before),'Project settings changed during configuration; rerun traverse init to preserve the newer settings');
  const previous=actual&&validateSettings(JSON.parse(actual));
  const changed=!previous||JSON.stringify(previous)!==JSON.stringify(value);
  initProject({project});
  if(changed)atomicJson(file,value);
  return {schema:'wayfinder-project-setup/1',projectRoot:project,settingsFile:file,mode:'setup',settings:value,ready:true,changed,exitCode:0};
 });
}
export function resolveProviderExecutable(provider,{env=process.env}={}){
 need(['codex','claude'].includes(provider),'Provider must be codex or claude');
 for(const dir of (env.PATH??'').split(path.delimiter)){
  if(!path.isAbsolute(dir))continue;
  const file=path.join(dir,provider);
  try{fs.accessSync(file,fs.constants.X_OK);if(fs.statSync(file).isFile())return fs.realpathSync(file);}catch{}
 }
 throw Error(`${provider} CLI is unavailable on PATH; install/sign in to that CLI or update the project frontier settings`);
}
