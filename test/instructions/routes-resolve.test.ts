import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(import.meta.dir, "../..");

// ---------------------------------------------------------------------------
// Mattpocock plugin discovery — via installed_plugins.json, no hardcoded path
// ---------------------------------------------------------------------------

function resolveMpPluginRoot(): string | null {
  const pluginsFile = path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json");
  try {
    const data = JSON.parse(readFileSync(pluginsFile, "utf8")) as {
      plugins: Record<string, Array<{ installPath: string }>>;
    };
    const entries = data.plugins["mattpocock-skills@claude-plugins-official"];
    if (!entries || entries.length === 0) return null;
    const p = entries[0].installPath;
    return statSync(p, { throwIfNoEntry: false })?.isDirectory() ? p : null;
  } catch {
    return null;
  }
}

const MP_PLUGIN_ROOT = resolveMpPluginRoot();
const MP_SKIP_REASON =
  MP_PLUGIN_ROOT === null
    ? "mattpocock-skills not found in ~/.claude/plugins/installed_plugins.json"
    : null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function walkFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkFiles(full, ext));
    else if (entry.isFile() && entry.name.endsWith(ext)) results.push(full);
  }
  return results;
}

function extractRefs(content: string): { groundwork: string[]; mattpocock: string[] } {
  const groundwork: string[] = [];
  const mattpocock: string[] = [];
  const gwRe = /`groundwork:([a-z][a-z0-9-]*)`/g;
  const mpRe = /`mattpocock-skills:([a-z][a-z0-9-]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = gwRe.exec(content)) !== null) groundwork.push(m[1]);
  while ((m = mpRe.exec(content)) !== null) mattpocock.push(m[1]);
  return { groundwork, mattpocock };
}

function gwResolves(name: string): boolean {
  return (
    existsSync(path.join(ROOT, "agents", `${name}.md`)) ||
    existsSync(path.join(ROOT, "skills", name))
  );
}

function mpSkillInfo(name: string): { exists: boolean; disabled: boolean } {
  if (!MP_PLUGIN_ROOT) return { exists: false, disabled: false };
  for (const f of walkFiles(path.join(MP_PLUGIN_ROOT, "skills"), "SKILL.md")) {
    if (path.basename(path.dirname(f)) === name) {
      const content = readFileSync(f, "utf8");
      return {
        exists: true,
        disabled: /^disable-model-invocation:\s*true/m.test(content),
      };
    }
  }
  return { exists: false, disabled: false };
}

// ---------------------------------------------------------------------------
// Files to scan
// ---------------------------------------------------------------------------

function collectScannedFiles(): string[] {
  const files: string[] = [];

  // rules/routing.md
  files.push(path.join(ROOT, "rules", "routing.md"));

  // session-start.ts source uses escaped backticks; scan the emitted text instead (suite below).

  // agents/*.md
  const agentsDir = path.join(ROOT, "agents");
  if (statSync(agentsDir, { throwIfNoEntry: false })?.isDirectory()) {
    for (const f of readdirSync(agentsDir))
      if (f.endsWith(".md")) files.push(path.join(agentsDir, f));
  }

  // skills/*/SKILL.md + skills/*/reference/*.md
  const skillsDir = path.join(ROOT, "skills");
  if (statSync(skillsDir, { throwIfNoEntry: false })?.isDirectory()) {
    for (const skill of readdirSync(skillsDir)) {
      const skillDir = path.join(skillsDir, skill);
      if (!statSync(skillDir, { throwIfNoEntry: false })?.isDirectory()) continue;
      const skillMd = path.join(skillDir, "SKILL.md");
      if (existsSync(skillMd)) files.push(skillMd);
      const refDir = path.join(skillDir, "reference");
      if (statSync(refDir, { throwIfNoEntry: false })?.isDirectory()) {
        for (const f of readdirSync(refDir))
          if (f.endsWith(".md")) files.push(path.join(refDir, f));
      }
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// Main route parity suite
// ---------------------------------------------------------------------------

describe("routes-resolve — every advertised route resolves", () => {
  const files = collectScannedFiles();

  it("scanned file set non-empty", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const content = readFileSync(file, "utf8");
    const { groundwork, mattpocock } = extractRefs(content);

    for (const name of [...new Set(groundwork)]) {
      it(`${rel}: groundwork:${name} resolves to agent or skill`, () => {
        expect(
          gwResolves(name),
          `groundwork:${name} — no agents/${name}.md and no skills/${name}/`,
        ).toBe(true);
      });
    }

    for (const name of [...new Set(mattpocock)]) {
      it.skipIf(MP_SKIP_REASON !== null)(
        `${rel}: mattpocock-skills:${name} exists and is model-invocable`,
        () => {
          const { exists, disabled } = mpSkillInfo(name);
          expect(exists, `mattpocock-skills:${name} not found in installed plugin`).toBe(true);
          expect(
            disabled,
            `mattpocock-skills:${name} has disable-model-invocation: true`,
          ).toBe(false);
        },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // routing.md row coverage — every expected route target survives trimming
  // ---------------------------------------------------------------------------
  describe("routing.md row coverage", () => {
    const routingContent = readFileSync(path.join(ROOT, "rules", "routing.md"), "utf8");

    const REQUIRED_ROUTES: string[] = [
      "groundwork:debugger",
      "groundwork:explore",
      "groundwork:junior-orchestrator",
      "groundwork:implementer",
      "mattpocock-skills:tdd",
      "mattpocock-skills:code-review",
      "groundwork:researcher",
      "groundwork:git-master",
      "groundwork:planner",
      "mattpocock-skills:codebase-design",
      "groundwork:designer",
      "mattpocock-skills:grilling",
      "groundwork:qa",
      "groundwork:advisor",
    ];

    for (const route of REQUIRED_ROUTES) {
      it(`routing.md contains \`${route}\``, () => {
        expect(
          routingContent,
          `route ${route} is missing from rules/routing.md`,
        ).toContain(`\`${route}\``);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Registry ↔ agents parity
// ---------------------------------------------------------------------------

describe("registry-parity — model-registry.json matches agents/", () => {
  const registryPath = path.join(ROOT, "model-registry.json");
  const registry = JSON.parse(readFileSync(registryPath, "utf8")) as {
    agents: Record<string, unknown>;
  };
  const agentsDir = path.join(ROOT, "agents");
  const agentFiles = readdirSync(agentsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));

  it("every registry key has a corresponding agents/*.md file", () => {
    const missing = Object.keys(registry.agents).filter((k) => !agentFiles.includes(k));
    expect(
      missing,
      `registry keys without an agent file: ${missing.join(", ")}`,
    ).toHaveLength(0);
  });

  it("every agents/*.md file has a registry entry", () => {
    const missing = agentFiles.filter((a) => !(a in registry.agents));
    expect(
      missing,
      `agent files without a registry entry: ${missing.join(", ")}`,
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// session-start emitted text — refs must resolve and be model-invocable
// Bite proof: add mattpocock-skills:to-tickets to the emitted text → red here.
// ---------------------------------------------------------------------------

describe("session-start emitted refs resolve", () => {
  const HOOK = path.join(ROOT, "src/hooks/session-start.ts");

  function runHook(): string {
    const r = spawnSync("bun", [HOOK], {
      input: "{}",
      env: Object.fromEntries(
        Object.entries({ ...process.env, CLAUDE_PLUGIN_ROOT: ROOT }).filter(
          ([k, v]) => k !== "CLAUDE_PROJECT_DIR" && v !== undefined,
        ),
      ) as Record<string, string>,
      cwd: ROOT,
    });
    if (r.status !== 0) throw new Error(`session-start exited ${r.status}: ${r.stderr?.toString()}`);
    const out = JSON.parse(r.stdout.toString()) as {
      hookSpecificOutput: { additionalContext: string };
    };
    return out.hookSpecificOutput.additionalContext;
  }

  it("emitted additionalContext contains at least 1 skill ref (non-vacuous)", () => {
    const ctx = runHook();
    const { groundwork, mattpocock } = extractRefs(ctx);
    expect(
      groundwork.length + mattpocock.length,
      "emitted additionalContext must contain at least one groundwork: or mattpocock-skills: ref",
    ).toBeGreaterThan(0);
  });

  it("every groundwork: ref in emitted text resolves to agent or skill", () => {
    const ctx = runHook();
    const { groundwork } = extractRefs(ctx);
    for (const name of [...new Set(groundwork)]) {
      expect(
        gwResolves(name),
        `groundwork:${name} in emitted text — no agents/${name}.md and no skills/${name}/`,
      ).toBe(true);
    }
  });

  it.skipIf(MP_SKIP_REASON !== null)(
    "every mattpocock-skills: ref in emitted text is model-invocable",
    () => {
      const ctx = runHook();
      const { mattpocock } = extractRefs(ctx);
      for (const name of [...new Set(mattpocock)]) {
        const { exists, disabled } = mpSkillInfo(name);
        expect(exists, `mattpocock-skills:${name} not found in installed plugin`).toBe(true);
        expect(disabled, `mattpocock-skills:${name} has disable-model-invocation: true`).toBe(false);
      }
    },
  );
});
