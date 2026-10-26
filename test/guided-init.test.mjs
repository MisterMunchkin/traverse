import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {drivingFixture, packageRoot} from './support/driving-fixture.mjs';

const cli=path.join(packageRoot,'bin/traverse.mjs');
const preferences=['--provider','codex','--model','gpt-6.1-sol','--effort','high','--policy','frontier','--max-steps','3','--timeout-ms','95000'];
const settings=f=>path.join(f.project,'.wayfinder/settings.json');
function run(f,args,code=0){
 const result=spawnSync(process.execPath,[cli,...args],{cwd:f.project,env:{...process.env,HOME:path.join(f.root,'home'),NO_COLOR:'1',TERM:'dumb'},encoding:'utf8',timeout:30000});
 assert.equal(result.status,code,result.stdout+result.stderr);assert.equal(result.signal,null);assert.equal(result.stderr,'');return JSON.parse(result.stdout);
}
function owned(f){return Object.fromEntries(['.gitignore','.wayfinder/.gitignore','.wayfinder/project.json','.wayfinder/graph.json','.wayfinder/settings.json'].map(name=>[name,fs.existsSync(path.join(f.project,name))?fs.readFileSync(path.join(f.project,name),'utf8'):null]));}

test('init configures graph and explicit project defaults in one call without launching tools',t=>{
 const f=drivingFixture(t),r=run(f,['init',...preferences,'--json']);
 assert.equal(r.schema,'wayfinder-init/2');assert.equal(r.ready,true);assert.equal(r.graph.ready,true);assert.equal(r.settingsFile,settings(f));
 assert.deepEqual(JSON.parse(fs.readFileSync(settings(f))),{schema:'wayfinder-settings/1',frontier:{provider:'codex',model:'gpt-6.1-sol',effort:'high'},driving:{policy:'frontier',maxSteps:3,timeoutMs:95000}});
 assert.equal(fs.existsSync(path.join(f.root,'home')),false);assert.equal(fs.existsSync(f.log),false);
});

test('init reruns preserve unchanged bytes and update defaults without losing unrelated settings',t=>{
 const f=drivingFixture(t);run(f,['init',...preferences,'--json']);
 const value=JSON.parse(fs.readFileSync(settings(f)));value.editor={theme:'custom'};fs.writeFileSync(settings(f),JSON.stringify(value,null,4)+'\n');const before=owned(f);
 const same=run(f,['init',...preferences,'--json']);assert.equal(same.settingsChanged,false);assert.deepEqual(owned(f),before);
 const updated=run(f,['init','--effort','max','--json']);assert.equal(updated.settingsChanged,true);assert.equal(updated.settings.frontier.effort,'max');assert.deepEqual(updated.settings.editor,{theme:'custom'});
 const after=owned(f);for(const name of ['.gitignore','.wayfinder/.gitignore','.wayfinder/project.json','.wayfinder/graph.json'])assert.equal(after[name],before[name]);
});

test('init previews and checks never create configuration or preferences',t=>{
 const f=drivingFixture(t),before=owned(f);const preview=run(f,['init',...preferences,'--dry-run','--json']);
 assert.equal(preview.mode,'dry-run');assert.equal(preview.settings.frontier.effort,'high');assert.deepEqual(owned(f),before);assert.equal(fs.existsSync(path.join(f.project,'.wayfinder')),false);
 run(f,['init','--check','--json'],1);assert.deepEqual(owned(f),before);
 run(f,['init',...preferences,'--json']);const saved=owned(f);const check=run(f,['init','--check','--json']);assert.equal(check.settings.frontier.effort,'high');assert.deepEqual(owned(f),saved);
});

test('init refuses incomplete or conflicting preference inputs before any fresh project write',t=>{
 for(const args of [['--provider','codex'],[...preferences,'--max-steps','0'],[...preferences,'--check'],[...preferences,'--no-interactive'],[...preferences,'--cache-dir','/unused']]){
  const f=drivingFixture(t),before=owned(f);const r=run(f,['init',...args,'--json'],1);assert.equal(r.ready,false);assert.deepEqual(owned(f),before);assert.equal(fs.existsSync(path.join(f.project,'.wayfinder')),false);
 }
});

test('graph-only scripted init remains supported and compatibility setup still updates defaults',t=>{
 const f=drivingFixture(t);const first=run(f,['init','--no-interactive','--json']);assert.equal(first.ready,true);assert.equal(fs.existsSync(settings(f)),false);
 const graph=fs.readFileSync(path.join(f.project,'.wayfinder/graph.json'));const legacy=run(f,['setup','--project','.',...preferences,'--json']);assert.equal(legacy.schema,'wayfinder-project-setup/1');assert.equal(legacy.settings.frontier.effort,'high');assert.deepEqual(fs.readFileSync(path.join(f.project,'.wayfinder/graph.json')),graph);
});
