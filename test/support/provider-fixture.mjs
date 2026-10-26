import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export function providerFixture(t,provider,mode='success',{model:configuredModel,effort:configuredEffort,catalog:providedCatalog}={}){
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'wayfinder-frontier-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const bin=path.join(dir,'bin');fs.mkdirSync(bin);const log=path.join(dir,'calls.jsonl'),pid=path.join(dir,'child.pid');
 const effort=configuredEffort??(mode==='effort-high'?'high':'medium');
 const model=configuredModel??(provider==='codex'?'gpt-6.1-sol':'claude-opus-5-5');
 const catalog=providedCatalog??(provider==='codex'?[{model,displayName:model,defaultReasoningEffort:effort,supportedReasoningEfforts:[{reasoningEffort:effort}]}]:[{value:'opus',resolvedModel:model,displayName:'Opus',supportsEffort:true,supportedEffortLevels:['low','medium','high','xhigh','max']}]);
 fs.writeFileSync(path.join(bin,provider),`#!${process.execPath}
import fs from 'node:fs';import readline from 'node:readline';
const args=process.argv.slice(2),log=${JSON.stringify(log)},mode=${JSON.stringify(mode)},model=${JSON.stringify(model)},effort=${JSON.stringify(effort)},catalog=${JSON.stringify(catalog)};
if(args[0]==='--version'){console.log(${JSON.stringify(provider==='codex'?'codex-cli 0.163.0':'2.1.292 (Claude Code)')});process.exit(0);}
if(args[0]==='auth'&&args[1]==='status'){console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:mode==='wrong-auth-provider'?'bedrock':'firstParty'}));process.exit(0);}
fs.writeFileSync(${JSON.stringify(pid)},String(process.pid));
fs.appendFileSync(log,JSON.stringify({args,envKeys:Object.keys(process.env).filter(k=>/API_KEY$/.test(k)),pid:process.pid})+'\\n');
function adapterAnswer(payload){
 fs.appendFileSync(log,JSON.stringify({author:payload})+'\\n');
 if(mode==='adapter-repair'&&!payload.previousDiagnostic)return {files:[{path:'../escape.mjs',source:'bad'}]};
 return {files:Object.entries(payload.request.requirements.artifactTemplate.files).map(([path,source])=>({path,source}))};
}
if(${JSON.stringify(provider)}==='claude'){
 let input='';for await(const chunk of process.stdin)input+=chunk;
 if(args.includes('--input-format')){
  const request=JSON.parse(input);if(request.type!=='control_request'||request.request.subtype!=='initialize')throw Error('Not metadata only');
  if(mode==='catalog-hang'){await new Promise(()=>{setInterval(()=>{},1000);});}
  if(mode.startsWith('catalog-tool'))console.log(JSON.stringify({type:'control_request',request_id:'tool',request:{subtype:'can_use_tool'}}));
  console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:request.request_id,response:mode.startsWith('catalog-unavailable')?{}:{models:mode==='catalog-null'?null:catalog}}}));process.exit(['catalog-tool-nonzero','catalog-invalid-nonzero'].includes(mode)?1:0);
 }

 if(mode==='hang')setInterval(()=>{},1000);else{
 if(process.env.CLAUDE_CODE_EFFORT_LEVEL||Object.keys(process.env).some(k=>k.startsWith('CLAUDE_CODE_USE_')))throw Error('Conflicting Claude selectors leaked');
 if(!args.includes('--tools')||args[args.indexOf('--tools')+1]!==''||!args.includes('--strict-mcp-config'))throw Error('Tools were not disabled');
 if(!args.includes('--model')||args[args.indexOf('--model')+1]!==model||(effort==='default'?args.includes('--effort'):args[args.indexOf('--effort')+1]!==effort))throw Error('Requested identity missing');
 const payload=JSON.parse(input);const pick=payload.options?(payload.options.find(o=>o.description.startsWith('Fill'))??payload.options[0]).id:null;const answer=payload.schema==='wayfinder-adapter-author/1'?adapterAnswer(payload):{pick:mode==='unoffered'?'private':pick};
 console.log(JSON.stringify({type:'system',subtype:'init',model:(mode==='wrong-model'||mode==='catalog-unavailable-wrong-model')?'other-model':model,tools:[],mcp_servers:[]}));
 console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,structured_output:answer,usage:{input_tokens:50,cache_creation_input_tokens:0,cache_read_input_tokens:0,output_tokens:3},modelUsage:{[model]:{inputTokens:50,outputTokens:3}},total_cost_usd:.02}));}
}else{
 if(!args.includes('web_search="disabled"'))throw Error('Codex web search was not disabled before startup');
 const lines=readline.createInterface({input:process.stdin});const send=x=>console.log(JSON.stringify(x));
 for await(const line of lines){const m=JSON.parse(line);fs.appendFileSync(log,JSON.stringify({method:m.method,params:m.params})+'\\n');if(m.id===undefined)continue;
 const result=m.method==='initialize'?{userAgent:'fake',codexHome:'/owned',platformFamily:'unix',platformOs:'macos'}:
 m.method==='account/read'?{account:{type:'chatgpt',email:'fixture@example.invalid',planType:'plus'},requiresOpenaiAuth:true}:
 m.method==='config/read'?{config:{mcp_servers:{fixture:{enabled:true,env:{SECRET:'must-not-log'}}}},layers:null,origins:{}}:
 m.method==='model/list'?{data:mode==='catalog-pages'?catalog.slice(m.params.cursor?1:0,m.params.cursor?undefined:1):catalog,nextCursor:mode==='catalog-loop'?'same':mode==='catalog-pages'&&!m.params.cursor?'page2':null}:
 m.method==='thread/start'?{thread:{id:'thread-1'},model:(mode==='wrong-model'||mode==='catalog-unavailable-wrong-model')?'other-model':model,modelProvider:'openai',reasoningEffort:effort,approvalPolicy:'never',sandbox:{type:'readOnly',networkAccess:false},runtimeWorkspaceRoots:[],serviceTier:'default'}:{turn:{id:'turn-1',status:'inProgress'}};
 if(m.method==='thread/start'&&(m.params.environments.length||m.params.dynamicTools.length||m.params.config['mcp_servers.fixture.enabled']!==false||m.params.config.web_search!=='disabled'))throw Error('Environment/MCP not disabled');
 if(m.method==='model/list'&&mode==='catalog-hang'){setInterval(()=>{},1000);continue;}
 send({id:m.id,result});
 if(m.method==='turn/start'){const payload=JSON.parse(m.params.input[0].text),pick=payload.options?(payload.options.find(o=>o.description.startsWith('Fill'))??payload.options[0]).id:null,answer=payload.schema==='wayfinder-adapter-author/1'?adapterAnswer(payload):{pick:mode==='unoffered'?'private':pick};
  if(m.params.effort!==effort||m.params.environments.length)throw Error('Turn settings missing');
  if(mode==='hang'){setInterval(()=>{},1000);continue;}
  if(mode==='tool'){send({id:999,method:'item/commandExecution/requestApproval',params:{}});continue;}
  send({method:'thread/tokenUsage/updated',params:{threadId:'thread-1',tokenUsage:{last:{inputTokens:50,cachedInputTokens:0,outputTokens:3,reasoningOutputTokens:0,totalTokens:53}}}});
  send({method:'item/completed',params:{threadId:'thread-1',turnId:mode==='wrong-turn'?'different-turn':'turn-1',item:{type:'agentMessage',id:'answer',phase:'final_answer',text:JSON.stringify(answer)}}});
  send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed',error:null,items:[]}}});
 }
 }
}
`,{mode:0o755});
 return{dir,bin,log,pid,profile:{provider,model,effort:configuredEffort??'medium'},env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,OPENAI_API_KEY:'not-forwarded',ANTHROPIC_API_KEY:'not-forwarded',CLAUDE_CODE_EFFORT_LEVEL:'max',CLAUDE_CODE_USE_BEDROCK:'1',CLAUDE_CODE_USE_VERTEX:'1',CLAUDE_CODE_USE_FOUNDRY:'1',CLAUDE_CODE_USE_ANTHROPIC_AWS:'1',CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD:'1',CLAUDE_CODE_USE_MANTLE:'1'}};
}
