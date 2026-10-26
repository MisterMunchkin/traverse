import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {need} from '../driving/contract.mjs';

// This worker and its non-detached Codex child share the canonical supervisor's
// owned process group. Only that supervisor supplies the operation deadline.
const {command,settings,request,instructions,directory,mode}=JSON.parse(fs.readFileSync(0,'utf8'));
const disabled=['shell_tool','apps','plugins','hooks','memories','multi_agent','multi_agent_v2','goals','browser_use','computer_use','in_app_browser','image_generation','view_image','skill_search','tool_suggest','daemon_auto_start'];
const args=['app-server','--stdio',...disabled.flatMap(n=>['--disable',n]),'-c','web_search="disabled"','-c','project_doc_max_bytes=0','-c','features.skip_host_skill_discovery=true','-c','forced_login_method="chatgpt"','-c','model_provider="openai"'];
const child=spawn(command,args,{cwd:process.cwd(),env:process.env,stdio:['pipe','pipe','pipe']});
child.stderr.pipe(process.stderr);
let nextId=0,bytes=0,failure,closing=false,threadId,turnId,usage=null,finalMessages=[];
const pending=new Map(),eventTurns=new Set();
let done,undone;
const complete=new Promise((resolve,reject)=>{done=resolve;undone=reject;});complete.catch(()=>{});
const transcript=directory&&path.join(directory,'protocol.jsonl');if(transcript)fs.writeFileSync(transcript,'',{flag:'wx',mode:0o600});
function log(value){if(transcript)fs.appendFileSync(transcript,JSON.stringify(value)+'\n');}
function fail(error){failure??=error;for(const p of pending.values())p.reject(failure);pending.clear();undone(failure);child.stdin.end();}
const closed=new Promise(resolve=>{child.on('close',(code,signal)=>{if(!closing)fail(Error('Codex stdio closed before completion'));resolve({code,signal});});});
child.on('error',fail);child.stdin.on('error',fail);
function send(m){child.stdin.write(JSON.stringify(m)+'\n');}
function rpc(method,params={}){if(failure)return Promise.reject(failure);const id=++nextId;log({sent:{id,method,params}});return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject,method});send({id,method,params});});}
const lines=readline.createInterface({input:child.stdout});
lines.on('line',line=>{
 try{
  bytes+=Buffer.byteLength(line);need(bytes<=8*1024*1024,'Codex protocol output limit exceeded');
  const m=JSON.parse(line);
  if(m.method&&Object.hasOwn(m,'id')){send({id:m.id,error:{code:-32601,message:'Traverse refuses tools, approvals and user input'}});throw Error('Codex requested a tool or approval');}
  if(Object.hasOwn(m,'id')){
   const p=pending.get(m.id);need(p,'Unexpected Codex response ID');pending.delete(m.id);
   // Account/config responses can contain personal configuration; never save them.
   log({received:{id:m.id,method:p.method,...(['config/read','account/read'].includes(p.method)?{redacted:true}:{result:m.result,error:m.error})}});
   if(m.error)p.reject(Error('Codex RPC failed: '+p.method));else p.resolve(m.result);return;
  }
  log({received:m});const p=m.params??{};
  if(p.threadId&&threadId)need(p.threadId===threadId,'Codex thread identity changed');
  if(p.turnId)eventTurns.add(p.turnId);
  if(p.turnId&&turnId)need(p.turnId===turnId,'Codex turn identity changed');
  if(m.method==='item/started'||m.method==='item/completed'){need(typeof p.turnId==='string'&&p.threadId===threadId,'Codex item identity is missing');need(['userMessage','agentMessage','reasoning'].includes(p.item?.type),'Codex attempted tool use');}
  if(m.method==='thread/tokenUsage/updated')usage=p.tokenUsage?.last??null;
  if(m.method==='item/completed'&&p.item?.type==='agentMessage'&&p.item.phase!=='commentary')finalMessages.push(p.item.text);
  if(m.method==='turn/completed')done(p.turn);
 }catch(e){fail(e);}
});
let result;
try{
 await rpc('initialize',{clientInfo:{name:'traverse',version:JSON.parse(fs.readFileSync(new URL('../../package.json',import.meta.url),'utf8')).version},capabilities:{experimentalApi:true}});send({method:'initialized',params:{}});
 const account=await rpc('account/read',{refreshToken:false});need(account.account?.type==='chatgpt'&&account.requiresOpenaiAuth===true,'Codex subscription login required; run codex login');
 let cursor;const models=[],cursors=new Set();
 do{
  const catalog=await rpc('model/list',{includeHidden:true,...(cursor?{cursor}:{})});
  need(Array.isArray(catalog.data),'Invalid Codex model catalog');models.push(...catalog.data);
  cursor=catalog.nextCursor;
  need(cursor==null||typeof cursor==='string'&&cursor.length>0&&!cursors.has(cursor)&&cursors.size<256,'Invalid Codex model catalog pagination');
  if(cursor)cursors.add(cursor);
 }while(cursor);
 if(mode==='catalog')result={models};
 else{
 const model=models.find(m=>m.model===settings.model);
 need(model,'Configured Codex model is not available in its model catalog');
 const effort=settings.effort==='default'?(model.defaultReasoningEffort??null):settings.effort;
 need(effort===null||model.supportedReasoningEfforts?.some(e=>e.reasoningEffort===effort),'Configured Codex model does not support the selected effort');
 const config=await rpc('config/read',{includeLayers:false}),overrides={...(effort===null?{}:{model_reasoning_effort:effort}),web_search:'disabled'};
 for(const name of Object.keys(config.config?.mcp_servers??{})){need(/^[A-Za-z0-9_-]+$/.test(name),'Unsupported MCP config key; inspect Codex configuration');overrides['mcp_servers.'+name+'.enabled']=false;}
 const thread=await rpc('thread/start',{model:settings.model,modelProvider:'openai',allowProviderModelFallback:false,approvalPolicy:'never',sandbox:'read-only',cwd:process.cwd(),ephemeral:true,environments:[],runtimeWorkspaceRoots:[],dynamicTools:[],baseInstructions:instructions,developerInstructions:'Return only the requested JSON; use no tools or environment access.',config:overrides});
 threadId=thread.thread?.id;
 need(threadId&&thread.model===settings.model&&thread.modelProvider==='openai','Codex returned a different or unknown model');
 need(thread.approvalPolicy==='never'&&thread.sandbox?.type==='readOnly'&&thread.sandbox.networkAccess===false&&thread.runtimeWorkspaceRoots?.length===0,'Codex environment permissions changed');
 need((thread.reasoningEffort??null)===effort,'Codex returned a different or unknown effort');
 const turn=await rpc('turn/start',{threadId,...(effort===null?{}:{effort}),environments:[],input:[{type:'text',text:JSON.stringify(request)}],outputSchema:request.responseSchema});turnId=turn.turn?.id;
 const completed=await complete;need([...eventTurns].every(id=>id===turnId),'Codex turn identity changed');need(completed?.id===turnId&&completed.status==='completed','Codex turn failed');
 need(finalMessages.length===1,'Codex returned no single final decision');const answer=JSON.parse(finalMessages[0]);need(answer&&typeof answer==='object'&&!Array.isArray(answer)&&Object.keys(answer).sort().join()===Object.keys(request.responseSchema.properties).sort().join(),'Codex response fields differ from the requested schema');
 result={...answer,usage:{inputTokens:Number.isFinite(usage?.inputTokens)?usage.inputTokens:null,outputTokens:Number.isFinite(usage?.outputTokens)?usage.outputTokens:null,cachedInputTokens:Number.isFinite(usage?.cachedInputTokens)?usage.cachedInputTokens:null},identity:{requested:{...settings},observed:{model:thread.model,effort:thread.reasoningEffort},effortVerified:true}};
 }
}catch(e){failure??=e;}
finally{closing=true;child.stdin.end();const outcome=await closed;lines.close();if(outcome.code!==0)failure??=Error('Codex stdio did not exit cleanly');}
if(failure){console.error(failure.message);process.exitCode=1;}else console.log(JSON.stringify(result));
