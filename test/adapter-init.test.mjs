import test from 'node:test';
import './support/isolated-approval-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectProject} from '../src/project.mjs';
import {extractNavigationSource} from '../src/source/navigation.mjs';
import * as presentation from '../src/presentation.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export function projectFixture(t,{src=false}={}){
 const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'wayfinder-adapter-')));t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
 for(const name of ['package.json','package-lock.json','tsconfig.json','node_modules/expo/package.json','node_modules/expo-router/package.json']){const dest=path.join(project,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,'examples/expo',name),dest);}
 const routeRoot=src?'src/app':'app';fs.mkdirSync(path.join(project,routeRoot),{recursive:true});
 fs.writeFileSync(path.join(project,routeRoot,'index.tsx'),`import {Link} from 'expo-router';export default()=> <Link href="/checkout"/>;`);
 fs.writeFileSync(path.join(project,routeRoot,'checkout.tsx'),'export default()=>null');
 fs.writeFileSync(path.join(project,'app.config.js'),`// Must never execute.\nthrow Error('CONFIG-MUST-NOT-EXECUTE');\nmodule.exports={name:process.env.PRIVATE_NAME,plugins:['expo-router']};`);
 fs.writeFileSync(path.join(project,'metro.config.js'),"throw Error('METRO-MUST-NOT-EXECUTE')");
 if(src)fs.writeFileSync(path.join(project,'tsconfig.json'),JSON.stringify({extends:'expo/tsconfig.base',compilerOptions:{paths:{'@/*':['./src/*']}}}));
 return project;
}
test('JavaScript Expo config is inspected statically without requiring app.json or evaluating configuration',t=>{
 const project=projectFixture(t),snapshot=inspectProject(project);
 assert.equal(snapshot.config.profile,'expo-source-inventory/2');assert.equal(snapshot.config.routing.conventions.routeRoot,'app');
 assert.ok(snapshot.provenance.inputHashes['app.config.js']);assert.ok(snapshot.provenance.inputHashes['metro.config.js']);
 assert.equal(JSON.stringify(snapshot.config).includes('PRIVATE_NAME'),false);assert.equal(fs.existsSync(path.join(project,'.wayfinder')),false);
});
test('src/app and alias-root navigation retain actual file provenance',t=>{
 const project=projectFixture(t,{src:true}),snapshot=inspectProject(project);
 const graph=extractNavigationSource(snapshot.spec.source.files,{routeRoot:'src/app',aliases:{'@/*':['./src/*']}});
 assert.deepEqual(graph.nodes.map(n=>n.id).sort(),['/','/checkout']);assert.equal(graph.edges.length,1);assert.equal(graph.edges[0].source.file,'src/app/index.tsx');
});
test('ambiguous dynamic router options require explicit static configuration before any writes',t=>{
 const project=projectFixture(t);fs.writeFileSync(path.join(project,'app.config.js'),"module.exports={plugins:[['expo-router',{root:process.env.ROUTE_ROOT}]]}");
 assert.throws(()=>inspectProject(project),/dynamic.*routing|routing.*static/i);assert.equal(fs.existsSync(path.join(project,'.wayfinder')),false);
});
test('loading stays plain in pipes, NO_COLOR, dumb terminals and JSON and stops on rejection',async()=>{
 assert.equal(typeof presentation.initProgress,'function');
 for(const env of [{NO_COLOR:'1'},{TERM:'dumb'},{CI:'1'}]){
  let output='';const progress=presentation.initProgress({stream:{isTTY:true,write:s=>{output+=s}},env});
  await assert.rejects(progress.run('Waiting for adapter',async()=>{throw Error('expected')}),/expected/);progress.close();
  assert.doesNotMatch(output,/\x1b|⠋|⠙/);assert.match(output,/Waiting for adapter/);
 }
 let output='';const progress=presentation.initProgress({json:true,stream:{isTTY:true,write:s=>{output+=s}},env:{}});await progress.run('Checking',async()=>{});progress.close();assert.equal(output,'');
});

const cli=path.join(root,'bin/traverse.mjs');
const {spawnSync}=await import('node:child_process');
const {providerFixture}=await import('./support/provider-fixture.mjs');
const {createRequest,referenceArtifact,artifactHash}=await import('../src/extractor-pipeline/pipeline.mjs');
function invoke(project,args,env=process.env,code=0){const r=spawnSync(process.execPath,[cli,'init',...args,'--json'],{cwd:project,env:{...env,NO_COLOR:'1'},encoding:'utf8',timeout:30000});assert.equal(r.status,code,r.stdout+r.stderr);assert.equal(r.signal,null);assert.equal(r.stderr,'');return JSON.parse(r.stdout);}
function published(project){return Object.fromEntries(['.gitignore','.wayfinder/project.json','.wayfinder/graph.json','.wayfinder/settings.json','.wayfinder/extractor/artifact.json','AGENTS.md'].map(n=>[n,fs.existsSync(path.join(project,n))?fs.readFileSync(path.join(project,n),'utf8'):null]));}
for(const provider of ['codex','claude'])test(`${provider} managed init authors, requires exact trust, pins and refreshes without author calls`,async t=>{
 const project=projectFixture(t,{src:true}),fake=providerFixture(t,provider),flags=Object.entries(fake.profile).flatMap(([k,v])=>['--'+k,v]),before=published(project);
 const first=invoke(project,flags,fake.env,1);assert.equal(first.ready,false);assert.equal(first.adapter.kind,'review-required');assert.equal(first.adapter.authorCalls,1);assert.deepEqual(published(project),before);
 const calls=fs.readFileSync(fake.log,'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(v=>v.author);assert.equal(calls.length,1);assert.equal(calls[0].author.schema,'wayfinder-adapter-author/1');assert.equal(JSON.stringify(calls).includes('PRIVATE_NAME'),false);
 const ready=invoke(project,[...flags,'--adapter',first.adapter.artifact,'--trust-adapter',first.adapter.artifactHash],fake.env);assert.equal(ready.ready,true);assert.equal(ready.adapter.authorCalls,0);
 const graph=JSON.parse(fs.readFileSync(path.join(project,'.wayfinder/graph.json')));assert.equal(graph.inventory.edges.length,1);assert.equal(graph.inventory.edges[0].source.file,'src/app/index.tsx');
 const saved=published(project);assert.equal(invoke(project,[],fake.env).adapter.authorCalls,0);assert.deepEqual(published(project),saved);
 fs.writeFileSync(path.join(project,'src/app/later.tsx'),'export default()=>null');
 const {refreshGraph}=await import('../src/graph.mjs');assert.equal((await refreshGraph({project})).authorCalls,0);
 assert.equal(fs.readFileSync(fake.log,'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(v=>v.author).length,1);
});
test('bounded tool-owned repair carries diagnostics and never executes the first candidate',t=>{
 const project=projectFixture(t),fake=providerFixture(t,'codex','adapter-repair'),flags=Object.entries(fake.profile).flatMap(([k,v])=>['--'+k,v]);
 const result=invoke(project,flags,fake.env,1);assert.equal(result.adapter.authorCalls,2);assert.equal(fs.existsSync(path.join(project,'.wayfinder/project.json')),false);
 const calls=fs.readFileSync(fake.log,'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(v=>v.author);assert.match(calls[1].author.previousDiagnostic,/relative/);assert.equal(fs.existsSync(path.join(project,'escape.mjs')),false);
});
test('wrong trust, unreviewed code and fabricated graph preserve project publication state',async t=>{
 const project=projectFixture(t),before=published(project),artifact=referenceArtifact(createRequest(inspectProject(project).spec));
 const file=path.join(project,'candidate.json');fs.writeFileSync(file,JSON.stringify(artifact));
 const unreviewed=invoke(project,['--adapter',file],process.env,1);assert.equal(unreviewed.adapter.kind,'review-required');assert.deepEqual(published(project),before);
 const wrong=invoke(project,['--adapter',file,'--trust-adapter','0'.repeat(64)],process.env,1);assert.match(wrong.error,/hash/);assert.deepEqual(published(project),before);
 artifact.files['extract.mjs']=`process.stdout.write(JSON.stringify({schema:'traverse-navigation',schemaVersion:1,nodes:[]}));`;fs.writeFileSync(file,JSON.stringify(artifact));
 const invalid=invoke(project,['--adapter',file,'--trust-adapter',artifactHash(artifact)],process.env,1);assert.equal(invalid.ready,false);assert.deepEqual(published(project),before);
});
test('read-only init and unsupported routers do not invoke a provider or create project state',t=>{
 const project=projectFixture(t),fake=providerFixture(t,'codex'),before=published(project);
 assert.equal(invoke(project,['--dry-run'],fake.env).ready,false);invoke(project,['--check'],fake.env,1);assert.deepEqual(published(project),before);assert.equal(fs.existsSync(fake.log),false);assert.equal(fs.existsSync(path.join(project,'.wayfinder')),false);
 const pkg=JSON.parse(fs.readFileSync(path.join(project,'package.json')));delete pkg.dependencies['expo-router'];pkg.dependencies['@tanstack/react-router']='1.0.0';fs.writeFileSync(path.join(project,'package.json'),JSON.stringify(pkg));
 const result=invoke(project,[],fake.env,1);assert.match(result.error,/conformance/);assert.equal(fs.existsSync(fake.log),false);assert.equal(fs.existsSync(path.join(project,'.wayfinder')),false);
});

test('normal large npm lockfiles have a separate bounded allowance from individual source files',t=>{
 const project=projectFixture(t),file=path.join(project,'package-lock.json'),lock=JSON.parse(fs.readFileSync(file));lock.fixturePadding='x'.repeat(1100000);fs.writeFileSync(file,JSON.stringify(lock));
 assert.equal(inspectProject(project).config.profile,'expo-source-inventory/2');
 fs.writeFileSync(file,' '.repeat(16*1024*1024+1));assert.throws(()=>inspectProject(project),/16 MiB/);assert.equal(fs.existsSync(path.join(project,'.wayfinder')),false);
});

test('conditional non-routing plugin branches do not require evaluating config, while conditional Router branches stay ambiguous',t=>{
 const project=projectFixture(t),file=path.join(project,'app.config.js');
 fs.writeFileSync(file,"module.exports={plugins:[...(process.env.TEST ? ['./plugins/one'] : [['./plugins/two',{secret:process.env.SECRET}]]),'expo-router']}");
 assert.equal(inspectProject(project).config.routing.conventions.routeRoot,'app');
 fs.writeFileSync(file,"module.exports={plugins:[...(process.env.TEST ? ['expo-router'] : []),'expo-router']}");assert.throws(()=>inspectProject(project),/conditional|dynamic/i);
 fs.writeFileSync(file,"module.exports={plugins:[...unknownPlugins,'expo-router']}");assert.throws(()=>inspectProject(project),/dynamic|static/i);
});

test('aborting managed authoring reaps its process and preserves public project state',async t=>{
 const project=projectFixture(t),fake=providerFixture(t,'codex','hang'),before=published(project),controller=new AbortController();
 const {prepareAdapter}=await import('../src/adapter-init.mjs');
 const pending=prepareAdapter({project,settings:{frontier:fake.profile},signal:controller.signal,env:fake.env,progress:presentation.initProgress({json:true})});pending.catch(()=>{});
 const deadline=Date.now()+5000;while(!fs.existsSync(fake.pid)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));assert.equal(fs.existsSync(fake.pid),true);controller.abort();
 await assert.rejects(pending,/CANCELLED|cancelled/);assert.throws(()=>process.kill(Number(fs.readFileSync(fake.pid)),0),{code:'ESRCH'});assert.deepEqual(published(project),before);
});
test('source changes during validation preserve the old graph and reject publication',async t=>{
 const project=projectFixture(t),artifact=referenceArtifact(createRequest(inspectProject(project).spec)),file=path.join(project,'candidate.json');fs.writeFileSync(file,JSON.stringify(artifact));
 invoke(project,['--adapter',file,'--trust-adapter',artifactHash(artifact)]);const before=published(project);
 const {prepareAdapter}=await import('../src/adapter-init.mjs');let edited=false;
 const progress={close(){},async run(_label,work){const result=await work();if(!edited){edited=true;fs.appendFileSync(path.join(project,'app/index.tsx'),'\n// concurrent source edit');}return result;}};
 await assert.rejects(prepareAdapter({project,progress}),/inputs changed/);assert.deepEqual(published(project),before);
});
test('a real waiting spinner stops writing after success and failure',async()=>{
 for(const fail of [false,true]){let output='';const progress=presentation.initProgress({stream:{isTTY:true,write:s=>{output+=s}},env:{TERM:'xterm'}});
  const work=progress.run('Actual wait',async()=>{await new Promise(r=>setTimeout(r,120));if(fail)throw Error('expected');});if(fail)await assert.rejects(work,/expected/);else await work;
  const stopped=output;await new Promise(r=>setTimeout(r,120));assert.equal(output,stopped);assert.match(output,/\x1b/);assert.match(output,/⠙/);progress.close();assert.equal(output,stopped);
 }
});
