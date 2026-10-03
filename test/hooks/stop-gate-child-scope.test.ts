import { describe, it, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync, appendFileSync, rmSync, mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { runMigrations } from "../../src/store/migrations.js";
import { MIGRATIONS } from "../../src/store/schema.js";

const HOOK_PATH = path.resolve(import.meta.dir, "../../src/hooks/stop-gate.ts");

describe("stop-gate — child scope pointer", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  });

  const git = (cwd: string, args: string[], date?: string) =>
    spawnSync("git", args, {
      cwd, encoding: "utf8",
      env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
        ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
    });

  /** dirty repo: a session-touched, uncommitted code file, no work store */
  function dirty(): { repo: string; transcript: string } {
    const root = mkdtempSync(path.join(os.tmpdir(), "gw-childscope-"));
    tmpDirs.push(root);
    const repo = path.join(root, "repo");
    mkdirSync(repo);
    git(repo, ["init", "-q"]);
    writeFileSync(path.join(repo, "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "base"], "2020-01-01T00:00:00Z");
    const transcript = path.join(root, "t.jsonl");
    writeFileSync(transcript, JSON.stringify({ type: "user", timestamp: "2021-01-01T00:00:00Z" }) + "\n");
    writeFileSync(path.join(repo, "a.ts"), "export const a = 2;\n");
    appendFileSync(transcript, JSON.stringify({
      type: "assistant", timestamp: "2021-01-02T00:00:00Z", cwd: repo, isSidechain: false,
      message: { role: "assistant", content: [{ type: "tool_use", id: "tu0", name: "Edit", input: { file_path: path.join(repo, "a.ts"), old_string: "1", new_string: "2" } }] },
    }) + "\n");
    return { repo, transcript };
  }

  const pointer = (repo: string, over: Record<string, unknown> | string) => {
    mkdirSync(path.join(repo, ".groundwork"), { recursive: true });
    const body = typeof over === "string" ? over : JSON.stringify({
      v: 1, motive: "m-parent", slice: "P-07", link_id: "L1", mode: "delegate", root: "/nowhere", created: "2021-01-01T00:00:00Z", ...over,
    });
    writeFileSync(path.join(repo, ".groundwork", "parent"), body);
  };

  function stop(repo: string, transcript: string) {
    const home = path.join(path.dirname(repo), "home");
    mkdirSync(home, { recursive: true });
    const payload = {
      hook_event_name: "Stop", session_id: "sess-1", transcript_path: transcript, cwd: repo,
      stop_hook_active: false, background_tasks: [],
    };
    const env: Record<string, string | undefined> = { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: repo };
    delete env.GROUNDWORK_DB;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    const r = spawnSync("bun", [HOOK_PATH], { input: JSON.stringify(payload), encoding: "utf8", env: env as Record<string, string> });
    return { raw: r.stdout, out: JSON.parse(r.stdout.trim()) as Record<string, unknown>, exit: r.status };
  }
  const seq = (repo: string, transcript: string, n: number) =>
    Array.from({ length: n }, () => (stop(repo, transcript).out.decision === "block" ? "block" : "allow"));

  it("no pointer: exact existing block line and exit 0 (positive control)", () => {
    const { repo, transcript } = dirty();
    const r = stop(repo, transcript);
    expect(r.exit).toBe(0);
    expect(r.out.decision).toBe("block");
    expect(r.out.reason).toBe("stop-gate: 1 code file(s) changed this session with no work store [a.ts]. Set up the store with gw init: run `$GW init`, slice with `$GW slice add`, delegate to groundwork:implementer.");
  });

  it("delegate pointer + work.db present: no unledgered block", () => {
    const { repo, transcript } = dirty();
    pointer(repo, {});
    const db = new Database(path.join(repo, ".groundwork", "work.db"));
    runMigrations(db, MIGRATIONS);
    db.close();
    const r = stop(repo, transcript);
    expect(r.out.decision).toBeUndefined();
    expect(String(r.out.reason)).not.toContain("no work store");
  });

  it("delegate pointer, no work.db: block names parent slice and gw init; same 3-block counter", () => {
    const { repo, transcript } = dirty();
    pointer(repo, {});
    const r = stop(repo, transcript);
    expect(r.out.decision).toBe("block");
    expect(String(r.out.reason)).toContain("P-07");
    expect(String(r.out.reason)).toContain("$GW init");
    expect(seq(repo, transcript, 4)).toEqual(["block", "block", "allow", "block"]);
  });

  it("direct pointer: stands down, allow, names no mode or switch", () => {
    const { repo, transcript } = dirty();
    pointer(repo, { mode: "direct" });
    for (let i = 0; i < 5; i++) {
      const r = stop(repo, transcript);
      expect(r.exit).toBe(0);
      expect(r.out.decision).toBeUndefined();
      expect(r.out.continue).toBe(true);
      expect(r.raw.toLowerCase()).not.toMatch(/mode|direct|delegate|flag|switch|--/);
    }
  });

  const bad: [string, string][] = [
    ["unparseable json", "{not json"],
    ["unknown higher v", JSON.stringify({ v: 2, motive: "m", slice: "s", link_id: "l", mode: "delegate", root: "/x", created: "c" })],
    ["unknown mode", JSON.stringify({ v: 1, motive: "m", slice: "s", link_id: "l", mode: "bogus", root: "/x", created: "c" })],
  ];
  for (const [name, body] of bad) {
    it(`invalid pointer (${name}): blocks, counts toward the 3-block release`, () => {
      const { repo, transcript } = dirty();
      pointer(repo, body);
      const r = stop(repo, transcript);
      expect(r.out.decision).toBe("block");
      expect(String(r.out.reason)).toContain("scope pointer");
      expect(seq(repo, transcript, 4)).toEqual(["block", "block", "allow", "block"]);
    });
  }
});
