// Builds the parity corpus from upstream cases (text-extracted), probes, README snippets and a pinned real-code sample.
// usage: node build-corpus.cjs <W>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const W = process.argv[2];
if (!W) { console.error('usage: build-corpus.cjs <W>'); process.exit(2); }
const REPO = path.resolve(__dirname, '../..');
const REAL_SAMPLE_COMMIT = '05bf55ad79c79e3efe89b215c77b9304da6bbcba';
const PROBES_DIR = process.env.PARITY_PROBES_DIR || path.join(__dirname, 'probes');
const RULES = ['no-array-filter-map', 'no-chained-type-assertions', 'no-conditional-empty-object-spread', 'no-known-value-widening', 'no-module-mocking', 'no-object-parameters', 'no-reduce-accumulator-copy', 'no-reflect-apply', 'no-reflect-get', 'no-runtime-typeof', 'no-shape-in-symbol-names', 'no-unknown-parameters', 'no-unknown-returns', 'no-unknown-type-aliases', 'no-unsafe-dictionary-type', 'no-widen-then-assert', 'require-readable-spacing', 'require-safety-comment-for-type-assertion', 'no-manual-effect-error-tag', 'no-manual-tag-comparison', 'no-manual-tagged-construction', 'no-service-constructor-imports', 'prefer-effect-match'];

const C = path.join(W, 'corpus');
fs.rmSync(C, { recursive: true, force: true });
fs.mkdirSync(C, { recursive: true });
const manifest = [];
const seen = new Set();
let dup = 0;
const put = (rel, code, meta) => {
  if (seen.has(rel)) { console.error('duplicate corpus path: ' + rel); dup++; return; }
  seen.add(rel);
  const p = path.join(C, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, code.endsWith('\n') ? code : code + '\n');
  manifest.push({ file: rel, ...meta });
};

// Declared filename -> safe relative path (leading '/' stripped, '..' segments rejected), else case.ts.
const declared = (fn) => {
  if (typeof fn !== 'string' || !fn) return 'case.ts';
  const segs = fn.replace(/^\/+/, '').split('/').filter((s) => s !== '' && s !== '.');
  if (!segs.length || segs.includes('..')) return 'case.ts';
  return segs.join('/');
};
const ext = (fn) => path.extname(fn || 'probe.ts') || '.ts';

const up = JSON.parse(fs.readFileSync(path.join(W, 'upstream-tests.json'), 'utf8'));
for (const r of RULES) {
  const e = up[r];
  if (!e) { console.error('missing rule in upstream-tests.json: ' + r); process.exit(1); }
  let idx = { valid: 0, invalid: 0 };
  for (const run of e.runs) {
    for (const kind of ['valid', 'invalid']) {
      for (const c of (run.body && run.body[kind]) || []) {
        const i = idx[kind]++;
        const obj = typeof c === 'string' ? {} : c;
        const code = typeof c === 'string' ? c : c.code;
        if (typeof code !== 'string') { console.error(`non-literal code: ${r} ${kind} ${i}`); process.exit(1); }
        const fn = declared(obj.filename);
        const meta = { src: 'upstream-test', check: r, plugin: e.plugin, kind, idx: i, expected: kind === 'invalid' ? (Array.isArray(obj.errors) ? obj.errors.length : obj.errors) : 0 };
        if (obj.options !== undefined) meta.options = obj.options;
        put(`ut/${r}/${kind}-${String(i).padStart(3, '0')}/${fn}`, code, meta);
      }
    }
  }
}

if (fs.existsSync(PROBES_DIR)) {
  for (const f of fs.readdirSync(PROBES_DIR).filter((x) => x.endsWith('.json')).sort()) {
    for (const p of JSON.parse(fs.readFileSync(path.join(PROBES_DIR, f), 'utf8'))) {
      const dir = p.src === 'readme' ? 'readme' : 'probes';
      const meta = { src: p.src === 'readme' ? 'readme' : 'probe', id: p.id, check: p.check, upstreamExpect: p.upstreamExpect };
      if (p.unverified !== undefined) meta.unverified = p.unverified;
      const rel = typeof p.filename === 'string' && p.filename.includes('/') ? `${dir}/${p.id}/${declared(p.filename)}` : `${dir}/${p.id}${ext(p.filename)}`;
      put(rel, p.code, meta);
    }
  }
}

const globRe = (g) => new RegExp('^' + g.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
const pats = ['src/*.ts', 'src/*.js', 'src/*.mjs', 'plugins/house-rules/src/*.ts', 'test/*.ts', 'test/*.js', 'test/*.mjs'].map(globRe);
const files = execFileSync('git', ['-C', REPO, 'ls-tree', '-r', '--name-only', REAL_SAMPLE_COMMIT], { encoding: 'utf8', maxBuffer: 1 << 28 })
  .split('\n').filter((f) => f && pats.some((re) => re.test(f))).sort();
const picked = [];
for (let i = 0; i < 100 && Math.floor((i * files.length) / 100) < files.length; i++) picked.push(files[Math.floor((i * files.length) / 100)]);
for (const f of picked) {
  const content = execFileSync('git', ['-C', REPO, 'show', `${REAL_SAMPLE_COMMIT}:${f}`], { encoding: 'utf8', maxBuffer: 1 << 28 });
  put(`real/${f.replace(/\//g, '__')}`, content, { src: 'real', orig: f });
}

manifest.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
fs.writeFileSync(path.join(W, 'manifest.json'), JSON.stringify(manifest, null, 1));
const h = crypto.createHash('sha256');
for (const m of manifest) { h.update(m.file + '\0'); h.update(fs.readFileSync(path.join(C, m.file))); h.update('\0'); }
fs.writeFileSync(path.join(W, 'corpus.sha256'), h.digest('hex') + '\n');

const bySrc = {}, byPlugin = {};
for (const m of manifest) { bySrc[m.src] = (bySrc[m.src] || 0) + 1; if (m.plugin) byPlugin[m.plugin] = (byPlugin[m.plugin] || 0) + 1; }
console.log(JSON.stringify({ bySrc, byPlugin, total: manifest.length, dup }));
process.exit(dup ? 1 : 0);
