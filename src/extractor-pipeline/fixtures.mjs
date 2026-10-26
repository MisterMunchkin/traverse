// Pipeline-owned miniature fixtures and hand-written expectations. Never supplied by an author.
import assert from 'node:assert/strict';
export const files = {
  'app/_layout.tsx': `import {Stack} from 'expo-router';export default()=> <Stack><Stack.Protected guard={signedIn}><Stack.Screen name="(provider)"/></Stack.Protected></Stack>`,
  'app/(provider)/_layout.tsx': `import {Tabs} from 'expo-router';export default()=> <Tabs><Tabs.Screen name="account" options={{href:null,title:'Account'}}/></Tabs>`,
  'app/(provider)/index.tsx': `import Menu from '@/components/menu';export default()=> <Menu/>`,
  'components/menu.tsx': `import {router as nav} from 'expo-router';export default()=> <Button label="Account" onPress={()=>nav.push('/account')}/>`,
  'app/(provider)/account.tsx': `export default()=>null`,
  'app/(provider)/settings.tsx': `export default()=>null`,
  'app/(client)/account.tsx': `export default()=>null`,
  'app/start.tsx': `import {router} from 'expo-router';export default()=> <Button onPress={()=>router.push('/account')}/>`,
  'app/dynamic.tsx': `import {router} from 'expo-router';export default()=> <Button onPress={()=>router.push(nextRoute)}/>`,
  'app/back.tsx': `import {router} from 'expo-router';export default()=> <Button onPress={()=>router.back()}/>`,
};
export const changedFiles = {...files, 'components/menu.tsx': files['components/menu.tsx'].replace("'/account'", "'/settings'").replace('label="Account"', 'label="Settings"')};
export const cases = [{name: 'base', files, destination: '/(provider)/account', label: 'Account'}, {name: 'changed-destination', files: changedFiles, destination: '/(provider)/settings', label: 'Settings'}];
export function expectedFacts(g, fixture, {routeRoot="app"}={}) {
  assert.deepEqual(g.nodes.map(n => n.id).sort(), ['/(client)/account', '/(provider)', '/(provider)/account', '/(provider)/settings', '/back', '/dynamic', '/start'], 'conformance: exact route set');
  assert.deepEqual(g.edges.map(e => ({from: e.from, to: e.to, label: e.label, file: e.source.file, line: e.source.line, method: e.method, kind: e.kind, pure: e.pureNavigation, conditions: e.conditions, chain: e.componentPath})), [{from: '/(provider)', to: fixture.destination, label: fixture.label, file: 'components/menu.tsx', line: 1, method: 'push', kind: 'action', pure: true, conditions: [], chain: [routeRoot+'/(provider)/index.tsx', 'components/menu.tsx']}], 'conformance: exact declared navigation');
  assert.deepEqual(g.unresolved.map(e => [e.owner, e.reason]).sort(), [['/back', 'history-dependent'], ['/dynamic', 'dynamic-target'], ['/start', 'ambiguous-route']], 'conformance: retained uncertainty');
  assert.deepEqual(g.unresolved.find(e => e.owner === '/start').candidates.sort(), ['/(client)/account', '/(provider)/account']);
  assert.deepEqual(g.nodes.filter(n => n.guards.length).map(n => [n.id, n.guards.map(c => [c.expression, c.truthy])]).sort(), [['/(provider)', [['signedIn', true]]], ['/(provider)/account', [['signedIn', true]]], ['/(provider)/settings', [['signedIn', true]]]], 'conformance: guards');
  assert.deepEqual(g.registrations.map(r => [r.to, r.navigator, r.hidden, r.title]).sort(), [['/(provider)', 'Stack', false, null], ['/(provider)/account', 'Tabs', true, 'Account']], 'conformance: hidden registration');
  assert.ok(g.nodes.find(n => n.id === '/(provider)/account').registrations.some(r => r.hidden), 'conformance: hidden attached');
}
