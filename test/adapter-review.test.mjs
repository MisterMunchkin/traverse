import test from 'node:test';
import './support/isolated-approval-state.mjs';
import {EventEmitter} from 'node:events';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inspectProject} from '../src/project.mjs';
import {extractNavigationSource} from '../src/source/navigation.mjs';
import {createRequest,referenceArtifact,artifactHash} from '../src/extractor-pipeline/pipeline.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
function fixture(t){const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'wayfinder-adapter-review-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));for(const n of ['package.json','package-lock.json','app.json','tsconfig.json','node_modules/expo/package.json','node_modules/expo-router/package.json']){const dest=path.join(dir,n);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,'examples/expo',n),dest);}fs.mkdirSync(path.join(dir,'app'));fs.writeFileSync(path.join(dir,'app/index.tsx'),'export default()=>null');return dir;}
for(const config of ["module.exports={plugins:['expo-router'],get plugins(){return [['expo-router',{root:process.env.ROOT}]]}}","module.exports={plugins:['expo-router'],['plugins']:unknown}","module.exports={expo:{plugins:['expo-router']},expo:{plugins:[['expo-router',{root:'src/app'}]]}}","module.exports={plugins:['expo-router'],plugins:unknown}"]){test('ambiguous exported routing properties fail before publication: '+config.slice(0,65),t=>{const project=fixture(t);fs.unlinkSync(path.join(project,'app.json'));fs.writeFileSync(path.join(project,'app.config.js'),config);assert.throws(()=>inspectProject(project),/ambiguous|duplicate|computed|accessor|static|dynamic/i);assert.equal(fs.existsSync(path.join(project,'.wayfinder')),false);});}
test('overlapping alias prefixes choose the most specific target in either key order',()=>{
 const files={'app/index.tsx':"import Menu from '@/ui/menu';export default()=> <Menu/>",'app/checkout.tsx':'export default()=>null','app/wrong.tsx':'export default()=>null','components/menu.tsx':"import {Link} from 'expo-router';export default()=> <Link href='/checkout'/>",'src/ui/menu.tsx':"import {Link} from 'expo-router';export default()=> <Link href='/wrong'/>"};
 const entries=[['@/*',['./src/*']],['@/ui/*',['./components/*']]];const graphs=[entries,[...entries].reverse()].map(e=>extractNavigationSource(files,{aliases:Object.fromEntries(e)}));
 for(const g of graphs){assert.deepEqual(g.edges.map(e=>[e.from,e.to,e.source.file]),[['/','/checkout','components/menu.tsx']]);}assert.deepEqual(graphs[0],graphs[1]);
});
test('a static root-app project with a nonlegacy alias reaches profile2 without dummy config',t=>{
 const project=fixture(t);fs.writeFileSync(path.join(project,'tsconfig.json'),JSON.stringify({extends:'expo/tsconfig.base',compilerOptions:{paths:{'@/*':['./src/*']}}}));assert.equal(inspectProject(project).config.profile,'expo-source-inventory/2');
});
for(const conflict of ['graph-directory','unowned-extractor','settings-lock','agents-lock','readonly-root-ignore','readonly-local-ignore'])test('known publication conflict preserves public state: '+conflict,t=>{
 const project=fixture(t);fs.writeFileSync(path.join(project,'metro.config.js'),'// select real-project profile');
 const artifact=referenceArtifact(createRequest(inspectProject(project).spec)),file=path.join(project,'candidate.json');fs.writeFileSync(file,JSON.stringify(artifact));fs.mkdirSync(path.join(project,'.wayfinder'),{recursive:true});
 if(conflict==='graph-directory')fs.mkdirSync(path.join(project,'.wayfinder/graph.json'));
 if(conflict==='unowned-extractor'){fs.mkdirSync(path.join(project,'.wayfinder/extractor'));fs.writeFileSync(path.join(project,'.wayfinder/extractor/keep'),'owned by user');}
 if(conflict.startsWith('readonly-')){const name=conflict==='readonly-root-ignore'?'.gitignore':'.wayfinder/.gitignore';fs.writeFileSync(path.join(project,name),conflict==='readonly-root-ignore'?'# keep user ignore\n':'# Wayfinder portable project artifacts\n*\n!/.gitignore\n!/project.json\n!/graph.json\n!/extractor/\n!/extractor/**\n');fs.chmodSync(path.join(project,name),0o444);}
 const beforeIgnores=Object.fromEntries(['.gitignore','.wayfinder/.gitignore'].map(n=>[n,fs.existsSync(path.join(project,n))?fs.readFileSync(path.join(project,n),'utf8'):null]));
 if(conflict.endsWith('-lock')){fs.mkdirSync(path.join(project,'.wayfinder/local'),{recursive:true});fs.writeFileSync(path.join(project,'.wayfinder/local',conflict.replace('-lock','.lock')),'existing owner');}
 const args=['init','--adapter',file,'--trust-adapter',artifactHash(artifact),'--provider','codex','--model','gpt-6.1-sol','--effort','medium',...(conflict==='agents-lock'?['--agents','shared']:[]),'--json'];
 const result=spawnSync(process.execPath,[path.join(root,'bin/traverse.mjs'),...args],{cwd:project,encoding:'utf8',timeout:30000});assert.equal(result.status,1,result.stdout+result.stderr);assert.equal(result.signal,null);assert.equal(JSON.parse(result.stdout).ready,false);
 for(const name of ['.gitignore','.wayfinder/project.json','.wayfinder/extractor/artifact.json','.wayfinder/settings.json','AGENTS.md'])if(name!=='.gitignore'||beforeIgnores[name]===null)assert.equal(fs.existsSync(path.join(project,name)),false,`unexpected write: ${name}`);
 for(const [name,before]of Object.entries(beforeIgnores))if(before!==null)assert.equal(fs.readFileSync(path.join(project,name),'utf8'),before);
});

for(const [aliasRoot,rebuildsStream]of [['ui',false],['features/ui',false],['features/ui',true],['ui',true]])test('watch notices a formerly absent alias source root '+aliasRoot+(rebuildsStream?' with shared native stream recreation':'')+' and refreshes navigation without authoring',async t=>{
 const project=fixture(t);if(aliasRoot.includes('/'))fs.mkdirSync(path.join(project,'features'));fs.writeFileSync(path.join(project,'tsconfig.json'),JSON.stringify({extends:'expo/tsconfig.base',compilerOptions:{paths:{'@ui/*':['./'+aliasRoot+'/*']}}}));fs.writeFileSync(path.join(project,'app/index.tsx'),"import Menu from '@ui/menu';export default()=> <Menu/>");fs.writeFileSync(path.join(project,'app/checkout.tsx'),'export default()=>null');
 const artifact=referenceArtifact(createRequest(inspectProject(project).spec)),file=path.join(project,'candidate.json');fs.writeFileSync(file,JSON.stringify(artifact));
 const r=spawnSync(process.execPath,[path.join(root,'bin/traverse.mjs'),'init','--adapter',file,'--trust-adapter',artifactHash(artifact),'--json'],{cwd:project,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+r.stderr);
 let streamEpoch=0;const subscriptions=new Map();
 // Model the shared native stream restarting from now when subscriptions change.
 if(rebuildsStream)t.mock.method(fs,'watch',(dir,options,callback)=>{streamEpoch++;const watcher=new EventEmitter();watcher.close=()=>{streamEpoch++;subscriptions.delete(dir);};subscriptions.set(dir,{options,callback,watcher});return watcher;});
 const {watchGraph}=await import('../src/graph.mjs'),controller=new AbortController();let created=false,found=false;const timer=setTimeout(()=>controller.abort(),15000);t.after(()=>clearTimeout(timer));
 await watchGraph({project,signal:controller.signal,debounceMs:20,onEvent:event=>{if(!event.ready)return;if(!created){created=true;fs.mkdirSync(path.join(project,aliasRoot));fs.writeFileSync(path.join(project,aliasRoot+'/menu.tsx'),"import {Link} from 'expo-router';export default()=> <Link href='/checkout'/>");
 if(rebuildsStream){const epoch=streamEpoch;setImmediate(()=>{if(streamEpoch!==epoch)return;for(const [dir,{options,callback}]of subscriptions){const name=path.relative(dir,path.join(project,aliasRoot,'menu.tsx'));if(!name.startsWith('..')&&(options.recursive||!name.includes(path.sep)))callback('rename',name);}});}
 }else{const graph=JSON.parse(fs.readFileSync(path.join(project,'.wayfinder/graph.json')));if(graph.inventory.edges.some(e=>e.source.file===aliasRoot+'/menu.tsx'&&e.to==='/checkout')){found=true;assert.equal(event.authorCalls,0);controller.abort();}}}});clearTimeout(timer);assert.equal(found,true,'watch missed new alias source directory');if(rebuildsStream)assert.equal(subscriptions.size,0,'source subscriptions survive abort');
});

test('unchanged read-only ignore files do not block a compatible init rerun',t=>{
 const project=fixture(t),cli=path.join(root,'bin/traverse.mjs');let result=spawnSync(process.execPath,[cli,'init','--json'],{cwd:project,encoding:'utf8',timeout:30000});assert.equal(result.status,0,result.stdout);
 const names=['.gitignore','.wayfinder/.gitignore'],before=Object.fromEntries(names.map(n=>[n,fs.readFileSync(path.join(project,n),'utf8')]));for(const n of names)fs.chmodSync(path.join(project,n),0o444);
 result=spawnSync(process.execPath,[cli,'init','--json'],{cwd:project,encoding:'utf8',timeout:30000});assert.equal(result.status,0,result.stdout+result.stderr);for(const n of names)assert.equal(fs.readFileSync(path.join(project,n),'utf8'),before[n]);
});
