import test from 'node:test';import assert from 'node:assert/strict';
import {extractNavigationSource} from '../src/source/navigation.mjs';

const files={
 'app/_layout.tsx':`import {Stack} from 'expo-router';export default()=> <Stack><Stack.Protected guard={hasToken}><Stack.Screen name="(tabs)"/></Stack.Protected></Stack>`,
 'app/(tabs)/_layout.tsx':`import {Tabs} from 'expo-router';export default()=> <Tabs><Tabs.Protected guard={isProvider}><Tabs.Screen name="(provider)/index" options={{title:'Home'}}/><Tabs.Screen name="(provider)/account" options={{href:null,title:'Account'}}/></Tabs.Protected><Tabs.Protected guard={isClient}><Tabs.Screen name="(client)/account"/></Tabs.Protected></Tabs>`,
 'app/(tabs)/(provider)/index.tsx':`import Menu from '@/components/menu';export default()=> <Menu/>`,
 'components/menu.tsx':`import {router} from 'expo-router';export default()=> <Button accessibilityLabel="Open account" onPress={()=>router.push('/account')}/>`,
 'app/(tabs)/(provider)/account/index.tsx':`import {router} from 'expo-router';export default()=> <Button label="Billing" onPress={()=>router.push('/account/billing')}/>`,
 'app/(tabs)/(provider)/account/billing.tsx':`export default()=>null`,
 'app/(tabs)/(client)/account/index.tsx':`export default()=>null`,
 'app/sign-in.tsx':`import {router} from 'expo-router';export default()=> <Button onPress={()=>router.push('/account')}/>`,
 'app/dynamic.tsx':`import {router} from 'expo-router';export default()=> <Button onPress={()=>router.push(nextStepRoute)}/>`,
 'app/back.tsx':`import {router} from 'expo-router';export default()=> <Button onPress={()=>router.back()}/>`,
 'app/+html.tsx':`export default()=>null`,
};

test('source graph retains grouped identities, actual component ownership and uniquely role-resolved aliases',()=>{
 const g=extractNavigationSource(files),home='/(tabs)/(provider)',account='/(tabs)/(provider)/account';
 assert.ok(g.nodes.some(n=>n.id===account));assert.ok(g.nodes.some(n=>n.id==='/(tabs)/(client)/account'));assert.ok(!g.nodes.some(n=>n.file==='app/+html.tsx'));
 const edge=g.edges.find(e=>e.from===home&&e.to===account);assert.ok(edge);assert.equal(edge.label,'Open account');assert.equal(edge.source.file,'components/menu.tsx');assert.equal(edge.source.line,1);assert.deepEqual(edge.componentPath,['app/(tabs)/(provider)/index.tsx','components/menu.tsx']);assert.equal(edge.pureNavigation,true);
 assert.equal(g.edges.find(e=>e.from===account).to,'/(tabs)/(provider)/account/billing');assert.ok(g.unresolved.some(x=>x.owner==='/sign-in'&&x.reason==='ambiguous-route'));
});

test('layout declarations preserve guard and hidden-tab evidence without inventing a button edge',()=>{
 const g=extractNavigationSource(files),account=g.nodes.find(n=>n.id==='/(tabs)/(provider)/account');
 assert.ok(account.registrations.some(r=>r.hidden===true&&r.guards.some(x=>x.expression==='isProvider')));assert.ok(account.guards.some(x=>x.expression==='hasToken'));assert.ok(account.guards.some(x=>x.expression==='isProvider'));
 assert.ok(!g.edges.some(e=>e.kind==='tab'&&e.to===account));
});

test('unresolved expressions, history and mutation callbacks are explicit rather than fabricated links',()=>{
 const g=extractNavigationSource({...files,'app/mutation.tsx':`import {router} from 'expo-router';export default()=> <Button onPress={async()=>{await save();router.push('/account/billing')}}/>`});
 assert.ok(g.unresolved.some(x=>x.source.file==='app/dynamic.tsx'&&x.reason==='dynamic-target'));assert.ok(g.unresolved.some(x=>x.source.file==='app/back.tsx'&&x.reason==='history-dependent'));assert.equal(g.edges.find(e=>e.from==='/mutation').pureNavigation,false);
});

test('graph extraction is deterministic and source fingerprints change with source evidence',()=>{
 const a=extractNavigationSource(files);assert.deepEqual(a,extractNavigationSource(Object.fromEntries(Object.entries(files).reverse())));const b=extractNavigationSource({...files,'components/menu.tsx':files['components/menu.tsx'].replace('Open account','Account hub')});assert.notEqual(a.sourceFingerprint,b.sourceFingerprint);assert.equal(a.files['components/menu.tsx'].sha256.length,64);
});

test('client provider-detail routes retain the outer client role rather than the subject name',()=>{
 const g=extractNavigationSource({...files,'app/(views)/client/provider/[providerId].tsx':`export default()=>null`});assert.equal(g.nodes.find(n=>n.file==='app/(views)/client/provider/[providerId].tsx').role,'client');
});
