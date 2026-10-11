import { describe, it, expect, beforeAll } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const REPO = path.resolve(import.meta.dir, "../..");
const GUARD = path.join(REPO, "src/hooks/guard.ts");

async function spawnGuard(payload: unknown, cwd: string): Promise<{ stdout: string; exit: number }> {
  const proc = Bun.spawn(["bun", GUARD], {
    stdin: "pipe", stdout: "pipe", stderr: "pipe", cwd,
    env: { ...process.env, CLAUDE_PROJECT_DIR: "/decoy/project/dir", CLAUDE_PLUGIN_ROOT: REPO } as Record<string, string>,
  });
  proc.stdin.write(JSON.stringify(payload));
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  return { stdout, exit: await proc.exited };
}

const write = (cwd: string, file: string, content: string) => ({
  hook_event_name: "PreToolUse", session_id: "s-gen", cwd, tool_name: "Write",
  tool_input: { file_path: path.join(cwd, file), content },
});

const OVER_CAP = [
  ...Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`),
  "// comment one", "// comment two", "// comment three", "// comment four", "// comment five",
];

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "guard-gen-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  writeFileSync(path.join(dir, ".house-rules.json"), JSON.stringify({
    rules: { "require-safety-comment-for-type-assertion": "warn", "type-escape-hatches": "warn" },
  }));
});

describe("guard skips generated files", () => {
  it("header-marked file: no context, no rewrite; unmarked twin is rewritten", async () => {
    const marked = await spawnGuard(write(dir, "gen.ts", ["// @generated", ...OVER_CAP].join("\n")), dir);
    expect(marked.exit).toBe(0);
    expect(marked.stdout.trim()).toBe("");

    const twin = await spawnGuard(write(dir, "twin.ts", ["// hand written", ...OVER_CAP].join("\n")), dir);
    const hso = (JSON.parse(twin.stdout) as { hookSpecificOutput: { additionalContext: string; updatedInput: { content: string } } }).hookSpecificOutput;
    expect(hso.additionalContext).toContain("not another session's edit");
    expect(hso.updatedInput.content.split("\n").filter((l) => l.startsWith("//")).length).toBeLessThan(6);
  });

  it("header-marked file: no content-rule warnings; unmarked twin warns", async () => {
    const body = "const x = y as unknown as Foo;\n";
    const marked = await spawnGuard(write(dir, "gen2.ts", "// @generated\n" + body), dir);
    expect(marked.stdout.trim()).toBe("");
    const twin = await spawnGuard(write(dir, "twin2.ts", "// hand\n" + body), dir);
    expect(twin.stdout).toContain("house-rules type-escape-hatches:");
  });

  it(".gitattributes linguist-generated file is skipped", async () => {
    writeFileSync(path.join(dir, ".gitattributes"), "attr-gen.ts linguist-generated\n");
    const r = await spawnGuard(write(dir, "attr-gen.ts", "const x = y as unknown as Foo;\n"), dir);
    expect(r.stdout.trim()).toBe("");
  });
});

describe("guard dedupes overlapping safety-comment finding", () => {
  const ctxLines = (stdout: string): string[] => {
    const hso = (JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput;
    return hso.additionalContext.split("\n").filter((l) => l.startsWith("house-rules "));
  };

  it("x as unknown as Foo yields exactly one line (type-escape-hatches)", async () => {
    const r = await spawnGuard(write(dir, "dd.ts", "const x = y as unknown as Foo;\n"), dir);
    const lines = ctxLines(r.stdout);
    expect(lines.length).toBe(1);
    expect(lines[0]).toStartWith("house-rules type-escape-hatches:");
  });

  it("single foo() as Foo keeps the safety-comment line", async () => {
    const r = await spawnGuard(write(dir, "single.ts", "const x = foo() as Foo;\n"), dir);
    const lines = ctxLines(r.stdout);
    expect(lines.some((l) => l.startsWith("house-rules require-safety-comment-for-type-assertion:"))).toBe(true);
  });
});
