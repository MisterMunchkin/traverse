import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {normalizeObservation, validateTask} from '../src/driving/contract.mjs';
import {decideAction} from '../src/driving/policy.mjs';
import {drive} from '../src/driving/loop.mjs';
const route=id=>({id,url:id,guards:[],registrations:[]});
const edge=(from,to)=>({owner:from,from,to,label:'Next',kind:'action',conditions:[],source:{file:from+'.tsx',line:4}});
const graph=()=>({schema:'traverse-navigation',schemaVersion:1,coverage:'partial-static-source',limits:{unsupported:['runtime visibility']},nodes:[route('/welcome'),route('/details'),route('/done'),...Array.from({length:138},(_,i)=>route('/other-'+i))],edges:[edge('/welcome','/details'),edge('/details','/done')],unresolved:[],sites:[],registrations:[],files:{}});
const screenMap={'/welcome':[{identifier:'screen-welcome'}],'/details':[{identifier:'screen-details'}]};
const task={goal:'Dismiss the notice then finish',screenMap,expect:{visible:[{label:'Done'}]}};
const snapshot=(screen='welcome',extra=[])=>normalizeObservation({nodes:[{index:0,type:'Other',identifier:'screen-'+screen,label:'Current screen'},{index:1,type:'Button',label:'Dismiss',ref:'e1'},...extra]}, {target:{platform:'ios',app:'test.app'}});
const choice=q=>({choice:'c0',confidence:1,probabilities:Object.fromEntries(q.options.map(o=>[o.id,o.id==='c0'?1:0])),raw:{usage:{input_tokens:1}}});
function directory(t){const d=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'traverse-window-')));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}

test('screenMap validates bounded identity selectors and exact graph routes',()=>{
 assert.doesNotThrow(()=>validateTask(task,{graph:graph()}));
 for(const invalid of [{}, {'/welcome':[]},{'/welcome':[{role:'button'}]},{'/welcome':[{identifier:''}]},{'/welcome':[{identifier:'screen',hidden:true}]},{'/missing':[{identifier:'screen'}]}])
  assert.throws(()=>validateTask({...task,screenMap:invalid},{graph:graph()}),/screenMap/);
});

test('a visible screen anchor lets unmatched Dismiss use a bounded graph window',async()=>{
 let asked;const o=snapshot(),g=graph();
 const r=await decideAction({task,observation:o,graph:g,ask:async q=>{asked=q;return choice(q);}});
 assert.equal(r.via,'tev1');const state=JSON.parse(asked.state),evidence=r.localEvidence.context;
 assert.equal(evidence.scope,'screen-window');assert.equal(evidence.screen.route,'/welcome');
 assert.equal(evidence.screen.method,'visible-selector-match');assert.equal(evidence.screen.observationId,o.id);
 assert.deepEqual(evidence.screen.nodeIds,['control-0']);assert.equal(evidence.screen.runtimeRouteVerified,false);
 assert.deepEqual(state.navigationGraph.nodes.map(n=>n.id),['/welcome','/details']);
 assert.ok(state.observed.some(n=>n.label==='Dismiss'));assert.equal(asked.instructions,`Goal: ${task.goal}\nChoose the current control that makes progress on this goal.`);
 assert.ok(evidence.budget.estimatedInputTokens<=1500);assert.ok(evidence.budget.graphTokenBudget>0);
 assert.equal(g.nodes.length,141);
});

test('unknown, hidden, duplicate and competing anchors bypass local choice even for a tiny graph',async()=>{
 const g=graph();g.nodes=g.nodes.slice(0,3);
 const hidden=snapshot('welcome');hidden.nodes[0].visible=false;
 for(const [o,status]of [[snapshot('unknown'),'unknown'],[hidden,'unknown'],[snapshot('welcome',[{index:2,identifier:'screen-welcome'}]),'ambiguous'],[snapshot('welcome',[{index:2,identifier:'screen-details'},{index:3,identifier:'screen-details'}]),'ambiguous']]){
  let calls=0;const r=await decideAction({task,observation:o,graph:g,ask:async()=>{calls++;throw Error('unexpected');}});
  assert.equal(calls,0);assert.equal(r.reason,status==='unknown'?'SCREEN_UNKNOWN':'SCREEN_AMBIGUOUS');assert.equal(r.brief.context.screen.status,status);
 }
});

test('window retains guarded candidates, redirects and only precisely associated source sites',async()=>{
 const g=graph();g.nodes.push({...route('/admin'),guards:[{expression:'isAdmin',truthy:true}]},route('/login'));
 g.unresolved.push({owner:'/welcome',reason:'ambiguous-route',candidates:['/details','/admin'],source:{file:'shared.tsx',line:10}});
 g.edges.push({...edge('/admin','/login'),kind:'redirect'});
 g.registrations.push({to:'/admin',guards:[{expression:'canEnter',truthy:true}]});
 g.sites.push({source:{file:'shared.tsx',line:10},conditions:[{expression:'available',truthy:true}]},{source:{file:'shared.tsx',line:99},conditions:[{expression:'unrelated',truthy:true}]});
 let asked;const r=await decideAction({task,observation:snapshot(),graph:g,ask:async q=>{asked=q;return choice(q);}});
 assert.equal(r.via,'tev1');const window=JSON.parse(asked.state).navigationGraph;
 assert.equal(window.nodes.find(n=>n.id==='/admin').guards[0].expression,'isAdmin');
 assert.ok(window.nodes.some(n=>n.id==='/login'));assert.equal(window.registrations[0].guards[0].expression,'canEnter');
 assert.equal(window.sites.length,1);assert.equal(window.sites[0].conditions[0].expression,'available');
});

test('oversized essential window escalates and frontier receives the complete semantic graph',async()=>{
 const g=graph();g.nodes[0].guards=[{expression:'essential '.repeat(600),truthy:true}];let frontierRequest;
 const r=await decideAction({task,observation:snapshot(),graph:g,ask:async()=>{throw Error('must not call');},frontier:async q=>{frontierRequest=q;return {pick:'c0'};}});
 assert.equal(r.localEscalation.code,'CONTEXT_LIMIT');assert.equal(r.via,'frontier');
 assert.equal(frontierRequest.state.navigationGraph.nodes.length,g.nodes.length);
 assert.equal(frontierRequest.state.navigationGraph.nodes[0].guards[0].expression,g.nodes[0].guards[0].expression);
 assert.equal(frontierRequest.context.expandedFrom,'screen-window');
});

test('UI compaction preserves values, false and unknown states, ancestry and modal scope',async()=>{
 const o=snapshot('welcome',[
  {index:2,type:'Alert',label:'Confirm'},
  {index:3,parentIndex:2,type:'Button',label:'Keep',ref:'e3',hittable:true},
  {index:4,parentIndex:2,type:'Button',label:'Disabled',enabled:false,hittable:false,ref:'e4'},
  {index:5,parentIndex:2,type:'TextField',label:'Name',value:'Typed draft',ref:'e5'},
 ]);let asked;
 await decideAction({task,observation:o,graph:graph(),ask:async q=>{asked=q;return choice(q);}});
 const state=JSON.parse(asked.state),disabled=state.observed.find(n=>n.label==='Disabled');
 assert.equal(disabled.enabled,false);assert.equal(disabled.hittable,false);assert.equal(disabled.parent,2);
 assert.equal(state.observed.find(n=>n.label==='Name').value,'Typed draft');
 assert.equal(state.observed.find(n=>n.label==='Current screen').hittable,null);
 assert.equal(state.modalScope.status,'active');assert.ok(asked.options.every(o=>!o.description.includes('Dismiss')));
});

test('drive reanchors after each action, keeps the full graph receipt and completes the observed journey',async t=>{
 const dir=directory(t),g=graph(),questions=[],calls=[];let step=0;
 const observe=()=>snapshot(step===0?'welcome':step===1?'details':'done',step===2?[{index:2,label:'Done',type:'StaticText'}]:[]);
 const runner={name:'fixture',session:'owned',target:{platform:'ios',app:'test.app'},open:async()=>calls.push('open'),close:async()=>calls.push('close'),screenshot:async()=>{},observe:async()=>observe(),act:async action=>{calls.push(action.type);step++;return {execution:'acknowledged',effect:'unverified',observation:observe()};}};
 const r=await drive({task,graph:g,runner,directory:dir,ask:async q=>{questions.push(JSON.parse(q.state));return choice(q);}});
 assert.equal(r.status,'verified');assert.equal(r.steps,2);assert.deepEqual(calls,['open','press','press','close']);
 assert.deepEqual(questions.map(q=>q.screen.route),['/welcome','/details']);
 assert.deepEqual(questions[1].navigationGraph.nodes.map(n=>n.id),['/details','/done']);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'inputs.json'))).graph.nodes.length,g.nodes.length);
 const decisions=fs.readFileSync(path.join(dir,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse).filter(e=>e.type==='decision');
 assert.notEqual(decisions[0].localEvidence.context.screen.observationId,decisions[1].localEvidence.context.screen.observationId);
});

test('drive does not retain a prior anchor after an unrecognized screen, and invalid routes never open a runner',async t=>{
 let step=0,opened=0,asked=0;
 const runner={name:'fixture',session:'owned',target:{platform:'ios',app:'test.app'},open:async()=>opened++,close:async()=>{},screenshot:async()=>{},observe:async()=>snapshot(),act:async()=>{step++;return {execution:'acknowledged',observation:snapshot('unmapped')};}};
 const r=await drive({task,graph:graph(),runner,directory:directory(t),ask:async q=>{asked++;return choice(q);}});
 assert.equal(r.status,'needs-frontier');assert.equal(r.escalation.reason,'SCREEN_UNKNOWN');assert.equal(asked,1);assert.equal(step,1);
 await assert.rejects(drive({task:{...task,screenMap:{'/missing':[{identifier:'screen-welcome'}]}},graph:graph(),runner,directory:directory(t)}),/screenMap/);
 assert.equal(opened,1);
});

test('screen matching respects hidden ancestors and requires every declared marker',async()=>{
 const o=snapshot('welcome',[
  {index:2,type:'Other',visible:false},
  {index:3,parentIndex:2,identifier:'screen-details'},
 ]);
 const result=await decideAction({task,observation:o,graph:graph(),ask:async q=>choice(q)});
 assert.equal(result.localEvidence.context.screen.route,'/welcome');
 const conjunction={...task,screenMap:{...screenMap,'/details':[{identifier:'screen-welcome'},{label:'Missing detail marker'}]}};
 const matched=await decideAction({task:conjunction,observation:o,graph:graph(),ask:async q=>choice(q)});
 assert.equal(matched.localEvidence.context.screen.route,'/welcome');
});

test('a screen-marker change before dispatch invalidates an otherwise unchanged target',async t=>{
 const {createAgentDeviceRunner}=await import('../src/driving/agent-device.mjs');
 const calls=[];let snapshots=0;
 const runner=createAgentDeviceRunner({executable:'/fixture/ad',session:'owned',directory:directory(t),target:{platform:'ios',app:'test.app',device:'UDID'},execute:async(command,args)=>{
  calls.push(args[0]);assert.equal(args[0],'snapshot');
  const data={nodes:[{index:0,identifier:snapshots++?'screen-details':'screen-welcome'},{index:1,type:'Button',label:'Dismiss',ref:'e1'}]};
  return {command,args,code:0,signal:null,stdout:JSON.stringify({success:true,data}),stderr:'',elapsedMs:1};
 }});
 const initial=await runner.observe();
 const decision=await decideAction({task,observation:initial,graph:graph(),ask:async q=>choice(q)});
 await assert.rejects(runner.act(decision.action),e=>e.code==='STALE_OBSERVATION');
 assert.deepEqual(calls,['snapshot','snapshot']);
});

test('no-controls handoff expands the anchored window and preserves its original receipt',async()=>{
 const o=normalizeObservation({nodes:[{identifier:'screen-welcome',label:'Welcome'}]});
 const g=graph();const r=await decideAction({task,observation:o,graph:g,ask:async()=>{throw Error('unexpected');}});
 assert.equal(r.reason,'NO_CONTROLS');assert.equal(r.brief.context.scope,'complete');
 assert.equal(r.brief.state.navigationGraph.nodes.length,g.nodes.length);
 assert.equal(r.brief.context.window.scope,'screen-window');assert.equal(r.brief.context.window.screen.route,'/welcome');
 assert.equal(r.brief.context.window.omitted.nodes,139);
});

test('over-budget window handoff keeps the rejected window budget separately from expanded context',async()=>{
 const g=graph();g.nodes[0].guards=[{expression:'essential '.repeat(600),truthy:true}];
 const r=await decideAction({task,observation:snapshot(),graph:g});
 assert.equal(r.reason,'CONTEXT_LIMIT');assert.equal(r.localEvidence,null);
 const full=r.brief.context,window=full.window;
 assert.equal(window.scope,'screen-window');assert.equal(window.omitted.nodes,139);
 assert.ok(window.budget.estimatedInputTokens>1500);assert.ok(full.budget.estimatedInputTokens>window.budget.estimatedInputTokens);
 assert.equal(window.graphHash,full.graphHash);assert.equal(full.omitted.nodes,0);
 assert.notEqual(window.budget,full.budget);
});
