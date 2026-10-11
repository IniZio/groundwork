import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const MAIN = path.join(ROOT, "src/cli/main.ts");
const HOOK = path.join(ROOT, "src/hooks/stop-gate.ts");
const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "gw-db-missing-")));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function envFor(xdg: string, extra: Record<string, string> = {}): Record<string, string> {
  const e = { ...process.env } as Record<string, string>;
  delete e.GROUNDWORK_DB; delete e.CLAUDE_PROJECT_DIR; delete e.GW;
  return {
    ...e, XDG_CONFIG_HOME: xdg, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
    ...extra,
  };
}

let n = 0;
/** Temp git repo; with `store`, a work store holding one incomplete slice. */
function repo(store: boolean) {
  const xdg = path.join(tmp, `xdg${n}`);
  mkdirSync(xdg, { recursive: true });
  const env = envFor(xdg);
  const root = path.join(tmp, `r${n++}`);
  mkdirSync(root, { recursive: true });
  const git = (...a: string[]) => spawnSync("git", a, { cwd: root, env, encoding: "utf8" });
  const gw = (...a: string[]) => spawnSync("bun", [MAIN, ...a], { cwd: root, env, encoding: "utf8" });
  git("init", "-q");
  writeFileSync(path.join(root, ".gitignore"), ".groundwork/\n");
  writeFileSync(path.join(root, "a.txt"), "a\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  if (store) {
    const tok = /token: (\S+)/.exec(gw("init").stdout)![1];
    expect(gw("slice", "add", "S1", "--token", tok).status).toBe(0);
  }
  return { root, xdg };
}

function stopWithMissing(store: boolean) {
  const { root, xdg } = repo(store);
  const missing = path.join(tmp, `nowhere${n}`, "missing.db");
  const r = spawnSync("bun", [HOOK], {
    cwd: root, env: envFor(xdg, { GROUNDWORK_DB: missing }), encoding: "utf8",
    input: JSON.stringify({ session_id: "miss-test", cwd: root }),
  });
  const out = { exit: r.status, stdout: r.stdout, stderr: r.stderr, missing, root };
  console.log(`TRACE store=${store} exit=${out.exit}\nstdout: ${out.stdout}\nstderr: ${out.stderr}`);
  return out;
}

describe("GROUNDWORK_DB pointing at a missing file", () => {
  it("(a) falls back to the repo store, blocks on incomplete slice, prints notice", () => {
    const r = stopWithMissing(true);
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain('"decision":"block"');
    expect(r.stderr).toContain(r.missing);
  });

  it("(b) allows when no repo store exists, prints notice", () => {
    const r = stopWithMissing(false);
    expect(r.exit).toBe(0);
    expect(r.stdout).not.toContain('"decision":"block"');
    expect(r.stderr).toContain(r.missing);
  });

  it("(c) creates nothing at the missing path", () => {
    for (const store of [true, false]) {
      const r = stopWithMissing(store);
      expect(existsSync(r.missing)).toBe(false);
      expect(existsSync(path.dirname(r.missing))).toBe(false);
    }
  });

  it("(d) no uncaught exception on stderr", () => {
    for (const store of [true, false]) {
      const r = stopWithMissing(store);
      expect(r.stderr).not.toMatch(/SQLiteError|unable to open|at .*\.ts:\d+|Error:/);
    }
  });
});
