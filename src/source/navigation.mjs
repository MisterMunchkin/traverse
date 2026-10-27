import path from 'node:path';
import {extractNextSource} from './next.mjs';
import {CONTRACT} from '../extractor-pipeline/contract.mjs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {parseTsx,attrValue,attrExpression,loc,unwrap} from './ast.mjs';
const ts=createRequire(new URL('../../package.json',import.meta.url))('typescript');
const hash=x=>createHash('sha256').update(x).digest('hex');
const url=id=>'/'+id.split('/').filter(s=>s&&!/^\(.*\)$/.test(s)).join('/');
const roleOf=id=>id.split('/').find(s=>['provider','client','(provider)','(client)'].includes(s))?.replace(/[()]/g,'')??null;
const literal=v=>v?.kind==='literal'?v.value:undefined;
function conditions(sf,node){
 const result=[];
 for(let n=node.parent;n;n=n.parent){
  if(ts.isJsxElement(n)&&n.openingElement.tagName.getText(sf).endsWith('.Protected')){const g=attrExpression(n.openingElement,'guard');if(g)result.push({expression:g.getText(sf),truthy:true,...loc(sf,g)})}
  if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken&&node.getStart(sf)>=n.right.getStart(sf))result.push({expression:n.left.getText(sf),truthy:true,...loc(sf,n.left)});
  if(ts.isConditionalExpression(n))result.push({expression:n.condition.getText(sf),truthy:node.getStart(sf)>=n.whenTrue.getStart(sf)&&node.end<=n.whenTrue.end,...loc(sf,n.condition)});
 }
 return result;
}
function sourceAt(sf,node){return {...loc(sf,node),endLine:sf.getLineAndCharacterOfPosition(node.end).line+1,excerpt:node.getText(sf).slice(0,260)}}
function localModule(files,from,spec,aliases){
 const match=Object.entries(aliases).sort(([a],[b])=>b.length-a.length||a.localeCompare(b)).find(([key])=>spec.startsWith(key.slice(0,-1)));
 if(match)spec="./"+match[1][0].replace(/\*$/,spec.slice(match[0].length-1)).replace(/^\.\//,"");
 if(match){const stem=path.posix.normalize(spec);return [stem,stem+".tsx",stem+".ts",stem+".jsx",stem+".js",stem+"/index.tsx",stem+"/index.ts",stem+"/index.jsx",stem+"/index.js"].find(p=>Object.hasOwn(files,p))??null;}
 const stem=spec.startsWith('@/')?spec.slice(2):spec.startsWith('.')?path.posix.normalize(path.posix.join(path.posix.dirname(from),spec)):null;
 return stem===null?null:[stem,stem+'.tsx',stem+'.ts',stem+'/index.tsx',stem+'/index.ts'].find(p=>Object.hasOwn(files,p))??null;
}
function valueTargets(sf,node,defs,seen=new Set()){
 const n=node&&unwrap(node);if(!n)return [];
 if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n))return [{path:n.text,conditions:[]}];
 if(ts.isTemplateExpression(n))return [{path:n.head.text+n.templateSpans.map(s=>'${'+s.expression.getText(sf)+'}'+s.literal.text).join(''),conditions:[],template:true}];
 if(ts.isObjectLiteralExpression(n)){const p=n.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(sf).replace(/['"]/g,'')==='pathname');return p?valueTargets(sf,p.initializer,defs,seen):[]}
 if(ts.isConditionalExpression(n))return [[n.whenTrue,true],[n.whenFalse,false]].flatMap(([v,truthy])=>valueTargets(sf,v,defs,seen).map(x=>({...x,conditions:[...x.conditions,{expression:n.condition.getText(sf),truthy,...loc(sf,n.condition)}]})));
 if(ts.isIdentifier(n)&&!seen.has(n.text)&&defs.get(n.text)?.length===1)return valueTargets(sf,defs.get(n.text)[0],defs,new Set([...seen,n.text]));
 return [];
}
function routeMatches(target,node){
 const want=target.split('/').filter(Boolean),have=node.split('/').filter(Boolean);if(want.length!==have.length)return false;
 return want.every((s,i)=>s===have[i]||/^\[.+\]$/.test(have[i])||/^\[.+\]$/.test(s)||s.includes('${'));
}
function resolveTarget(target,owner,nodes){
 if(!target.startsWith('/'))return {reason:/^[a-z]+:/i.test(target)?'external-target':'relative-target',candidates:[]};
 const qualified=target.split('/').some(s=>/^\(.+\)$/.test(s));let matches=nodes.filter(n=>routeMatches(target,qualified?n.id:n.url));
 if(matches.length>1&&roleOf(owner)){const same=matches.filter(n=>n.role===roleOf(owner));if(same.length)matches=same}
 return matches.length===1?{to:matches[0].id}:{reason:matches.length?'ambiguous-route':'missing-route',candidates:matches.map(n=>n.id)};
}
function controlFor(sf,node){
 let open,fn;
 for(let n=node;n;n=n.parent){if(!fn&&(ts.isArrowFunction(n)||ts.isFunctionExpression(n)))fn=n;if(ts.isJsxAttribute(n)){open=n.parent.parent;break}}
 let label;if(open?.attributes)for(const name of ['accessibilityLabel','label','title']){const v=literal(attrValue(sf,open,name));if(typeof v==='string'){label=v;break}}
 let pure=false;
 if(fn){const b=unwrap(fn.body);pure=b===node||ts.isBlock(b)&&b.statements.length===1&&ts.isExpressionStatement(b.statements[0])&&b.statements[0].expression===node}
 return {label:label??null,pureNavigation:pure,disabled:open?.attributes?attrValue(sf,open,'disabled'):undefined};
}

// An AST inventory of declared navigation, not a proof of runtime visibility or business effects.
export function extractNavigationSource(input,{routeRoot="app",aliases={"@/*":["./*"]},profile}={}){
 if(profile==='next-app-source-inventory/1')return extractNextSource(input,{routeRoot,aliases});
 const routeId=file=>"/"+file.slice(routeRoot.length+1).replace(/\.[jt]sx?$/,"").replace(/(^|\/)index$/,"").replace(/\/$/,"");
 const files=Object.fromEntries(Object.entries(input).sort(([a],[b])=>a.localeCompare(b))),sfs=new Map(),imports=new Map(),sitesByFile=new Map(),registrations=[];
 const nodes=Object.keys(files).filter(f=>f.startsWith(routeRoot+'/')&&/\.[jt]sx?$/.test(f)&&!/(^|\/)(?:_|\+)/.test(f.slice(routeRoot.length+1))).map(file=>({id:routeId(file),url:url(routeId(file)),file,role:roleOf(routeId(file)),registrations:[],guards:[]}));
 for(const[file,text]of Object.entries(files)){
  const sf=/\.[jt]sx$/.test(file)?parseTsx(file,text):ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);sfs.set(file,sf);
  const defs=new Map(),bindings=new Map(),routerNames=new Set(),hookNames=new Set(),expoTags=new Map(),usedTags=new Set(),sites=[];
  const visitDefs=n=>{if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.initializer){if(!defs.has(n.name.text))defs.set(n.name.text,[]);defs.get(n.name.text).push(n.initializer)}if(ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n))usedTags.add(n.tagName.getText(sf).split('.')[0]);ts.forEachChild(n,visitDefs)};visitDefs(sf);
  for(const n of sf.statements)if(ts.isImportDeclaration(n)&&ts.isStringLiteral(n.moduleSpecifier)&&n.importClause){const spec=n.moduleSpecifier.text,c=n.importClause,local=localModule(files,file,spec,aliases);if(c.name&&local)bindings.set(c.name.text,local);if(c.namedBindings&&ts.isNamedImports(c.namedBindings))for(const b of c.namedBindings.elements){const name=(b.propertyName??b.name).text;if(local)bindings.set(b.name.text,local);if(spec==='expo-router'){if(name==='router')routerNames.add(b.name.text);if(name==='useRouter')hookNames.add(b.name.text);expoTags.set(b.name.text,name)}}}
  for(const[name,values]of defs)if(values.length===1&&ts.isCallExpression(unwrap(values[0]))&&hookNames.has(unwrap(values[0]).expression.getText(sf)))routerNames.add(name);
  imports.set(file,[...bindings].filter(([name])=>usedTags.has(name)).map(([,f])=>f));
  const walk=n=>{
   if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&routerNames.has(n.expression.expression.getText(sf))){const method=n.expression.name.text;
    if(['push','replace','navigate','dismissTo','back','dismiss','dismissAll'].includes(method)){const control=controlFor(sf,n),targets=valueTargets(sf,n.arguments[0],defs);sites.push({kind:['back','dismiss','dismissAll'].includes(method)?'history':'action',method,targets,expression:n.arguments[0]?.getText(sf)??null,conditions:conditions(sf,n),source:sourceAt(sf,n),...control})}
   }
   if(ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n)){const tag=n.tagName.getText(sf),parts=tag.split('.'),name=expoTags.get(parts[0]);
    if((name==='Stack'||name==='Tabs')&&parts[1]==='Screen'){const screen=literal(attrValue(sf,n,'name')),options=attrExpression(n,'options');let title=null,hidden=false,presentation=null;
     if(options&&ts.isObjectLiteralExpression(unwrap(options)))for(const p of unwrap(options).properties)if(ts.isPropertyAssignment(p)){const key=p.name.getText(sf).replace(/['"]/g,''),v=unwrap(p.initializer);if(key==='title'&&ts.isStringLiteral(v))title=v.text;if(key==='href'&&v.kind===ts.SyntaxKind.NullKeyword)hidden=true;if(key==='presentation'&&ts.isStringLiteral(v))presentation=v.text}
     const parent='/'+path.posix.dirname(file).slice(routeRoot.length).replace(/^\//,'');const to=screen===undefined?routeId(file):routeId(routeRoot+'/'+path.posix.join(parent.slice(1),screen)+'.tsx');registrations.push({to,navigator:name,hidden,title,presentation,guards:conditions(sf,n),source:sourceAt(sf,n)})
    }
    if(name==='Link'||name==='Redirect'){const href=attrExpression(n,'href'),v=attrValue(sf,n,'href');sites.push({kind:name==='Redirect'?'redirect':'action',method:name,targets:href?valueTargets(sf,href,defs):typeof literal(v)==='string'?[{path:literal(v),conditions:[]}]:[],expression:href?.getText(sf)??literal(v)??null,label:literal(attrValue(sf,n,'accessibilityLabel'))??null,pureNavigation:true,conditions:conditions(sf,n),source:sourceAt(sf,n)})}
   }
   ts.forEachChild(n,walk);
  };walk(sf);sitesByFile.set(file,sites);
 }
 for(const n of nodes)for(const r of registrations)if(n.id===r.to||n.id.startsWith(r.to+'/')){n.guards.push(...r.guards);if(n.id===r.to){n.registrations.push(r);if(r.title)n.title=r.title}}
 const edges=[],unresolved=[];
 for(const owner of nodes){const queue=[[owner.file]],seen=new Set();for(let i=0;i<queue.length;i++){const chain=queue[i],file=chain.at(-1);if(seen.has(file)||chain.length>8)continue;seen.add(file);
   for(const site of sitesByFile.get(file)??[]){const common={owner:owner.id,componentPath:chain,source:site.source,method:site.method,expression:site.expression};
    if(site.kind==='history'){unresolved.push({...common,reason:'history-dependent'});continue}
    if(!site.targets.length){unresolved.push({...common,reason:'dynamic-target'});continue}
    for(const target of site.targets){const resolved=resolveTarget(target.path,owner.id,nodes),fields={...common,target:target.path,conditions:[...site.conditions,...target.conditions],label:site.label,pureNavigation:site.pureNavigation,kind:site.kind,...(site.disabled?{disabled:site.disabled}:{})};
     if(resolved.to)edges.push({id:'nav-'+hash(JSON.stringify([owner.id,site.source.file,site.source.line,site.source.excerpt,target.path])).slice(0,16),from:owner.id,to:resolved.to,...fields});else unresolved.push({...fields,...resolved})
    }
   }
   for(const next of imports.get(file)??[])queue.push([...chain,next]);
  }}
 const manifest=Object.fromEntries(Object.entries(files).map(([file,text])=>[file,{sha256:hash(text),bytes:Buffer.byteLength(text)}]));
 return {...CONTRACT,parser:'typescript@'+ts.version,sourceFingerprint:hash(JSON.stringify(manifest)),files:manifest,nodes,registrations,sites:[...sitesByFile].flatMap(([file,sites])=>sites.map(s=>({file,...s}))),edges,unresolved,coverage:'partial-static-source',limits:{componentDepth:8,unsupported:['runtime visibility','business/API effects','unresolved dynamic targets','history-dependent targets','imperative helper call graph']},stats:{files:Object.keys(files).length,nodes:nodes.length,registrations:registrations.length,edges:edges.length,unresolved:unresolved.length}};
}
