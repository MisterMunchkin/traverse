import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'bin/traverse.mjs');
const hash = b => createHash('sha256').update(b).digest('hex');
function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wayfinder-setup-')));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  for (const name of ['app','components','app.json','tsconfig.json','package.json','package-lock.json','node_modules/expo/package.json','node_modules/expo-router/package.json']) {
    const dest = path.join(dir,name); fs.mkdirSync(path.dirname(dest),{recursive:true});
    fs.cpSync(path.join(root,'examples/expo',name),dest,{recursive:true});
  }
  return dir;
}
function run(cwd,args,expect=0,bin=cli) {
  const r=spawnSync(process.execPath,[bin,...args],{cwd,encoding:'utf8',timeout:15000,env:{...process.env,HOME:path.join(cwd,'.test-home'),NO_COLOR:'1',TERM:'dumb'}});
  if(process.env.SETUP_TEST_EVIDENCE){fs.mkdirSync(process.env.SETUP_TEST_EVIDENCE,{recursive:true});fs.writeFileSync(path.join(process.env.SETUP_TEST_EVIDENCE,randomUUID()+'.json'),JSON.stringify({command:process.execPath,args:[bin,...args],cwd,node:process.version,code:r.status,signal:r.signal,timeoutMs:15000,error:r.error?.message,stdout:r.stdout,stderr:r.stderr},null,2));}
  assert.equal(r.status,expect,r.stdout+'\n'+r.stderr); assert.equal(r.signal,null); return r;
}
function tree(dir) {
  const out={};function walk(d){for(const n of fs.readdirSync(d)){const p=path.join(d,n),s=fs.lstatSync(p),key=path.relative(dir,p);if(s.isSymbolicLink())out[key]='link:'+fs.readlinkSync(p);else if(s.isDirectory()){out[key]='/';walk(p);}else out[key]=hash(fs.readFileSync(p));}}walk(dir);return out;
}
const change=(dir,file,fn)=>{const p=path.join(dir,file),v=JSON.parse(fs.readFileSync(p));fn(v);fs.writeFileSync(p,JSON.stringify(v));};

test('portable help and version work outside a project and reject unknown flags',t=>{
  const dir=fixture(t),before=tree(dir);
  assert.match(run(dir,['--help']).stdout,/traverse init/);
  assert.equal(run(dir,['--version']).stdout.trim(),JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version);
  run(dir,['init','--unknown'],1);assert.deepEqual(tree(dir),before);
});

test('init creates portable artifacts beside other data, preserves reruns and supplies a doctor command',t=>{
  const dir=fixture(t);fs.mkdirSync(path.join(dir,'.wayfinder/install'),{recursive:true});fs.writeFileSync(path.join(dir,'.wayfinder/install/keep'),'existing installation');
  const before=tree(dir),first=JSON.parse(run(dir,['init','--json']).stdout);
  assert.equal(first.schema,'wayfinder-init/2');assert.equal(Object.hasOwn(first,'nativeDriving'),false);assert.equal(first.created,true);assert.equal(first.projectRoot,dir);
  const file=path.join(dir,'.wayfinder/project.json'),bytes=fs.readFileSync(file),config=JSON.parse(bytes);
  assert.equal(config.schema,'wayfinder-project/2');assert.equal(config.framework.package,'expo-router');assert.equal(config.projectRoot,undefined);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'.wayfinder/graph.json'))).schema,'wayfinder-repository-graph/1');
  const after=tree(dir);for(const [p,h]of Object.entries(before))assert.equal(after[p],h,p);
  const again=run(dir,['init']);assert.equal(again.stdout,'');assert.match(again.stderr,/already initialised/i);assert.match(again.stderr,/traverse doctor/);assert.deepEqual(fs.readFileSync(file),bytes);
  const doctor=JSON.parse(run(dir,['doctor','--json']).stdout);assert.deepEqual(doctor.readiness,{extractor:true,configuration:true});assert.equal(doctor.checks.find(c=>c.name==='project-config').status,'pass');
  const retired=JSON.parse(run(dir,['doctor','--json','--require-driving'],1).stdout);assert.equal(retired.exitCode,1);assert.equal(retired.checks[0].name,'command-options');
});

test('init previews and checks are read-only, and doctor requires explicit project setup',t=>{
  const dir=fixture(t),before=tree(dir);
  assert.equal(JSON.parse(run(dir,['init','--dry-run','--json']).stdout).created,false);assert.deepEqual(tree(dir),before);
  run(dir,['init','--check','--json'],1);assert.deepEqual(tree(dir),before);
  const report=JSON.parse(run(dir,['doctor','--json'],1).stdout);assert.equal(report.readiness.extractor,false);assert.match(report.checks.find(c=>c.name==='project-config').remediation,/traverse init/);assert.deepEqual(tree(dir),before);
  run(dir,['init','--json']);const installed=tree(dir);run(dir,['init','--check','--json']);assert.deepEqual(tree(dir),installed);
});

test('init human output is finite plain stderr and JSON has no mixed banners',t=>{
  const dir=fixture(t),r=run(dir,['init']);assert.equal(r.stdout,'');assert.match(r.stderr,/Checking Expo project/);assert.match(r.stderr,/Project ready/);assert.match(r.stderr,/traverse doctor/);assert.doesNotMatch(r.stderr,/\x1b|undefined|Created:/);
  const j=run(dir,['init','--json']);assert.equal(j.stderr,'');assert.equal(JSON.parse(j.stdout).created,false);
});

test('snapshot reads configured source and produces an immutable pipeline spec',t=>{
  const dir=fixture(t);run(dir,['init','--json']);const before=fs.readFileSync(path.join(dir,'.wayfinder/project.json'));
  const out=path.join(dir,'.wayfinder/snapshots/one');run(dir,['snapshot','--out',out,'--json']);
  const spec=JSON.parse(fs.readFileSync(path.join(out,'spec.json')));assert.deepEqual(spec.contract,{schema:'traverse-navigation',schemaVersion:1});assert.equal(Object.keys(spec.source.files).length,7);
  assert.ok(spec.source.files['app/notes/edit.tsx'].includes('save(draft.value)'));
  run(dir,['snapshot','--out',out,'--json'],1);assert.deepEqual(fs.readFileSync(path.join(dir,'.wayfinder/project.json')),before);
  const nested=path.join(dir,'components');run(nested,['doctor','--json'],1);run(nested,['doctor','--project',dir,'--json']);
});

for(const [label,mutate]of [
  ['dynamic configuration',d=>fs.writeFileSync(path.join(d,'app.config.ts'),'throw Error("DO-NOT-EXECUTE")')],
  ['empty route root',d=>fs.mkdirSync(path.join(d,'src/app'),{recursive:true})],
  ['escaping alias',d=>change(d,'tsconfig.json',p=>{p.compilerOptions.paths['@/*']=['../outside/*'];})],
  ['wrong installed version',d=>change(d,'node_modules/expo-router/package.json',p=>{p.version='58.0.1';})],
  ['malformed manifest',d=>fs.writeFileSync(path.join(d,'package.json'),'{"secret":"DO-NOT-DISCLOSE"')],
  ['source symlink',d=>fs.symlinkSync(path.join(d,'package.json'),path.join(d,'app/leak.ts'))],
  ['oversized source',d=>fs.writeFileSync(path.join(d,'app/huge.ts'),' '.repeat(1024*1024+1))],
])test(`unsupported ${label} fails before init mutation without exposing config`,t=>{
  const dir=fixture(t);mutate(dir);const before=tree(dir),r=run(dir,['init','--json'],1);assert.equal(JSON.parse(r.stdout).ready,false);assert.doesNotMatch(r.stdout+r.stderr,/DO-NOT-DISCLOSE|DO-NOT-EXECUTE/);assert.deepEqual(tree(dir),before);
});

test('malformed, conflicting and symlink project state is never overwritten',t=>{
  for(const kind of ['malformed','changed-root','changed-framework','symlink-file','symlink-dir']){
    const dir=fixture(t);run(dir,['init','--json']);const file=path.join(dir,'.wayfinder/project.json');
    if(kind==='malformed')fs.writeFileSync(file,'{"secret":"DO-NOT-DISCLOSE"');
    if(kind==='changed-root')change(dir,'.wayfinder/project.json',p=>{p.projectRoot='/not-this-project';});
    if(kind==='changed-framework')change(dir,'.wayfinder/project.json',p=>{p.framework.version='57.0.999';});
    if(kind==='symlink-file'){fs.renameSync(file,path.join(dir,'outside.json'));fs.symlinkSync(path.join(dir,'outside.json'),file);}
    if(kind==='symlink-dir'){fs.renameSync(path.join(dir,'.wayfinder'),path.join(dir,'outside'));fs.symlinkSync(path.join(dir,'outside'),path.join(dir,'.wayfinder'));}
    const before=tree(dir),r=run(dir,['init','--json'],1);assert.deepEqual(tree(dir),before);assert.doesNotMatch(r.stdout+r.stderr,/DO-NOT-DISCLOSE/);
  }
});

test('package declares the Traverse executable and an included shrinkwrap rather than an omitted package-lock',()=>{
  const p=JSON.parse(fs.readFileSync(path.join(root,'package.json')));assert.deepEqual(p.bin,{traverse:'bin/traverse.mjs'});assert.ok(p.files.includes('src/'));assert.ok(fs.existsSync(path.join(root,'npm-shrinkwrap.json')));assert.ok(!fs.existsSync(path.join(root,'package-lock.json')));
});

test('snapshot refuses output in source directories before creating any parent',t=>{
  const dir=fixture(t);run(dir,['init','--json']);const before=tree(dir);
  for(const folder of ['app','components'])run(dir,['snapshot','--out',path.join(dir,folder,'generated/deep'),'--json'],1);
  assert.deepEqual(tree(dir),before);
});

test('snapshot protects an absent optional source root and leaves doctor ready',t=>{
  const dir=fixture(t);fs.rmSync(path.join(dir,'components'),{recursive:true});run(dir,['init','--json']);const before=tree(dir);
  run(dir,['snapshot','--out',path.join(dir,'components/generated'),'--json'],1);
  assert.deepEqual(tree(dir),before);assert.ok(!fs.existsSync(path.join(dir,'components')));
  assert.deepEqual(JSON.parse(run(dir,['doctor','--json']).stdout).readiness,{extractor:true,configuration:true});
});

test('checkout installer uses stderr progress, clear reruns and silent JSON',t=>{
  const dir=fixture(t),prefix=path.join(dir,'.wayfinder/tool');
  const args=['--prefix',prefix],bin=path.join(root,'bin/install.mjs');
  const r=run(dir,args,0,bin);assert.equal(r.stdout,'');assert.match(r.stderr,/Checking Node and installation/);assert.match(r.stderr,/Installation complete/);assert.match(r.stderr,/init/);assert.doesNotMatch(r.stderr,/Created:|\x1b/);
  const config=fs.readFileSync(path.join(prefix,'config.json'));
  const again=run(dir,args,0,bin);assert.match(again.stderr,/Already installed/);assert.deepEqual(fs.readFileSync(path.join(prefix,'config.json')),config);
  const j=run(dir,[...args,'--json'],0,bin);assert.equal(j.stderr,'');assert.equal(JSON.parse(j.stdout).ready,true);
});

test('a project-relative source alias is supported in a read-only initialization preview',t=>{
  const dir=fixture(t);change(dir,'tsconfig.json',p=>{p.compilerOptions.paths['@/*']=['./src/*'];});const before=tree(dir);
  const result=run(dir,['init','--dry-run','--json']);assert.equal(JSON.parse(result.stdout).mode,'dry-run');assert.deepEqual(tree(dir),before);
});


test('legacy navigation identity refuses initialization and refresh before writes, even with migrate',t=>{
 const dir=fixture(t);run(dir,['init','--json']);
 change(dir,'.wayfinder/project.json',config=>{config.contract='cv-navigation/1';});
 const before=tree(dir);
 for(const args of [['init','--json'],['init','--migrate','--json'],['graph','refresh','--json']]){
  const result=run(dir,args,1);
  assert.match(result.stdout+result.stderr,/Navigation format changed.*preserve.*\.wayfinder.*traverse init/i);
  assert.deepEqual(tree(dir),before);
 }
});
