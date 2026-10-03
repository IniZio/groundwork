import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const MAIN = path.resolve(import.meta.dir, "../../src/cli/main.ts");
const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "gw-nse2e-")));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const env = (() => {
  const e = { ...process.env } as Record<string, string>;
  delete e.GROUNDWORK_DB; delete e.CLAUDE_PROJECT_DIR; delete e.GW;
  return {
    ...e, XDG_CONFIG_HOME: path.join(tmp, "xdg"), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
  };
})();

const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, env, encoding: "utf8" });
const gw = (cwd: string, ...a: string[]) => {
  const r = spawnSync("bun", [MAIN, ...a], { cwd, env, encoding: "utf8" });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
};

let n = 0;
function setup(mode?: string) {
  const parent = path.join(tmp, `p${n}`);
  const child = path.join(tmp, `c${n++}`);
  mkdirSync(parent, { recursive: true });
  git(parent, "init", "-q");
  writeFileSync(path.join(parent, "a.txt"), "a\n");
  git(parent, "add", "a.txt");
  git(parent, "commit", "-q", "-m", "init");
  expect(git(parent, "worktree", "add", "-q", "-b", `b${n}`, child).status).toBe(0);
  const init = gw(parent, "init");
  const tok = /token: (\S+)/.exec(init.out)![1];
  expect(gw(parent, "motive", "add", "m1", "--use", "--token", tok).code).toBe(0);
  expect(gw(parent, "slice", "add", "S1", "--token", tok).code).toBe(0);
  const link = gw(parent, "scope", "link", child, "--slice", "S1", ...(mode ? ["--mode", mode] : []), "--token", tok);
  expect(link.code).toBe(0);
  return { parent, child, tok };
}
const childInit = (child: string) => {
  const r = gw(child, "init");
  expect(r.code).toBe(0);
  return /token: (\S+)/.exec(r.out)?.[1] ?? gw(child, "token").out.match(/token: (\S+)/)![1];
};

describe("nested scope e2e", () => {
  it("delegate: child approve forwards, parent complete succeeds", () => {
    const { parent, child, tok } = setup();
    const ctok = childInit(child);
    expect(gw(child, "gate", "approve", "--citation", "a.txt:1", "--token", ctok).code).toBe(0);
    const r = gw(parent, "slice", "complete", "S1", "--token", tok);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
  });

  it("parent complete refused before child approve; unknown flags change nothing", () => {
    const { parent, child, tok } = setup();
    childInit(child);
    for (const extra of [[], ["--force"], ["--skip-guard"]]) {
      const r = gw(parent, "slice", "complete", "S1", "--token", tok, ...extra);
      expect(r.code).toBe(1);
      expect(r.err).toContain("cannot complete slice 'S1'");
    }
    expect(gw(parent, "slice", "status").out).toContain("pending");
  });

  it("CORRECTION after APPROVE refuses", () => {
    const { parent, child, tok } = setup();
    const ctok = childInit(child);
    gw(child, "gate", "approve", "--citation", "a.txt:1", "--token", ctok);
    const c = gw(child, "gate", "correction", "--citation", "a.txt:2", "--token", ctok);
    expect(c.code).toBe(0);
    const r = gw(parent, "slice", "complete", "S1", "--token", tok);
    expect(r.code).toBe(1);
    expect(r.err).toContain("latest child verdict");
  });

  it("direct mode needs scope verify", () => {
    const { parent, child, tok } = setup("direct");
    expect(gw(child, "init").out).toContain("no child store");
    const before = gw(parent, "slice", "complete", "S1", "--token", tok);
    expect(before.code).toBe(1);
    expect(before.err).toContain("gw scope verify");
    expect(gw(parent, "scope", "verify", "--slice", "S1", "--citation", "a.txt:1", "--token", tok).code).toBe(0);
    expect(gw(parent, "slice", "complete", "S1", "--token", tok).code).toBe(0);
  });

  it("scope errors: stderr gw: prefix, exit 1; token required", () => {
    const { parent, child, tok } = setup();
    const v = gw(parent, "scope", "verify", "--slice", "S1", "--citation", "a.txt:1", "--token", tok);
    expect(v.code).toBe(1);
    expect(v.err).toStartWith("gw: ");
    expect(gw(parent, "scope", "unlink", "--slice", "S1", "--reason", "x").code).toBe(1);
    void child;
  });

  it("unlink with reason frees slice", () => {
    const { parent, tok } = setup();
    expect(gw(parent, "slice", "complete", "S1", "--token", tok).code).toBe(1);
    expect(gw(parent, "scope", "unlink", "--slice", "S1", "--reason", " ", "--token", tok).code).toBe(1);
    expect(gw(parent, "scope", "unlink", "--slice", "S1", "--reason", "abandoned", "--token", tok).code).toBe(0);
    expect(gw(parent, "slice", "complete", "S1", "--token", tok).code).toBe(0);
  });

  it("event append rejects each scope type", () => {
    const { parent, tok } = setup();
    for (const t of ["CHILD_LINK", "CHILD_REGISTER", "CHILD_GATE", "SCOPE_VERIFY", "SCOPE_UNLINK", "SCOPE_PARENT"]) {
      const r = gw(parent, "event", "append", "--type", t, "--msg", "x", "--token", tok);
      expect(r.code).toBe(1);
      expect(r.err).toContain("cannot be appended directly");
    }
  });

  it("gate status --json in parent and child", () => {
    const { parent, child, tok } = setup();
    const ctok = childInit(child);
    const p = JSON.parse(gw(parent, "gate", "status", "--json").out);
    expect(p.scope).toBe("root");
    const c0 = JSON.parse(gw(child, "gate", "status", "--json").out);
    expect(c0.scope).toBe("child");
    expect(c0.parent.slice).toBe("S1");
    gw(child, "gate", "approve", "--citation", "a.txt:1", "--token", ctok);
    expect(JSON.parse(gw(child, "gate", "status", "--json").out).gate).toBe("APPROVE");
    void tok;
  });

  it("forward failure exits nonzero, local verdict stays", () => {
    const { parent, child } = setup();
    const ctok = childInit(child);
    rmSync(path.join(parent, ".groundwork", "work.db"));
    const r = gw(child, "gate", "approve", "--citation", "a.txt:1", "--token", ctok);
    expect(r.code).toBe(1);
    expect(r.err).toContain("remains recorded");
    expect(JSON.parse(gw(child, "gate", "status", "--json").out).gate).toBe("APPROVE");
  });

  describe("plain errors print gw: <msg>, no stack", () => {
    const clean = (r: { code: number | null; err: string }) => {
      expect(r.code).toBe(1);
      expect(r.err.startsWith("gw: ")).toBe(true);
      expect(r.err.split("\n").some(l => /^\s+at /.test(l))).toBe(false);
    };

    it("scope link to a missing slice", () => {
      const { parent, child, tok } = setup();
      clean(gw(parent, "scope", "link", child, "--slice", "NOPE", "--token", tok));
    });

    it("scope link into a dir with a corrupt pointer", () => {
      const { parent, tok } = setup();
      const bad = path.join(tmp, `bad${n++}`);
      mkdirSync(path.join(bad, ".groundwork"), { recursive: true });
      writeFileSync(path.join(bad, ".groundwork", "parent"), "{not json");
      clean(gw(parent, "scope", "link", bad, "--slice", "S1", "--token", tok));
    });
  });
});
