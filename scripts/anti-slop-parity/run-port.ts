// Runs the PORT over every corpus file in W; every line counts as added. Usage: bun run-port.ts <W>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const REPO = resolve(import.meta.dir, '../..');
const { defineGroupedRule } = await import(REPO + '/plugins/house-rules/src/engine/grouped-rule.ts');
const R = REPO + '/plugins/house-rules/rules';
const W = process.argv[2];
if (!W) { console.error('usage: bun run-port.ts <W>'); process.exit(2); }
const C = resolve(W, 'corpus');
const PORTED = new Set(['no-unknown-parameters','no-unknown-returns','no-unknown-type-aliases','no-unsafe-dictionary-type','no-object-parameters','no-chained-type-assertions','no-module-mocking','no-reflect-apply','no-reflect-get','no-conditional-empty-object-spread','no-array-filter-map','no-reduce-accumulator-copy','no-shape-in-symbol-names','no-runtime-typeof','no-widen-then-assert','no-known-value-widening','prefer-effect-match','no-manual-effect-error-tag','no-service-constructor-imports','no-manual-tag-comparison','no-manual-tagged-construction','require-safety-comment-for-type-assertion','require-readable-spacing']);
const rules = [
  defineGroupedRule('type-escape-hatches', 'x', R + '/type-escape-hatches/checks'),
  defineGroupedRule('code-smells', 'x', R + '/code-smells/checks'),
  defineGroupedRule('no-module-mocking', 'x', R + '/no-module-mocking/checks'),
  defineGroupedRule('effect', 'x', R + '/effect/checks'),
  defineGroupedRule('require-safety-comment-for-type-assertion', 'x', R + '/require-safety-comment-for-type-assertion/checks'),
  defineGroupedRule('require-readable-spacing', 'x', R + '/require-readable-spacing/checks'),
];
const manifest = JSON.parse(readFileSync(resolve(W, 'manifest.json'), 'utf8')) as { file: string }[];
const out: string[] = [];
let other = 0, errors = 0, findings = 0;
for (const m of manifest) {
  const text = readFileSync(C + '/' + m.file, 'utf8');
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const ctx: any = { repoRoot: C, mode: 'cli', files: [{ path: m.file, text, tracked: true, addedHunks: [{ added: lines.map((_, i) => i + 1), removed: [], removedBaseLineNos: [] }] }] };
  for (const rule of rules) {
    let f: any[];
    try { f = await rule.check(ctx); } catch (e: any) { errors++; out.push(JSON.stringify({ file: m.file, error: String(e?.message ?? e) })); continue; }
    for (const x of f) {
      const mm = /^\[([^\]]*)\]\s*/.exec(x.message);
      const sub = mm?.[1] ?? '?';
      if (!PORTED.has(sub)) { other++; continue; }
      findings++;
      out.push(JSON.stringify({ file: x.path ?? x.file ?? m.file, line: x.line, col: x.column ?? x.col, check: sub, msg: x.message.slice(mm![0].length) }));
    }
  }
}
mkdirSync(resolve(W, 'out'), { recursive: true });
writeFileSync(resolve(W, 'out/port.jsonl'), out.length ? out.join('\n') + '\n' : '');
console.log('port findings', findings, 'non-ported dropped', other, 'errors', errors);
