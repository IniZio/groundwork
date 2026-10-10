// Parses upstream anti-slop RuleTester files as TEXT via the TypeScript AST. Never executes upstream code.
// usage: node extract-upstream-tests.cjs <upstream-clone> <out.json>

const fs = require('fs');
const path = require('path');
// Needs the classic TypeScript compiler API (createSourceFile). The repo's typescript@7 dropped it,
// so resolve: PARITY_TYPESCRIPT, then repo-local classic (<7) pnpm copy (highest), then top-level copy if classic.
const ts = (() => {
  const repo = path.resolve(__dirname, '../..');
  const classic = (m) => m && typeof m.createSourceFile === 'function';
  const tryLoad = (f) => { try { const m = require(f); return classic(m) ? m : undefined; } catch { return undefined; } };
  const env = process.env.PARITY_TYPESCRIPT;
  if (env) {
    const f = fs.existsSync(path.join(env, 'lib/typescript.js')) ? path.join(env, 'lib/typescript.js') : env;
    const m = tryLoad(f);
    if (m) { console.error(`typescript ${m.version} from ${f}`); return m; }
  }
  const pnpm = path.join(repo, 'node_modules/.pnpm');
  const found = fs.existsSync(pnpm) ? fs.readdirSync(pnpm).map((d) => ({ d, m: /^typescript@(\d+)\.(\d+)\.(\d+)/.exec(d) }))
    .filter((x) => x.m && Number(x.m[1]) < 7)
    .sort((a, b) => { for (let i = 1; i <= 3; i++) { const k = Number(b.m[i]) - Number(a.m[i]); if (k) return k; } return 0; }) : [];
  for (const { d } of found) {
    const f = path.join(pnpm, d, 'node_modules/typescript/lib/typescript.js');
    const m = tryLoad(f);
    if (m) { console.error(`typescript ${m.version} from ${f}`); return m; }
  }
  const top = path.join(repo, 'node_modules/typescript/lib/typescript.js');
  const m = fs.existsSync(top) ? tryLoad(top) : undefined;
  if (m) { console.error(`typescript ${m.version} from ${top}`); return m; }
  console.error('no classic typescript.js found (need createSourceFile); set PARITY_TYPESCRIPT or install typescript<7 under node_modules/.pnpm'); process.exit(2);
})();

const RULES = {
  'anti-slop': ['no-array-filter-map', 'no-chained-type-assertions', 'no-conditional-empty-object-spread', 'no-known-value-widening', 'no-module-mocking', 'no-object-parameters', 'no-reduce-accumulator-copy', 'no-reflect-apply', 'no-reflect-get', 'no-runtime-typeof', 'no-shape-in-symbol-names', 'no-unknown-parameters', 'no-unknown-returns', 'no-unknown-type-aliases', 'no-unsafe-dictionary-type', 'no-widen-then-assert', 'require-readable-spacing', 'require-safety-comment-for-type-assertion'],
  'anti-slop-effect': ['no-manual-effect-error-tag', 'no-manual-tag-comparison', 'no-manual-tagged-construction', 'no-service-constructor-imports', 'prefer-effect-match'],
};
const DIRS = { 'anti-slop': 'src/rules', 'anti-slop-effect': 'src/effect/rules' };

let CONSTS = {};
// Template/concatenation made only of literals and string consts folds to a plain string; else stays {$expr}.
function fold(n) {
  if (ts.isStringLiteralLike(n)) return n.text;
  if (ts.isParenthesizedExpression(n)) return fold(n.expression);
  if (ts.isIdentifier(n)) return typeof CONSTS[n.text] === 'string' ? CONSTS[n.text] : undefined;
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = fold(n.left), r = fold(n.right);
    return l === undefined || r === undefined ? undefined : l + r;
  }
  if (ts.isTemplateExpression(n)) {
    let o = n.head.text;
    for (const sp of n.templateSpans) { const v = fold(sp.expression); if (v === undefined) return undefined; o += v + sp.literal.text; }
    return o;
  }
  return undefined;
}

function lit(n) {
  if (!n) return undefined;
  switch (n.kind) {
    case ts.SyntaxKind.StringLiteral: case ts.SyntaxKind.NoSubstitutionTemplateLiteral: return n.text;
    case ts.SyntaxKind.NumericLiteral: return Number(n.text);
    case ts.SyntaxKind.TrueKeyword: return true;
    case ts.SyntaxKind.FalseKeyword: return false;
    case ts.SyntaxKind.ParenthesizedExpression: return lit(n.expression);
    case ts.SyntaxKind.ArrayLiteralExpression: return n.elements.map(lit);
    case ts.SyntaxKind.ObjectLiteralExpression: {
      const o = {};
      for (const p of n.properties) {
        if (ts.isPropertyAssignment(p)) o[p.name.getText()] = lit(p.initializer);
        else if (ts.isSpreadAssignment(p)) o['...' + p.expression.getText()] = true;
        else if (ts.isShorthandPropertyAssignment(p)) o[p.name.text] = { $ref: p.name.text };
        else o['$unk'] = p.getText();
      }
      return o;
    }
    case ts.SyntaxKind.Identifier: return { $ref: n.text };
    default: { const v = fold(n); return v === undefined ? { $expr: n.getText() } : v; }
  }
}

// Replace {$ref:NAME} with the file-level const value when that const is a literal (no $expr at top level).
function resolve(v, consts, depth = 0) {
  if (depth > 8 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => resolve(x, consts, depth + 1));
  const keys = Object.keys(v);
  if (keys.length === 1 && keys[0] === '$ref') {
    const c = consts[v.$ref];
    if (c === undefined || (c && typeof c === 'object' && !Array.isArray(c) && ('$expr' in c || '$ref' in c))) return v;
    return resolve(c, consts, depth + 1);
  }
  const o = {};
  for (const k of keys) o[k] = resolve(v[k], consts, depth + 1);
  return o;
}

function extractFile(file) {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const consts = CONSTS = {};
  sf.statements.forEach((s) => {
    if (ts.isVariableStatement(s)) s.declarationList.declarations.forEach((d) => { if (d.initializer) consts[d.name.getText()] = lit(d.initializer); });
  });
  const runs = [];
  (function visit(n) {
    if (ts.isCallExpression(n) && /\.run$/.test(n.expression.getText())) {
      runs.push({ name: lit(n.arguments[0]), body: resolve(lit(n.arguments[2]), consts) });
    }
    ts.forEachChild(n, visit);
  })(sf);
  return { consts, runs };
}

const [U, OUT] = process.argv.slice(2);
if (!U || !OUT) { console.error('usage: extract-upstream-tests.cjs <upstream> <out.json>'); process.exit(2); }
const out = {};
let bad = 0;
for (const [plugin, rules] of Object.entries(RULES)) {
  for (const r of rules) {
    const rel = `${DIRS[plugin]}/${r}.test.ts`;
    const abs = path.join(U, rel);
    if (!fs.existsSync(abs)) { console.error(`missing ${rel}`); bad++; continue; }
    const { consts, runs } = extractFile(abs);
    out[r] = { plugin, testFile: rel, consts, runs };
    const n = runs.reduce((a, x) => a + ((x.body && x.body.valid) || []).length + ((x.body && x.body.invalid) || []).length, 0);
    if (n === 0) { console.error(`zero cases for ${r}`); bad++; }
  }
}
// require-readable-spacing-cli.test.ts is a spawn-based oxlint test (no RuleTester .run), deliberately not extracted.
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
for (const r of Object.keys(out)) {
  const c = out[r].runs.reduce((a, x) => [a[0] + x.body.valid.length, a[1] + x.body.invalid.length], [0, 0]);
  console.log(`${r} valid=${c[0]} invalid=${c[1]} runs=${out[r].runs.length}`);
}
process.exit(bad ? 1 : 0);
