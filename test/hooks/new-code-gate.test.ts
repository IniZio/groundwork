import { describe, it, expect, afterEach } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import { check, run } from "../../src/hooks/new-code-gate.js";

const TMP = "/tmp/gw-ncg-test";
mkdirSync(TMP, { recursive: true });
const repos: string[] = [];

function makeRepo(label: string): string {
  const dir = path.join(TMP, `${label}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  execSync("git init", { cwd: dir });
  execSync('git config user.email "t@t.com"', { cwd: dir });
  execSync('git config user.name "T"', { cwd: dir });
  repos.push(dir);
  return dir;
}

function makefileWithRules(repo: string) {
  writeFileSync(path.join(repo, "Makefile"), "# groundwork-rule: no-console-log\n# groundwork-rule: no-ts-any\n");
}

afterEach(() => {
  for (const r of repos) { try { rmSync(r, { recursive: true, force: true }); } catch { /* ok */ } }
  repos.length = 0;
});

describe("new-code-gate — pre-existing violation at HEAD is allowed", () => {
  it("committed console.log → no violations", () => {
    const repo = makeRepo("pre-existing");
    makefileWithRules(repo);
    mkdirSync(path.join(repo, "src"), { recursive: true });
    writeFileSync(path.join(repo, "src/index.ts"), 'console.log("old");\nexport const x = 1;\n');
    execSync("git add -A && git commit -m 'chore: init'", { cwd: repo, shell: "/bin/bash" });

    const violations = check(repo);
    expect(violations).toHaveLength(0);
  });
});

describe("new-code-gate — new violating line blocks with name + file + line", () => {
  it("new console.log added after HEAD → blocks, names rule file and line", () => {
    const repo = makeRepo("new-violation");
    makefileWithRules(repo);
    mkdirSync(path.join(repo, "src"), { recursive: true });
    writeFileSync(path.join(repo, "src/index.ts"), 'export const x = 1;\n');
    execSync("git add -A && git commit -m 'chore: init'", { cwd: repo, shell: "/bin/bash" });

    writeFileSync(path.join(repo, "src/index.ts"), 'export const x = 1;\nconsole.log("debug");\n');

    const violations = check(repo);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].rule).toBe("no-console-log");
    expect(violations[0].file).toBe("src/index.ts");
    expect(violations[0].line).toBeGreaterThan(0);

    const result = run({ cwd: repo }, {});
    const out = JSON.parse(result.stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(/no-console-log/);
    expect(out.reason).toMatch(/src\/index\.ts:\d+/);
  });

  it("new ': any' in ts file → blocks with no-ts-any", () => {
    const repo = makeRepo("ts-any");
    makefileWithRules(repo);
    mkdirSync(path.join(repo, "src"), { recursive: true });
    writeFileSync(path.join(repo, "src/a.ts"), "export const x = 1;\n");
    execSync("git add -A && git commit -m 'chore: init'", { cwd: repo, shell: "/bin/bash" });

    writeFileSync(path.join(repo, "src/a.ts"), "export const x = 1;\nconst y: any = {};\n");

    const violations = check(repo);
    const anyViolation = violations.find(v => v.rule === "no-ts-any");
    expect(anyViolation).toBeDefined();
    expect(anyViolation!.file).toBe("src/a.ts");
  });
});

describe("new-code-gate — clean addition allows", () => {
  it("new line without violation → no block", () => {
    const repo = makeRepo("clean");
    makefileWithRules(repo);
    mkdirSync(path.join(repo, "src"), { recursive: true });
    writeFileSync(path.join(repo, "src/index.ts"), "export const x = 1;\n");
    execSync("git add -A && git commit -m 'chore: init'", { cwd: repo, shell: "/bin/bash" });

    writeFileSync(path.join(repo, "src/index.ts"), "export const x = 1;\nexport const y = 2;\n");

    const violations = check(repo);
    expect(violations).toHaveLength(0);

    const result = run({ cwd: repo }, {});
    const out = JSON.parse(result.stdout);
    expect(out.continue).toBe(true);
  });
});

describe("new-code-gate — no rules in repo files → always allows", () => {
  it("Makefile without groundwork-rule lines → violations empty", () => {
    const repo = makeRepo("no-rules");
    writeFileSync(path.join(repo, "Makefile"), ".PHONY: test\ntest:\n\techo ok\n");
    mkdirSync(path.join(repo, "src"), { recursive: true });
    writeFileSync(path.join(repo, "src/index.ts"), "export const x = 1;\n");
    execSync("git add -A && git commit -m 'chore: init'", { cwd: repo, shell: "/bin/bash" });

    writeFileSync(path.join(repo, "src/index.ts"), 'export const x = 1;\nconsole.log("debug");\n');

    const violations = check(repo);
    expect(violations).toHaveLength(0);

    const result = run({ cwd: repo }, {});
    const out = JSON.parse(result.stdout);
    expect(out.continue).toBe(true);
  });

  it("no Makefile at all → allows", () => {
    const repo = makeRepo("no-makefile");
    mkdirSync(path.join(repo, "src"), { recursive: true });
    writeFileSync(path.join(repo, "src/index.ts"), "export const x = 1;\n");
    execSync("git add -A && git commit -m 'chore: init'", { cwd: repo, shell: "/bin/bash" });
    writeFileSync(path.join(repo, "src/index.ts"), 'export const x = 1;\nconsole.log("debug");\n');

    const result = run({ cwd: repo }, {});
    const out = JSON.parse(result.stdout);
    expect(out.continue).toBe(true);
  });
});

describe("new-code-gate — diff.noprefix=true reports full path", () => {
  it("violation in src/index.ts reported as src/index.ts even with diff.noprefix", () => {
    const repo = makeRepo("noprefix");
    makefileWithRules(repo);
    mkdirSync(path.join(repo, "src"), { recursive: true });
    writeFileSync(path.join(repo, "src/index.ts"), "export const x = 1;\n");
    execSync("git -c diff.noprefix=true add -A && git commit -m 'chore: init'", { cwd: repo, shell: "/bin/bash" });
    execSync("git config diff.noprefix true", { cwd: repo });

    writeFileSync(path.join(repo, "src/index.ts"), 'export const x = 1;\nconsole.log("debug");\n');

    const violations = check(repo);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].rule).toBe("no-console-log");
    expect(violations[0].file).toBe("src/index.ts");
  });
});

describe("new-code-gate — untracked file with violation → blocks", () => {
  it("new untracked file with console.log → blocks", () => {
    const repo = makeRepo("untracked");
    makefileWithRules(repo);
    writeFileSync(path.join(repo, "Makefile"), readFileSync(path.join(repo, "Makefile"), "utf8"));
    execSync("git add Makefile && git commit -m 'chore: init'", { cwd: repo, shell: "/bin/bash" });

    mkdirSync(path.join(repo, "src"), { recursive: true });
    writeFileSync(path.join(repo, "src/new.ts"), 'console.log("from untracked");\n');

    const violations = check(repo);
    expect(violations.some(v => v.rule === "no-console-log")).toBe(true);
  });
});

describe("new-code-gate — unknown rule marker", () => {
  it("unknown name → blocks naming it and the allowed set", () => {
    const repo = makeRepo("unknown-rule");
    writeFileSync(path.join(repo, "Makefile"), "# groundwork-rule: no-such-rule\n");
    const out = JSON.parse(run({ cwd: repo, hook_event_name: "Stop" }, {}).stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("no-such-rule");
    expect(out.reason).toContain("no-console-log, no-ts-any");
  });

  it("Makefile without marker → allows", () => {
    const repo = makeRepo("no-marker");
    writeFileSync(path.join(repo, "Makefile"), "all:\n\ttrue\n");
    expect(JSON.parse(run({ cwd: repo, hook_event_name: "Stop" }, {}).stdout).continue).toBe(true);
  });
});

describe("new-code-gate — session base (spawned by deployed path)", () => {
  const HOOK = path.resolve(import.meta.dir, "../../src/hooks/new-code-gate.ts");
  const BASE_DATE = "2020-01-01T00:00:00Z";
  const SESSION_START = "2020-01-02T00:00:00Z";
  const SESSION_DATE = "2020-01-03T00:00:00Z";

  function save(repo: string, msg: string, date: string) {
    execSync(`git add -A && git commit -m '${msg}'`, { cwd: repo, shell: "/bin/bash", env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  }
  function transcript(repo: string): string {
    const f = path.join(repo, "..", `${path.basename(repo)}.jsonl`);
    writeFileSync(f, JSON.stringify({ timestamp: SESSION_START }) + "\n");
    return f;
  }
  function spawn(payload: Record<string, unknown>) {
    const env = { ...process.env } as Record<string, string | undefined>;
    delete env.CLAUDE_PROJECT_DIR;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    const r = Bun.spawnSync(["bun", HOOK], { stdin: Buffer.from(JSON.stringify(payload)), env: env as Record<string, string> });
    return JSON.parse(r.stdout.toString());
  }
  function seed(label: string, body: string): string {
    const repo = makeRepo(label);
    makefileWithRules(repo);
    mkdirSync(path.join(repo, "src"), { recursive: true });
    writeFileSync(path.join(repo, "src/a.ts"), body);
    save(repo, "chore: init", BASE_DATE);
    return repo;
  }

  it("subagent commits violation then SubagentStop -> blocks naming rule", () => {
    const repo = seed("sb-commit", "export const x = 1;\n");
    const tp = transcript(repo);
    writeFileSync(path.join(repo, "src/a.ts"), 'export const x = 1;\nconsole.log("c");\n');
    save(repo, "feat: add", SESSION_DATE);
    const out = spawn({ hook_event_name: "SubagentStop", transcript_path: "/nonexistent", agent_transcript_path: tp, cwd: repo });
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(/no-console-log src\/a\.ts:2/);
  });

  it("Stop: uncommitted and untracked violations still block", () => {
    const repo = seed("sb-dirty", "export const x = 1;\n");
    const tp = transcript(repo);
    writeFileSync(path.join(repo, "src/a.ts"), 'export const x = 1;\nconsole.log("u");\n');
    writeFileSync(path.join(repo, "src/b.ts"), 'console.log("n");\n');
    const out = spawn({ hook_event_name: "Stop", transcript_path: tp, cwd: repo });
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(/src\/a\.ts:2/);
    expect(out.reason).toMatch(/src\/b\.ts:1/);
  });

  it("violation committed before session start -> allowed", () => {
    const repo = seed("sb-old", 'console.log("old");\n');
    const tp = transcript(repo);
    expect(spawn({ hook_event_name: "Stop", transcript_path: tp, cwd: repo }).continue).toBe(true);
  });

  it("missing transcript -> diffs against HEAD (committed ignored, dirty blocks)", () => {
    const repo = seed("sb-missing", "export const x = 1;\n");
    writeFileSync(path.join(repo, "src/a.ts"), 'export const x = 1;\nconsole.log("c");\n');
    save(repo, "feat: add", SESSION_DATE);
    const payload = { hook_event_name: "SubagentStop", transcript_path: "/nonexistent", agent_transcript_path: "/nonexistent2", cwd: repo };
    expect(spawn(payload).continue).toBe(true);
    writeFileSync(path.join(repo, "src/a.ts"), 'export const x = 1;\nconsole.log("c");\nconsole.log("d");\n');
    expect(spawn(payload).decision).toBe("block");
  });
});
