import { describe, it, expect, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, appendFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const HOOK_PATH = path.resolve(import.meta.dir, "../../src/hooks/stop-gate.ts");

describe("stop-gate — unledgered code changes", () => {
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

  /** repo with an old base commit (2020), transcript starting 2021; later commits count. */
  function setup(tmpBase: string = os.tmpdir()): { repo: string; transcript: string } {
    const root = mkdtempSync(path.join(tmpBase, "gw-unledgered-"));
    tmpDirs.push(root);
    const repo = path.join(root, "repo");
    mkdirSync(repo);
    git(repo, ["init", "-q"]);
    writeFileSync(path.join(repo, "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "base"], "2020-01-01T00:00:00Z");
    const transcript = path.join(root, "t.jsonl");
    writeFileSync(transcript, JSON.stringify({ type: "user", timestamp: "2021-01-01T00:00:00Z" }) + "\n");
    return { repo, transcript };
  }

  /** append a main-thread assistant entry with tool_use blocks, shaped like a real transcript */
  function touch(repo: string, transcript: string, tools: { name: string; input: Record<string, unknown> }[]) {
    appendFileSync(transcript, JSON.stringify({
      type: "assistant", timestamp: "2021-01-02T00:00:00Z", cwd: repo, isSidechain: false,
      message: { role: "assistant", content: tools.map((t, i) => ({ type: "tool_use", id: "tu" + i, name: t.name, input: t.input })) },
    }) + "\n");
  }
  const edit = (repo: string, transcript: string, f: string) =>
    touch(repo, transcript, [{ name: "Edit", input: { file_path: path.join(repo, f), old_string: "a", new_string: "b" } }]);

  function commit(repo: string, file: string, date: string) {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), "x\n");
    git(repo, ["add", "-A", "-f"]);
    git(repo, ["commit", "-q", "-m", "c " + file], date);
  }

  function stop(repo: string, transcript: string, over: Record<string, unknown> = {}, env: Record<string, string> = {}) {
    const home = path.join(path.dirname(repo), "home");
    mkdirSync(home, { recursive: true });
    const payload = {
      hook_event_name: "Stop", session_id: "sess-1", transcript_path: transcript, cwd: repo,
      stop_hook_active: false, background_tasks: [], ...over,
    };
    const cleanEnv: Record<string, string | undefined> = { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: repo, ...env };
    delete cleanEnv.GROUNDWORK_DB;
    if (!("CLAUDE_CODE_ENTRYPOINT" in env)) delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
    const r = spawnSync("bun", [HOOK_PATH], { input: JSON.stringify(payload), encoding: "utf8", env: cleanEnv as Record<string, string> });
    return { out: JSON.parse(r.stdout.trim()) as Record<string, unknown>, stderr: r.stderr };
  }

  it("blocks committed code file since base; names gw init", () => {
    const { repo, transcript } = setup();
    commit(repo, "b.ts", "2021-06-01T00:00:00Z");
    edit(repo, transcript, "b.ts");
    const { out } = stop(repo, transcript);
    expect(out.decision).toBe("block");
    expect(String(out.reason)).toContain("gw init");
  });

  it("blocks uncommitted edit to tracked code file", () => {
    const { repo, transcript } = setup();
    writeFileSync(path.join(repo, "a.ts"), "export const a = 2;\n");
    edit(repo, transcript, "a.ts");
    expect(stop(repo, transcript).out.decision).toBe("block");
  });

  it("blocks untracked new code file", () => {
    const { repo, transcript } = setup();
    writeFileSync(path.join(repo, "new.py"), "x = 1\n");
    touch(repo, transcript, [{ name: "Write", input: { file_path: path.join(repo, "new.py"), content: "x = 1\n" } }]);
    expect(stop(repo, transcript).out.decision).toBe("block");
  });

  it("allows when only README.md, doc/x.txt, .groundwork/notes changed", () => {
    const { repo, transcript } = setup();
    writeFileSync(path.join(repo, "README.md"), "hi\n");
    mkdirSync(path.join(repo, "doc"));
    writeFileSync(path.join(repo, "doc/x.txt"), "x\n");
    mkdirSync(path.join(repo, ".groundwork"));
    writeFileSync(path.join(repo, ".groundwork/notes"), "n\n");
    commit(repo, "doc/y.txt", "2021-06-01T00:00:00Z");
    for (const f of ["README.md", "doc/x.txt", "doc/y.txt", ".groundwork/notes"]) edit(repo, transcript, f);
    const { out } = stop(repo, transcript);
    expect(out.decision).toBeUndefined();
    expect(out.continue).toBe(true);
  });

  it("allows with no changes (no active work store)", () => {
    const { repo, transcript } = setup();
    const { out } = stop(repo, transcript);
    expect(out.continue).toBe(true);
    expect(String(out.reason)).toContain("no active work store");
  });

  it("allows SubagentStop and sdk entrypoint", () => {
    const { repo, transcript } = setup();
    writeFileSync(path.join(repo, "new.py"), "x = 1\n");
    edit(repo, transcript, "new.py");
    expect(stop(repo, transcript, { hook_event_name: "SubagentStop" }).out.decision).toBeUndefined();
    expect(stop(repo, transcript, {}, { CLAUDE_CODE_ENTRYPOINT: "sdk-js" }).out.decision).toBeUndefined();
  });

  it("releases after 4 blocked attempts with warning", () => {
    const { repo, transcript } = setup();
    writeFileSync(path.join(repo, "new.py"), "x = 1\n");
    edit(repo, transcript, "new.py");
    for (let i = 0; i < 3; i++) expect(stop(repo, transcript).out.decision).toBe("block");
    const r = stop(repo, transcript);
    expect(r.out.decision).toBeUndefined();
    expect(r.out.continue).toBe(true);
    expect(r.stderr).toContain("4th consecutive block");
  });

  it("commits before session base do not count", () => {
    const { repo, transcript } = setup();
    commit(repo, "old.ts", "2020-06-01T00:00:00Z");
    edit(repo, transcript, "old.ts");
    const { out } = stop(repo, transcript);
    expect(out.decision).toBeUndefined();
    expect(out.continue).toBe(true);
  });

  it("pre-session dirty tree, nothing touched this session: allows", () => {
    const { repo, transcript } = setup();
    writeFileSync(path.join(repo, "a.ts"), "export const a = 9;\n");
    writeFileSync(path.join(repo, "scratch.py"), "x = 1\n");
    const { out } = stop(repo, transcript);
    expect(out.decision).toBeUndefined();
    expect(out.continue).toBe(true);
  });

  it("other session's commit in window, not in transcript: allows", () => {
    const { repo, transcript } = setup();
    commit(repo, "other.ts", "2021-06-01T00:00:00Z");
    const { out } = stop(repo, transcript);
    expect(out.decision).toBeUndefined();
    expect(out.continue).toBe(true);
  });

  it("session Bash append then commit: blocks, lists file, names $GW init", () => {
    // vendored Bash extractor ignores /tmp/ targets, so host this repo outside os.tmpdir()
    const { repo, transcript } = setup("/var/tmp");
    mkdirSync(path.join(repo, "src"));
    writeFileSync(path.join(repo, "src/a.ts"), "x");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "src"], "2021-03-01T00:00:00Z");
    touch(repo, transcript, [{ name: "Bash", input: { command: "printf 'x' >> src/a.ts" } }]);
    appendFileSync(path.join(repo, "src/a.ts"), "x");
    git(repo, ["commit", "-qam", "edit"], "2021-06-01T00:00:00Z");
    const { out } = stop(repo, transcript);
    expect(out.decision).toBe("block");
    expect(String(out.reason)).toContain("src/a.ts");
    expect(String(out.reason)).toContain("$GW init");
  });

  it("sidechain tool_use does not attribute", () => {
    const { repo, transcript } = setup();
    writeFileSync(path.join(repo, "new.py"), "x = 1\n");
    appendFileSync(transcript, JSON.stringify({ type: "assistant", timestamp: "2021-01-02T00:00:00Z", cwd: repo, isSidechain: true,
      message: { role: "assistant", content: [{ type: "tool_use", id: "t", name: "Write", input: { file_path: path.join(repo, "new.py") } }] } }) + "\n");
    expect(stop(repo, transcript).out.decision).toBeUndefined();
  });

  it("counter resets on an allow: block, allow, then 3 more blocks before release", () => {
    const { repo, transcript } = setup();
    writeFileSync(path.join(repo, "new.py"), "x = 1\n");
    edit(repo, transcript, "new.py");
    expect(stop(repo, transcript).out.decision).toBe("block");
    expect(stop(repo, transcript).out.decision).toBe("block");
    rmSync(path.join(repo, "new.py")); // nothing blocks -> counter resets
    expect(stop(repo, transcript).out.decision).toBeUndefined();
    writeFileSync(path.join(repo, "new.py"), "x = 1\n");
    const seq = [0, 1, 2, 3].map(() => {
      const r = stop(repo, transcript);
      return r.out.decision === "block" ? "block" : "continue";
    });
    expect(seq).toEqual(["block", "block", "block", "continue"]);
    // after release counter is cleared: designed semantics = a fresh run of 3 blocks follows
    expect(stop(repo, transcript).out.decision).toBe("block");
  });

  it("session-touched tracked code file later deleted: allows", () => {
    const { repo, transcript } = setup();
    writeFileSync(path.join(repo, "a.ts"), "export const a = 2;\n");
    edit(repo, transcript, "a.ts");
    expect(stop(repo, transcript).out.decision).toBe("block");
    rmSync(path.join(repo, "a.ts")); // still in git diff as a deletion
    const { out } = stop(repo, transcript);
    expect(out.decision).toBeUndefined();
    expect(out.continue).toBe(true);
  });

  it("creates no .groundwork/ in the host repo when no work store exists", () => {
    const { repo, transcript } = setup();
    mkdirSync(path.join(repo, "sub"));
    writeFileSync(path.join(repo, "sub/n.py"), "x = 1\n");
    edit(repo, transcript, "sub/n.py");
    for (let i = 0; i < 4; i++) stop(repo, transcript, { cwd: path.join(repo, "sub") });
    expect(existsSync(path.join(repo, ".groundwork"))).toBe(false);
    expect(existsSync(path.join(repo, "sub/.groundwork"))).toBe(false);
  });

  it("not a git repo allows", () => {
    const d = mkdtempSync(path.join(os.tmpdir(), "gw-unledgered-ng-"));
    tmpDirs.push(d);
    writeFileSync(path.join(d, "a.ts"), "x\n");
    expect(stop(path.join(d), path.join(d, "none.jsonl")).out.decision).toBeUndefined();
  });
});
