import ts from 'typescript';

export const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parseTsx(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

// transpileModule reports only syntactic diagnostics, which is exactly the gate we want.
export function syntaxErrors(file, text) {
  const out = ts.transpileModule(text, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest},
  });
  return (out.diagnostics ?? []).map(d => ({
    line: d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0,
    message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
  }));
}

export const base = file => file.split('/').pop();
export const loc = (sf, node) => ({file: sf.fileName, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1});

export function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression;
  return node;
}

export const isJsxNode = n => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n);
export const openingOf = n => (ts.isJsxElement(n) ? n.openingElement : n);
export const tagOf = (sf, n) => openingOf(n).tagName.getText(sf);
export const childrenOf = n => (ts.isJsxElement(n) || ts.isJsxFragment(n) ? n.children : []);
export const hasSpread = open => open.attributes.properties.some(p => ts.isJsxSpreadAttribute(p));

export function attrNode(open, name) {
  return open.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText() === name);
}

// A value is one of {kind:'literal', value}, {kind:'template', pattern, regex, captures}, {kind:'expr', text}.
export function exprValue(sf, expression) {
  const e = unwrap(expression);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return {kind: 'literal', value: e.text};
  if (ts.isTemplateExpression(e)) {
    const captures = e.templateSpans.map(s => s.expression.getText(sf));
    const pattern = e.head.text + e.templateSpans.map((s, i) => `{${captures[i]}}${s.literal.text}`).join('');
    const regex = `^${escapeRegex(e.head.text)}${e.templateSpans.map(s => `(.+)${escapeRegex(s.literal.text)}`).join('')}$`;
    return {kind: 'template', pattern, regex, captures};
  }
  return {kind: 'expr', text: e.getText(sf)};
}

export function attrValue(sf, open, name) {
  const a = attrNode(open, name);
  if (!a) return undefined;
  const init = a.initializer;
  if (!init) return {kind: 'literal', value: true};
  if (ts.isStringLiteral(init)) return {kind: 'literal', value: init.text};
  return init.expression ? exprValue(sf, init.expression) : undefined;
}

export const attrExpression = (open, name) => {
  const a = attrNode(open, name);
  return a && a.initializer && ts.isJsxExpression(a.initializer) ? a.initializer.expression : undefined;
};

export const idOf = v => (!v ? null : v.kind === 'literal' ? String(v.value) : v.kind === 'template' ? v.pattern : null);

export function objectProps(sf, expression) {
  const e = expression && unwrap(expression);
  const out = {};
  if (!e || !ts.isObjectLiteralExpression(e)) return out;
  for (const p of e.properties) if (ts.isPropertyAssignment(p)) out[p.name.getText(sf)] = exprValue(sf, p.initializer);
  return out;
}

export function lastReturnExpression(body) {
  if (!ts.isBlock(body)) return body;
  const rets = body.statements.filter(s => ts.isReturnStatement(s) && s.expression);
  return rets.length ? rets[rets.length - 1].expression : undefined;
}

// Component lookup: a top-level function declaration or a const arrow/function expression with this name.
export function findFunction(sf, name) {
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name?.text === name) return s;
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        const init = d.initializer && unwrap(d.initializer);
        if (ts.isIdentifier(d.name) && d.name.text === name && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) return init;
      }
    }
  }
  return null;
}

export function findDefaultExport(sf) {
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && ts.getModifiers(s)?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) return s;
    if (ts.isExportAssignment(s) && ts.isIdentifier(s.expression)) return findFunction(sf, s.expression.text);
  }
  return null;
}
