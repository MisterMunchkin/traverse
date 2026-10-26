import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {noSymlinks} from './installation.mjs';
import {CONTRACT,sha,manifest,sourceFingerprint,compatibility} from './extractor-pipeline/contract.mjs';

export const EXPO_PROFILE='expo-source-inventory/2';
const configNames=['app.json','app.config.js','app.config.ts','app.config.mjs','app.config.cjs','metro.config.js','metro.config.cjs','metro.config.mjs','babel.config.js','babel.config.cjs'];
const exists=p=>{try{fs.lstatSync(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
export function modernProfile(root){
 const pinned=path.join(root,'.wayfinder/project.json');noSymlinks(pinned);
 if(exists(pinned)){const stat=fs.statSync(pinned);if(!stat.isFile()||stat.size>1024*1024)throw Error('Invalid project configuration');return JSON.parse(fs.readFileSync(pinned,'utf8')).profile===EXPO_PROFILE;}
 if(['src/app',...configNames.filter(n=>n!=='app.json')].some(n=>exists(path.join(root,n))))return true;
 const file=path.join(root,'tsconfig.json');noSymlinks(file);
 if(exists(file)){if(fs.statSync(file).size>1024*1024)throw Error('tsconfig exceeds 1 MiB');const ts=createRequire(new URL('../package.json',import.meta.url))('typescript'),parsed=ts.parseConfigFileTextToJson(file,fs.readFileSync(file,'utf8'));if(parsed.error)throw Error('Malformed tsconfig.json');if(JSON.stringify(parsed.config.compilerOptions?.paths)!==JSON.stringify({'@/*':['./*']})||parsed.config.compilerOptions?.baseUrl)return true;}
 const app=path.join(root,'app.json');noSymlinks(app);if(exists(app)){if(fs.statSync(app).size>1024*1024)throw Error('App config exceeds 1 MiB');const value=JSON.parse(fs.readFileSync(app,'utf8')),expo=value.expo,allowed=['name','slug','version','scheme','userInterfaceStyle','web','plugins'];if(Object.keys(value).join()!=='expo'||!expo||Object.keys(expo).some(k=>!allowed.includes(k))||JSON.stringify(expo.plugins)!=='["expo-router"]'||JSON.stringify(expo.web)!=='{"output":"static"}')return true;}
 return false;
}
// Parse routing facts, never evaluate app/Metro/Babel config or read environment values.
export function inspectModernProject(root){
 const ts=createRequire(new URL('../package.json',import.meta.url))('typescript'),hashes={};
 function read(name){const full=path.join(root,name);noSymlinks(full,{label:'input'});const st=fs.statSync(full);const limit=name==='package-lock.json'?16:1;if(!st.isFile()||st.size>limit*1024*1024)throw Error(`Input must be a regular file under ${limit} MiB: ${name}`);const text=fs.readFileSync(full,'utf8');hashes[name]=sha(text);return text;}
 const json=name=>{try{return JSON.parse(read(name));}catch(e){if(e instanceof SyntaxError)throw Error(`Malformed JSON: ${name}; inspect it locally`);throw e;}};
 const pkg=json('package.json'),lock=json('package-lock.json');
 if(pkg.main!=='expo-router/entry')throw Error('Unsupported routing entrypoint; this profile requires expo-router/entry. A new framework needs independent conformance support before init can mark it ready.');
 const versions={};
 for(const name of ['expo','expo-router']){
  const installed=json(`node_modules/${name}/package.json`),declared=pkg.dependencies?.[name],m=/^(~?)57\.0\.(\d+)$/.exec(declared??'');
  if(!m||installed.name!==name||!/^57\.0\.\d+$/.test(installed.version??'')||installed.version!==lock.packages?.[`node_modules/${name}`]?.version||declared!==lock.packages?.['']?.dependencies?.[name]||(m[1]?Number(installed.version.split('.')[2])<Number(m[2]):declared!==installed.version))throw Error(`Missing/incompatible installed, declared or locked ${name}; run npm ci with the project lockfile`);
  versions[name]=installed.version;
 }
 const parsed=ts.parseConfigFileTextToJson('tsconfig.json',read('tsconfig.json'));if(parsed.error)throw Error('Malformed tsconfig.json; inspect it locally');
 const tsconfig=parsed.config;
 if(tsconfig.extends!=='expo/tsconfig.base'||tsconfig.compilerOptions?.baseUrl&&!['.','./'].includes(tsconfig.compilerOptions.baseUrl))throw Error('Routing requires static Expo tsconfig and project-relative aliases');
 const aliases=tsconfig.compilerOptions?.paths??{};
 for(const [key,values]of Object.entries(aliases))if(!key.endsWith('/*')||!Array.isArray(values)||values.length!==1||typeof values[0]!=='string'||!values[0].endsWith('/*')||values[0].replace(/^\.\//,'').split('/').some(x=>x==='..'||x==='')||path.isAbsolute(values[0])||/^(?:\.\/)?(?:node_modules|\.git|\.wayfinder)(?:\/|$)/.test(values[0]))throw Error('Routing aliases require one static project-relative wildcard target');
 let plugins,explicitRoot;
 const dynamic=configNames.filter(n=>/^app\.config\./.test(n)&&exists(path.join(root,n)));
 if(dynamic.length>1)throw Error('Ambiguous app configuration; select one app.config input');
 if(exists(path.join(root,'app.json')))plugins=json('app.json')?.expo?.plugins;
 if(dynamic.length){
  const name=dynamic[0],sf=ts.createSourceFile(name,read(name),ts.ScriptTarget.Latest,true);
  if(sf.parseDiagnostics.length)throw Error('App config contains syntax errors');
  const exports=sf.statements.flatMap(n=>ts.isExportAssignment(n)?[n.expression]:ts.isExpressionStatement(n)&&ts.isBinaryExpression(n.expression)&&n.expression.left.getText(sf)==='module.exports'?[n.expression.right]:[]);
  if(exports.length!==1||!ts.isObjectLiteralExpression(exports[0]))throw Error('Dynamic routing config requires a static module.exports or export default object; config is never executed');
  function routingObject(object){
   if(!ts.isObjectLiteralExpression(object))throw Error('Dynamic routing container requires a static object');
   const seen=new Set();for(const p of object.properties){
    if(ts.isSpreadAssignment(p)||p.name&&ts.isComputedPropertyName(p.name))throw Error('Ambiguous computed or spread routing configuration');
    const key=p.name?.getText(sf).replace(/['"]/g,'');
    if(['expo','plugins'].includes(key)){if(seen.has(key))throw Error('Duplicate routing configuration: '+key);seen.add(key);if(!ts.isPropertyAssignment(p))throw Error('Dynamic routing accessor requires a static property: '+key);}
   }
  }
  routingObject(exports[0]);
  const container=exports[0].properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(sf).replace(/['"]/g,'')==='expo')?.initializer??exports[0];
  routingObject(container);
  const candidates=container.properties.filter(p=>ts.isPropertyAssignment(p)&&p.name.getText(sf).replace(/['"]/g,'')==='plugins').map(p=>p.initializer);
  if(candidates.length!==1||!ts.isArrayLiteralExpression(candidates[0]))throw Error('Dynamic routing config: plugins must have one static array declaration; config is never executed');
  function nonRoutingList(node){
   while(ts.isParenthesizedExpression(node))node=node.expression;
   if(ts.isConditionalExpression(node)){nonRoutingList(node.whenTrue);nonRoutingList(node.whenFalse);return;}
   if(!ts.isArrayLiteralExpression(node))throw Error('Dynamic plugin spread requires static branch arrays');
   for(const entry of node.elements){
    if(ts.isSpreadElement(entry)){nonRoutingList(entry.expression);continue;}
    const id=ts.isStringLiteral(entry)?entry.text:ts.isArrayLiteralExpression(entry)&&ts.isStringLiteral(entry.elements[0])?entry.elements[0].text:null;
    if(!id)throw Error('Dynamic plugin identity requires static declarations');
    if(id==='expo-router')throw Error('Conditional Router declaration makes routing ambiguous; use an unconditional static Router plugin');
   }
  }
  plugins=candidates[0].elements.flatMap(n=>{
   if(ts.isSpreadElement(n)){nonRoutingList(n.expression);return [];}
   return [n];
  }).map(n=>{
   if(ts.isStringLiteral(n))return n.text;
   if(ts.isArrayLiteralExpression(n)&&ts.isStringLiteral(n.elements[0])){
    if(n.elements[0].text!=='expo-router')return n.elements[0].text;
    const options=n.elements[1];if(!options||!ts.isObjectLiteralExpression(options))throw Error('Dynamic routing options require static expo-router configuration');
    const values={};for(const p of options.properties){if(!ts.isPropertyAssignment(p))throw Error('Dynamic routing options require static declarations');const key=p.name.getText(sf).replace(/['"]/g,'');if(key==='root'){if(!ts.isStringLiteral(p.initializer))throw Error('Dynamic routing root requires a static value');values.root=p.initializer.text;}else if(!['origin','asyncRoutes','unstable_src'].includes(key))throw Error(`Unsupported expo-router option: ${key}; independent profile support required`);}
    return ['expo-router',values];
   }
   throw Error('Dynamic routing plugins require static declarations');
  });
 }
 if(!Array.isArray(plugins))throw Error('Routing config requires a static expo-router plugin declaration');
 const router=plugins.filter(p=>(Array.isArray(p)?p[0]:p)==='expo-router');if(router.length!==1)throw Error('Routing config requires exactly one expo-router plugin');
 explicitRoot=Array.isArray(router[0])?router[0][1]?.root:undefined;
 if(explicitRoot!==undefined&&!['app','./app','src/app','./src/app'].includes(explicitRoot))throw Error('Unsupported custom routing root; conformance currently covers app/ and src/app/');
 const routeRoot=explicitRoot?.replace(/^\.\//,'')??(exists(path.join(root,'src/app'))?'src/app':'app');
 noSymlinks(path.join(root,routeRoot));if(!fs.statSync(path.join(root,routeRoot)).isDirectory())throw Error(`Missing routing directory: ${routeRoot}`);
 for(const name of configNames)if(exists(path.join(root,name))&&!hashes[name])read(name);
 const roots=[...new Set([routeRoot,'components','src',...Object.values(aliases).map(v=>v[0].replace(/^\.\//,'').slice(0,-2)).filter(s=>s&&s!=='.')])].sort();
 const files={};let count=0,bytes=0;
 function walk(relative,depth=0){noSymlinks(path.join(root,relative),{label:'input'});if(depth>16)throw Error('Source directory depth exceeds 16');for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){if(++count>10000)throw Error('Source entry count exceeds 10000');const name=relative+'/'+entry.name;if(entry.isSymbolicLink())throw Error(`Symlink input is unsupported: ${name}`);if(entry.isDirectory()){if(!['node_modules','.git','.wayfinder'].includes(entry.name))walk(name,depth+1);}else if(/\.[jt]sx?$/.test(name)){const source=read(name);delete hashes[name];bytes+=Buffer.byteLength(source);if(bytes>16*1024*1024)throw Error('Source size exceeds 16 MiB');files[name]=source;}}}
 const includedDirectories=[];for(const name of roots)if(exists(path.join(root,name))&&!includedDirectories.some(parent=>name.startsWith(parent+'/'))){walk(name);includedDirectories.push(name);}
 if(!Object.keys(files).some(f=>f.startsWith(routeRoot+'/')&&!/(^|\/)[_+]/.test(f.slice(routeRoot.length+1))))throw Error(`No route source files found under ${routeRoot}/`);
 const fingerprint=sourceFingerprint(files),settings={framework:{package:'expo-router',version:versions['expo-router']},routing:{config:{entrypoint:pkg.main,aliases},conventions:{routeRoot,componentAlias:'@/'}},contract:CONTRACT,profile:EXPO_PROFILE};
 const spec={...settings,source:{revision:`content-sha256:${fingerprint}`,files}};compatibility(spec);
 return {root,config:{schema:'wayfinder-project/2',...settings},spec,provenance:{schema:'wayfinder-project-snapshot/1',revisionKind:'content-addressed-source-not-git-or-build',sourceFingerprint:fingerprint,sourceManifest:manifest(files),inputHashes:hashes,versions,includedDirectories,limitations:['Static Expo57 navigation facts; configuration is never executed','Source inventory, not runtime state or UI effect proof','No installed build identity']}};
}
