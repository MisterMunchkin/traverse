import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createFrontier, createStructuredAgent} from '../src/frontier/provider.mjs';
import {providerFixture} from './support/provider-fixture.mjs';
const request={options:[{id:'c0',description:'Save'}],responseSchema:{type:'object',properties:{pick:{type:'string',enum:['c0','none']}},required:['pick'],additionalProperties:false}};
for(const mode of ['structured-success','structured-auxiliary']) test(`Claude ${mode} accepts schema transport and retains usage identity`,async t=>{
 const f=providerFixture(t,'claude',mode),frontier=await createFrontier({settings:f.profile,directory:path.join(f.dir,'receipts'),env:f.env});
 const result=await frontier(request);
 assert.equal(result.pick,'c0');assert.equal(result.identity.observed.model,f.profile.model);
 if(mode==='structured-auxiliary'){
  assert.equal(result.reportedModelUsage['claude-haiku-5-5'].inputTokens,7);
  assert.equal(result.identity.auxiliaryUsageProvenance,'unknown');
  assert.equal(result.usage.inputTokens,null); // mixed accounting is not decision-model usage
 }
});
for(const mode of ['structured-tool','structured-conflict','structured-duplicate','structured-inventory','structured-mcp','structured-wrong-model','structured-missing-model','structured-extra-field','structured-wrong-type']) test(`Claude rejects ${mode}`,async t=>{
 const f=providerFixture(t,'claude',mode),frontier=await createFrontier({settings:f.profile,directory:path.join(f.dir,'receipts'),env:f.env});
 await assert.rejects(frontier(request));
});
test('unsupported response schema constraints fail closed',async t=>{
 const f=providerFixture(t,'claude'),frontier=await createFrontier({settings:f.profile,directory:path.join(f.dir,'receipts'),env:f.env});
 await assert.rejects(frontier({...request,responseSchema:{...request.responseSchema,properties:{pick:{type:'string',pattern:'^c0$'}}}}),/schema/i);
});
test('nested structured author output validates every array item',async t=>{
 const f=providerFixture(t,'claude','structured-success'),operation=await createStructuredAgent({settings:f.profile,directory:path.join(f.dir,'receipts'),env:f.env,instructions:'Return files only.'});
 const responseSchema={type:'object',properties:{files:{type:'array',items:{type:'object',properties:{path:{type:'string'},source:{type:'string'}},required:['path','source'],additionalProperties:false}}},required:['files'],additionalProperties:false};
 const result=await operation({schema:'wayfinder-adapter-author/1',responseSchema,request:{requirements:{artifactTemplate:{files:{'index.mjs':'export default {}'}}}}});
 assert.deepEqual(result.files,[{path:'index.mjs',source:'export default {}'}]);
});
test('nested output validation rejects wrong types, extra keys and missing fields',async()=>{
 const {validateResponseSchema,validateStructuredOutput}=await import('../src/frontier/structured-output.mjs');
 const schema={type:'object',properties:{files:{type:'array',items:{type:'object',properties:{path:{type:'string'},source:{type:'string'}},required:['path','source'],additionalProperties:false}}},required:['files'],additionalProperties:false};
 validateResponseSchema(schema);
 for(const value of [{files:[{path:'x',source:1}]},{files:[{path:'x',source:'s',extra:true}]},{files:[{path:'x'}]},{files:'bad'}]) assert.throws(()=>validateStructuredOutput(value,schema),/Structured/);
});
