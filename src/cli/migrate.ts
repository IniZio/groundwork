import { existsSync, lstatSync, readFileSync, writeFileSync, readdirSync, mkdirSync, renameSync, rmSync, cpSync, rmdirSync } from "node:fs";
import path from "node:path";

export type MigrateResult = { lines: string[]; code: number };

type Entry = { src: string; from: string; dest: string; flags: string[]; collision: boolean; inferred?: string };

const DONE = new Set(["complete", "completed", "archived", "done"]);
const LOOSE = ["archive/motives", "handoffs", "research", "journal", "compiled", "gates", "runs", "specs", "learnings"];

// Line parser rather than YAML.parse: YAML turns bare dates into Date objects.
function fmField(text: string, key: string): string | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) return undefined;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*?)\s*$/.exec(line);
    if (kv && kv[1] === key) return kv[2].replace(/^(["'])(.*)\1$/, "$2").trim();
  }
  return undefined;
}

// lstat everywhere: a symlink is never moved, followed or planned.
function isLink(p: string): boolean {
  try { return lstatSync(p).isSymbolicLink(); } catch { return false; }
}

function isRealDir(p: string): boolean {
  try { return lstatSync(p).isDirectory(); } catch { return false; }
}

function oldestMtime(dir: string): Date {
  let min = Infinity;
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p); else min = Math.min(min, st.mtimeMs);
    }
  };
  walk(dir);
  return new Date(Number.isFinite(min) ? min : lstatSync(dir).mtimeMs);
}

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function subdirs(dir: string): string[] {
  if (!isRealDir(dir)) return [];
  return readdirSync(dir).sort().filter(n => isRealDir(path.join(dir, n)));
}

function plan(root: string): Entry[] {
  const gwDir = path.join(root, ".groundwork");
  const out: Entry[] = [];
  const seen = new Set<string>();
  const add = (src: string, from: string, dest: string, flags: string[], inferred?: string): void => {
    const collision = existsSync(path.join(gwDir, dest)) || seen.has(dest);
    if (!collision) seen.add(dest);
    out.push({ src, from, dest, flags, collision, inferred });
  };

  for (const slug of subdirs(path.join(gwDir, "motives"))) {
    const dir = path.join(gwDir, "motives", slug);
    const mf = path.join(dir, "motive.md");
    const text = existsSync(mf) ? readFileSync(mf, "utf8") : "";
    const status = fmField(text, "status")?.toLowerCase();
    let created = fmField(text, "created");
    const flags: string[] = [];
    if (!status) flags.push("[unclassified]");
    let inferred: string | undefined;
    if (!created || !/^\d{4}-\d{2}/.test(created)) {
      created = ymd(oldestMtime(dir));
      if (text) { flags.push("[created inferred]"); inferred = created; }
    }
    const dest = status && DONE.has(status) ? `archive/${created.slice(0, 7)}/${slug}` : `work/${slug}`;
    add(`motives/${slug}`, dir, dest, flags, inferred);
  }
  for (const f of subdirs(path.join(root, ".scratch"))) {
    add(`.scratch/${f}`, path.join(root, ".scratch", f), `work/${f}`, []);
  }
  if (existsSync(gwDir)) {
    const present = (n: string): boolean => {
      let p = gwDir;
      for (const part of n.split("/")) {
        p = path.join(p, part);
        if (!existsSync(p) || isLink(p)) return false;
      }
      return true;
    };
    const loose = new Set(LOOSE.filter(present));
    for (const n of readdirSync(gwDir)) if (/^pause-state.*\.md$/.test(n) && !isLink(path.join(gwDir, n))) loose.add(n);
    for (const n of [...loose].sort()) {
      add(n, path.join(gwDir, n), `archive/legacy/${n.startsWith("archive/") ? n.slice(8) : n}`, []);
    }
  }
  return out;
}

function addCreated(file: string, date: string): void {
  const text = readFileSync(file, "utf8");
  const m = /^---(\r?\n)([\s\S]*?)(\r?\n)---(?=\r?\n|$)/.exec(text);
  if (!m) { writeFileSync(file, `---\ncreated: ${date}\n---\n${text}`); return; }
  const at = m.index + 3 + m[1].length + m[2].length;
  writeFileSync(file, `${text.slice(0, at)}${m[3]}created: ${date}${text.slice(at)}`);
}

function move(from: string, to: string): void {
  mkdirSync(path.dirname(to), { recursive: true });
  try { renameSync(from, to); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    cpSync(from, to, { recursive: true, preserveTimestamps: true });
    rmSync(from, { recursive: true, force: true });
  }
}

function rmdirIfEmpty(dir: string): void {
  if (isRealDir(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
}

const NEVER_TOUCH = /^(work\.db|stop-gate\.)|^(profile\.md|unknowns\.md|skills|work|archive)$/;

function leftInPlace(root: string): string[] {
  const gwDir = path.join(root, ".groundwork");
  if (!existsSync(gwDir)) return [];
  const known = new Set(["motives", ...LOOSE.map(n => n.split("/")[0])]);
  const nested = (dir: string, prefix: string): string[] =>
    isRealDir(dir) ? readdirSync(dir).sort().filter(n => isLink(path.join(dir, n))).map(n => `left in place: ${prefix}${n} (symlink)`) : [];
  const top = readdirSync(gwDir).sort()
    .map(n => isLink(path.join(gwDir, n)) ? `left in place: ${n} (symlink)`
      : !known.has(n) && !/^pause-state.*\.md$/.test(n) && !NEVER_TOUCH.test(n) ? `left in place: ${n}` : "")
    .filter(Boolean);
  return [...top, ...nested(path.join(gwDir, "motives"), "motives/"), ...nested(path.join(root, ".scratch"), ".scratch/")];
}

export function runMigrate(root: string, apply: boolean): MigrateResult {
  const kept = leftInPlace(root);
  const entries = plan(root);
  if (entries.length === 0) return { lines: ["nothing to migrate", ...kept], code: 0 };
  const lines = entries.map(e =>
    `${e.src} → ${e.dest}${e.flags.length ? " " + e.flags.join(" ") : ""}${e.collision ? " [collision: skipped]" : ""}`);
  const code = entries.some(e => e.collision) ? 1 : 0;
  if (apply) {
    const gwDir = path.join(root, ".groundwork");
    for (const e of entries) {
      if (e.collision) continue;
      const to = path.join(gwDir, e.dest);
      move(e.from, to);
      if (e.inferred) addCreated(path.join(to, "motive.md"), e.inferred);
    }
    rmdirIfEmpty(path.join(gwDir, "motives"));
    rmdirIfEmpty(path.join(root, ".scratch"));
  }
  return { lines: [...lines, ...kept], code };
}
