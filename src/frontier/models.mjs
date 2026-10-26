import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runProcess} from '../runtime/process.mjs';
import {resolveProviderExecutable,validModelId,validEffort} from '../settings.mjs';
import {need} from '../driving/contract.mjs';
import {subscriptionEnvironment,claudeRestrictedArgs} from './config.mjs';

const worker=fileURLToPath(new URL('./codex-worker.mjs',import.meta.url));
const unsafe=message=>Object.assign(Error(message),{code:'CATALOG_UNSAFE'});
const decode=text=>{try{return JSON.parse(text);}catch{throw unsafe('Malformed provider metadata');}};
const label=s=>typeof s==='string'?s.replace(/[\x00-\x1f\x7f-\x9f]/g,' ').slice(0,160):'';
export function normalizeModels(provider,rows){
 need(['codex','claude'].includes(provider)&&Array.isArray(rows),'Invalid provider model catalog');
 const unique=new Map();let unresolved=0;
 for(const row of rows){
  need(row&&typeof row==='object','Invalid provider model entry');
  const id=provider==='codex'?row.model:row.resolvedModel??row.value;
  // Older Claude builds can advertise aliases without their wire IDs. Never guess.
  if(provider==='claude'&&!validModelId(provider,id)){unresolved++;continue;}
  need(validModelId(provider,id),'Invalid provider model ID');
  const levels=provider==='codex'?row.supportedReasoningEfforts?.map(e=>e.reasoningEffort):row.supportedEffortLevels;
  need(levels===undefined||Array.isArray(levels)&&levels.every(validEffort),'Invalid provider effort catalog');
  const efforts=[...new Set(levels??[])];
  const defaultEffort=provider==='codex'?row.defaultReasoningEffort:null;
  need(defaultEffort==null||validEffort(defaultEffort)&&efforts.includes(defaultEffort),'Invalid provider default effort');
  if(!unique.has(id))unique.set(id,{id,label:label(row.displayName)||id,efforts,defaultEffort,hidden:row.hidden===true});
 }
 return {models:[...unique.values()],unresolved};
}

const unavailable=()=>Object.assign(Error('Model metadata unavailable'),{code:'CATALOG_UNAVAILABLE'});
function checkedCatalog(provider,rows){
 try{return normalizeModels(provider,rows);}catch{throw unsafe('Malformed provider model capabilities');}
}
function claudeModels(stdout){
 const events=stdout.trim().split('\n').filter(Boolean).map(decode);
 if(!events.every(e=>e&&['system','control_response'].includes(e.type)))throw unsafe('Unexpected Claude metadata message');
 const replies=events.filter(e=>e.type==='control_response');
 if(!replies.length)throw unavailable();
 if(replies.length!==1||replies[0].response?.request_id!=='wayfinder-model-catalog')throw unsafe('Claude metadata response identity changed');
 const response=replies[0].response;
 if(response.subtype==='error')throw unavailable();
 if(response.subtype!=='success')throw unsafe('Invalid Claude metadata response');
 const payload=response.response;
 if(payload===undefined)throw unavailable();
 if(!payload||typeof payload!=='object'||Array.isArray(payload))throw unsafe('Invalid Claude metadata payload');
 if(!Object.hasOwn(payload,'models'))throw unavailable();
 if(!Array.isArray(payload.models))throw unsafe('Invalid Claude model capabilities');
 return checkedCatalog('claude',payload.models);
}

// Initialize only: no user message, thread/start, turn/start, setModel or generation.
export async function discoverModels(provider,{env=process.env,signal,timeoutMs=10000}={}){
 const command=resolveProviderExecutable(provider,{env}),cleanEnv=subscriptionEnvironment(env);
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'wayfinder-model-catalog-'));
 try{
  let catalog;
  if(provider==='codex'){
   const result=await runProcess(process.execPath,[worker],{cwd,env:cleanEnv,input:JSON.stringify({command,mode:'catalog'}),signal,timeoutMs});
   catalog=checkedCatalog('codex',decode(result.stdout).models);
  }else{
   let result;
   try{
    result=await runProcess(command,[...claudeRestrictedArgs(),'--input-format','stream-json'],{cwd,env:cleanEnv,input:JSON.stringify({type:'control_request',request_id:'wayfinder-model-catalog',request:{subtype:'initialize',hooks:{},sdkMcpServers:[],agents:{}}})+'\n',signal,timeoutMs});
   }catch(e){
    // A nonzero exit cannot conceal unsafe protocol output behind an unavailable catalog.
    if(e.record?.stdout){try{claudeModels(e.record.stdout);}catch(protocol){if(protocol.code!=='CATALOG_UNAVAILABLE')throw protocol;}}
    throw e;
   }
   catalog=claudeModels(result.stdout);
  }
  return catalog;
 }catch(e){
  // Provider control responses can contain account/configuration data. Do not expose them.
  if(signal?.aborted)throw Error('CANCELLED');
  const unavailableFailure=e.code==='CATALOG_UNAVAILABLE'||e.record&&e.message!=='OUTPUT_LIMIT';
  const code=e.code==='CATALOG_UNSAFE'||!unavailableFailure?'CATALOG_UNSAFE':'CATALOG_UNAVAILABLE';
  throw Object.assign(Error(code==='CATALOG_UNSAFE'?`Invalid ${provider} model catalog protocol; update the provider CLI before using it.`:`Could not load ${provider} models. Check that its CLI is installed, up to date and signed in; enter an exact model ID manually or retry.`),{code});
 }finally{fs.rmSync(cwd,{recursive:true,force:true});}
}
