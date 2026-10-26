import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {attrValue, findDefaultExport, findFunction, objectProps, openingOf, parseTsx, syntaxErrors} from '../src/source/ast.mjs';

function firstJsx(source) {
  const sf = parseTsx('t.tsx', source);
  let found;
  const walk = n => {
    if (!found && (ts.isJsxSelfClosingElement(n) || ts.isJsxElement(n))) found = n;
    else ts.forEachChild(n, walk);
  };
  walk(sf);
  return {sf, open: openingOf(found)};
}

test('a template-literal testID becomes a pattern, a capture list and an anchored regex', () => {
  const {sf, open} = firstJsx('const x = <Button testID={`item-${item.id}`} />;');
  const v = attrValue(sf, open, 'testID');
  assert.deepEqual(v, {kind: 'template', pattern: 'item-{item.id}', regex: '^item-(.+)$', captures: ['item.id']});
  assert.ok(new RegExp(v.regex).test('item-20'));
  assert.ok(!new RegExp(v.regex).test('xitem-20'));
});

test('regex metacharacters in the literal part of a template testID are escaped', () => {
  const {sf, open} = firstJsx('const x = <Button testID={`row.[${id}](a+b)`} />;');
  const v = attrValue(sf, open, 'testID');
  const re = new RegExp(v.regex);
  assert.ok(re.test('row.[7](a+b)'));
  assert.ok(!re.test('rowX[7](a+b)'));
});

test('string literal, braced string, expression and boolean attributes are classified', () => {
  const {sf, open} = firstJsx('const x = <TextInput a="lit" b={"braced"} c={flag} secureTextEntry />;');
  assert.deepEqual(attrValue(sf, open, 'a'), {kind: 'literal', value: 'lit'});
  assert.deepEqual(attrValue(sf, open, 'b'), {kind: 'literal', value: 'braced'});
  assert.deepEqual(attrValue(sf, open, 'c'), {kind: 'expr', text: 'flag'});
  assert.deepEqual(attrValue(sf, open, 'secureTextEntry'), {kind: 'literal', value: true});
  assert.equal(attrValue(sf, open, 'missing'), undefined);
});

test('object-literal props keep string values and mark the rest as expressions', () => {
  const sf = parseTsx('t.tsx', "const o = {title: 'Home', tabBarButtonTestID: 'tab-home', headerShown: false};");
  const init = sf.statements[0].declarationList.declarations[0].initializer;
  const props = objectProps(sf, init);
  assert.deepEqual(props.title, {kind: 'literal', value: 'Home'});
  assert.deepEqual(props.headerShown, {kind: 'expr', text: 'false'});
});

test('syntaxErrors reports the line of a broken file and nothing for a valid one', () => {
  assert.deepEqual(syntaxErrors('ok.tsx', 'export const a = <View />;'), []);
  const errors = syntaxErrors('bad.tsx', 'export const a = 1;\nexport const b = <View>;\n');
  assert.ok(errors.length >= 1);
  assert.equal(errors[0].line, 2);
});

test('component lookup finds function declarations, const arrows and default exports, and nothing else', () => {
  const sf = parseTsx('c.tsx', `export default function Main() { return null; }
const Row = () => null;
const answer = 42;
function helper() {}
export {helper};`);
  assert.equal(findFunction(sf, 'Row').kind, ts.SyntaxKind.ArrowFunction);
  assert.equal(findFunction(sf, 'helper').kind, ts.SyntaxKind.FunctionDeclaration);
  assert.equal(findFunction(sf, 'answer'), null);
  assert.equal(findDefaultExport(sf).name.text, 'Main');
  const alias = parseTsx('d.tsx', 'const Screen = () => null;\nexport default Screen;');
  assert.equal(findDefaultExport(alias).kind, ts.SyntaxKind.ArrowFunction);
  assert.equal(findDefaultExport(parseTsx('e.tsx', 'export const x = 1;')), null);
});
