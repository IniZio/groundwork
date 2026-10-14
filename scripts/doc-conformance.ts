import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { checkDocConformance, resolveManifest } from "../plugins/house-rules/rules/artifact-structure/index.js";
import { matchPath, forbiddenRedirect } from "../plugins/house-rules/src/config/manifest.mjs";

const USAGE = "usage: bun scripts/doc-conformance.ts [--root DIR] [--json] [--include-doc] [paths/globs...]";

const args = process.argv.slice(2);
let root = process.cwd();
let json = false;
let includeDoc = false;
const patterns: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--root") {
    const v = args[++i];
    if (v === undefined) { console.error(USAGE); process.exit(2); }
    root = v;
  } else if (a === "--json") json = true;
  else if (a === "--include-doc") includeDoc = true;
  else if (a === "--help" || a === "-h") { console.log(USAGE); process.exit(0); }
  else if (a.startsWith("--")) { console.error(`unknown option ${a}\n${USAGE}`); process.exit(2); }
  else patterns.push(a);
}
root = resolve(root);

// Walks the filesystem, not git, so gitignored files are included. Symlinks are skipped.
function walk(dir: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith(".md")) out.push(relative(root, p).split(sep).join("/"));
  }
}

function collect(): string[] {
  const out: string[] = [];
  if (patterns.length === 0) {
    const dirs = [".groundwork", ...(includeDoc ? ["doc"] : [])];
    for (const d of dirs) if (existsSync(join(root, d)) && statSync(join(root, d)).isDirectory()) walk(join(root, d), out);
    return out.sort();
  }
  for (const pat of patterns) {
    const abs = resolve(root, pat);
    if (existsSync(abs) && statSync(abs).isDirectory()) walk(abs, out);
    else if (existsSync(abs)) out.push(relative(root, abs).split(sep).join("/"));
    else for (const m of new Bun.Glob(pat).scanSync({ cwd: root, dot: true })) if (m.endsWith(".md")) out.push(m);
  }
  return [...new Set(out)].sort();
}

const files = collect();
const manifest = resolveManifest(root);
// checkDocConformance returns [] for both conforming and untyped files, so untyped is detected by the same matcher it uses.
function isTyped(rel: string): boolean {
  if (manifest === null) return false;
  return matchPath(rel, manifest.options) !== null || forbiddenRedirect(rel, { forbidden: manifest.options.forbidden ?? [] }) !== null;
}
const bad: { path: string; findings: { message: string; severity: string }[] }[] = [];
const untypedPaths: string[] = [];
let checkedTyped = 0;
for (const f of files) {
  if (!isTyped(f)) { untypedPaths.push(f); continue; }
  checkedTyped++;
  const findings = checkDocConformance(root, f);
  if (findings.length > 0) bad.push({ path: f, findings: findings.map(x => ({ message: x.message, severity: x.severity ?? "error" })) });
}
const checked = files.length;
const nonConforming = bad.length;
const untyped = untypedPaths.length;
const conforming = checkedTyped - nonConforming;
const percent = checkedTyped === 0 ? 100 : Math.round((conforming / checkedTyped) * 1000) / 10;

if (json) {
  console.log(JSON.stringify({ root, checked, conforming, nonConforming, untyped, percentConforming: percent, files: bad, untypedPaths }, null, 2));
} else {
  for (const b of bad) {
    console.log(b.path);
    for (const f of b.findings) console.log(`  [${f.severity}] ${f.message}`);
  }
  console.log(`checked ${checked}, conforming ${conforming}, non-conforming ${nonConforming}, untyped ${untyped} (${percent}% of typed conforming)`);
}
process.exit(nonConforming > 0 ? 1 : 0);
