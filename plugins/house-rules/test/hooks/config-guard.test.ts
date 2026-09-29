import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PLUGIN_ROOT = resolve(import.meta.dir, "../..");
const FALLBACK_CMD = "bun ${CLAUDE_PLUGIN_ROOT}/src/hooks/config-guard.ts";
const BYPASS_RE =
  /env(ironment)?\s*var|CLAUDE_[A-Z_]+|HOUSE_RULES_[A-Z_]+|kill[- ]?switch|disabl|bypass|skip|--no-verify|override/i;
const LOOSEN_MSG =
  "Loosening house-rules config is a human decision. Ask the user to make this change.";

function hookCommand(): string {
  try {
    const manifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf8"));
    for (const group of manifest.hooks?.PreToolUse ?? []) {
      for (const h of group.hooks ?? []) {
        if (typeof h.command === "string" && h.command.includes("config-guard.ts")) return h.command;
      }
    }
  } catch {
    // fall through to literal command
  }
  return FALLBACK_CMD;
}

type Result = { stdout: string; exit: number; reason: string | null; decision: string | null };
const denyReasons: string[] = [];

async function runHook(repo: string, toolName: string, toolInput: Record<string, unknown>): Promise<Result> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  delete env.CLAUDE_PROJECT_DIR;
  env.CLAUDE_PROJECT_DIR = repo;
  env.CLAUDE_PLUGIN_ROOT = PLUGIN_ROOT;
  const parts = hookCommand().replaceAll("${CLAUDE_PLUGIN_ROOT}", PLUGIN_ROOT).split(" ");
  const proc = Bun.spawn(parts, { stdin: "pipe", stdout: "pipe", stderr: "pipe", env, cwd: repo });
  proc.stdin.write(
    JSON.stringify({ hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput, cwd: repo }),
  );
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  let reason: string | null = null;
  let decision: string | null = null;
  if (stdout.trim() !== "") {
    const out = JSON.parse(stdout).hookSpecificOutput;
    decision = out.permissionDecision;
    reason = out.permissionDecisionReason;
    if (decision === "deny") denyReasons.push(reason as string);
  }
  return { stdout, exit, reason, decision };
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hr-config-guard-"));
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "t@example.com"', { cwd: dir });
  execSync('git config user.name "T"', { cwd: dir });
  execSync("git commit -q --allow-empty -m 'initial work'", { cwd: dir });
  return dir;
}

const repos: string[] = [];
let repo: string;
let file: string;

beforeAll(() => {
  repo = makeRepo();
  repos.push(repo);
  file = join(repo, ".house-rules.json");
});
afterAll(() => {
  for (const r of repos) rmSync(r, { recursive: true, force: true });
});

function setFile(content: string | null): void {
  if (content === null) rmSync(file, { force: true });
  else writeFileSync(file, content);
}

const cfg = (rules: Record<string, unknown>) => JSON.stringify({ rules }, null, 2) + "\n";

async function expectAllow(r: Promise<Result>): Promise<void> {
  const res = await r;
  expect(res.stdout.trim()).toBe("");
  expect(res.exit).toBe(0);
}

async function expectDeny(r: Promise<Result>, ...needles: string[]): Promise<Result> {
  const res = await r;
  expect(res.exit).toBe(0);
  expect(res.decision).toBe("deny");
  for (const n of needles) expect(res.reason).toContain(n);
  return res;
}

const write = (content: string) => runHook(repo, "Write", { file_path: file, content });
const edit = (o: string, n: string) =>
  runHook(repo, "Edit", { file_path: file, old_string: o, new_string: n });
const multi = (o: string, n: string) =>
  runHook(repo, "MultiEdit", { file_path: file, edits: [{ old_string: o, new_string: n }] });

const KEY_SEV = 'rules["comment-density"]';

describe("allow: tightening or neutral changes", () => {
  test("pin preset equal to detection (Write)", async () => {
    setFile(null);
    await expectAllow(write(cfg({ "commit-message": ["error", { preset: "handbook" }] })));
  });

  test("pin preset equal to detection (Edit)", async () => {
    setFile(cfg({ "commit-message": "error" }));
    await expectAllow(edit('"commit-message": "error"', '"commit-message": ["error", {"preset": "handbook"}]'));
  });

  test("repair legacy warn to error (Write)", async () => {
    setFile(cfg({ "comment-density": "warn" }));
    await expectAllow(write(cfg({ "comment-density": "error" })));
  });

  test("repair legacy warn to error (Edit)", async () => {
    setFile(cfg({ "stray-artifacts": "warn" }));
    await expectAllow(edit('"warn"', '"error"'));
  });

  test("repair legacy off to error (MultiEdit)", async () => {
    setFile(cfg({ "comment-density": "off" }));
    await expectAllow(multi('"off"', '"error"'));
  });

  test("repair legacy off to error (Write)", async () => {
    setFile(cfg({ "stray-artifacts": "off" }));
    await expectAllow(write(cfg({ "stray-artifacts": "error" })));
  });

  test("explicit rule at default into empty file (Write)", async () => {
    setFile("");
    await expectAllow(write(cfg({ "comment-density": "error" })));
  });

  test("explicit rule at default into missing file (Write)", async () => {
    setFile(null);
    await expectAllow(write(cfg({ "comment-density": "error" })));
  });

  test("whitespace-only reformat (Write)", async () => {
    setFile(cfg({ "comment-density": "error" }));
    await expectAllow(write('{"rules":{"comment-density":"error"}}'));
  });

  test("adding $schema (Write)", async () => {
    setFile(cfg({ "comment-density": "error" }));
    await expectAllow(
      write(JSON.stringify({ $schema: "./schema.json", rules: { "comment-density": "error" } })),
    );
  });

  test("non-target file with any content", async () => {
    const other = join(repo, "other.json");
    await expectAllow(runHook(repo, "Write", { file_path: other, content: '{"rules":{"comment-density":"off"}}' }));
    await expectAllow(runHook(repo, "Write", { file_path: other, content: "not json" }));
  });
});

describe("deny: loosening", () => {
  test("preset differs from detection (Write)", async () => {
    setFile(null);
    await expectDeny(
      write(cfg({ "commit-message": ["error", { preset: "conventional" }] })),
      '  rules["commit-message"].preset: handbook → conventional',
      LOOSEN_MSG,
    );
  });

  test("preset differs from detection (MultiEdit)", async () => {
    setFile(cfg({ "commit-message": ["error", { preset: "handbook" }] }));
    await expectDeny(
      multi('"handbook"', '"subject-only"'),
      '  rules["commit-message"].preset: handbook → subject-only',
    );
  });
});

describe("deny: invalid content", () => {
  test("comment-density off is invalid (Write)", async () => {
    setFile(cfg({ "comment-density": "error" }));
    const res = await expectDeny(write(cfg({ "comment-density": "off" })), "is invalid", "Ask the user");
    expect(res.reason).toContain(`${KEY_SEV}: invalid severity; allowed: error`);
  });

  test("comment-density off is invalid (Edit)", async () => {
    setFile(cfg({ "comment-density": "error" }));
    const res = await expectDeny(edit('"error"', '"off"'), "is invalid", "Ask the user");
    expect(res.reason).toContain(`${KEY_SEV}: invalid severity`);
  });

  test("comment-density off is invalid (MultiEdit)", async () => {
    setFile(cfg({ "comment-density": "error" }));
    const res = await expectDeny(multi('"error"', '"off"'), "is invalid", "Ask the user");
    expect(res.reason).toContain(`${KEY_SEV}: invalid severity`);
  });

  test("comment-density warn is invalid (Write)", async () => {
    setFile(cfg({ "comment-density": "error" }));
    const res = await expectDeny(write(cfg({ "comment-density": "warn" })), "is invalid", "Ask the user");
    expect(res.reason).toContain(`${KEY_SEV}: invalid severity`);
  });

  test("comment-density warn is invalid (Edit)", async () => {
    setFile(cfg({ "comment-density": "error" }));
    const res = await expectDeny(edit('"error"', '"warn"'), "is invalid", "Ask the user");
    expect(res.reason).toContain(`${KEY_SEV}: invalid severity`);
  });

  test("stray-artifacts off is invalid (Write)", async () => {
    setFile(cfg({ "stray-artifacts": "error" }));
    const res = await expectDeny(write(cfg({ "stray-artifacts": "off" })), "is invalid", "Ask the user");
    expect(res.reason).toContain('rules["stray-artifacts"]: invalid severity');
  });

  test("stray-artifacts off is invalid (MultiEdit)", async () => {
    setFile(cfg({ "stray-artifacts": "error" }));
    const res = await expectDeny(multi('"error"', '"off"'), "is invalid", "Ask the user");
    expect(res.reason).toContain('rules["stray-artifacts"]: invalid severity');
  });

  test("comment-density option max_per_100 is invalid (Write)", async () => {
    setFile(cfg({ "comment-density": "error" }));
    const res = await expectDeny(
      write(cfg({ "comment-density": ["error", { max_per_100: 10 }] })),
      "is invalid",
      "Ask the user",
    );
    expect(res.reason).toContain(`${KEY_SEV}[1].max_per_100: unknown option; allowed: no options`);
  });

  test("comment-density option max_per_100 is invalid (Edit)", async () => {
    setFile(cfg({ "comment-density": ["error", { max_per_100: 5 }] }));
    const res = await expectDeny(edit('"max_per_100": 5', '"max_per_100": 10'), "is invalid", "Ask the user");
    expect(res.reason).toContain("max_per_100");
  });

  test("bad severity value (Write)", async () => {
    setFile(cfg({ "comment-density": "error" }));
    const res = await expectDeny(write(cfg({ "comment-density": "loud" })), "is invalid", "Ask the user");
    expect(res.reason).toContain("comment-density");
    expect(res.reason).toContain("severity");
  });

  test("bad severity value (Edit)", async () => {
    setFile(cfg({ "comment-density": "error" }));
    const res = await expectDeny(edit('"error"', '"loud"'), "is invalid", "Ask the user");
    expect(res.reason).toContain("comment-density");
  });

  test("commit-message severity warn is invalid (Write)", async () => {
    setFile(null);
    const res = await expectDeny(write(cfg({ "commit-message": "warn" })), "is invalid", "Ask the user");
    expect(res.reason).toContain("severity");
  });

  test("malformed JSON (Write)", async () => {
    setFile(cfg({ "comment-density": "error" }));
    await expectDeny(write('{"rules": {'), "is invalid", "Ask the user");
  });
});

const BASH_DENY = [
  `echo '{}' > .house-rules.json`,
  `echo x >> ./.house-rules.json`,
  `jq '.rules={}' .house-rules.json > .house-rules.json`,
  `tee .house-rules.json < /tmp/x`,
  `sed -i 's/error/off/' .house-rules.json`,
  `perl -pi -e 's/error/off/' .house-rules.json`,
  `rm .house-rules.json`,
  `mv .house-rules.json old.json`,
  `cp /tmp/loose.json .house-rules.json`,
  `truncate -s0 .house-rules.json`,
  `git checkout HEAD~1 -- .house-rules.json`,
  `git restore .house-rules.json`,
  `git rm .house-rules.json`,
];

const BASH_ALLOW = [
  `cat .house-rules.json`,
  `less .house-rules.json`,
  `head -n5 .house-rules.json`,
  `jq . .house-rules.json`,
  `git diff .house-rules.json`,
  `git log -- .house-rules.json`,
  `git show HEAD:.house-rules.json`,
  `house-rules config`,
  `cat .house-rules.json > /tmp/copy.json`,
  `cp .house-rules.json /tmp/backup.json`,
  `ls -la`,
];

describe("bash", () => {
  test.each(BASH_DENY)("deny: %s", async (command) => {
    setFile(cfg({ "comment-density": "error" }));
    await expectDeny(
      runHook(repo, "Bash", { command }),
      "would modify .house-rules.json",
      "Ask the user",
    );
  });

  test.each(BASH_ALLOW)("allow: %s", async (command) => {
    setFile(cfg({ "comment-density": "error" }));
    await expectAllow(runHook(repo, "Bash", { command }));
  });
});

describe("preset guard in a conventional-history repo", () => {
  const KEY_PRESET = 'rules["commit-message"].preset';

  function makeConventionalRepo(gitmessage = false): { dir: string; cfgPath: string } {
    const dir = makeRepo();
    repos.push(dir);
    for (const m of ["feat: a", "fix: b", "chore: c", "docs: d"]) {
      execSync(`git commit -q --allow-empty -m '${m}'`, { cwd: dir });
    }
    if (gitmessage) writeFileSync(join(dir, ".gitmessage"), "subject\n");
    return { dir, cfgPath: join(dir, ".house-rules.json") };
  }

  const pin = (preset: string) => cfg({ "commit-message": ["error", { preset }] });
  const writeTo = (r: { dir: string; cfgPath: string }, content: string) =>
    runHook(r.dir, "Write", { file_path: r.cfgPath, content });

  test("pin conventional (matches history detection) is allowed", async () => {
    const r = makeConventionalRepo();
    await expectAllow(writeTo(r, pin("conventional")));
  });

  test("pin handbook is denied when history detects conventional", async () => {
    const r = makeConventionalRepo();
    await expectDeny(writeTo(r, pin("handbook")), KEY_PRESET, "handbook", "Ask the user");
  });

  test("pin subject-only is denied when history detects conventional", async () => {
    const r = makeConventionalRepo();
    await expectDeny(writeTo(r, pin("subject-only")), KEY_PRESET, "subject-only", "Ask the user");
  });

  test(".gitmessage repo: pin subject-only allowed", async () => {
    const r = makeConventionalRepo(true);
    await expectAllow(writeTo(r, pin("subject-only")));
  });

  test(".gitmessage repo: pin conventional denied", async () => {
    const r = makeConventionalRepo(true);
    await expectDeny(writeTo(r, pin("conventional")), KEY_PRESET, "Ask the user");
  });

  test("removing a conventional pin in a conventional repo is allowed", async () => {
    const r = makeConventionalRepo();
    writeFileSync(r.cfgPath, pin("conventional"));
    await expectAllow(writeTo(r, cfg({})));
  });
});

describe("explicit preset pin is a human decision", () => {
  const REASON = '  rules["commit-message"].preset: ';
  function makeRepoWith(msgs: string[], pinned: string) {
    const dir = makeRepo();
    repos.push(dir);
    for (const m of msgs) execSync(`git commit -q --allow-empty -m '${m}'`, { cwd: dir });
    const cfgPath = join(dir, ".house-rules.json");
    writeFileSync(cfgPath, cfg({ "commit-message": ["error", { preset: pinned }] }));
    return { dir, cfgPath };
  }
  const handbookRepo = (pinned: string) => makeRepoWith(["Add x", "Add y"], pinned);
  const put = (r: { dir: string; cfgPath: string }, content: string) =>
    runHook(r.dir, "Write", { file_path: r.cfgPath, content });
  const pinTo = (preset: string) => cfg({ "commit-message": ["error", { preset }] });

  test("conventional pin in handbook repo: Write {} denied", async () => {
    const r = handbookRepo("conventional");
    await expectDeny(put(r, "{}"), REASON + "conventional → handbook", "Ask the user");
  });

  test("conventional pin in handbook repo: revert to handbook denied", async () => {
    const r = handbookRepo("conventional");
    await expectDeny(put(r, pinTo("handbook")), REASON + "conventional → handbook");
  });

  test("conventional pin in handbook repo: rm denied", async () => {
    const r = handbookRepo("conventional");
    await expectDeny(runHook(r.dir, "Bash", { command: "rm .house-rules.json" }));
  });

  test("handbook pin in conventional repo: switch to conventional denied", async () => {
    const r = makeRepoWith(["feat: a", "fix: b", "chore: c", "docs: d"], "handbook");
    await expectDeny(put(r, pinTo("conventional")), REASON + "handbook → conventional");
  });

  test("invalid old file treated as defaults: valid pin != detection still denied", async () => {
    const r = makeRepoWith(["Add x", "Add y"], "conventional");
    writeFileSync(r.cfgPath, "{not json");
    await expectDeny(put(r, pinTo("conventional")), REASON);
  });
});

describe("no bypass hints", () => {
  test("positive control: BYPASS_RE matches bypass hints", () => {
    expect("set HOUSE_RULES_DISABLE=1 to bypass the hook").toMatch(BYPASS_RE);
    expect("use --no-verify").toMatch(BYPASS_RE);
  });

  test("no deny reason mentions a bypass", () => {
    expect(denyReasons.length).toBeGreaterThanOrEqual(10);
    for (const reason of denyReasons) expect(reason).not.toMatch(BYPASS_RE);
  });
});

test("hook file exists", () => {
  expect(existsSync(join(PLUGIN_ROOT, "src/hooks/config-guard.ts"))).toBe(true);
});
