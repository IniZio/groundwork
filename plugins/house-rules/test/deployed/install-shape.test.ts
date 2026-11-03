import { describe, it, expect, afterAll } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const PLUGIN_REL = "plugins/house-rules";
const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");
const AUTOFIX_LINE = "house-rules comment-density: auto-removed";
const DEV_ONLY_DIRS = new Set(["test", "scripts"]);
const SOURCE_EXT = /\.(ts|mts|js|mjs)$/;
const BUILTINS = new Set(builtinModules);

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  roots.push(root);
  return root;
}

function nodeModulesAbove(dir: string): string | null {
  for (let d = dir; ; d = path.dirname(d)) {
    if (existsSync(path.join(d, "node_modules"))) return d;
    if (path.dirname(d) === d) return null;
  }
}

/** Copies the plugin's tracked and unignored files, the set a marketplace install ships, with no node_modules. */
function extractPlugin(): string {
  const root = tempRoot("hr-install-");
  const ls = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", PLUGIN_REL], {
    cwd: REPO_ROOT, encoding: "utf8",
  });
  expect(ls.status, ls.stderr).toBe(0);
  for (const rel of ls.stdout.split("\0").filter(Boolean)) {
    const src = path.join(REPO_ROOT, rel);
    if (!existsSync(src)) continue;
    mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    copyFileSync(src, path.join(root, rel));
  }
  expect(nodeModulesAbove(path.join(root, PLUGIN_REL))).toBeNull();
  return root;
}

function isAllowedSpecifier(spec: string): boolean {
  if (spec.startsWith(".") || spec.startsWith("/")) return true;
  if (spec.startsWith("node:") || spec === "bun" || spec.startsWith("bun:")) return true;
  return BUILTINS.has(spec);
}

function sourceFiles(dir: string, top = true): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (top && DEV_ONLY_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full, false));
    else if (SOURCE_EXT.test(entry.name) && !entry.name.endsWith(".d.ts") && !entry.name.endsWith(".d.mts")) out.push(full);
  }
  return out;
}

/** Runtime imports of package specifiers an install cannot resolve; type-only imports are erased and skipped. */
function bareImports(pluginDir: string): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(pluginDir)) {
    const loader = file.endsWith("ts") ? "ts" : "js";
    const text = readFileSync(file, "utf8").replace(/^#!.*/, "");
    const imports = new Bun.Transpiler({ loader }).scanImports(text);
    for (const { path: spec } of imports) {
      if (!isAllowedSpecifier(spec)) found.push(`${path.relative(pluginDir, file)}: ${spec}`);
    }
  }
  return found;
}

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
}

const STRIPPED_ENV = new Set(["CLAUDE_PROJECT_DIR", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_PLUGIN_ROOT"]);

function noInstallEnv(root: string) {
  const tmp = path.join(root, "tmp");
  mkdirSync(tmp, { recursive: true });
  const inherited = Object.entries(process.env).filter(([key]) => !STRIPPED_ENV.has(key));
  return { ...Object.fromEntries(inherited), TMPDIR: tmp };
}

describe("installed plugin shape: runs with no node_modules and no auto-install", () => {
  const root = extractPlugin();
  const pluginDir = path.join(root, PLUGIN_REL);

  it("parses a transcript line under bun --no-install", () => {
    const probe = path.join(root, "probe.ts");
    writeFileSync(probe, [
      `import { parseTranscriptLine } from "./${PLUGIN_REL}/src/hooks/lib/transcript.ts";`,
      `const line = JSON.stringify({ type: "assistant", cwd: "/r", timestamp: "2026-01-01T00:00:00Z",`,
      `  message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } });`,
      `console.log(JSON.stringify(parseTranscriptLine(line)));`,
    ].join("\n"));

    const r = spawnSync("bun", ["--no-install", probe], { cwd: root, env: noInstallEnv(root), encoding: "utf8" });

    expect(r.stderr).not.toContain("Cannot find package");
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      type: "assistant", timestamp: "2026-01-01T00:00:00Z", timeMs: Date.parse("2026-01-01T00:00:00Z"), cwd: "/r",
      blocks: [{ kind: "tool_use", id: "t1", name: "Bash", command: "ls" }],
    });
  });

  it("gate.ts autofixes a Bash write over the density budget under bun --no-install", () => {
    const repo = path.join(root, "repo");
    mkdirSync(path.join(repo, "src"), { recursive: true });
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "t@t");
    git(repo, "config", "user.name", "t");
    const target = path.join(repo, "src/a.ts");
    writeFileSync(target, "export const a = 1;\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "init");

    const overBudget = Array.from({ length: 20 }, (_, i) =>
      i % 5 === 0 ? `// reason ${i}` : `export const x${i} = ${i};`,
    ).join("\n") + "\n";
    const command = `cat > src/a.ts <<'EOF'\n${overBudget}EOF`;
    const start = new Date().toISOString();
    const write = spawnSync("bash", ["-c", command], { cwd: repo, encoding: "utf8" });
    expect(write.status, write.stderr).toBe(0);
    const end = new Date().toISOString();
    const transcript = path.join(root, "s1.jsonl");
    writeFileSync(transcript, [
      { type: "assistant", cwd: repo, timestamp: start,
        message: { content: [{ type: "tool_use", id: "tu0", name: "Bash", input: { command } }] } },
      { type: "user", cwd: repo, timestamp: end,
        message: { content: [{ type: "tool_result", tool_use_id: "tu0", content: "" }] } },
    ].map((e) => JSON.stringify(e)).join("\n") + "\n");

    const r = spawnSync("bun", ["--no-install", path.join(pluginDir, "src/hooks/gate.ts")], {
      cwd: repo, env: noInstallEnv(root), encoding: "utf8",
      input: JSON.stringify({ hook_event_name: "Stop", session_id: "s1", transcript_path: transcript, cwd: repo }),
    });

    expect(r.stderr).not.toContain("Cannot find package");
    expect(r.status, r.stderr).toBe(0);
    const out: { hookSpecificOutput?: { additionalContext?: string } } = r.stdout.trim() ? JSON.parse(r.stdout) : {};
    const context = out.hookSpecificOutput?.additionalContext ?? "";
    expect(context).toContain(AUTOFIX_LINE);
    expect(context).toContain(`${target}: removed`);
  });

  it("no runtime file imports a package the install does not ship", () => {
    expect(bareImports(pluginDir)).toEqual([]);
  });
});

describe("bare-import guard", () => {
  function fixture(files: Record<string, string>): string {
    const dir = tempRoot("hr-bare-");
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), text);
    }
    return dir;
  }

  it("reports a runtime bare package import", () => {
    const dir = fixture({
      "src/a.ts": `import { Ajv } from "ajv";\nexport const v = new Ajv();\n`,
      "src/b.mjs": `export { x } from "left-pad";\n`,
    });
    expect(bareImports(dir).sort()).toEqual(["src/a.ts: ajv", "src/b.mjs: left-pad"]);
  });

  it("allows builtins, bun, relative paths, type-only imports and dev-only dirs", () => {
    const dir = fixture({
      "src/a.ts": [
        `import fs from "node:fs";`,
        `import path from "path";`,
        `import { $ } from "bun";`,
        `import { b } from "./b.ts";`,
        `import type { JSONSchemaType } from "ajv";`,
        `const s: JSONSchemaType<string> = { type: "string" };`,
        `export const x = [fs, path, $, b, s];`,
      ].join("\n"),
      "src/b.ts": `export const b = 1;\n`,
      "test/t.test.ts": `import { it } from "bun:test";\nimport { Ajv } from "ajv";\nit("x", () => new Ajv());\n`,
      "scripts/gen.ts": `import { Ajv } from "ajv";\nnew Ajv();\n`,
    });
    expect(bareImports(dir)).toEqual([]);
  });
});
