import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {drivingFixture, packageRoot} from './support/driving-fixture.mjs';
const cli=path.join(packageRoot,'bin/traverse.mjs');
function run(f,args,code=0){const r=spawnSync(process.execPath,[cli,...args],{cwd:f.project,env:{...process.env,HOME:path.join(f.root,'home'),NO_COLOR:'1',TERM:'dumb'},encoding:'utf8',timeout:30000});assert.equal(r.status,code,r.stdout+r.stderr);assert.equal(r.signal,null);return r;}
const settings=f=>path.join(f.project,'.wayfinder/settings.json');
const configure=['setup','--project','.','--provider','codex','--model','gpt-6.1-sol','--effort','medium','--policy','frontier','--max-steps','1','--timeout-ms','90000','--json'];
test('project setup saves portable defaults without changing graph or installing a model',t=>{
 const f=drivingFixture(t);run(f,['init','--json']);const graph=fs.readFileSync(path.join(f.project,'.wayfinder/graph.json')),config=fs.readFileSync(path.join(f.project,'.wayfinder/project.json'));
 const r=JSON.parse(run(f,configure).stdout);assert.equal(r.schema,'wayfinder-project-setup/1');assert.equal(r.ready,true);assert.equal(r.settingsFile,settings(f));
 assert.deepEqual(JSON.parse(fs.readFileSync(settings(f))),{schema:'wayfinder-settings/1',frontier:{provider:'codex',model:'gpt-6.1-sol',effort:'medium'},driving:{policy:'frontier',maxSteps:1,timeoutMs:90000}});
 assert.deepEqual(fs.readFileSync(path.join(f.project,'.wayfinder/graph.json')),graph);assert.deepEqual(fs.readFileSync(path.join(f.project,'.wayfinder/project.json')),config);assert.equal(fs.existsSync(path.join(f.root,'home/.cache/wayfinder')),false);assert.equal(fs.existsSync(f.log),false);
});
test('project setup reruns preserve identical bytes and unrelated settings',t=>{
 const f=drivingFixture(t);run(f,['init','--json']);run(f,configure);const data=JSON.parse(fs.readFileSync(settings(f)));data.editor={theme:'custom'};fs.writeFileSync(settings(f),JSON.stringify(data,null,4)+'\n');const before=fs.readFileSync(settings(f));
 assert.equal(JSON.parse(run(f,configure).stdout).changed,false);assert.deepEqual(fs.readFileSync(settings(f)),before);
 const args=[...configure];args[args.indexOf('medium')]='high';run(f,args);assert.deepEqual(JSON.parse(fs.readFileSync(settings(f))).editor,{theme:'custom'});assert.equal(JSON.parse(fs.readFileSync(settings(f))).frontier.effort,'high');
});
test('project setup previews and noninteractive missing inputs leave settings absent',t=>{
 const f=drivingFixture(t);run(f,['init','--json']);const r=JSON.parse(run(f,[...configure,'--dry-run']).stdout);assert.equal(r.ready,false);assert.equal(r.mode,'dry-run');assert.equal(fs.existsSync(settings(f)),false);
 const missing=run(f,['setup','--project','.','--json'],1);assert.match(JSON.parse(missing.stdout).error,/provider.*model.*effort/i);assert.equal(fs.existsSync(settings(f)),false);
 const check=JSON.parse(run(f,['setup','--project','.','--check','--json'],1).stdout);assert.equal(check.ready,false);assert.equal(fs.existsSync(settings(f)),false);
});
test('project setup refuses bad limits, model flags and unowned or symlink settings before writing',t=>{
 for(const kind of ['limit','model','mixed','unowned','symlink']){
  const f=drivingFixture(t);run(f,['init','--json']);let args=[...configure];
  if(kind==='limit')args[args.indexOf('1')]='0';if(kind==='model')args[args.indexOf('gpt-6.1-sol')]='--dangerous';if(kind==='mixed')args.push('--cache-dir',path.join(f.root,'cache'));
  const original='{"unrelated":"preserve me"}';if(kind==='unowned')fs.writeFileSync(settings(f),original);if(kind==='symlink'){fs.writeFileSync(path.join(f.root,'keep.json'),original);fs.symlinkSync(path.join(f.root,'keep.json'),settings(f));}
  run(f,args,1);if(kind==='unowned'||kind==='symlink')assert.equal(fs.readFileSync(settings(f),'utf8'),original);else assert.equal(fs.existsSync(settings(f)),false);assert.equal(fs.existsSync(f.log),false);
 }
});
test('saved driving limits apply and explicit run flags override without rewriting defaults',t=>{
 const f=drivingFixture(t);run(f,['init','--json']);run(f,configure);const before=fs.readFileSync(settings(f));
 const args=['drive','--task',f.task,'--session','limited','--platform','web','--app','http://fixture','--frontier-config',f.config,'--agent-device',f.executable,'--json'];
 const limited=JSON.parse(run(f,args,1).stdout);assert.equal(limited.status,'step-limit');assert.equal(limited.policy,'frontier');assert.equal(limited.steps,1);
 const extended=[...args];extended[extended.indexOf('limited')]='extended';const complete=JSON.parse(run(f,[...extended,'--max-steps','3']).stdout);assert.equal(complete.status,'verified');assert.equal(complete.steps,2);assert.deepEqual(fs.readFileSync(settings(f)),before);
});
test('switching a saved provider requires its explicit model and effort',t=>{
 const f=drivingFixture(t);run(f,['init','--json']);run(f,configure);const before=fs.readFileSync(settings(f));
 const r=run(f,['setup','--project','.','--provider','claude','--json'],1);assert.match(JSON.parse(r.stdout).error,/model.*effort/i);assert.deepEqual(fs.readFileSync(settings(f)),before);
});
test('doctor checks saved provider availability without invoking it and keeps extraction independent',t=>{
 const f=drivingFixture(t);run(f,['init','--json']);run(f,configure);
 const bin=path.join(f.root,'bin');fs.mkdirSync(bin);const marker=path.join(f.root,'provider-launched');fs.writeFileSync(path.join(bin,'codex'),'#!/bin/sh\ntouch '+marker+'\n',{mode:0o755});
 const doctor=(env,expected)=>{const r=spawnSync(process.execPath,[cli,'doctor','--json'],{cwd:f.project,env:{...process.env,HOME:path.join(f.root,'home'),...env},encoding:'utf8',timeout:30000});assert.equal(r.status,expected,r.stdout+r.stderr);return JSON.parse(r.stdout);};
 const ready=doctor({PATH:bin},0);assert.equal(ready.readiness.configuration,true);assert.equal(fs.existsSync(marker),false);assert.equal(ready.checks.find(c=>c.name==='project-frontier').status,'pass');
 const missing=doctor({PATH:path.join(f.root,'missing')},1);assert.equal(missing.readiness.configuration,false);assert.equal(missing.readiness.extractor,true);assert.match(missing.checks.find(c=>c.name==='project-frontier').evidence,/unavailable/);
 fs.writeFileSync(settings(f),'{"schema":"unknown"}');const invalid=doctor({PATH:bin},1);assert.equal(invalid.readiness.extractor,true);assert.equal(invalid.readiness.configuration,false);
});
test('setup upgrades owned ignore rules so portable settings are trackable while local evidence stays ignored',t=>{
 const f=drivingFixture(t);run(f,['init','--json']);
 const local=path.join(f.project,'.wayfinder/.gitignore'),root=path.join(f.project,'.gitignore');
 fs.writeFileSync(local,fs.readFileSync(local,'utf8').replace('!settings.json\n',''));fs.writeFileSync(root,fs.readFileSync(root,'utf8').replace('!/.wayfinder/settings.json\n',''));
 const prefix='# Keep my unrelated ignore rule\n/my-cache/\n';fs.writeFileSync(root,prefix+fs.readFileSync(root,'utf8'));const config=fs.readFileSync(path.join(f.project,'.wayfinder/project.json'));
 run(f,configure);assert.ok(fs.readFileSync(root,'utf8').startsWith(prefix));assert.deepEqual(fs.readFileSync(path.join(f.project,'.wayfinder/project.json')),config);
 const git=(args,code)=>{const r=spawnSync('git',args,{cwd:f.project,encoding:'utf8'});assert.equal(r.status,code,r.stderr);return r.stdout;};git(['init','--quiet'],0);git(['check-ignore','.wayfinder/settings.json'],1);git(['check-ignore','.wayfinder/local/some-receipt.json'],0);
});
test('Claude settings require exact IDs and preserve future models and provider efforts offline',t=>{
 const f=drivingFixture(t);run(f,['init','--json']);
 const alias=run(f,['setup','--project','.','--provider','claude','--model','opus','--effort','medium','--json'],1);assert.match(alias.stdout,/exact model/i);assert.equal(fs.existsSync(settings(f)),false);
 const r=JSON.parse(run(f,['setup','--project','.','--provider','claude','--model','claude-future-model-7','--effort','default','--json']).stdout);assert.equal(r.settings.frontier.model,'claude-future-model-7');assert.equal(r.settings.frontier.effort,'default');
});
