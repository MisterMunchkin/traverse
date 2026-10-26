import fs from 'node:fs';
import path from 'node:path';
import {CONTRACT, PROFILE, compatibility, manifest, sourceFingerprint, sha, json as canonical} from './extractor-pipeline/contract.mjs';
import {noSymlinks} from './installation.mjs';
import {atomicJson, directory} from './state.mjs';
import {modernProfile,inspectModernProject} from './project-profile.mjs';

const has = p => { try { fs.lstatSync(p); return true; } catch(e) { if(e.code === 'ENOENT') return false; throw e; } };
const fail = message => { throw Error(message); };
const configFile = root => path.join(root, '.wayfinder/project.json');
const staticInputs = ['package.json','package-lock.json','app.json','tsconfig.json'];
const sourceRoots = ['app','components','src'];

export function inspectProject(directory = process.cwd(), {profile} = {}) {
  if(profile!==undefined&&profile!==PROFILE)fail('Unsupported explicit source profile');
  const root = path.resolve(directory);
  noSymlinks(root);
  if (!fs.statSync(root).isDirectory()) fail('Choose an Expo project directory with --project');
  const packageInput=path.join(root,'package.json');noSymlinks(packageInput);
  if(fs.statSync(packageInput).size>1024*1024)fail('Package input exceeds 1 MiB');
  const declared=JSON.parse(fs.readFileSync(packageInput,'utf8'));
  if(!declared.dependencies?.['expo-router'])fail('No supported routing profile detected. This version supports Expo Router57; another framework requires host-owned conformance support before an agent-generated adapter can be accepted.');
  if (profile!==PROFILE&&modernProfile(root)) return inspectModernProject(root);
  const hashes = {};
  function regular(relative, directory = false) {
    const full = path.join(root,relative); noSymlinks(full, {label:'input'});
    const stat = fs.statSync(full);
    if (!(directory ? stat.isDirectory() : stat.isFile())) fail(`Invalid input type: ${relative}`);
    return {full,stat};
  }
  function source(relative) {
    const {full,stat} = regular(relative);
    if (stat.size > 1024 * 1024) fail(`Input exceeds 1 MiB limit: ${relative}`);
    return fs.readFileSync(full,'utf8');
  }
  function json(relative) {
    const content=source(relative);hashes[relative]=sha(content);
    try { return JSON.parse(content); } catch { fail(`Malformed JSON: ${relative}; inspect it locally`); }
  }
  for(const name of ['src/app','app.config.js','app.config.ts','app.config.mjs','app.config.cjs','metro.config.js','metro.config.cjs','metro.config.mjs','babel.config.js','babel.config.cjs']) {
    if(has(path.join(root,name))) fail(`Unsupported project routing input: ${name}; use the static SDK57/root-app profile`);
  }
  const [pkg,lock,app,ts]=staticInputs.map(json);
  if(pkg?.main!=='expo-router/entry') fail('Project requires expo-router/entry');
  if(ts?.extends!=='expo/tsconfig.base'||canonical(ts.compilerOptions?.paths)!==canonical({'@/*':['./*']})||ts.compilerOptions?.baseUrl) fail('Project requires root @/ alias');
  const allowed=['name','slug','version','scheme','userInterfaceStyle','web','plugins'];
  if(!app||Object.keys(app).join()!=='expo'||!app.expo||Object.keys(app.expo).some(k=>!allowed.includes(k))||canonical(app.expo.plugins)!=='["expo-router"]'||canonical(app.expo.web)!=='{"output":"static"}') fail('Unsupported app routing config; use static app.json and the default expo-router plugin');
  const versions={};
  for(const name of ['expo','expo-router']) {
    const installed=json(`node_modules/${name}/package.json`),locked=lock?.packages?.[`node_modules/${name}`];
    const declared=pkg.dependencies?.[name],range=/^(~?)(57)\.0\.(\d+)$/.exec(declared||'');
    if(!range||(range[1]==='~'?Number(installed.version?.split('.')[2])<Number(range[3]):declared!==installed.version)||!locked||installed.name!==name||installed.version!==locked.version||!/^57\.0\.\d+$/.test(installed.version)||declared!==lock.packages?.['']?.dependencies?.[name]) fail(`Missing/incompatible installed, declared or locked ${name}; run npm ci with the project lockfile`);
    versions[name]=installed.version;
  }
  const files={},includedDirectories=['app','components'].filter(dir=>dir==='app'||has(path.join(root,dir)));let bytes=0,count=0;
  function walk(relative,depth=0) {
    if(depth>16) fail('Source directory depth exceeds 16');
    for(const name of fs.readdirSync(regular(relative,true).full).sort()) {
      if(++count>10000) fail('Source entry count exceeds 10000');
      const file=`${relative}/${name}`,s=fs.lstatSync(path.join(root,file));
      if(s.isSymbolicLink()) fail(`Symlink input is unsupported: ${file}`);
      if(s.isDirectory()) walk(file,depth+1);
      else {
        if(!/\.(?:tsx?|jsx?)$/.test(file)) fail(`Unsupported source input: ${file}`);
        if((bytes+=s.size)>16*1024*1024) fail('Source size exceeds 16 MiB');
        files[file]=source(file);
      }
    }
  }
  for(const dir of includedDirectories) walk(dir);
  if(!Object.keys(files).some(f=>f.startsWith('app/')&&!/(^|\/)[_+]/.test(f.slice(4)))) fail('No route source files found under app/');
  const fingerprint=sourceFingerprint(files);
  const settings={framework:{package:'expo-router',version:versions['expo-router']},routing:{config:{app:app.expo,entrypoint:pkg.main,paths:ts.compilerOptions.paths},conventions:{routeRoot:'app',componentAlias:'@/'}},contract:CONTRACT,profile:PROFILE};
  const spec={...settings,source:{revision:`content-sha256:${fingerprint}`,files}};compatibility(spec);
  const config={schema:'wayfinder-project/2',...settings};
  return {root,config,spec,provenance:{schema:'wayfinder-project-snapshot/1',revisionKind:'content-addressed-source-not-git-or-build',sourceFingerprint:fingerprint,sourceManifest:manifest(files),inputHashes:hashes,versions,includedDirectories,limitations:['Static SDK57/root-app conventions','Source inventory, not runtime state or UI effect proof','No installed build identity']}};
}

function currentConfig(project, {migrate = false} = {}) {
  const file=configFile(project.root);noSymlinks(file);
  if(!has(file)) return false;
  const stat=fs.statSync(file);if(!stat.isFile()||stat.size>1024*1024) fail('Project configuration must be a regular file under 1 MiB');
  let value;try { value=JSON.parse(fs.readFileSync(file,'utf8')); } catch { fail('Malformed project configuration; inspect .wayfinder/project.json locally'); }
  if(value.schema==='wayfinder-project/1') {
    if(canonical(value)!==canonical({...project.config,schema:'wayfinder-project/1',projectRoot:project.root})) fail('Legacy project configuration differs from this directory or routing profile');
    if(!migrate) fail('Legacy project configuration requires traverse init --migrate; the original will be preserved locally');
    return 'legacy';
  }
  if(canonical(value)!==canonical(project.config)) fail('Project configuration differs from this routing profile; inspect .wayfinder/project.json and preserve it before explicit replacement');
  return 'portable';
}
const legacyLocalIgnore = '# Wayfinder portable project artifacts\n*\n!/.gitignore\n!/project.json\n!/graph.json\n!/extractor/\n!/extractor/**\n';
const legacyRootIgnore = '# BEGIN Wayfinder project artifacts\n!.wayfinder/\n.wayfinder/*\n!.wayfinder/.gitignore\n!.wayfinder/project.json\n!.wayfinder/graph.json\n!.wayfinder/extractor/\n!.wayfinder/extractor/**\n# END Wayfinder project artifacts\n';
const localIgnore=legacyLocalIgnore.replace('!/project.json\n','!/project.json\n!/settings.json\n');
const rootIgnore=legacyRootIgnore.replace('!.wayfinder/project.json\n','!.wayfinder/project.json\n!.wayfinder/settings.json\n');
function ignorePlan(root) {
  const local=path.join(root,'.wayfinder/.gitignore'),parent=path.join(root,'.gitignore');
  noSymlinks(local);noSymlinks(parent);
  const contents=file=>{if(!has(file))return null;const stat=fs.statSync(file);if(!stat.isFile()||stat.size>1024*1024)fail('Invalid project ignore file');return fs.readFileSync(file,'utf8');};
  const currentLocal=contents(local),currentRoot=contents(parent);
  if(currentLocal!==null&&currentLocal!==localIgnore&&currentLocal!==legacyLocalIgnore)fail('Conflicting .wayfinder/.gitignore; preserve it before initialising portable artifacts');
  if(currentRoot?.includes('# BEGIN Wayfinder')&&!currentRoot.includes(rootIgnore)&&!currentRoot.includes(legacyRootIgnore))fail('Conflicting Traverse ignore block; inspect .gitignore before setup');
  return {local,parent,currentLocal,currentRoot};
}
export function projectIgnoreWrites(root){
  const plan=ignorePlan(root);
  return [...(plan.currentLocal!==localIgnore?[plan.local]:[]),...(!plan.currentRoot?.includes(rootIgnore)?[plan.parent]:[])];
}
export function initProject({project=process.cwd(),dryRun=false,check=false,migrate=false,onProgress=()=>{}}={}) {
  if(check&&dryRun) fail('Choose --check or --dry-run');
  onProgress('Checking Expo project');
  const p=inspectProject(project),existing=currentConfig(p,{migrate}),file=configFile(p.root),ignores=ignorePlan(p.root);
  if(existing!=='portable'&&!check&&!dryRun) {
    onProgress('Creating project configuration');
    fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});noSymlinks(file);
    if(existing==='legacy') {
      const backup=path.join(p.root,'.wayfinder/local/project-v1.json');noSymlinks(backup);directory(path.dirname(backup));
      const original=fs.readFileSync(file);
      if(has(backup)&&!fs.readFileSync(backup).equals(original))fail('Conflicting legacy backup; preserve local/project-v1.json before migration');
      if(!has(backup))fs.writeFileSync(backup,original,{flag:'wx',mode:0o600});
      atomicJson(file,p.config);
    } else fs.writeFileSync(file,JSON.stringify(p.config,null,2)+'\n',{flag:'wx',mode:0o600});
  }
  if(!check&&!dryRun) {
    if(ignores.currentLocal!==localIgnore)fs.writeFileSync(ignores.local,localIgnore,{flag:ignores.currentLocal===null?'wx':'w',mode:0o600});
    if(!ignores.currentRoot?.includes(rootIgnore)) {
      const prefix=ignores.currentRoot??'';
      fs.writeFileSync(ignores.parent,prefix.includes(legacyRootIgnore)?prefix.replace(legacyRootIgnore,rootIgnore):prefix+(prefix&&!prefix.endsWith('\n')?'\n':'')+rootIgnore,{flag:ignores.currentRoot===null?'wx':'w'});
    }
  }
  const ready=existing==='portable'||(!check&&!dryRun);
  return {schema:'wayfinder-init/2',projectRoot:p.root,config:file,framework:p.config.framework,mode:check?'check':dryRun?'dry-run':'init',ready,created:!existing&&!check&&!dryRun,migrated:existing==='legacy'&&!check&&!dryRun,exitCode:check&&!ready?1:0};
}
export function projectStatus(directory=process.cwd()) {
  const p=inspectProject(directory);
  if(!currentConfig(p)) fail('Project is not initialised; run traverse init in this directory');
  return p;
}
export function snapshotProject(directory,out) {
  const p=projectStatus(directory),target=path.resolve(out);noSymlinks(target);
  if([...sourceRoots,...p.provenance.includedDirectories].some(dir=>target===path.join(p.root,dir)||target.startsWith(path.join(p.root,dir)+path.sep))) fail('Snapshot output must be outside source directories; use .wayfinder/snapshots/');
  if(has(target)) fail('Snapshot output already exists; choose a new directory');
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.mkdirSync(target,{mode:0o700});
  for(const name of ['spec','provenance']) fs.writeFileSync(path.join(target,name+'.json'),JSON.stringify(p[name],null,2)+'\n',{flag:'wx',mode:0o600});
  return {schema:'wayfinder-snapshot/1',out:target,spec:path.join(target,'spec.json'),sourceFingerprint:p.provenance.sourceFingerprint,framework:p.spec.framework};
}
