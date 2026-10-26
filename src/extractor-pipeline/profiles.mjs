// Host-owned profile registry. Adding an author is not adding conformance support.
import assert from 'node:assert/strict';
import path from 'node:path';
import {cases,expectedFacts} from './fixtures.mjs';
export function extractionOptions(compatible){
 if(!compatible||compatible.profile==='expo-source-inventory/1')return {routeRoot:'app',aliases:{'@/*':['./*']}};
 assert.equal(compatible.framework.package,'expo-router','No independent framework conformance support');
 assert.match(compatible.framework.version,/^57\.0\.\d+$/,'No conformance support for this framework version');
 assert.equal(compatible.profile,'expo-source-inventory/2','No independent profile conformance support');
 return {routeRoot:compatible.routing.conventions.routeRoot,aliases:compatible.routing.config.aliases};
}
export function conformanceCases(compatible){
 const {routeRoot}=extractionOptions(compatible);
 if(compatible.profile==='expo-source-inventory/1')return cases;
 // Fixture source is authored for each real layout; requested project paths are never rewritten.
 return cases.map(fixture=>({...fixture,files:Object.fromEntries(Object.entries(fixture.files).map(([name,text])=>{
  const file=name.startsWith('app/')?routeRoot+name.slice(3):name;
  const target=path.posix.relative(path.posix.dirname(file),'components/menu');
  return [file,text.replace("@/components/menu",target.startsWith('.')?target:'./'+target)];
 })),routeRoot}));
}
export function conformanceFacts(graph,fixture){
 if(!fixture.routeRoot)return expectedFacts(graph,fixture);
 expectedFacts(graph,fixture,{routeRoot:fixture.routeRoot});
}
