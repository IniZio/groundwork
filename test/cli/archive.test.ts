import { describe, it, expect, afterAll } from "bun:test";
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync,
  readdirSync, statSync, utimesSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

const MAIN = path.resolve(import.meta.dir, "../../src/cli/main.ts");
const root = mkdtempSync(path.join(tmpdir(), "gw-archive-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const baseEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
} as Record<string, string>;
delete baseEnv.GROUNDWORK_DB;
delete baseEnv.CLAUDE_PROJECT_DIR;

let n = 0;
interface Ctx { d: string; env: Record<string, string>; token: string }

function run(cmd: string, args: string[], c: { d: string; env: Record<string, string> }, extra: Record<string, string> = {}) {
  return spawnSync(cmd, args, { cwd: c.d, env: { ...c.env, ...extra }, encoding: "utf8", timeout: 30000 });
}
const git = (c: Ctx, extra: Record<string, string>, ...a: string[]) => run("git", a, c, extra);
const gw = (c: Ctx, ...a: string[]) => run("bun", [MAIN, ...a], c);

/** Temp git repo, initialised, with store motive `foo` registered. */
function makeRepo(): Ctx {
  const base = path.join(root, `r${n++}`);
  const d = path.join(base, "repo");
  mkdirSync(d, { recursive: true });
  const env = { ...baseEnv, XDG_CONFIG_HOME: path.join(base, "xdg") };
  const c = { d, env, token: "" } as Ctx;
  git(c, {}, "init", "-q");
  const init = gw(c, "init");
  expect(init.status).toBe(0);
  const m = /token: (\S+)/.exec(init.stdout);
  expect(m).not.toBeNull();
  c.token = m![1];
  expect(gw(c, "motive", "add", "foo", "--token", c.token).status).toBe(0);
  return c;
}

const work = (c: Ctx, slug = "foo") => path.join(c.d, ".groundwork", "work", slug);
function put(c: Ctx, rel: string, body: string) {
  const f = path.join(work(c), rel);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, body);
}
function seed(c: Ctx, opts: { motive?: string; spec?: string | null } = {}) {
  put(c, "motive.md", opts.motive ?? "---\ncreated: 2026-09-01\n---\n# foo\n");
  if (opts.spec !== null) put(c, "spec.md", opts.spec ?? "---\nfolds_into: doc/spec/a.md\n---\n# spec\n");
  put(c, "notes.md", "some notes\n");
  put(c, "sub/x.txt", "nested\n");
  put(c, "evidence/e.png", "PNGDATA");
}
function commitSpec(c: Ctx, date: string, body = "spec\n") {
  const f = path.join(c.d, "doc/spec/a.md");
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, body);
  git(c, {}, "add", "doc/spec/a.md");
  const r = git(c, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, "commit", "-qm", "spec");
  expect(r.status).toBe(0);
}
function walk(dir: string, rel = ""): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir).sort()) {
    const r = rel ? `${rel}/${e}` : e;
    if (statSync(path.join(dir, e)).isDirectory()) out.push(...walk(path.join(dir, e), r));
    else out.push(r);
  }
  return out;
}
const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
function treeHash(dir: string): string {
  const h = createHash("sha256");
  for (const r of walk(dir)) h.update(r + "\0").update(readFileSync(path.join(dir, r))).update("\0");
  return h.digest("hex");
}
const month = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const archiveDir = (c: Ctx, slug = "foo") => path.join(c.d, ".groundwork", "archive", month(), slug);
const listLine = (c: Ctx) => gw(c, "motive", "list").stdout.split("\n").find(l => /^\s+foo\s/.test(l)) ?? "";

describe("gw archive", () => {
  it("AC1: archives folded work unit, files byte-identical, evidence/ dropped", () => {
    const c = makeRepo();
    seed(c);
    commitSpec(c, "2026-09-10T12:00:00");
    const files = walk(work(c)).filter(f => !f.startsWith("evidence/"));
    expect(files.sort()).toEqual(["motive.md", "notes.md", "spec.md", "sub/x.txt"]);
    const before = new Map(files.map(f => [f, sha(path.join(work(c), f))]));
    const r = gw(c, "archive", "foo", "--token", c.token);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`archived: foo → .groundwork/archive/${month()}/foo\n`);
    expect(existsSync(work(c))).toBe(false);
    const dest = archiveDir(c);
    expect(walk(dest).sort()).toEqual(files);
    for (const f of files) expect(sha(path.join(dest, f))).toBe(before.get(f)!);
    expect(existsSync(path.join(dest, "evidence"))).toBe(false);
  });

  it("AC2: old commit plus staged-only modification passes the git check", () => {
    const c = makeRepo();
    seed(c);
    commitSpec(c, "2026-08-01T12:00:00");
    writeFileSync(path.join(c.d, "doc/spec/a.md"), "spec\nmodified\n");
    expect(git(c, {}, "add", "doc/spec/a.md").status).toBe(0);
    const r = gw(c, "archive", "foo", "--token", c.token);
    expect(r.status).toBe(0);
    expect(existsSync(work(c))).toBe(false);
    expect(existsSync(archiveDir(c))).toBe(true);
  });

  it("AC3: control, only a pre-created commit and nothing staged is refused", () => {
    const c = makeRepo();
    seed(c);
    commitSpec(c, "2026-08-01T12:00:00");
    const before = treeHash(work(c));
    const r = gw(c, "archive", "foo", "--token", c.token);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("doc/spec/a.md");
    expect(r.stderr).toContain("2026-09-01");
    expect(treeHash(work(c))).toBe(before);
    expect(existsSync(work(c))).toBe(true);
    expect(existsSync(path.join(c.d, ".groundwork", "archive"))).toBe(false);
  });

  it("AC4: folds_into none with reason archives", () => {
    const c = makeRepo();
    seed(c, { spec: "---\nfolds_into: none\nreason: superseded\n---\n# spec\n" });
    const r = gw(c, "archive", "foo", "--token", c.token);
    expect(r.status).toBe(0);
    expect(existsSync(work(c))).toBe(false);
    expect(existsSync(path.join(archiveDir(c), "spec.md"))).toBe(true);
  });

  it("AC4: folds_into none without reason is refused and mentions reason", () => {
    const c = makeRepo();
    seed(c, { spec: "---\nfolds_into: none\n---\n# spec\n" });
    const before = treeHash(work(c));
    const r = gw(c, "archive", "foo", "--token", c.token);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("reason");
    expect(treeHash(work(c))).toBe(before);
    expect(existsSync(path.join(c.d, ".groundwork", "archive"))).toBe(false);
  });

  it("AC5: no spec.md archives", () => {
    const c = makeRepo();
    seed(c, { spec: null });
    expect(existsSync(path.join(work(c), "spec.md"))).toBe(false);
    const r = gw(c, "archive", "foo", "--token", c.token);
    expect(r.status).toBe(0);
    expect(existsSync(work(c))).toBe(false);
    expect(existsSync(path.join(archiveDir(c), "motive.md"))).toBe(true);
  });

  it("AC6: motive.md without created: is refused, no mtime fallback", () => {
    const c = makeRepo();
    commitSpec(c, "2026-09-10T12:00:00");
    seed(c, { motive: "---\ntitle: foo\n---\n# foo\n" });
    const old = new Date("2020-01-01T00:00:00Z");
    for (const f of walk(work(c))) utimesSync(path.join(work(c), f), old, old);
    const before = treeHash(work(c));
    const r = gw(c, "archive", "foo", "--token", c.token);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("created:");
    expect(treeHash(work(c))).toBe(before);
    expect(existsSync(path.join(c.d, ".groundwork", "archive"))).toBe(false);
  });

  it("AC7: after archive, motive list shows foo complete (not complete before)", () => {
    const c = makeRepo();
    seed(c);
    commitSpec(c, "2026-09-10T12:00:00");
    expect(listLine(c)).toContain("foo");
    expect(listLine(c)).not.toContain("[complete]");
    const r = gw(c, "archive", "foo", "--token", c.token);
    expect(r.status).toBe(0);
    expect(listLine(c)).toContain("[complete]");
  });

  it("AC7: missing token is refused, tree and store unchanged", () => {
    const c = makeRepo();
    seed(c);
    commitSpec(c, "2026-09-10T12:00:00");
    const before = treeHash(work(c));
    const r = gw(c, "archive", "foo");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--token required");
    expect(treeHash(work(c))).toBe(before);
    expect(existsSync(path.join(c.d, ".groundwork", "archive"))).toBe(false);
    expect(listLine(c)).not.toContain("[complete]");
  });

  it("AC7: wrong token is refused, tree and store unchanged", () => {
    const c = makeRepo();
    seed(c);
    commitSpec(c, "2026-09-10T12:00:00");
    const before = treeHash(work(c));
    const r = gw(c, "archive", "foo", "--token", "wrong-token");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--token required");
    expect(treeHash(work(c))).toBe(before);
    expect(listLine(c)).not.toContain("[complete]");
  });

  it("AC7: unknown slug is refused", () => {
    const c = makeRepo();
    seed(c);
    const before = treeHash(work(c));
    const r = gw(c, "archive", "nope", "--token", c.token);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no work unit 'nope'");
    expect(treeHash(work(c))).toBe(before);
  });

  it("AC7: pre-existing archive target is refused, work dir untouched", () => {
    const c = makeRepo();
    seed(c);
    commitSpec(c, "2026-09-10T12:00:00");
    mkdirSync(archiveDir(c), { recursive: true });
    const before = treeHash(work(c));
    const r = gw(c, "archive", "foo", "--token", c.token);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("archive target exists");
    expect(treeHash(work(c))).toBe(before);
    expect(readdirSync(archiveDir(c))).toEqual([]);
    expect(listLine(c)).not.toContain("[complete]");
  });
});
