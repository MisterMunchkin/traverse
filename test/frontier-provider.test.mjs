import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {drivingFixture,packageRoot} from './support/driving-fixture.mjs';
import {providerFixture as fixture} from './support/provider-fixture.mjs';
import {createFrontier} from '../src/frontier/provider.mjs';
const request={schema:'wayfinder-frontier-choice-request/1',goal:'Save',inputs:{},observationId:'observed',state:{observed:[],navigationGraph:{},history:[]},options:[{id:'c0',description:'Press Save'}],responseSchema:{type:'object',properties:{pick:{type:'string',enum:['c0','none']}},required:['pick'],additionalProperties:false}};
for(const provider of ['codex','claude']){
 test(`${provider} returns an offered choice and reported usage without exposing API keys`,async t=>{
  const f=fixture(t,provider),frontier=await createFrontier({settings:f.profile,directory:path.join(f.dir,'evidence'),env:f.env});const r=await frontier(request);
  assert.equal(r.pick,'c0');assert.equal(r.usage.inputTokens,50);assert.equal(r.usage.outputTokens,3);assert.equal(r.costUsd,null);assert.equal(r.identity.requested.model,f.profile.model);assert.equal(r.identity.observed.model,f.profile.model);
  const entries=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse);assert.deepEqual(entries[0].envKeys,[]);
  const evidence=fs.readdirSync(path.join(f.dir,'evidence/request-001')).filter(n=>n.endsWith('.json')||n.endsWith('.jsonl')).map(n=>fs.readFileSync(path.join(f.dir,'evidence/request-001',n),'utf8')).join('');assert.ok(!evidence.includes('must-not-log'));
  if(provider==='codex')assert.ok(entries.some(x=>x.method==='turn/start'&&x.params.effort==='medium'));
 });
 test(`${provider} rejects a changed model and unoffered choice`,async t=>{
  for(const mode of ['wrong-model','unoffered',...(provider==='codex'?['wrong-turn']:[])]){const f=fixture(t,provider,mode),frontier=await createFrontier({settings:f.profile,directory:path.join(f.dir,'evidence'),env:f.env});await assert.rejects(frontier(request),/model|offered|identity/i);}
 });
 test(`${provider} withheld response fails within its deadline and reaps its owned process`,async t=>{
  const f=fixture(t,provider,'hang'),frontier=await createFrontier({settings:f.profile,directory:path.join(f.dir,'evidence'),env:f.env,timeoutMs:500});await assert.rejects(frontier(request),/DEADLINE/);const pid=Number(fs.readFileSync(f.pid));assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
 });
}
test('Codex tool requests are rejected rather than executed',async t=>{
 const f=fixture(t,'codex','tool'),frontier=await createFrontier({settings:f.profile,directory:path.join(f.dir,'evidence'),env:f.env,timeoutMs:2000});await assert.rejects(frontier(request),/tool|approval/i);
});

for(const provider of ['codex','claude'])test(`saved ${provider} drives fill and save in one runner session without an external config`,t=>{
 const fake=fixture(t,provider),f=drivingFixture(t),cli=path.join(packageRoot,'bin/traverse.mjs');
 const run=(args,code=0)=>{const r=spawnSync(process.execPath,[cli,...args],{cwd:f.project,env:{...fake.env,HOME:path.join(f.root,'home'),NO_COLOR:'1'},encoding:'utf8',timeout:30000});assert.equal(r.status,code,r.stdout+r.stderr);return JSON.parse(r.stdout);};
 run(['init','--json']);run(['setup','--project','.',...Object.entries(fake.profile).flatMap(([k,v])=>['--'+k,v]),'--policy','frontier','--json']);
 const file=path.join(f.project,'.wayfinder/settings.json'),before=fs.readFileSync(file);
 const result=run(['drive','--task',f.task,'--session','saved-provider','--platform','web','--app','http://fixture','--agent-device',f.executable,'--json']);
 assert.equal(result.status,'verified');assert.equal(result.steps,2);assert.equal(result.accounting.frontierCalls,2);assert.equal(result.accounting.localCalls,0);assert.equal(result.accounting.frontierInputTokens,100);assert.equal(result.accounting.frontierOutputTokens,6);assert.equal(result.accounting.costUsd,null);
 assert.deepEqual(fs.readFileSync(file),before);assert.equal(result.preferences.frontier.provider,provider);
 const calls=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse).filter(c=>c.args.includes('--session'));assert.equal(new Set(calls.map(c=>c.args[c.args.indexOf('--session')+1])).size,1);
 assert.equal(calls.filter(c=>c.args[0]==='open').length,1);assert.equal(calls.filter(c=>c.args[0]==='close').length,1);
});
test('per-run provider flags never silently inherit another provider model',t=>{
 const fake=fixture(t,'codex'),f=drivingFixture(t),cli=path.join(packageRoot,'bin/traverse.mjs');
 const run=(args,code=0)=>{const r=spawnSync(process.execPath,[cli,...args],{cwd:f.project,env:{...fake.env,HOME:path.join(f.root,'home')},encoding:'utf8',timeout:30000});assert.equal(r.status,code,r.stdout+r.stderr);return JSON.parse(r.stdout);};
 run(['init','--json']);run(['setup','--project','.','--provider','codex','--model','gpt-6.1-sol','--effort','medium','--policy','frontier','--json']);const before=fs.readFileSync(path.join(f.project,'.wayfinder/settings.json'));
 const base=['drive','--task',f.task,'--session','override','--platform','web','--app','http://fixture','--agent-device',f.executable,'--json'];
 assert.match(run([...base,'--provider','claude'],1).error,/model.*effort/i);assert.equal(fs.existsSync(f.log),false);
 const success=run([...base,'--provider','codex','--model','gpt-6.1-sol','--effort','medium']);assert.equal(success.status,'verified');assert.deepEqual(fs.readFileSync(path.join(f.project,'.wayfinder/settings.json')),before);
});

for(const provider of ['codex','claude'])test(`${provider} cancellation reaps a pending frontier request`,async t=>{
 const f=fixture(t,provider,'hang'),controller=new AbortController(),frontier=await createFrontier({settings:f.profile,directory:path.join(f.dir,'evidence'),env:f.env,timeoutMs:5000});
 const pending=frontier({...request,signal:controller.signal});pending.catch(()=>{});
 const deadline=Date.now()+4000;while(!fs.existsSync(f.pid)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));assert.equal(fs.existsSync(f.pid),true);controller.abort();await assert.rejects(pending,/CANCELLED/);assert.throws(()=>process.kill(Number(fs.readFileSync(f.pid)),0),{code:'ESRCH'});
});
test('a per-run effort override reaches Codex without saving over project defaults',t=>{
 const fake=fixture(t,'codex','effort-high'),f=drivingFixture(t),cli=path.join(packageRoot,'bin/traverse.mjs');
 const run=args=>{const r=spawnSync(process.execPath,[cli,...args],{cwd:f.project,env:{...fake.env,HOME:path.join(f.root,'home')},encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+r.stderr);return JSON.parse(r.stdout);};
 run(['init','--json']);run(['setup','--project','.','--provider','codex','--model','gpt-6.1-sol','--effort','medium','--policy','frontier','--json']);const file=path.join(f.project,'.wayfinder/settings.json'),before=fs.readFileSync(file);
 const r=run(['drive','--task',f.task,'--session','effort-override','--platform','web','--app','http://fixture','--agent-device',f.executable,'--effort','high','--json']);assert.equal(r.status,'verified');assert.equal(r.preferences.frontier.effort,'high');assert.deepEqual(fs.readFileSync(file),before);
});

test('Claude rejects a non-first-party backend even with OAuth-shaped status',async t=>{
 const f=fixture(t,'claude','wrong-auth-provider');await assert.rejects(createFrontier({settings:f.profile,directory:path.join(f.dir,'evidence'),env:f.env}),/subscription|first.party/i);assert.equal(fs.existsSync(f.pid),false);
});
