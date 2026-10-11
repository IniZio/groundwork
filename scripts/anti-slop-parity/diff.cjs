const fs = require('fs');
const path = require('path');

const PORTED = new Set(['no-unknown-parameters', 'no-unknown-returns', 'no-unknown-type-aliases', 'no-unsafe-dictionary-type', 'no-object-parameters', 'no-chained-type-assertions', 'no-module-mocking', 'no-reflect-apply', 'no-reflect-get', 'no-conditional-empty-object-spread', 'no-array-filter-map', 'no-reduce-accumulator-copy', 'no-shape-in-symbol-names', 'no-runtime-typeof', 'no-widen-then-assert', 'no-known-value-widening', 'prefer-effect-match', 'no-manual-effect-error-tag', 'no-service-constructor-imports', 'no-manual-tag-comparison', 'no-manual-tagged-construction', 'require-safety-comment-for-type-assertion', 'require-readable-spacing']);

const die = (msg, code = 2) => { console.error(msg); process.exit(code); };
const [W, OXPATH] = process.argv.slice(2);
if (!W || !OXPATH) die('usage: node diff.cjs <W> <oxlint.json>');
const readJson = (p, what) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return die(`cannot read ${what} ${p}: ${e.message}`); } };

const manifest = readJson(path.join(W, 'manifest.json'), 'manifest');
const meta = Object.fromEntries(manifest.map((m) => [m.file, m]));
const ox = readJson(OXPATH, 'oxlint json');
const portLines = fs.readFileSync(path.join(W, 'out', 'port.jsonl'), 'utf8').split('\n').filter((l) => l.trim());
const portAll = portLines.map((l, i) => { try { return JSON.parse(l); } catch (e) { return die(`port.jsonl line ${i + 1} not JSON`); } });

// ---- residuals (validated) ----
const resPath = process.env.PARITY_RESIDUALS || path.join(__dirname, 'residuals.json');
const res = readJson(resPath, 'residuals');
const bad = (m) => die(`malformed residuals ${resPath}: ${m}`);
if (!res || typeof res !== 'object' || Array.isArray(res)) bad('not an object');
if (typeof res.upstreamSha !== 'string' || !res.upstreamSha) bad('missing upstreamSha');
if (!Array.isArray(res.divergences)) bad('divergences must be an array');
if (!Array.isArray(res.notPorted)) bad('notPorted must be an array');
const nonEmpty = (s) => typeof s === 'string' && s.trim() !== '';
const rkey = (x) => `${x.file}\t${x.line}\t${x.check}`;
const seenRes = new Set();
res.divergences.forEach((r, i) => {
  const at = `divergences[${i}]`;
  if (!r || typeof r !== 'object') bad(`${at} not an object`);
  if (!nonEmpty(r.file)) bad(`${at} missing file`);
  if (!Number.isInteger(r.line)) bad(`${at} line must be integer`);
  if (!nonEmpty(r.check)) bad(`${at} missing check`);
  if (!Number.isInteger(r.upOnly) || r.upOnly < 0) bad(`${at} upOnly must be non-negative integer`);
  if (!Number.isInteger(r.portOnly) || r.portOnly < 0) bad(`${at} portOnly must be non-negative integer`);
  if (r.class !== 'known' && r.class !== 'artifact') bad(`${at} unknown class ${JSON.stringify(r.class)}`);
  if (!nonEmpty(r.why)) bad(`${at} missing why`);
  if (seenRes.has(rkey(r))) bad(`${at} duplicate key ${r.file}:${r.line} ${r.check}`);
  seenRes.add(rkey(r));
});
const seenNp = new Set();
res.notPorted.forEach((r, i) => {
  const at = `notPorted[${i}]`;
  if (!r || typeof r !== 'object') bad(`${at} not an object`);
  if (!nonEmpty(r.check)) bad(`${at} missing check`);
  if (!nonEmpty(r.why)) bad(`${at} missing why`);
  if (seenNp.has(r.check)) bad(`${at} duplicate check ${r.check}`);
  seenNp.add(r.check);
});

// ---- upstream findings ----
const stripCorpus = (f) => f.replace(/^(?:.*\/)?corpus\//, '');
const parseErr = new Set();
const up = [];
for (const d of ox.diagnostics || []) {
  const file = stripCorpus(d.filename);
  const m = /^anti-slop(?:-effect)?\((.*)\)$/.exec(d.code || '');
  if (!m) { parseErr.add(file); continue; }
  const sp = d.labels && d.labels[0] && d.labels[0].span;
  up.push({ file, line: sp ? sp.line : 0, col: sp ? sp.column : 0, check: m[1], msg: d.message });
}
const portErrors = portAll.filter((p) => p.error !== undefined);
const port = portAll.filter((p) => p.error === undefined);

// ---- multiplicity diff ----
const key = (x) => `${x.file}\t${x.line}\t${x.check}`;
const count = (arr) => { const c = new Map(); for (const x of arr) c.set(key(x), (c.get(key(x)) || 0) + 1); return c; };
const hasOpts = (m) => m.options && (typeof m.options !== 'object' || Object.keys(m.options).length > 0);
const optFiles = new Set(manifest.filter((m) => m.src === 'upstream-test' && m.check && hasOpts(m)).map((m) => m.file));
const upC = up.filter((x) => !optFiles.has(x.file)), portC = port.filter((x) => !optFiles.has(x.file));
const cu = count(upC), cp = count(portC);
const firstMsg = (arr) => { const m = new Map(); for (const x of arr) if (!m.has(key(x))) m.set(key(x), x.msg); return m; };
const mu = firstMsg(upC), mp = firstMsg(portC);
const rows = [];
for (const k of new Set([...cu.keys(), ...cp.keys()])) {
  const [file, line, check] = k.split('\t');
  const a = cu.get(k) || 0, b = cp.get(k) || 0;
  rows.push({ file, line: +line, check, up: a, port: b, agree: Math.min(a, b), upOnly: Math.max(0, a - b), portOnly: Math.max(0, b - a), src: meta[file] && meta[file].src, upMsg: mu.get(k), portMsg: mp.get(k) });
}

// ---- classification ----
const resByKey = new Map(res.divergences.map((r) => [rkey(r), r]));
const npSet = new Set(res.notPorted.map((r) => r.check));
const matchedRes = new Set();
for (const r of rows) {
  r.status = 'agree';
  if (!r.upOnly && !r.portOnly) continue;
  const rr = resByKey.get(key(r));
  if (rr && rr.upOnly === r.upOnly && rr.portOnly === r.portOnly) { r.status = 'covered'; matchedRes.add(key(r)); }
  else if (npSet.has(r.check) && r.portOnly === 0) r.status = 'covered';
  else r.status = 'new';
}
const stale = [];
for (const r of res.divergences) if (!matchedRes.has(rkey(r))) stale.push({ kind: 'divergence', ...r });
const upByCheck = new Map(), portByCheck = new Map();
for (const x of upC) upByCheck.set(x.check, (upByCheck.get(x.check) || 0) + 1);
for (const x of portC) portByCheck.set(x.check, (portByCheck.get(x.check) || 0) + 1);
for (const r of res.notPorted) {
  const u = upByCheck.get(r.check) || 0, p = portByCheck.get(r.check) || 0;
  if (u === 0 || p >= 1) stale.push({ kind: 'notPorted', ...r, up: u, port: p });
}

// ---- table ----
const checks = new Set([...upByCheck.keys(), ...portByCheck.keys(), ...res.divergences.map((r) => r.check), ...res.notPorted.map((r) => r.check)]);
const table = {};
for (const c of [...checks].sort()) table[c] = { up: 0, port: 0, agree: 0, upOnly: 0, portOnly: 0, covered: 0, new: 0 };
for (const r of rows) {
  const t = table[r.check];
  t.up += r.up; t.port += r.port; t.agree += r.agree; t.upOnly += r.upOnly; t.portOnly += r.portOnly;
  if (r.status === 'covered') t.covered += r.upOnly + r.portOnly;
  if (r.status === 'new') t.new += r.upOnly + r.portOnly;
}

// ---- real-sample ----
let rsA = 0, rsT = 0;
for (const r of rows) if (r.src === 'real' && PORTED.has(r.check)) { rsA += r.agree; rsT += Math.max(r.up, r.port); }

// ---- upstream self-check ----
const selfMismatch = [], selfOpts = [];
for (const m of manifest) {
  if (m.src !== 'upstream-test' || !m.check) continue;
  const n = up.filter((x) => x.file === m.file && x.check === m.check).length;
  if (n === m.expected) continue;
  const e = { file: m.file, check: m.check, expected: m.expected, oxlint: n };
  (hasOpts(m) ? selfOpts : selfMismatch).push(e);
}

// ---- port vs upstream expected, for option cases ----
const PORT_OPTIONS = { 'no-runtime-typeof': ['allowInTypeGuards'] };
const portOptsMismatch = [], portOptsUnsupported = [], poByCheck = {};
let poAgree = 0, poJudged = 0;
for (const m of manifest) {
  if (m.src !== 'upstream-test' || !m.check || !hasOpts(m)) continue;
  const o = Array.isArray(m.options) ? m.options[0] : m.options;
  const n = port.filter((x) => x.file === m.file && x.check === m.check).length;
  const e = { file: m.file, check: m.check, options: m.options, expected: m.expected, port: n };
  const supported = PORT_OPTIONS[m.check] || [];
  const keys = o && typeof o === 'object' ? Object.keys(o) : [];
  if (!keys.every((k) => supported.includes(k))) { portOptsUnsupported.push(e); continue; }
  const t = poByCheck[m.check] || (poByCheck[m.check] = { agree: 0, judged: 0 });
  poJudged++; t.judged++;
  if (n === m.expected) { poAgree++; t.agree++; } else portOptsMismatch.push(e);
}

const newRows = rows.filter((r) => r.status === 'new');
const cols = ['up', 'port', 'agree', 'upOnly', 'portOnly', 'covered', 'new'];
const lines = [];
lines.push('check'.padEnd(36) + cols.join('\t'));
const tot = Object.fromEntries(cols.map((c) => [c, 0]));
for (const [c, t] of Object.entries(table)) { lines.push(c.padEnd(36) + cols.map((k) => t[k]).join('\t')); for (const k of cols) tot[k] += t[k]; }
lines.push('TOTAL'.padEnd(36) + cols.map((k) => tot[k]).join('\t'));
lines.push(`real-sample agree=${rsA}/${rsT}`);
lines.push(`parse-errors ${parseErr.size} ${[...parseErr].join(' ')}`.trimEnd());
lines.push(`upstream-self-mismatch ${selfMismatch.length}`);
for (const e of selfMismatch) lines.push(`  self-mismatch ${JSON.stringify(e)}`);
lines.push(`self-mismatch-with-options ${selfOpts.length}`);
for (const e of selfOpts) lines.push(`  self-mismatch-opts ${JSON.stringify(e)}`);
lines.push(`port-opts agree ${poAgree}/${poJudged}${Object.entries(poByCheck).map(([c, t]) => ` ${c}=${t.agree}/${t.judged}`).join('')}`);
for (const e of portOptsMismatch) lines.push(`  port-opts-mismatch ${JSON.stringify(e)}`);
lines.push(`port-opts unsupported ${portOptsUnsupported.length}`);
for (const e of portOptsUnsupported) lines.push(`  port-opts-unsupported ${JSON.stringify(e)}`);
for (const m of manifest) {
  if (!m.unverified) continue;
  const id = m.id || m.file;
  lines.push(`unverified ${id} check=${m.check} up=${up.filter((x) => x.file === m.file && x.check === m.check).length} port=${port.filter((x) => x.file === m.file && x.check === m.check).length}`);
}
for (const r of newRows) lines.push(`NEW ${r.file}:${r.line} ${r.check} up=${r.up} port=${r.port} upMsg=${JSON.stringify(r.upMsg)} portMsg=${JSON.stringify(r.portMsg)}`);
for (const e of portErrors) lines.push(`NEW ${e.file}:0 port-error up=0 port=0 upMsg=null portMsg=${JSON.stringify(e.error)}`);
for (const s of stale) lines.push(`STALE ${JSON.stringify(s)}`);
const nNew = newRows.length + portErrors.length + portOptsMismatch.length;
lines.push(`new=${nNew} stale=${stale.length}`);
console.log(lines.join('\n'));

fs.mkdirSync(path.join(W, 'out'), { recursive: true });
fs.writeFileSync(path.join(W, 'out', 'diff.json'), JSON.stringify({ parseErrors: [...parseErr], realSample: { agree: rsA, total: rsT }, upstreamSelfMismatch: selfMismatch, selfMismatchWithOptions: selfOpts, portOpts: { agree: poAgree, judged: poJudged, mismatches: portOptsMismatch, unsupported: portOptsUnsupported }, table, divergences: rows.filter((r) => r.upOnly || r.portOnly), portErrors, stale, new: nNew }, null, 1));
process.exit(nNew + stale.length > 0 ? 1 : 0);
