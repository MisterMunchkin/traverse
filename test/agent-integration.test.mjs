import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {drivingFixture, packageRoot} from './support/driving-fixture.mjs';
import {agentSnapshot,installedAgents,planAgentIntegration,applyAgentIntegration} from '../src/agent-integration.mjs';

const cli=path.join(packageRoot,'bin/traverse.mjs');
const shared=['.agents/skills/traverse/SKILL.md','AGENTS.md'],legacy=['.claude/skills/wayfinder/SKILL.md','CLAUDE.md'];
const sha=body=>createHash('sha256').update(body).digest('hex');
const signed=(body,kind)=>body+`<!-- Wayfinder ${kind} sha256:${sha(body)} -->\n`;
function write(f,name,body){const file=path.join(f.project,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);}
// The prior signed format, independently constructed as update/migration input.
function seedLegacy(f,{codex=false,claude=true,prefix='',suffix=''}={}){
 const skill=signed('---\nname: traverse\ndescription: Previous Traverse guidance\n---\n\n# Traverse\n','skill');
 for(const [enabled,[skillName,instructions]] of [[codex,shared],[claude,legacy]])if(enabled){
  write(f,skillName,skill);
  const body=`Use Traverse for navigation-graph maintenance and UI driving in this repository.\nRead \`${skillName}\` before using it; follow this repository's task and permission instructions.\n`;
  write(f,instructions,prefix+'<!-- BEGIN Wayfinder agent guidance -->\n'+signed(body,'guidance')+'<!-- END Wayfinder agent guidance -->\n'+suffix);
 }
}
function run(f,args,code=0){
 const r=spawnSync(process.execPath,[cli,'init',...args,'--json'],{cwd:f.project,env:{...process.env,HOME:path.join(f.root,'home'),NO_COLOR:'1',TERM:'dumb'},encoding:'utf8',timeout:30000});
 assert.equal(r.status,code,r.stdout+r.stderr);assert.equal(r.signal,null);assert.equal(r.stderr,'');return JSON.parse(r.stdout);
}
const read=(f,name)=>fs.readFileSync(path.join(f.project,name),'utf8');
function snapshot(root,{includeLocal=true}={}){
 const files={};function walk(dir){for(const name of fs.readdirSync(dir)){const file=path.join(dir,name),relative=path.relative(root,file),stat=fs.lstatSync(file);if(!includeLocal&&relative==='.wayfinder/local')continue;if(stat.isDirectory())walk(file);else files[relative]=stat.isSymbolicLink()?{link:fs.readlinkSync(file)}:sha(fs.readFileSync(file));}}
 walk(root);return files;
}

test('shared install creates one skill and AGENTS pointer without Claude copies, frontier settings or tool invocation',t=>{
 const f=drivingFixture(t),r=run(f,['--agents','shared']);
 assert.equal(r.ready,true);assert.equal(r.agentIntegration.selection,'shared');assert.equal(r.agentIntegration.ready,true);assert.equal(r.agentIntegration.changed,true);
 for(const name of shared)assert.equal(fs.existsSync(path.join(f.project,name)),true,name);
 for(const name of ['.claude','CLAUDE.md','.wayfinder/settings.json'])assert.equal(fs.existsSync(path.join(f.project,name)),false,name);
 assert.equal(fs.existsSync(path.join(f.root,'home')),false);assert.equal(fs.existsSync(f.log),false);
 assert.ok(read(f,shared[0]).startsWith('---\nname: traverse\n'));assert.ok(read(f,'AGENTS.md').includes(shared[0]));
});

test('omitted or skipped integration preserves graph-only init and existing legacy guidance exactly',t=>{
 const f=drivingFixture(t);write(f,'AGENTS.md','My custom instructions without a newline');
 run(f,[]);assert.equal(fs.existsSync(path.join(f.project,'.agents')),false);
 seedLegacy(f);const before=snapshot(f.project,{includeLocal:false});const r=run(f,['--agents','skip']);
 assert.equal(r.agentIntegration.changed,false);assert.deepEqual(snapshot(f.project,{includeLocal:false}),before);assert.equal(read(f,'AGENTS.md'),'My custom instructions without a newline');
});

test('managed shared reruns preserve unchanged bytes, surrounding instructions and unrelated files',t=>{
 const f=drivingFixture(t),prefix='Keep this CRLF text.\r\n\r\n';write(f,'AGENTS.md',prefix);write(f,'CLAUDE.md','My own Claude instructions\n');
 write(f,'.claude/skills/another/SKILL.md','Unrelated Claude skill');run(f,['--agents','shared']);const generated=read(f,'AGENTS.md');assert.ok(generated.startsWith(prefix));
 const suffix='\nAfter the Traverse block.\n';fs.appendFileSync(path.join(f.project,'AGENTS.md'),suffix);
 write(f,'.agents/skills/wayfinder/notes.md','User-owned notes');
 const before=snapshot(f.project,{includeLocal:false});const r=run(f,['--agents','shared']);assert.equal(r.agentIntegration.changed,false);assert.deepEqual(snapshot(f.project,{includeLocal:false}),before);
 assert.equal(read(f,'AGENTS.md'),generated+suffix);assert.equal(read(f,'CLAUDE.md'),'My own Claude instructions\n');
});

for(const source of ['codex','claude','both'])test(`shared install migrates intact signed ${source} guidance to one canonical skill`,t=>{
 const f=drivingFixture(t);seedLegacy(f,{codex:source!=='claude',claude:source!=='codex'});
 assert.equal(installedAgents(agentSnapshot(f.project)),'shared');
 write(f,'.claude/skills/other/SKILL.md','Keep other skills');const r=run(f,['--agents','shared']);assert.equal(r.agentIntegration.ready,true);
 for(const name of legacy)assert.equal(fs.existsSync(path.join(f.project,name)),false,name);
 assert.equal(read(f,'.claude/skills/other/SKILL.md'),'Keep other skills');assert.ok(read(f,'AGENTS.md').includes(shared[0]));
 const before=snapshot(f.project,{includeLocal:false});const repeat=run(f,['--agents','shared']);assert.equal(repeat.agentIntegration.changed,false);assert.deepEqual(snapshot(f.project,{includeLocal:false}),before);
});

test('migration removes only the legacy managed block and preserves exact surrounding custom instructions',t=>{
 const f=drivingFixture(t),prefix='My Claude instructions.\r\n\r\n',suffix='\nKeep these too.\n';seedLegacy(f,{prefix,suffix});
 write(f,'.claude/skills/wayfinder/notes.md','Local notes');run(f,['--agents','shared']);
 assert.equal(read(f,'CLAUDE.md'),prefix+'\n'+suffix);assert.equal(read(f,'.claude/skills/wayfinder/notes.md'),'Local notes');
});

test('shared preview and checks are read-only and report missing or legacy duplicate guidance as stale',t=>{
 const f=drivingFixture(t),before=snapshot(f.project);const preview=run(f,['--agents','shared','--dry-run']);
 assert.equal(preview.mode,'dry-run');assert.equal(preview.agentIntegration.ready,false);assert.equal(preview.agentIntegration.changed,false);assert.deepEqual(preview.agentIntegration.changes,shared);assert.deepEqual(snapshot(f.project),before);
 run(f,['--agents','shared','--check'],1);assert.deepEqual(snapshot(f.project),before);
 run(f,['--agents','shared']);const saved=snapshot(f.project);const checked=run(f,['--agents','shared','--check']);assert.equal(checked.agentIntegration.ready,true);assert.equal(checked.agentIntegration.changed,false);assert.deepEqual(snapshot(f.project),saved);
 seedLegacy(f,{codex:false});const duplicate=snapshot(f.project);const stale=run(f,['--agents','shared','--check'],1);assert.equal(stale.agentIntegration.ready,false);assert.deepEqual(stale.agentIntegration.removals,legacy);assert.deepEqual(snapshot(f.project),duplicate);
 const migration=run(f,['--agents','shared','--dry-run']);assert.deepEqual(migration.agentIntegration.removals,legacy);assert.deepEqual(snapshot(f.project),duplicate);
});

test('provider-named and invalid agent choices are rejected without writes or conversion aliases',t=>{
 for(const choice of ['codex','claude','both','other']){
  const f=drivingFixture(t),before=snapshot(f.project),r=run(f,['--agents',choice],1);assert.match(r.error,/--agents must be shared or skip/);assert.deepEqual(snapshot(f.project),before);
 }
});

test('shared preflight refuses custom, edited, malformed, external-symlink, non-file or oversized selected files before fresh init writes',t=>{
 for(const kind of ['graph-only','unmanaged-shared','unmanaged-legacy','edited-shared','edited-legacy','edited-shared-block','edited-legacy-block','malformed-shared-block','malformed-legacy-block','external-symlink','directory','oversize']){
  const f=drivingFixture(t);let args=['--agents','shared'];
  if(kind==='graph-only')args.push('--no-interactive');
  if(kind==='unmanaged-shared')write(f,shared[0],'My existing skill');
  if(kind==='unmanaged-legacy')write(f,legacy[0],'My existing Claude skill');
  if(kind.startsWith('edited-')){
   seedLegacy(f,{codex:true});const name=kind==='edited-shared'?shared[0]:kind==='edited-legacy'?legacy[0]:kind==='edited-shared-block'?'AGENTS.md':'CLAUDE.md';
   write(f,name,read(f,name).replace('Traverse','Traverse custom'));
  }
  if(kind==='malformed-shared-block')write(f,'AGENTS.md','<!-- BEGIN Wayfinder agent guidance -->\nunfinished');
  if(kind==='malformed-legacy-block')write(f,'CLAUDE.md','<!-- BEGIN Wayfinder agent guidance -->\nunfinished');
  if(kind==='external-symlink')fs.symlinkSync(path.join(f.root,'keep.md'),path.join(f.project,'CLAUDE.md'));
  if(kind==='directory')fs.mkdirSync(path.join(f.project,'CLAUDE.md'));
  if(kind==='oversize')write(f,'CLAUDE.md','x'.repeat(1024*1024+1));
  const before=snapshot(f.project),r=run(f,args,1);assert.equal(r.ready,false);assert.deepEqual(snapshot(f.project),before,kind);assert.equal(fs.existsSync(path.join(f.project,'.wayfinder')),false,kind);
 }
});

test('Skip tolerates conflicting legacy and shared files without migration or deletion',t=>{
 const f=drivingFixture(t);write(f,legacy[0],'Customized');write(f,shared[0],'Customized too');write(f,'CLAUDE.md','<!-- BEGIN Wayfinder agent guidance -->\nunfinished');
 run(f,[]);const before=snapshot(f.project,{includeLocal:false});run(f,['--agents','skip']);assert.deepEqual(snapshot(f.project,{includeLocal:false}),before);
});

test('all selected guidance is rechecked before writes, including absent legacy paths and planned deletions',async t=>{
 for(const name of [...shared,...legacy]){
  const f=drivingFixture(t);run(f,[]);seedLegacy(f,{codex:true});
  const plan=planAgentIntegration(f.project,'shared',{snapshot:agentSnapshot(f.project)});write(f,name,'Newer user instructions');const before=snapshot(f.project);
  await assert.rejects(applyAgentIntegration(plan),/changed during configuration/);assert.deepEqual(snapshot(f.project),before,name);
 }
 const f=drivingFixture(t);run(f,[]);const plan=planAgentIntegration(f.project,'shared');write(f,'CLAUDE.md','Newly created instructions');const before=snapshot(f.project);
 await assert.rejects(applyAgentIntegration(plan),/changed during configuration: CLAUDE.md/);assert.deepEqual(snapshot(f.project),before);
});

test('intact older shared skills update while checks remain read-only and shared integration is discoverable',t=>{
 const f=drivingFixture(t);run(f,['--agents','shared']);assert.equal(installedAgents(agentSnapshot(f.project)),'shared');
 const current=read(f,shared[0]);seedLegacy(f,{codex:true,claude:false});const before=snapshot(f.project);
 const checked=run(f,['--agents','shared','--check'],1);assert.equal(checked.agentIntegration.ready,false);assert.deepEqual(snapshot(f.project),before);
 const updated=run(f,['--agents','shared']);assert.equal(updated.agentIntegration.changed,true);assert.equal(read(f,shared[0]),current);
});

test('shared guidance output cannot exceed the reader limit before project or agent writes',t=>{
 const f=drivingFixture(t);write(f,'AGENTS.md','x'.repeat(1024*1024));const before=snapshot(f.project);
 const result=run(f,['--agents','shared'],1);assert.match(result.error,/exceed.*1 MiB/i);assert.deepEqual(snapshot(f.project),before);assert.equal(fs.existsSync(path.join(f.project,'.wayfinder')),false);
});
