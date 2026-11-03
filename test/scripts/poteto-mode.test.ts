import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SCRIPT = new URL("../../scripts/poteto-mode.ts", import.meta.url).pathname;
const SKILL = new URL("../../skills/newman-mode/SKILL.md", import.meta.url).pathname;

let tmp: string;
let home: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "poteto-mode-"));
  home = join(tmp, "home");
  mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

function pstack(root: string, version: string): string {
  const file = join(root, version, "skills", "poteto-mode", "SKILL.md");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `---\nname: poteto-mode\n---\n\n# Poteto mode\n\nversion ${version}\n`);
  return file;
}

function groundworkRoot(): string {
  const root = join(tmp, "cache", "mkt", "groundwork", "9.9.9");
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, join(root, "scripts", "poteto-mode.ts"));
  return root;
}

function env() {
  return { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") };
}

function run(args: string[], cwd = tmp) {
  return spawnSync("bun", ["--no-install", SCRIPT, ...args], { cwd, env: env(), encoding: "utf8" });
}

describe("scripts/poteto-mode.ts", () => {
  it("picks the highest semver sibling pstack, not the highest string", () => {
    const root = groundworkRoot();
    const base = join(tmp, "cache", "mkt", "pstack");
    pstack(base, "0.15.9");
    pstack(base, "0.15.36");
    const want = pstack(base, "0.16.0");
    const p = run(["--path", root]);
    expect(p.status).toBe(0);
    expect(p.stdout.trim()).toBe(want);
    const c = run([root]);
    expect(c.status).toBe(0);
    expect(c.stdout.split("\n")[0]).toContain(dirname(want));
    expect(c.stdout).toContain("# Poteto mode");
    expect(c.stdout).toContain("version 0.16.0");
  });

  it("falls back to the installPath in installed_plugins.json", () => {
    const root = groundworkRoot();
    const want = pstack(join(tmp, "elsewhere"), "0.15.36");
    writeFileSync(
      join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { "pstack@other": [{ installPath: join(tmp, "elsewhere", "0.15.36"), version: "0.15.36" }] } }),
    );
    const p = run(["--path", root]);
    expect(p.status).toBe(0);
    expect(p.stdout.trim()).toBe(want);
  });

  it("nothing found → one loud line naming where it looked, exit 0", () => {
    const root = groundworkRoot();
    const r = run([root]);
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("NOT FOUND");
    expect(lines[0]).toContain(join(tmp, "cache", "mkt", "pstack"));
    expect(lines[0]).toContain(join(home, ".claude", "plugins", "installed_plugins.json"));
  });

  it("runs with no node_modules above it (installed-plugin shape)", () => {
    const root = groundworkRoot();
    pstack(join(tmp, "cache", "mkt", "pstack"), "0.15.36");
    const r = spawnSync("bun", ["--no-install", join(root, "scripts", "poteto-mode.ts"), "--path", root], {
      cwd: tmp, env: env(), encoding: "utf8",
    });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("poteto-mode/SKILL.md");
  });
});

describe("skills/newman-mode/SKILL.md — injected poteto-mode", () => {
  const skill = readFileSync(SKILL, "utf8");
  const inject = /^!`([^`]+)`$/m.exec(skill)?.[1];

  it("injects the resolver command", () => {
    expect(inject).toContain("scripts/poteto-mode.ts");
  });

  it("allowed-tools pre-approves exactly that command", () => {
    const front = skill.split(/^---$/m)[1] ?? "";
    const rules = [...front.matchAll(/Bash\(([^)]*)\)/g)].map((m) => m[1]);
    const glob = (rule: string) =>
      new RegExp("^" + rule.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
    const root = "/x/cache/mkt/groundwork/1.0.0";
    const cmd = inject!.replaceAll("${CLAUDE_PLUGIN_ROOT}", root);
    expect(rules.some((r) => glob(r.replaceAll("${CLAUDE_PLUGIN_ROOT}", root)).test(cmd))).toBe(true);
  });

  it("the injected command renders poteto-mode's heading", () => {
    const root = groundworkRoot();
    pstack(join(tmp, "cache", "mkt", "pstack"), "0.15.36");
    const cmd = inject!.replaceAll("${CLAUDE_PLUGIN_ROOT}", root);
    const r = spawnSync("bash", ["-c", cmd], { cwd: tmp, env: env(), encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("# Poteto mode");
  });
});
