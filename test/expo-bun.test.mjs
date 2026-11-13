import test from 'node:test';
import './support/isolated-approval-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {inspectProject} from '../src/project.mjs';
import {extractNavigationSource} from '../src/source/navigation.mjs';
import {compatibility,validateGraph} from '../src/extractor-pipeline/contract.mjs';
import {conformanceCases,conformanceFacts,extractionOptions} from '../src/extractor-pipeline/profiles.mjs';
import {createRequest,referenceArtifact,artifactHash} from '../src/extractor-pipeline/pipeline.mjs';
import {spawnSync} from 'node:child_process';
function fixture(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'traverse-bun55-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const deps={expo:'^55.0.0','expo-router':'~55.0.4'};
 const files={'package.json':{main:'expo-router/entry',dependencies:deps},'bun.lock':{lockfileVersion:1,configVersion:1,workspaces:{'':{name:'synthetic',dependencies:deps}},packages:{expo:['expo@55.0.5','',{},'sha512-fixture'], 'expo-router':['expo-router@55.0.4','',{},'sha512-fixture']}},'node_modules/expo/package.json':{name:'expo',version:'55.0.5'},'node_modules/expo-router/package.json':{name:'expo-router',version:'55.0.4'},'tsconfig.json':{extends:'expo/tsconfig.base',compilerOptions:{paths:{'@/*':['./*']}}},'app.json':{expo:{plugins:['expo-router']}}};
 for(const [name,value]of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),JSON.stringify(value));}
 fs.mkdirSync(path.join(root,'app'));fs.mkdirSync(path.join(root,'components'));
 fs.writeFileSync(path.join(root,'app/_layout.tsx'),"import {Stack} from 'expo-router';export default()=> <Stack><Stack.Screen name='detail' options={{presentation:'modal'}}/></Stack>");
 fs.writeFileSync(path.join(root,'app/index.tsx'),"import Menu from '@/components/menu';export default()=> <Menu/>;");
 fs.writeFileSync(path.join(root,'components/menu.tsx'),"import {router} from 'expo-router';export default()=> <Button label='Review' onPress={()=>router.push('/detail')}/>;");
 fs.writeFileSync(path.join(root,'app/detail.tsx'),"import {router} from 'expo-router';export default()=> <Button label='Back' onPress={()=>router.back()}/>;");
 fs.writeFileSync(path.join(root,'metro.config.js'),"throw Error('CONFIG-MUST-NOT-EXECUTE')");return root;
}
const change=(root,name,fn)=>{const f=path.join(root,name),value=JSON.parse(fs.readFileSync(f));fn(value);fs.writeFileSync(f,JSON.stringify(value));};
test('Expo55 Bun lock produces an explicit profile, real source graph and retained history uncertainty',t=>{const root=fixture(t),snapshot=inspectProject(root);assert.equal(snapshot.config.profile,'expo-bun-source-inventory/1');assert.equal(snapshot.config.framework.version,'55.0.4');assert.ok(snapshot.provenance.inputHashes['bun.lock']);assert.equal(snapshot.provenance.inputHashes['package-lock.json'],undefined);const g=extractNavigationSource(snapshot.spec.source.files,extractionOptions(compatibility(snapshot.spec)));validateGraph(g,snapshot.spec.source.files,extractionOptions(compatibility(snapshot.spec)));assert.deepEqual(g.nodes.map(n=>n.id).sort(),['/','/detail']);assert.deepEqual(g.edges.map(e=>[e.from,e.to,e.source.file]),[['/','/detail','components/menu.tsx']]);assert.equal(g.unresolved[0].reason,'history-dependent');assert.equal(fs.existsSync(path.join(root,'.wayfinder')),false);});
test('Bun JSONC trailing commas are parsed without executing source',t=>{const root=fixture(t),f=path.join(root,'bun.lock');fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace('"packages":','// generated lock\n"packages":').replace(/}$/,',}'));assert.equal(inspectProject(root).config.profile,'expo-bun-source-inventory/1');});
for(const [name,mutate]of [
 ['installed package differs from lock',r=>change(r,'node_modules/expo-router/package.json',p=>p.version='55.0.9')],
 ['lock declaration differs from package',r=>change(r,'bun.lock',p=>p.workspaces[''].dependencies.expo='^55.0.3')],
 ['unsupported framework version',r=>change(r,'package.json',p=>p.dependencies.expo='^56.0.0')],
 ['unsupported lock schema',r=>change(r,'bun.lock',p=>p.lockfileVersion=99)],
 ['ambiguous lockfiles',r=>fs.writeFileSync(path.join(r,'package-lock.json'),'{}')],
 ['ambiguous binary lock',r=>fs.writeFileSync(path.join(r,'bun.lockb'),'binary')],
])test(`Bun profile refuses ${name}`,t=>{const root=fixture(t);mutate(root);assert.throws(()=>inspectProject(root));assert.equal(fs.existsSync(path.join(root,'.wayfinder')),false);});
test('Expo55 profile passes pipeline-owned independent guard/alias/ambiguity fixtures',t=>{const snapshot=inspectProject(fixture(t)),compatible=compatibility(snapshot.spec);for(const f of conformanceCases(compatible)){const g=extractNavigationSource(f.files,extractionOptions(compatible));conformanceFacts(g,f);}});
test('reviewed Bun extractor initializes, checks, refreshes and marks source changes stale',t=>{const root=fixture(t),request=createRequest(inspectProject(root).spec),artifact=referenceArtifact(request),file=path.join(root,'adapter.json');fs.writeFileSync(file,JSON.stringify(artifact));const invoke=(args,exit=0)=>{const p=spawnSync(process.execPath,['bin/traverse.mjs',...args,'--project',root,'--json'],{encoding:'utf8',timeout:30000});assert.equal(p.status,exit,p.stdout+'\n'+p.stderr);return JSON.parse(p.stdout);};const untrusted=invoke(['init','--no-interactive','--adapter',file],1);assert.equal(untrusted.ready,false);assert.equal(fs.existsSync(path.join(root,'.wayfinder/project.json')),false);const ready=invoke(['init','--no-interactive','--adapter',file,'--trust-adapter',artifactHash(artifact)]);assert.equal(ready.ready,true);invoke(['graph','check']);fs.appendFileSync(path.join(root,'app/detail.tsx'),'\n// changed source');invoke(['graph','check'],1);invoke(['graph','refresh']);invoke(['graph','check']);});
