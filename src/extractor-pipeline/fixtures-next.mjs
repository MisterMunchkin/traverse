// Host-owned synthetic apps and hand-written facts; never selected by an author.
import assert from 'node:assert/strict';
export function nextCases(routeRoot = 'app') {
  const files = {
    [routeRoot + '/layout.tsx']: `import Link from 'next/link';export default function Layout({children}){return <html><body><Link href="/login"/>{children}</body></html>}`,
    [routeRoot + '/page.tsx']: `import Menu from '../components/menu';export default()=> <Menu/>`,
    [routeRoot + '/(members)/layout.tsx']: `import {redirect} from 'next/navigation';export default function Layout({children}){if(!signedIn){redirect('/login')}return children}`,
    [routeRoot + '/(members)/account/page.tsx']: `import {useRouter as useNav} from 'next/navigation';export default function Page(){const nav=useNav();return <><button onClick={()=>nav.push('/posts/42?view=full#title')}/><button onClick={()=>nav.replace(destination)}/><button onClick={()=>nav.back()}/></>}`,
    [routeRoot + '/posts/[id]/page.tsx']: `export default()=>null`,
    [routeRoot + '/docs/[...slug]/page.tsx']: `export default()=>null`,
    [routeRoot + '/shop/[[...slug]]/page.tsx']: `export default()=>null`,
    [routeRoot + '/login/page.tsx']: `export default()=>null`,
    [routeRoot + '/_private/page.tsx']: `export default()=>null`,
    [routeRoot + '/colocated.tsx']: `export default()=>null`,
    [routeRoot + '/api/route.ts']: `export function GET(){return null}`,
    'components/menu.tsx': `import Link from 'next/link';export default()=> <><Link href="/account" aria-label="Account"/><Link href={computed}/><Link href="/missing"/><Link href="../login"/><Link href="https://example.test"/><Link href="/docs/a/b"/><Link href="/shop"/></>`,
  };
  // Actual source paths and relative component imports for both roots.
  if (routeRoot === 'src/app') files[routeRoot + '/page.tsx'] = files[routeRoot + '/page.tsx'].replace('../components/menu', '../../components/menu');
  return [
    {name: 'next-base', profile: 'next-app-source-inventory/1', routeRoot, files, destination: '/(members)/account', label: 'Account'},
    {name: 'next-changed', profile: 'next-app-source-inventory/1', routeRoot, files: {...files, 'components/menu.tsx': files['components/menu.tsx'].replace('href="/account" aria-label="Account"', 'href="/login" aria-label="Login"')}, destination: '/login', label: 'Login'},
    {name: 'next-barrel', profile: 'next-app-source-inventory/1', routeRoot, files: {...files,
      [routeRoot + '/page.tsx']: `import {Menu} from '${routeRoot === 'app' ? '../' : '../../'}components';export default()=> <Menu/>`,
      'components/index.ts': `export {default as Menu} from './forward';export type {Unused} from './missing-types';`,
      'components/forward.ts': `import Menu from './menu';export default Menu;`,
    }, destination: '/(members)/account', label: 'Account', componentPath: [routeRoot + '/page.tsx', 'components/index.ts', 'components/forward.ts', 'components/menu.tsx']},
  ];
}
export function nextFacts(g, fixture) {
  const {routeRoot: root} = fixture;
  assert.deepEqual(g.nodes.map(n => n.id).sort(), ['/', '/(members)/account', '/docs/[...slug]', '/login', '/posts/[id]', '/shop/[[...slug]]'].sort(), 'Next conformance: exact pages');
  assert.ok(g.nodes.every(n => n.role === null && !n.guards.length && !n.registrations.length), 'Next groups do not imply roles or auth guarantees');
  const menu = g.edges.find(e => e.from === '/' && e.label === fixture.label);
  assert.equal(menu?.to, fixture.destination, 'Next conformance: changed component target');
  assert.deepEqual(menu.componentPath, fixture.componentPath ?? [root + '/page.tsx', 'components/menu.tsx']);
  assert.deepEqual(menu.source, {file: 'components/menu.tsx', line: 1, endLine: 1, excerpt: `<Link href="${fixture.destination === '/login' ? '/login' : '/account'}" aria-label="${fixture.label}"/>`});
  assert.equal(g.edges.filter(e => e.source.file === root + '/layout.tsx' && e.to === '/login').length, 6, 'Next conformance: root layout applies to every page');
  assert.ok(g.edges.some(e => e.from === '/(members)/account' && e.to === '/posts/[id]' && e.target === '/posts/42?view=full#title' && e.method === 'push'));
  assert.ok(g.edges.some(e => e.from === '/' && e.to === '/docs/[...slug]'));
  assert.ok(g.edges.some(e => e.from === '/' && e.to === '/shop/[[...slug]]'));
  const redirect = g.edges.filter(e => e.kind === 'redirect');
  assert.equal(redirect.length, 1, 'Next conformance: nested layout scope');
  assert.deepEqual(redirect[0].conditions, [{expression: '!signedIn', truthy: true, file: root + '/(members)/layout.tsx', line: 1}], 'Next conformance: conditional auth redirect');
  assert.equal(redirect[0].from, '/(members)/account');
  assert.deepEqual(g.unresolved.map(e => [e.owner, e.reason]).sort(), [['/', 'dynamic-target'], ['/', 'missing-route'], ['/', 'relative-target'], ['/', 'external-target'], ['/(members)/account', 'dynamic-target'], ['/(members)/account', 'history-dependent']].sort(), 'Next conformance: uncertainty');
  assert.equal(g.registrations.length, 0);
}
