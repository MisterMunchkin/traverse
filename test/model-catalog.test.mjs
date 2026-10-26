import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {providerFixture} from './support/provider-fixture.mjs';
import {discoverModels,normalizeModels} from '../src/frontier/models.mjs';
import {setupWizard} from '../src/setup-wizard.mjs';
import {createFrontier} from '../src/frontier/provider.mjs';
import {effortChoices,validateSettings,SETTINGS_SCHEMA,DRIVING_DEFAULTS} from '../src/settings.mjs';

const codexRows=[{model:'gpt-new-sol',displayName:'Sol',defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'ultra'}]},{model:'gpt-new-astra',displayName:'Astra',hidden:true,defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high'}]}];
const claudeRows=[{value:'default',resolvedModel:'claude-new-opus',displayName:'Default',supportsEffort:true,supportedEffortLevels:['high','max']},{value:'opus',resolvedModel:'claude-new-opus',displayName:'Opus',supportedEffortLevels:['high','max']},{value:'haiku',resolvedModel:'claude-haiku-4-5-20251001',displayName:'Haiku'},{value:'opusplan',displayName:'Switching mode'}];
test('catalog normalizes all exact models, resolves aliases and deduplicates without a family allowlist',()=>{
 const catalog=normalizeModels('claude',claudeRows);assert.deepEqual(catalog.models.map(m=>m.id),['claude-new-opus','claude-haiku-4-5-20251001']);assert.equal(catalog.unresolved,1);
 assert.deepEqual(effortChoices({provider:'claude',model:'claude-new-opus'},catalog.models),['high','max']);assert.deepEqual(effortChoices({provider:'claude',model:'claude-haiku-4-5-20251001'},catalog.models),['default']);
 const codex=normalizeModels('codex',codexRows);assert.deepEqual(effortChoices({provider:'codex',model:'gpt-new-sol'},codex.models),['medium','ultra']);assert.equal(codex.models[1].hidden,true);
 assert.throws(()=>normalizeModels('codex',[{model:'--bad'}]),/model ID/);assert.throws(()=>normalizeModels('claude',[{value:'claude-new',supportedEffortLevels:['--oops']}]),/effort/);
 assert.equal(validateSettings({schema:SETTINGS_SCHEMA,frontier:{provider:'codex',model:'gpt-new',effort:'ultra'},driving:DRIVING_DEFAULTS}).frontier.effort,'ultra');
});
for(const provider of ['codex','claude'])test(`${provider} metadata discovery sends no generation and strips conflicting provider variables`,async t=>{
 const f=providerFixture(t,provider,provider==='codex'?'catalog-pages':'success',{catalog:provider==='codex'?codexRows:claudeRows});
 const result=await discoverModels(provider,{env:f.env});assert.equal(result.models.length,2);const calls=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse);assert.deepEqual(calls[0].envKeys,[]);
 assert.ok(!calls.some(c=>['thread/start','turn/start'].includes(c.method)));
 if(provider==='codex'){const pages=calls.filter(c=>c.method==='model/list');assert.equal(pages.length,2);assert.equal(pages[0].params.includeHidden,true);assert.equal(pages[1].params.cursor,'page2');}
 else assert.ok(calls[0].args.includes('--input-format'));
 assert.throws(()=>process.kill(Number(fs.readFileSync(f.pid)),0),{code:'ESRCH'});
});
for(const provider of ['codex','claude'])test(`${provider} discovery deadline and cancellation reap the metadata process`,async t=>{
 for(const kind of ['deadline','cancel']){
  const f=providerFixture(t,provider,'catalog-hang'),controller=new AbortController();
  const pending=discoverModels(provider,{env:f.env,timeoutMs:kind==='deadline'?2000:5000,signal:controller.signal});pending.catch(()=>{});
  if(kind==='cancel'){const until=Date.now()+3000;while(!fs.existsSync(f.pid)&&Date.now()<until)await new Promise(r=>setTimeout(r,10));assert.equal(fs.existsSync(f.pid),true);controller.abort();}
  await assert.rejects(pending,kind==='cancel'?/CANCELLED/:/Could not load/);
  assert.equal(fs.existsSync(f.pid),true,`${kind}: fixture reached metadata processing`);
  const pid=Number(fs.readFileSync(f.pid)),reapDeadline=Date.now()+1000;
  while(Date.now()<reapDeadline){try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')break;throw e;}await new Promise(r=>setTimeout(r,10));}
  assert.throws(()=>process.kill(pid,0),{code:'ESRCH'},`${kind}: owned child reaped within cleanup allowance`);
 }
});
test('discovery rejects repeated pagination and unsolicited Claude tools',async t=>{
 for(const [provider,mode] of [['codex','catalog-loop'],['claude','catalog-tool']]){const f=providerFixture(t,provider,mode);await assert.rejects(discoverModels(provider,{env:f.env,timeoutMs:2000}),/Could not load|Invalid.*protocol/);}
});

function terminal(){
 const input=new PassThrough();input.isRaw=false;input.setRawMode=value=>{input.isRaw=value;};const output=new PassThrough();let text='';output.on('data',chunk=>text+=chunk);
 return {input,output,get text(){return text;},key(name,text='',extra={}){input.emit('keypress',text,{name,...extra});}};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('wizard selects Astra and its effort, preserves it on back and returns only after save',async()=>{
 const t=terminal();let calls=0;const run=setupWizard(null,{...t,loadModels:async provider=>{calls++;assert.equal(provider,'codex');return normalizeModels(provider,codexRows);}});
 t.key('return');await tick();assert.match(t.text,/gpt-new-astra/);assert.match(t.text,/gpt-new-sol/);
 // The old default ID is retained as a manual-compatible third row; choose Astra.
 t.key('up');t.key('return');assert.match(t.text,/Reasoning effort/);t.key('escape');assert.match(t.text,/› Astra · gpt-new-astra/);t.key('return');t.key('return');
 t.key('return');t.key('return');t.key('return');t.key('return');const result=await run;
 assert.equal(result.frontier.model,'gpt-new-astra');assert.equal(result.frontier.effort,'high');assert.equal(calls,1);assert.equal(t.input.isRaw,false);
});
test('wizard selects Claude no-effort models and uses the exact resolved ID',async()=>{
 const t=terminal(),run=setupWizard(null,{...t,loadModels:async provider=>normalizeModels(provider,claudeRows)});
 t.key('down');t.key('return');await tick();assert.match(t.text,/claude-new-opus/);assert.match(t.text,/claude-haiku-4-5-20251001/);
 t.key('up');t.key('return');assert.match(t.text,/Provider default \(no effort override\)/);t.key('return');t.key('return');t.key('return');t.key('return');t.key('return');const result=await run;
 assert.equal(result.frontier.provider,'claude');assert.equal(result.frontier.model,'claude-haiku-4-5-20251001');assert.equal(result.frontier.effort,'default');
});
test('wizard failed discovery permits manual exact-ID entry and preserves its draft on back',async()=>{
 const t=terminal(),run=setupWizard(null,{...t,loadModels:async()=>{throw Error('CLI unavailable; enter manually');}});
 t.key('return');await tick();assert.match(t.text,/CLI unavailable/);t.key('down');t.key('return');t.key('u','',{ctrl:true});for(const c of 'gpt-future')t.key(c,c);t.key('return');t.key('escape');assert.match(t.text,/› gpt-future/);
 t.key('return');t.key('return');t.key('return');t.key('return');t.key('return');t.key('return');assert.equal((await run).frontier.model,'gpt-future');
});
test('wizard cancel waits for discovery cleanup and restores input without returning settings',async()=>{
 const t=terminal();let cleaned=false;const run=setupWizard(null,{...t,loadModels:(_provider,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>setImmediate(()=>{cleaned=true;reject(Error('CANCELLED'));}),{once:true}))});
 t.key('return');await tick();t.key('c','',{ctrl:true});await assert.rejects(run,/cancelled/);assert.equal(cleaned,true);assert.equal(t.input.isRaw,false);
});

test('Claude non-effort models omit --effort and retain exact inference provenance',async t=>{
 const model='claude-haiku-4-5-20251001',f=providerFixture(t,'claude','success',{model,effort:'default',catalog:[{value:'haiku',resolvedModel:model,displayName:'Haiku'}]});
 const frontier=await createFrontier({settings:f.profile,directory:path.join(f.dir,'evidence'),env:f.env});
 const result=await frontier({options:[{id:'c0',description:'Save'}],responseSchema:{type:'object',properties:{pick:{type:'string'}},required:['pick'],additionalProperties:false}});
 assert.equal(result.pick,'c0');assert.equal(result.identity.requested.effort,'default');assert.equal(result.identity.observed.model,model);assert.equal(result.identity.effortVerified,false);
});

test('Codex provider default resolves its catalog effort and attests the exact model',async t=>{
 const f=providerFixture(t,'codex'),frontier=await createFrontier({settings:{...f.profile,effort:'default'},directory:path.join(f.dir,'evidence'),env:f.env});
 const result=await frontier({options:[{id:'c0',description:'Save'}],responseSchema:{type:'object',properties:{pick:{type:'string'}},required:['pick'],additionalProperties:false}});
 assert.equal(result.identity.requested.effort,'default');assert.equal(result.identity.observed.effort,'medium');assert.equal(result.identity.effortVerified,true);
});
test('Claude advertised incompatible effort fails before any generation',async t=>{
 const f=providerFixture(t,'claude','success',{catalog:[{value:'opus',resolvedModel:'claude-opus-5-5',supportedEffortLevels:['low']}]});
 await assert.rejects(createFrontier({settings:f.profile,directory:path.join(f.dir,'evidence'),env:f.env}),/does not support.*effort/);
 const calls=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse);assert.ok(calls.every(c=>!c.args||c.args.includes('--input-format')));
});
test('wizard Escape cancels a loading catalog, returns to provider and permits another selection',async()=>{
 const t=terminal();let cleaned=false;
 const run=setupWizard(null,{...t,loadModels:(provider,{signal})=>provider==='codex'?new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{cleaned=true;reject(Error('CANCELLED'));},{once:true})):Promise.resolve(normalizeModels('claude',claudeRows))});
 t.key('return');await tick();t.key('escape');t.key('down');t.key('return');await tick();assert.equal(cleaned,true);assert.match(t.text,/claude-new-opus/);t.key('c','',{ctrl:true});await assert.rejects(run,/cancelled/);
});

test('manual Claude exact-ID inference works without metadata and still rejects a changed model',async t=>{
 for(const mode of ['catalog-unavailable','catalog-unavailable-wrong-model']){
  const f=providerFixture(t,'claude',mode),frontier=await createFrontier({settings:f.profile,directory:path.join(f.dir,'evidence'),env:f.env});
  const pending=frontier({options:[{id:'c0',description:'Save'}],responseSchema:{type:'object',properties:{pick:{type:'string'}},required:['pick'],additionalProperties:false}});
  if(mode.endsWith('wrong-model'))await assert.rejects(pending,/model/);
  else{const result=await pending;assert.equal(result.identity.observed.model,f.profile.model);assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'evidence/provider.json'))).catalog.available,false);}
 }
});
test('manual Claude cannot bypass tool requests during metadata discovery',async t=>{
 const f=providerFixture(t,'claude','catalog-tool');await assert.rejects(createFrontier({settings:f.profile,directory:path.join(f.dir,'evidence'),env:f.env}),/model|catalog/i);
 const calls=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse);assert.ok(calls.every(c=>!c.args||c.args.includes('--input-format')));
});

test('manual Claude fails closed on present malformed metadata and unsafe output even after nonzero exit',async t=>{
 for(const [mode,catalog] of [['success',{}],['catalog-null',null],['catalog-tool-nonzero',undefined],['catalog-invalid-nonzero',[{value:'claude-opus-5-5',supportedEffortLevels:['--bad']}]]]){
  const f=providerFixture(t,'claude',mode,{catalog});
  await assert.rejects(createFrontier({settings:f.profile,directory:path.join(f.dir,'evidence'),env:f.env}),e=>e.code==='CATALOG_UNSAFE');
  const calls=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse);assert.ok(calls.every(c=>!c.args||c.args.includes('--input-format')));
 }
});
