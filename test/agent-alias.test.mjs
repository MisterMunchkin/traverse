import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {drivingFixture,packageRoot} from './support/driving-fixture.mjs';
import {agentSnapshot,planAgentIntegration,applyAgentIntegration,installedAgents} from '../src/agent-integration.mjs';

const cli=path.join(packageRoot,'bin/traverse.mjs');
const begin='<!-- BEGIN Wayfinder agent guidance -->';
function write(f,name,body){const p=path.join(f.project,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,body);}
function run(f,args,code=0){const r=spawnSync(process.execPath,[cli,'init',...args,'--json'],{cwd:f.project,env:{...process.env,HOME:path.join(f.root,'home'),NO_COLOR:'1',TERM:'dumb'},encoding:'utf8',timeout:30000});assert.equal(r.status,code,r.stdout+r.stderr);assert.equal(r.signal,null);assert.equal(r.error,undefined);assert.equal(r.stderr,'');return JSON.parse(r.stdout);}
function tree(root){const out={};function walk(dir){for(const n of fs.readdirSync(dir)){const p=path.join(dir,n),s=fs.lstatSync(p),rel=path.relative(root,p);if(rel==='.wayfinder/local')continue;if(s.isDirectory())walk(p);else out[rel]=s.isSymbolicLink()?{link:fs.readlinkSync(p)}:fs.readFileSync(p).toString('base64');}}walk(root);return out;}
function seedLegacy(f,target,{prefix='',suffix=''}={}){
 const signed=(body,kind)=>body+`<!-- Wayfinder ${kind} sha256:${createHash('sha256').update(body).digest('hex')} -->\n`;
 write(f,'.claude/skills/wayfinder/SKILL.md',signed('Previous Traverse guidance\n','skill'));
 const body='Use Traverse for navigation-graph maintenance and UI driving in this repository.\nRead `.claude/skills/wayfinder/SKILL.md` before using it; follow this repository\'s task and permission instructions.\n';
 write(f,target,prefix+begin+'\n'+signed(body,'guidance')+'<!-- END Wayfinder agent guidance -->\n'+suffix);
}

for(const alias of ['AGENTS.md','CLAUDE.md'])test(`shared init preserves ${alias} instruction alias, content and one canonical guidance block across rerun/check`,t=>{
 const f=drivingFixture(t),target=alias==='AGENTS.md'?'CLAUDE.md':'AGENTS.md',prefix='Existing project instructions.\r\n\r\n';write(f,target,prefix);fs.symlinkSync(target,path.join(f.project,alias));
 const first=run(f,['--agents','shared']);assert.equal(first.ready,true);assert.equal(fs.readlinkSync(path.join(f.project,alias)),target);const text=fs.readFileSync(path.join(f.project,target),'utf8');assert.ok(text.startsWith(prefix));assert.equal(text.split(begin).length-1,1);assert.ok(text.includes('.agents/skills/traverse/SKILL.md'));assert.equal(fs.existsSync(path.join(f.project,'.claude/skills/wayfinder/SKILL.md')),false);
 assert.deepEqual(first.agentIntegration.removals,[]);assert.equal(installedAgents(agentSnapshot(f.project)),'shared');
 const before=tree(f.project),again=run(f,['--agents','shared']);assert.equal(again.agentIntegration.changed,false);run(f,['--agents','shared','--check']);assert.deepEqual(tree(f.project),before);
});

test('both instruction aliases share a third in-repo target without duplicate planning or writes',t=>{
 const f=drivingFixture(t);write(f,'docs/instructions.md','Keep these instructions.\n');for(const name of ['AGENTS.md','CLAUDE.md'])fs.symlinkSync('docs/instructions.md',path.join(f.project,name));
 const plan=planAgentIntegration(f.project,'shared');const r=run(f,['--agents','shared']);assert.equal(r.ready,true);assert.equal(plan.entries.filter(e=>e.name==='docs/instructions.md').length,1);assert.ok(r.agentIntegration.changes.includes('docs/instructions.md'));
 assert.equal(fs.readFileSync(path.join(f.project,'docs/instructions.md'),'utf8').split(begin).length-1,1);for(const name of ['AGENTS.md','CLAUDE.md'])assert.equal(fs.readlinkSync(path.join(f.project,name)),'docs/instructions.md');
});

test('legacy migration through a shared instruction alias updates one block and preserves surrounding content',t=>{
 const f=drivingFixture(t),prefix='Keep project rules.\r\n\r\n',suffix='\nKeep trailing rules.\r\n';seedLegacy(f,'CLAUDE.md',{prefix,suffix});fs.symlinkSync('CLAUDE.md',path.join(f.project,'AGENTS.md'));
 const r=run(f,['--agents','shared']),text=fs.readFileSync(path.join(f.project,'CLAUDE.md'),'utf8');assert.ok(text.startsWith(prefix));assert.ok(text.endsWith(suffix));assert.equal(text.split(begin).length-1,1);assert.ok(text.includes('.agents/skills/traverse/SKILL.md'));assert.ok(!text.includes('.claude/skills/wayfinder/SKILL.md'));assert.equal(fs.readlinkSync(path.join(f.project,'AGENTS.md')),'CLAUDE.md');assert.deepEqual(r.agentIntegration.removals,['.claude/skills/wayfinder/SKILL.md']);
 const before=tree(f.project);run(f,['--agents','shared','--check']);run(f,['--agents','shared']);assert.deepEqual(tree(f.project),before);
});

test('separate legacy instruction alias migration keeps its target present even when only the owned block is removed',t=>{
 const f=drivingFixture(t);seedLegacy(f,'docs/legacy.md');fs.symlinkSync('docs/legacy.md',path.join(f.project,'CLAUDE.md'));run(f,['--agents','shared']);assert.equal(fs.readlinkSync(path.join(f.project,'CLAUDE.md')),'docs/legacy.md');assert.equal(fs.readFileSync(path.join(f.project,'docs/legacy.md'),'utf8'),'');assert.equal(fs.readFileSync(path.join(f.project,'AGENTS.md'),'utf8').split(begin).length-1,1);
 const before=tree(f.project);run(f,['--agents','shared']);run(f,['--agents','shared','--check']);assert.deepEqual(tree(f.project),before);
});

test('instruction aliases cannot overlap managed skill destinations',t=>{
 const f=drivingFixture(t);seedLegacy(f,'CLAUDE.md');fs.symlinkSync('.claude/skills/wayfinder/SKILL.md',path.join(f.project,'AGENTS.md'));const before=tree(f.project);assert.throws(()=>planAgentIntegration(f.project,'shared'),/destinations overlap/);assert.deepEqual(tree(f.project),before);assert.equal(fs.existsSync(path.join(f.project,'.wayfinder')),false);
});

test('case-varied instruction aliases migrate one physical file without deleting its shared block',t=>{
 const f=drivingFixture(t);seedLegacy(f,'CLAUDE.md');if(!fs.existsSync(path.join(f.project,'claude.md')))return t.skip('Case-sensitive filesystem');fs.symlinkSync('claude.md',path.join(f.project,'AGENTS.md'));
 run(f,['--agents','shared']);assert.equal(fs.readlinkSync(path.join(f.project,'AGENTS.md')),'claude.md');assert.equal(fs.existsSync(path.join(f.project,'CLAUDE.md')),true);const text=fs.readFileSync(path.join(f.project,'CLAUDE.md'),'utf8');assert.equal(text.split(begin).length-1,1);assert.ok(text.includes('.agents/skills/traverse/SKILL.md'));run(f,['--agents','shared','--check']);
});

test('case-varied instruction and skill destinations still conflict',t=>{
 const f=drivingFixture(t);seedLegacy(f,'CLAUDE.md');if(!fs.existsSync(path.join(f.project,'.CLAUDE/SKILLS/WAYFINDER/SKILL.MD')))return t.skip('Case-sensitive filesystem');fs.symlinkSync('.CLAUDE/SKILLS/WAYFINDER/SKILL.MD',path.join(f.project,'AGENTS.md'));const before=tree(f.project);assert.throws(()=>planAgentIntegration(f.project,'shared'),/destinations overlap/);assert.deepEqual(tree(f.project),before);
});

test('actual case-varied skill directories use the same destination identity as instruction aliases',t=>{
 const f=drivingFixture(t);seedLegacy(f,'CLAUDE.md');if(!fs.existsSync(path.join(f.project,'.CLAUDE')))return t.skip('Case-sensitive filesystem');fs.renameSync(path.join(f.project,'.claude'),path.join(f.project,'.CLAUDE'));assert.ok(fs.realpathSync.native(path.join(f.project,'.claude/skills/wayfinder/SKILL.md')).includes('/.CLAUDE/'));fs.symlinkSync('.CLAUDE/skills/wayfinder/SKILL.md',path.join(f.project,'AGENTS.md'));const before=tree(f.project);assert.throws(()=>planAgentIntegration(f.project,'shared'),/destinations overlap/);assert.deepEqual(tree(f.project),before);
});

test('parent traversal cannot hide a symlink or missing directory, but real in-project parents work',t=>{
 for(const kind of ['symlink','missing','directory']){
  const f=drivingFixture(t);write(f,'CLAUDE.md','Keep project instructions\n');if(kind==='symlink'){fs.mkdirSync(path.join(f.root,'outside'));fs.symlinkSync(path.join(f.root,'outside'),path.join(f.project,'linked'));}else if(kind==='directory')fs.mkdirSync(path.join(f.project,'linked'));
  fs.symlinkSync('linked/../CLAUDE.md',path.join(f.project,'AGENTS.md'));const before=tree(f.project);
  if(kind==='directory'){const r=run(f,['--agents','shared']);assert.equal(r.ready,true);assert.equal(fs.readlinkSync(path.join(f.project,'AGENTS.md')),'linked/../CLAUDE.md');run(f,['--agents','shared','--check']);}
  else{const r=run(f,['--agents','shared'],1);assert.match(r.error,/symlink|directory|ENOENT/i);assert.deepEqual(tree(f.project),before);assert.equal(fs.existsSync(path.join(f.project,'.wayfinder')),false);}
 }
});

test('shared guidance resolves an internal chain but refuses external, dangling, cyclic, parent and skill symlinks without writes',t=>{
 for(const kind of ['chain','external','escape-return','dangling','cycle','parent','skill']){
  const f=drivingFixture(t);write(f,'docs/canonical.md','Keep instructions\n');
  if(kind==='chain'){fs.symlinkSync('docs/alias.md',path.join(f.project,'AGENTS.md'));fs.symlinkSync('canonical.md',path.join(f.project,'docs/alias.md'));}
  if(kind==='external'){fs.writeFileSync(path.join(f.root,'outside.md'),'Do not modify');fs.symlinkSync('../outside.md',path.join(f.project,'AGENTS.md'));}
  if(kind==='escape-return'){fs.symlinkSync('project/docs/canonical.md',path.join(f.root,'return.md'));fs.symlinkSync('../return.md',path.join(f.project,'AGENTS.md'));}
  if(kind==='dangling')fs.symlinkSync('missing.md',path.join(f.project,'AGENTS.md'));
  if(kind==='cycle'){fs.symlinkSync('CLAUDE.md',path.join(f.project,'AGENTS.md'));fs.symlinkSync('AGENTS.md',path.join(f.project,'CLAUDE.md'));}
  if(kind==='parent'){fs.mkdirSync(path.join(f.root,'outside'));fs.writeFileSync(path.join(f.root,'outside/instructions.md'),'Keep');fs.symlinkSync(path.join(f.root,'outside'),path.join(f.project,'linked'));fs.symlinkSync('linked/instructions.md',path.join(f.project,'AGENTS.md'));}
  if(kind==='skill'){fs.mkdirSync(path.join(f.project,'.agents/skills/traverse'),{recursive:true});fs.symlinkSync('../../../docs/canonical.md',path.join(f.project,'.agents/skills/traverse/SKILL.md'));}
  const before=tree(f.project),outside=fs.existsSync(path.join(f.root,'outside.md'))&&fs.readFileSync(path.join(f.root,'outside.md'));
  if(kind==='chain'){run(f,['--agents','shared']);assert.equal(fs.readlinkSync(path.join(f.project,'AGENTS.md')),'docs/alias.md');assert.equal(fs.readlinkSync(path.join(f.project,'docs/alias.md')),'canonical.md');}
  else{run(f,['--agents','shared'],1);assert.deepEqual(tree(f.project),before,kind);assert.equal(fs.existsSync(path.join(f.project,'.wayfinder')),false,kind);if(outside)assert.deepEqual(fs.readFileSync(path.join(f.root,'outside.md')),outside);}
 }
});

test('retargeted or replaced instruction aliases with identical bytes are rejected before any guidance write',async t=>{
 for(const kind of ['retarget','replace','target-symlink','bytes']){
  const f=drivingFixture(t);run(f,[]);write(f,'CLAUDE.md','Same bytes\n');write(f,'other.md','Same bytes\n');fs.symlinkSync('CLAUDE.md',path.join(f.project,'AGENTS.md'));const plan=planAgentIntegration(f.project,'shared');
  if(kind==='retarget'){fs.unlinkSync(path.join(f.project,'AGENTS.md'));fs.symlinkSync('other.md',path.join(f.project,'AGENTS.md'));}
  if(kind==='replace'){fs.unlinkSync(path.join(f.project,'AGENTS.md'));write(f,'AGENTS.md','Same bytes\n');}
  if(kind==='target-symlink'){fs.unlinkSync(path.join(f.project,'CLAUDE.md'));fs.symlinkSync('other.md',path.join(f.project,'CLAUDE.md'));}
  if(kind==='bytes')write(f,'CLAUDE.md','New instructions\n');
  const before=tree(f.project);await assert.rejects(applyAgentIntegration(plan),/changed during configuration|symlink/i);assert.deepEqual(tree(f.project),before,kind);assert.equal(fs.existsSync(path.join(f.project,'.agents/skills/traverse/SKILL.md')),false);
 }
});

test('Skip ignores unsupported aliases and preserves every guidance path',t=>{
 const f=drivingFixture(t);fs.symlinkSync('../unrelated.md',path.join(f.project,'AGENTS.md'));const plan=planAgentIntegration(f.project,'skip');assert.equal(plan.entries.length,0);const links=fs.readlinkSync(path.join(f.project,'AGENTS.md'));run(f,['--agents','skip']);assert.equal(fs.readlinkSync(path.join(f.project,'AGENTS.md')),links);
});
