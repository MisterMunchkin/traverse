import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {drivingFixture,packageRoot} from './support/driving-fixture.mjs';
import {DEFAULT_MODEL_CACHE} from '../src/model-setup.mjs';
const cli=path.join(packageRoot,'bin',fs.existsSync(path.join(packageRoot,'bin/traverse.mjs'))?'traverse.mjs':'wayfinder.mjs');
const signed=(body,kind)=>body+`<!-- Wayfinder ${kind} sha256:${createHash('sha256').update(body).digest('hex')} -->\n`;
function run(root,args,code=0){const r=spawnSync(process.execPath,[cli,...args],{cwd:root,env:{...process.env,NO_COLOR:'1',TERM:'dumb'},encoding:'utf8',timeout:30000});assert.equal(r.status,code,r.stdout+r.stderr);assert.equal(r.signal,null);assert.equal(r.error,undefined);return r;}
function seed(f,custom=false){
 const dir=path.join(f.project,'.agents/skills/wayfinder');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'SKILL.md'),custom?'My customized Wayfinder skill':signed('---\nname: wayfinder\ndescription: Previous Wayfinder skill\n---\n','skill'));
 const body='Use Wayfinder for navigation-graph maintenance and UI driving in this repository.\nRead `.agents/skills/wayfinder/SKILL.md` before using it; follow this repository\'s task and permission instructions.\n';
 const prefix='Keep project instructions.\r\n\r\n',suffix='\nKeep trailing instructions.\r\n';fs.writeFileSync(path.join(f.project,'CLAUDE.md'),prefix+'<!-- BEGIN Wayfinder agent guidance -->\n'+signed(body,'guidance')+'<!-- END Wayfinder agent guidance -->\n'+suffix);fs.symlinkSync('CLAUDE.md',path.join(f.project,'AGENTS.md'));return {prefix,suffix};
}
test('Traverse help, command and private package identify the new product without changing machine contracts',()=>{
 const r=run(packageRoot,['--help']);assert.match(r.stdout,/Traverse/);assert.match(r.stdout,/Usage: traverse init/);assert.doesNotMatch(r.stdout,/Wayfinder|\x1b/);assert.equal(r.stderr,'');
 const pkg=JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json')));assert.equal(pkg.name,'@mistermunchkin/traverse');assert.deepEqual(pkg.bin,{traverse:'bin/traverse.mjs'});assert.equal(run(packageRoot,['--version']).stdout.trim(),pkg.version);assert.equal(DEFAULT_MODEL_CACHE,path.join(os.homedir(),'.cache/wayfinder'));
});
test('Traverse init migrates intact Wayfinder shared guidance, preserves aliased instructions and reads unchanged existing settings',t=>{
 const f=drivingFixture(t),{prefix,suffix}=seed(f);fs.mkdirSync(path.join(f.project,'.wayfinder'));const settings=JSON.stringify({schema:'wayfinder-settings/1',frontier:{provider:'codex',model:'gpt-6.1-sol',effort:'medium'},driving:{policy:'local-first',maxSteps:17,timeoutMs:45000}},null,4)+'\n';fs.writeFileSync(path.join(f.project,'.wayfinder/settings.json'),settings);
 const first=JSON.parse(run(f.project,['init','--agents','shared','--json']).stdout);assert.equal(first.schema,'wayfinder-init/2');assert.equal(first.ready,true);assert.equal(first.adapter.authorCalls,0);assert.equal(fs.readFileSync(path.join(f.project,'.wayfinder/settings.json'),'utf8'),settings);assert.equal(fs.existsSync(path.join(f.project,'.traverse')),false);assert.equal(fs.readlinkSync(path.join(f.project,'AGENTS.md')),'CLAUDE.md');
 const instructions=fs.readFileSync(path.join(f.project,'CLAUDE.md'),'utf8');assert.ok(instructions.startsWith(prefix));assert.ok(instructions.endsWith(suffix));assert.ok(instructions.includes('Use Traverse'));assert.ok(instructions.includes('.agents/skills/traverse/SKILL.md'));assert.equal(instructions.split('<!-- BEGIN Wayfinder agent guidance -->').length-1,1);assert.equal(fs.existsSync(path.join(f.project,'.agents/skills/wayfinder/SKILL.md')),false);assert.match(fs.readFileSync(path.join(f.project,'.agents/skills/traverse/SKILL.md'),'utf8'),/^---\nname: traverse\n/);
 const again=JSON.parse(run(f.project,['init','--agents','shared','--json']).stdout);assert.equal(again.agentIntegration.changed,false);assert.equal(fs.readFileSync(path.join(f.project,'CLAUDE.md'),'utf8'),instructions);assert.equal(fs.readFileSync(path.join(f.project,'.wayfinder/settings.json'),'utf8'),settings);assert.equal(JSON.parse(run(f.project,['init','--agents','shared','--check','--json']).stdout).ready,true);assert.equal(fs.existsSync(f.log),false);
});
test('Traverse shared migration refuses a customized prior Wayfinder skill before project writes and Skip preserves it',t=>{
 const f=drivingFixture(t);seed(f,true);const before=fs.readFileSync(path.join(f.project,'CLAUDE.md'));const refusal=JSON.parse(run(f.project,['init','--agents','shared','--json'],1).stdout);assert.match(refusal.error,/Existing or customized.*skill/);assert.equal(fs.existsSync(path.join(f.project,'.wayfinder')),false);assert.equal(fs.existsSync(path.join(f.project,'.agents/skills/traverse')),false);assert.deepEqual(fs.readFileSync(path.join(f.project,'CLAUDE.md')),before);
 run(f.project,['init','--agents','skip','--json']);assert.deepEqual(fs.readFileSync(path.join(f.project,'CLAUDE.md')),before);assert.equal(fs.readFileSync(path.join(f.project,'.agents/skills/wayfinder/SKILL.md'),'utf8'),'My customized Wayfinder skill');assert.equal(fs.readlinkSync(path.join(f.project,'AGENTS.md')),'CLAUDE.md');
});

test('Traverse accepts existing Wayfinder ignore ownership bytes without rewriting them',t=>{
 const f=drivingFixture(t);run(f.project,['init','--json']);
 const local='# Wayfinder portable project artifacts\n*\n!/.gitignore\n!/project.json\n!/settings.json\n!/graph.json\n!/extractor/\n!/extractor/**\n';
 const root='# Keep this root rule\n# BEGIN Wayfinder project artifacts\n!.wayfinder/\n.wayfinder/*\n!.wayfinder/.gitignore\n!.wayfinder/project.json\n!.wayfinder/settings.json\n!.wayfinder/graph.json\n!.wayfinder/extractor/\n!.wayfinder/extractor/**\n# END Wayfinder project artifacts\n';
 fs.writeFileSync(path.join(f.project,'.wayfinder/.gitignore'),local);fs.writeFileSync(path.join(f.project,'.gitignore'),root);const config=fs.readFileSync(path.join(f.project,'.wayfinder/project.json'));const result=JSON.parse(run(f.project,['init','--check','--json']).stdout);assert.equal(result.ready,true);assert.equal(fs.readFileSync(path.join(f.project,'.gitignore'),'utf8'),root);assert.equal(fs.readFileSync(path.join(f.project,'.wayfinder/.gitignore'),'utf8'),local);assert.deepEqual(fs.readFileSync(path.join(f.project,'.wayfinder/project.json')),config);
});
test('Traverse refuses edited Wayfinder root ignore ownership before any fresh init writes',t=>{
 const f=drivingFixture(t),root='# Keep this rule\n# BEGIN Wayfinder project artifacts\ncustomized managed block\n';fs.writeFileSync(path.join(f.project,'.gitignore'),root);const result=JSON.parse(run(f.project,['init','--json'],1).stdout);assert.match(result.error,/Conflicting.*ignore block/);assert.equal(fs.readFileSync(path.join(f.project,'.gitignore'),'utf8'),root);assert.equal(fs.existsSync(path.join(f.project,'.wayfinder')),false);
});
