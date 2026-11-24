import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeObservation} from '../src/driving/contract.mjs';
import {decideAction} from '../src/driving/policy.mjs';
const task={goal:'Open details',expect:{visible:[{label:'Details'}]}};
const observation=normalizeObservation({nodes:[{type:'Button',label:'Details',ref:'e1'}]});
const answer=q=>({choice:'c0',confidence:1,probabilities:Object.fromEntries(q.options.map(o=>[o.id,o.id==='c0'?1:0]))});
const node=id=>({id,url:id,guards:[],registrations:[]});
function graph(){return {schema:'traverse-navigation',schemaVersion:1,coverage:'partial-static-source',limits:{unsupported:['runtime visibility']},files:{'app/index.tsx':{sha256:'a'.repeat(64)}},nodes:[node('/'),node('/details'),...Array.from({length:138},(_,i)=>node('/other-'+i))],edges:[{id:'details',owner:'/',from:'/',to:'/details',target:'/details',label:'Details',method:'push',kind:'action',conditions:[{expression:'canRead',truthy:true}],pureNavigation:true,source:{file:'app/index.tsx',line:1,excerpt:'source '.repeat(2000)}}],sites:[],unresolved:[{owner:'/',method:'back',reason:'history-dependent',expression:null}],registrations:[]};}
test('large source inventory reaches local choice through a marked bounded graph projection',async()=>{
 const g=graph();let seen;
 const r=await decideAction({task,observation,graph:g,ask:async q=>{seen=q;return answer(q);}});
 assert.equal(r.via,'tev1');const state=JSON.parse(seen.state);
 assert.ok(!seen.state.includes('source source'));
 assert.equal(state.navigationGraph.context.scope,'retrieved');
 assert.equal(state.navigationGraph.context.observedRoute,null);
 assert.deepEqual(state.navigationGraph.nodes.map(n=>n.id),['/','/details']);
 assert.equal(state.navigationGraph.edges[0].conditions[0].expression,'canRead');
 assert.equal(state.navigationGraph.unresolved[0].reason,'history-dependent');
 assert.match(r.localEvidence.context.graphHash,/^[a-f0-9]{64}$/);
 assert.equal(r.localEvidence.context.omitted.nodes,138);
 assert.equal(g.nodes.length,140);assert.ok(g.edges[0].source);
});
test('lossless semantic compaction preserves complete small graphs despite huge provenance',async()=>{
 const g=graph();g.nodes=g.nodes.slice(0,2);let seen;
 const r=await decideAction({task,observation,graph:g,ask:async q=>{seen=q;return answer(q);}});
 assert.equal(r.via,'tev1');assert.equal(r.localEvidence.context.scope,'complete');
 assert.equal(JSON.parse(seen.state).navigationGraph.nodes.length,2);
});
test('unmatched large graph and oversized relevant guards escalate instead of silently dropping facts',async()=>{
 const unmatched=graph();unmatched.edges[0].label='Unrelated';
 const guarded=graph();guarded.edges[0].conditions[0].expression='long guard '.repeat(1000);
 for(const g of [unmatched,guarded]){
  const r=await decideAction({task:{...task,goal:'Use the button'},observation,graph:g,ask:async()=>{throw Error('must not call');}});
  assert.equal(r.reason,'CONTEXT_LIMIT');assert.equal(r.accounting.localCalls,0);
 }
});
test('all duplicate-label matches survive retrieval and option overflow still escalates',async()=>{
 const g=graph();g.nodes.push(node('/second'));g.edges.push({...g.edges[0],id:'second',owner:'/second',from:'/second'});
 let seen;const r=await decideAction({task,observation,graph:g,ask:async q=>{seen=q;return answer(q);}});
 assert.equal(r.via,'tev1');assert.equal(JSON.parse(seen.state).navigationGraph.edges.length,2);
 const many=normalizeObservation({nodes:Array.from({length:24},(_,i)=>({type:'Button',label:String(i),ref:'e'+i}))});
 const tooMany=await decideAction({task,observation:many,graph:{},ask:async()=>{throw Error('unexpected');}});
 assert.equal(tooMany.reason,'TOO_MANY_OPTIONS');
});
test('retrieval retains destination guards, automatic redirects and uncertainty without substring route matches',async()=>{
 const g=graph();g.nodes[1].guards=[{expression:'signedIn',truthy:false}];g.nodes.push(node('/login'));
 g.edges.push({id:'redirect',owner:'/details',from:'/details',to:'/login',target:'/login',kind:'redirect',method:'Redirect',conditions:[{expression:'signedIn',truthy:false}],label:null});
 g.registrations.push({to:'/login',guards:[{expression:'loginAvailable',truthy:true}]});
 let seen;const r=await decideAction({task:{...task,goal:'Open /other-10'},observation,graph:g,ask:async q=>{seen=q;return answer(q);}});
 assert.equal(r.via,'tev1');const projected=JSON.parse(seen.state).navigationGraph;
 assert.ok(projected.nodes.some(n=>n.id==='/other-10'));assert.ok(!projected.nodes.some(n=>n.id==='/other-1'));
 assert.equal(projected.nodes.find(n=>n.id==='/details').guards[0].expression,'signedIn');
 assert.ok(projected.nodes.some(n=>n.id==='/login'));assert.equal(projected.registrations[0].guards[0].expression,'loginAvailable');
 assert.equal(projected.coverage,'partial-static-source');
});
test('retrieved unresolved candidates and file-selected owners retain their guarded dependencies',async()=>{
 const g=graph();g.edges=[];
 g.nodes.push({...node('/(admin)/details'),guards:[{expression:'isAdmin',truthy:true}]},node('/(user)/details'),node('/shared-owner'),node('/login'));
 g.unresolved=[{owner:'/',label:'Details',method:'push',reason:'ambiguous-route',candidates:['/(admin)/details','/(user)/details'],source:{file:'shared.tsx'}},
  {owner:'/shared-owner',label:null,method:'back',reason:'history-dependent',source:{file:'shared.tsx'}}];
 g.registrations=[{to:'/(admin)/details',guards:[{expression:'adminEnabled',truthy:true}]}];
 g.edges.push({owner:'/(admin)/details',from:'/(admin)/details',to:'/login',kind:'redirect'});
 let seen;const r=await decideAction({task,observation,graph:g,ask:async q=>{seen=q;return answer(q);}});
 assert.equal(r.via,'tev1');const projected=JSON.parse(seen.state).navigationGraph;
 assert.equal(projected.nodes.find(n=>n.id==='/(admin)/details')?.guards[0]?.expression,'isAdmin');
 assert.ok(projected.nodes.some(n=>n.id==='/(user)/details'));assert.ok(projected.nodes.some(n=>n.id==='/shared-owner'));assert.ok(projected.nodes.some(n=>n.id==='/login'));
 assert.equal(projected.registrations[0]?.guards[0].expression,'adminEnabled');
});
