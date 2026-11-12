import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {root} from '../src/extractor-pipeline/pipeline.mjs';
import {DEFAULT_PREFIX} from '../src/installation.mjs';
const hash = b => createHash('sha256').update(b).digest('hex');
const q = s => "'" + s.replaceAll("'", "'\"'\"'") + "'";
const requiredFiles = ['install.sh','package.json','bin/install.mjs','bin/traverse.mjs','bin/extractor-pipeline.mjs','bin/setup.mjs','bin/init.mjs','src/project-profile.mjs','src/project-next.mjs','src/source/next.mjs','src/extractor-pipeline/fixtures-next.mjs','src/adapter-init.mjs','src/extractor-approval.mjs','src/private-state.mjs','src/project-defaults.mjs', 'src/agent-integration.mjs', 'src/skills/traverse.md','bin/graph.mjs','bin/driving.mjs','src/installation.mjs','src/project.mjs','src/presentation.mjs','src/state.mjs','src/graph.mjs','src/model-setup.mjs','src/model-pins.json','src/runtime/ollama.mjs', 'src/settings.mjs', 'src/setup-wizard.mjs', 'src/frontier/provider.mjs', 'src/frontier/codex-worker.mjs', 'src/frontier/config.mjs', 'src/frontier/models.mjs','src/source/navigation.mjs','fixtures/extractor-pipeline/example-spec.json','npm-shrinkwrap.json','src/source/ast.mjs','src/runtime/process.mjs',...['pipeline.mjs','contract.mjs','fixtures.mjs','validate-worker.mjs','profiles.mjs'].map(f=>'src/extractor-pipeline/'+f),...['contract','agent-device','sessions','session-state','choice','policy','loop'].map(n=>'src/driving/'+n+'.mjs')];
function fixture(t, {parser=true, strange=false}={}) {
  const parent = process.env.INSTALLER_TEST_EVIDENCE ?? fs.realpathSync(os.tmpdir()); fs.mkdirSync(parent,{recursive:true});
  const d=fs.mkdtempSync(path.join(parent,'tev1-install-')), source=path.join(d,strange?"source ' $(touch INJECTED) `touch INJECTED2` ; & space":'source'), prefix=path.join(d,strange?"prefix ' $(touch PWNED) `touch PWNED2` ; & space":'prefix');
  fs.mkdirSync(source);for(const name of requiredFiles){const target=path.join(source,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,name),target);}
  fs.chmodSync(path.join(source,'install.sh'),0o755);
  if(parser){fs.mkdirSync(path.join(source,'node_modules'));fs.symlinkSync(path.join(root,'node_modules/typescript'),path.join(source,'node_modules/typescript'),'dir');}
  if(!process.env.INSTALLER_TEST_EVIDENCE)t.after(()=>fs.rmSync(d,{recursive:true,force:true}));
  return {d,source,prefix};
}
function run(f, args, {launcher=false, expect=0, json=true, pidFile=null}={}) {
  const command=launcher?path.join(f.prefix,'bin/traverse'):path.join(f.source,'install.sh');
  const argv=launcher?args:['--prefix',f.prefix,'--node',process.execPath,...args];
  const invokedCommand=pidFile?'/bin/sh':command, invokedArgs=pidFile?['-c','printf \"%s\\n\" \"$$\" > \"$1\"; shift; exec \"$@\"','tev1-test',pidFile,command,...argv]:argv;
  const started=performance.now();const result=spawnSync(invokedCommand,invokedArgs,{encoding:'utf8',cwd:f.source,timeout:25000,env:{PATH:process.env.PATH,HOME:path.join(f.d,'home')},stdio:'pipe'});
  const {stdout='',stderr='',signal}=result,code=result.status,timedOut=result.error?.code==='ETIMEDOUT';
  if(process.env.INSTALLER_TEST_EVIDENCE)fs.writeFileSync(path.join(f.d,`cli-${randomUUID()}.json`),JSON.stringify({command:invokedCommand,args:invokedArgs,cwd:f.source,node:process.version,platform:process.platform,arch:process.arch,code,signal,timedOut,timeoutMs:25000,elapsedMs:performance.now()-started,stdout,stderr},null,2));
  assert.equal(code,expect,`${command} ${JSON.stringify(argv)}\n${stdout}\n${stderr}`);
  if(!json)return stdout+stderr;
  const parsed=JSON.parse(stdout);if(launcher&&args[0]==='doctor')assert.equal(parsed.schema,'wayfinder-doctor/2');if(!launcher)assert.equal(parsed.schema,'wayfinder-install-result/2');return parsed;
}
function snapshot(directory) { const result={};function walk(dir){if(!fs.existsSync(dir))return;for(const entry of fs.readdirSync(dir)){if(/^cli-.*\.json$/.test(entry))continue;const p=path.join(dir,entry),s=fs.lstatSync(p);if(s.isSymbolicLink())result[path.relative(directory,p)]='link:'+fs.readlinkSync(p);else if(s.isDirectory())walk(p);else result[path.relative(directory,p)]=hash(fs.readFileSync(p));}}walk(directory);return result; }
function npmStub(f, body) {
  const js=path.join(f.d,'npm stub.mjs'), bin=path.join(f.d,"npm ' literal");fs.writeFileSync(js,body);fs.writeFileSync(bin,`#!/bin/sh\nexec ${q(process.execPath)} ${q(js)} "$@"\n`,{mode:0o755});return bin;
}
const setupParser = `import fs from 'node:fs';import path from 'node:path';const args=process.argv.slice(2),prefix=args[args.indexOf('--prefix')+1];fs.mkdirSync(path.join(prefix,'node_modules'),{recursive:true});fs.symlinkSync(${JSON.stringify(path.join(root,'node_modules/typescript'))},path.join(prefix,'node_modules/typescript'),'dir');console.log('locked parser provided by explicit test fixture');`;

test('Traverse installs its canonical launcher, schemas and source pins through literal paths and preserves config', t=>{
  const f=fixture(t,{strange:true}), installed=run(f,['--json']);assert.equal(installed.ready,true);
  assert.equal(installed.schema,'wayfinder-install-result/2');
  assert.ok(fs.existsSync(path.join(f.prefix,'bin/traverse')));assert.ok(!fs.existsSync(path.join(f.prefix,'bin/tev1-lab')));
  const metadata=JSON.parse(fs.readFileSync(path.join(f.prefix,'installation.json')));assert.equal(metadata.schema,'wayfinder-checkout-install/1');
  assert.ok(metadata.sourceIdentity.sources['bin/traverse.mjs']);assert.ok(!Object.hasOwn(metadata.sourceIdentity.sources,'bin/tev1-lab.mjs'));
  const report=run(f,['doctor','--json'],{launcher:true});assert.equal(report.schema,'wayfinder-doctor/2');assert.deepEqual(report.readiness,{extractor:true,configuration:true});assert.equal(report.checks.find(c=>c.name==='extractor-smoke').evidence.edges,1);
  const configPath=path.join(f.prefix,'config.json'), config=JSON.parse(fs.readFileSync(configPath));assert.equal(config.schema,'wayfinder-config/1');config.tools.frontier=process.execPath;fs.writeFileSync(configPath,JSON.stringify(config,null,4)+'\n');const before=fs.readFileSync(configPath);
  assert.deepEqual(run(f,['--json']).created,[]);assert.deepEqual(fs.readFileSync(configPath),before);
  const strict=run(f,['doctor','--json','--require-driving'],{launcher:true,expect:1});assert.equal(strict.checks[0].name,'command-options');assert.match(strict.checks[0].evidence,/require-driving/);
  assert.match(run(f,['doctor'],{launcher:true,json:false}),/Traverse.*Configuration: READY/);
  assert.match(run(f,['extractor','--help'],{launcher:true,json:false}),/prepare/);
  assert.match(run(f,['--help'],{json:false}),/Traverse/);
  assert.match(run(f,['--help'],{launcher:true,json:false}),/Usage: traverse init/);
  for(const p of ['PWNED','PWNED2','INJECTED','INJECTED2'])assert.ok(!fs.existsSync(path.join(f.source,p))&&!fs.existsSync(path.join(f.d,p)));
  const request=path.join(f.d,'request'),artifact=path.join(f.d,'artifact.json'),review=path.join(f.d,'review.json'),accepted=path.join(f.d,'accepted');
  run(f,['extractor','prepare','--spec',path.join(f.source,'fixtures/extractor-pipeline/example-spec.json'),'--out',request],{launcher:true});
  run(f,['extractor','reference','--request',path.join(request,'request.json'),'--out',artifact],{launcher:true});
  const inspected=run(f,['extractor','inspect','--artifact',artifact],{launcher:true});
  run(f,['extractor','review','--artifact',artifact,'--hash',inspected.artifactHash,'--reviewer','test-reviewed-reference','--trust-host','--out',review],{launcher:true});
  run(f,['extractor','accept','--request',path.join(request,'request.json'),'--artifact',artifact,'--review',review,'--out',accepted],{launcher:true});
  assert.equal(JSON.parse(fs.readFileSync(path.join(accepted,'graph.json'))).edges[0].to,'/account');
});
test('check and dry-run perform no filesystem/setup changes with missing or existing parser/install', t=>{
  for(const parser of [false,true]){const f=fixture(t,{parser}),before=snapshot(f.d);
    const dry=run(f,['--dry-run','--json']);assert.equal(dry.parser.ready,parser);assert.deepEqual(snapshot(f.d),before);
    run(f,['--check','--json'],{expect:1});assert.deepEqual(snapshot(f.d),before);
    if(parser){run(f,['--json']);const installed=snapshot(f.d);run(f,['--check','--json']);run(f,['--dry-run','--json']);assert.deepEqual(snapshot(f.d),installed);}
  }
});
test('bootstrap loads with parser absent and bounded explicit npm supplies actual dependency', t=>{
  const f=fixture(t,{parser:false});assert.ok(!fs.existsSync(path.join(f.source,'node_modules')));
  const npm=npmStub(f,setupParser),result=run(f,['--npm',npm,'--json']);assert.equal(result.parser.observed,'6.0.3');
  const record=JSON.parse(fs.readFileSync(path.join(f.prefix,'logs',fs.readdirSync(path.join(f.prefix,'logs'))[0])));assert.equal(record.code,0);assert.equal(record.signal,null);assert.ok(record.args.includes('--ignore-scripts'));assert.ok(record.args.includes(path.join(f.prefix,'npm-cache')));
  assert.ok(record.args.includes('--omit=dev'), 'Runtime parser bootstrap must omit repository development tools');
  assert.equal(run(f,['doctor','--json'],{launcher:true}).readiness.extractor,true);
  fs.unlinkSync(path.join(f.source,'node_modules/typescript'));
  const broken=run(f,['doctor','--json'],{launcher:true,expect:1});assert.equal(broken.checks.find(c=>c.name==='parser-version').status,'fail');assert.equal(broken.readiness.configuration,false);
});
test('failed and nonresponding dependency setup retain bounded diagnostics without a ready launcher', t=>{
  for(const [name,body] of [['failed',"console.error('fixture setup failure');process.exit(7)"],['hung','setInterval(()=>{},1000)']]){
    const f=fixture(t,{parser:false}),npm=npmStub(f,body);run(f,['--npm',npm,'--timeout-ms',name==='hung'?'150':'5000','--json'],{expect:1});
    assert.ok(!fs.existsSync(path.join(f.prefix,'bin/traverse')));assert.equal(JSON.parse(fs.readFileSync(path.join(f.prefix,'installation.json'))).state,'preparing');
    const record=JSON.parse(fs.readFileSync(path.join(f.prefix,'logs',fs.readdirSync(path.join(f.prefix,'logs'))[0])));
    if(name==='hung'){assert.equal(record.timedOut,true);assert.ok(record.signal);assert.ok(record.elapsedMs<2000);}else assert.equal(record.code,7);
  }
});
test('missing/wrong parser and incompatible Node fail actionably without using shared dependencies', t=>{
  const f=fixture(t,{parser:false});fs.mkdirSync(path.join(f.source,'node_modules/typescript'),{recursive:true});fs.writeFileSync(path.join(f.source,'node_modules/typescript/package.json'),JSON.stringify({version:'0.0.0'}));
  assert.equal(run(f,['--dry-run','--json']).parser.ready,false);
  const missingNode=path.join(f.d,'missing-node');assert.throws(()=>execFileSync(path.join(f.source,'install.sh'),['--prefix',f.prefix,'--node',missingNode],{stdio:'pipe'}),/Node is missing/);assert.ok(!fs.existsSync(f.prefix));
  const old=path.join(f.d,'old-node.mjs');fs.writeFileSync(old,"Object.defineProperty(process.versions,'node',{value:'20.0.0'});");
  let output;try{execFileSync(process.execPath,['--import',old,path.join(f.source,'bin/install.mjs'),'--prefix',f.prefix,'--json'],{encoding:'utf8'});}catch(e){output=JSON.parse(e.stdout);assert.equal(e.status,1);}
  assert.match(output.error,/incompatible/);assert.ok(!fs.existsSync(f.prefix));
});
test('a repository dependency uses the hoisted pinned parser and still refuses an incompatible version',t=>{
  const f=fixture(t,{parser:false});fs.mkdirSync(path.join(f.d,'node_modules'));
  fs.symlinkSync(path.join(root,'node_modules/typescript'),path.join(f.d,'node_modules/typescript'),'dir');
  assert.equal(run(f,['--dry-run','--json']).parser.ready,true);
  run(f,['--json']);assert.equal(run(f,['doctor','--json'],{launcher:true}).readiness.configuration,true);
  const wrong=fixture(t,{parser:false}),folder=path.join(wrong.d,'node_modules/typescript');fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(path.join(folder,'package.json'),JSON.stringify({name:'typescript',version:'0.0.0'}));
  assert.equal(run(wrong,['--dry-run','--json']).parser.ready,false);assert.equal(fs.existsSync(wrong.prefix),false);
});
test('malformed/stale config, changed source and conflicting launcher fail without rewriting configuration', t=>{
  for(const kind of ['malformed','stale','source','launcher']){const f=fixture(t);run(f,['--json']);const cp=path.join(f.prefix,'config.json');
    if(kind==='malformed')fs.writeFileSync(cp,'{"secret":"DO-NOT-DISCLOSE"');
    if(kind==='stale'){const c=JSON.parse(fs.readFileSync(cp));c.schema='unknown/9';fs.writeFileSync(cp,JSON.stringify(c));}
    if(kind==='source')fs.appendFileSync(path.join(f.source,'src/source/navigation.mjs'),'\n// changed');
    if(kind==='launcher')fs.appendFileSync(path.join(f.prefix,'bin/traverse'),'\n# unrelated owner edit');
    const before=fs.readFileSync(cp),report=run(f,['doctor','--json'],{launcher:true,expect:1});assert.equal(report.readiness.extractor,false);assert.ok(!JSON.stringify(report).includes('DO-NOT-DISCLOSE'));
    const failure=run(f,['--json'],{expect:1});assert.ok(!JSON.stringify(failure).includes('DO-NOT-DISCLOSE'));assert.deepEqual(fs.readFileSync(cp),before);
  }
});
test('unowned prefixes and symlink destination escapes are refused; explicit project is read-only', t=>{
  const f=fixture(t),other=path.join(f.d,'other');fs.mkdirSync(other);fs.writeFileSync(path.join(other,'keep'),'unchanged');fs.symlinkSync(other,f.prefix,'dir');run(f,['--json'],{expect:1});assert.deepEqual(fs.readdirSync(other),['keep']);fs.unlinkSync(f.prefix);
  fs.mkdirSync(f.prefix);fs.writeFileSync(path.join(f.prefix,'unowned'),'keep');run(f,['--json'],{expect:1});assert.equal(fs.readFileSync(path.join(f.prefix,'unowned'),'utf8'),'keep');fs.rmSync(f.prefix,{recursive:true});
  const project=path.join(f.d,'explicit project');fs.mkdirSync(path.join(project,'.git'),{recursive:true});fs.writeFileSync(path.join(project,'data'),'untouched');const before=snapshot(project);run(f,['--project',project,'--json']);assert.deepEqual(snapshot(project),before);
  const cp=path.join(f.prefix,'config.json');fs.unlinkSync(cp);fs.symlinkSync(path.join(other,'keep'),cp);run(f,['--json'],{expect:1});assert.equal(fs.readFileSync(path.join(other,'keep'),'utf8'),'unchanged');
});
test('launcher emits parseable required-failure JSON if its configured Node becomes missing', t=>{
  const f=fixture(t);run(f,['--json']);const lp=path.join(f.prefix,'bin/traverse');fs.writeFileSync(lp,fs.readFileSync(lp,'utf8').replace('node='+q(process.execPath),'node='+q(path.join(f.d,'missing-node'))));
  const result=run(f,['doctor','--json'],{launcher:true,expect:1});assert.equal(result.readiness.extractor,false);assert.equal(result.readiness.configuration,false);assert.equal(result.checks[0].name,'launcher-runtime');
});

test('missing source bootstrap modules produce structured doctor failure', t=>{
  const f=fixture(t);run(f,['--json']);
  fs.unlinkSync(path.join(f.source,'src/extractor-pipeline/contract.mjs'));
  const report=run(f,['doctor','--json'],{launcher:true,expect:1});
  assert.deepEqual(report.readiness,{extractor:false,configuration:false});
  assert.equal(report.checks[0].name,'launcher-startup');
});

test('installed extractor directly owns author retries and preserves supported per-attempt budgets', t=>{
  const f=fixture(t);run(f,['--json']);const request=path.join(f.d,'request');
  run(f,['extractor','prepare','--spec',path.join(f.source,'fixtures/extractor-pipeline/example-spec.json'),'--out',request],{launcher:true});
  const parents=path.join(f.d,'parents.json'),script=path.join(f.d,'fake-author.mjs'),config=path.join(f.d,'author-config.json'),out=path.join(f.d,'authored'),pidFile=path.join(f.d,'launcher.pid');
  fs.writeFileSync(script,`import fs from 'node:fs';const data=JSON.parse(fs.readFileSync(0,'utf8'));const p=${JSON.stringify(parents)};const list=fs.existsSync(p)?JSON.parse(fs.readFileSync(p)):[];list.push(process.ppid);fs.writeFileSync(p,JSON.stringify(list));process.stdout.write(list.length===1?'bad-first-attempt':JSON.stringify(data.request.requirements.artifactTemplate));`);
  const settings={command:process.execPath,args:[script],identity:{kind:'fake',provider:'offline',model:'direct-ownership-fixture',effort:'none'},timeoutMs:120000,maxAttempts:3};
  fs.writeFileSync(config,JSON.stringify(settings));
  run(f,['extractor','author','--request',path.join(request,'request.json'),'--config',config,'--out',out],{launcher:true,pidFile});
  const top=Number(fs.readFileSync(pidFile,'utf8'));assert.deepEqual(JSON.parse(fs.readFileSync(parents)),[top,top]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out,'config.json'))),settings);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out,'author-receipt.json'))).attempts,2);
  for(const n of [1,2])assert.equal(JSON.parse(fs.readFileSync(path.join(out,`attempt-${n}/process.json`))).timeoutMs,120000);
});

test('Traverse default prefix is canonical without installing into the real home', ()=>{
  assert.equal(DEFAULT_PREFIX,path.join(os.homedir(),'.local/share/traverse'));
  assert.ok(fs.existsSync(path.join(root,'bin/traverse.mjs')));
  assert.ok(!fs.existsSync(path.join(root,'bin/tev1-lab.mjs')));
});

test('Traverse refuses legacy installation and config identities without migration or overwrite', t=>{
  for(const field of ['installation','config']){
    const f=fixture(t);run(f,['--json']);const file=path.join(f.prefix,field+'.json'),value=JSON.parse(fs.readFileSync(file));
    value.schema=field==='installation'?'tev1-lab-checkout-install/1':'tev1-lab-config/1';fs.writeFileSync(file,JSON.stringify(value));
    const before=snapshot(f.prefix);run(f,['--json'],{expect:1});run(f,['doctor','--json'],{launcher:true,expect:1});assert.deepEqual(snapshot(f.prefix),before);
  }
});


test('checkout doctor checks only configured optional paths and fails an unavailable explicit tool', t => {
  const f = fixture(t); run(f, ['--json'], {json: false});
  const initial = JSON.parse(run(f, ['doctor', '--json'], {launcher: true, json: false}));
  assert.ok(!initial.checks.some(c => c.name.startsWith('optional-')), 'Unset tools are not configuration problems');
  const file = path.join(f.prefix, 'config.json'), config = JSON.parse(fs.readFileSync(file));
  config.tools.agentDevice = path.join(f.d, 'missing-runner'); fs.writeFileSync(file, JSON.stringify(config));
  const before = fs.readFileSync(file);
  const failed = JSON.parse(run(f, ['doctor', '--json'], {launcher: true, json: false, expect: 1}));
  assert.equal(failed.readiness.configuration, false); assert.equal(failed.readiness.extractor, true);
  const check = failed.checks.find(c => c.name === 'optional-agentDevice'); assert.equal(check.status, 'fail');
  assert.equal(check.severity, 'required'); assert.equal(check.evidence.executed, false);
  assert.match(run(f, ['extractor', '--help'], {launcher: true, json: false}), /prepare/);
  const request = path.join(f.d, 'request'), artifact = path.join(f.d, 'artifact.json');
  run(f, ['extractor', 'prepare', '--spec', path.join(f.source, 'fixtures/extractor-pipeline/example-spec.json'), '--out', request], {launcher: true});
  run(f, ['extractor', 'reference', '--request', path.join(request, 'request.json'), '--out', artifact], {launcher: true});
  assert.ok(JSON.parse(fs.readFileSync(artifact)).schema);
  assert.deepEqual(fs.readFileSync(file), before);
});

for(const changed of ['src/driving/session-state.mjs','bin/init.mjs','src/project-profile.mjs','src/project-next.mjs','src/source/next.mjs','src/extractor-pipeline/fixtures-next.mjs','src/adapter-init.mjs','src/extractor-approval.mjs','src/private-state.mjs','src/project-defaults.mjs','src/agent-integration.mjs','src/skills/traverse.md'])test(`checkout source pins reject changed ${changed} before initialization writes`,t=>{
  const f=fixture(t);run(f,['--json']);
  const before=fs.readFileSync(path.join(f.prefix,'config.json'));
  fs.appendFileSync(path.join(f.source,changed),'\n// edited after installation\n');
  const report=run(f,['doctor','--json'],{launcher:true,expect:1});
  assert.equal(report.checks.find(check=>check.name==='source-integrity').status,'fail');
  const init=run(f,['init','--project',f.source,'--no-interactive','--json'],{launcher:true,expect:1});
  assert.match(init.error,/Installation is not ready/);assert.equal(fs.existsSync(path.join(f.source,'.wayfinder')),false);
  assert.deepEqual(fs.readFileSync(path.join(f.prefix,'config.json')),before);
});
