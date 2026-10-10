import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { check } from "../../src/hooks/guard.js";

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guard-warn-"));
  const git = (...a: string[]) => spawnSync("git", a, { cwd: dir });
  git("init", "-q");
  git("config", "user.email", "t@t.com");
  git("config", "user.name", "T");
  for (const [n, c] of Object.entries(files)) writeFileSync(path.join(dir, n), c);
  git("add", ".");
  git("commit", "-qm", "init");
  return dir;
}

function hso(r: { stdout: string }): Record<string, unknown> {
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : {};
}

const LINE = "const v = Reflect.get(o, k);";
const WARN = "house-rules code-smells: [no-reflect-get]";

describe("guard warn findings", () => {
  it("AC1: Write adding Reflect.get warns, no deny", async () => {
    const dir = repo({});
    try {
      const fp = path.join(dir, "a.ts");
      const r = await check({ tool_name: "Write", cwd: dir, tool_input: { file_path: fp, content: `${LINE}\n` } });
      expect(r.exit).toBe(0);
      const h = hso(r);
      expect(h.permissionDecision).toBeUndefined();
      expect(h.additionalContext as string).toContain(WARN);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("AC2: code-smells off suppresses the warning", async () => {
    const dir = repo({ ".house-rules.json": JSON.stringify({ rules: { "code-smells": "off" } }) });
    try {
      const fp = path.join(dir, "a.ts");
      const r = await check({ tool_name: "Write", cwd: dir, tool_input: { file_path: fp, content: `${LINE}\n` } });
      expect(r.stdout).not.toContain("code-smells");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("AC3: comment-density rewrite and warn line both emitted", async () => {
    const dir = repo({});
    try {
      const fp = path.join(dir, "a.ts");
      const lines = Array.from({ length: 5 }, (_, i) => `const c${i} = ${i};`);
      for (let i = 0; i < 6; i++) lines.push(`// filler comment number ${i}`);
      lines.push(LINE);
      const r = await check({ tool_name: "Write", cwd: dir, tool_input: { file_path: fp, content: lines.join("\n") + "\n" } });
      const h = hso(r);
      expect(h.permissionDecision).toBeUndefined();
      expect(h.updatedInput).toBeDefined();
      expect(h.additionalContext as string).toContain(WARN);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("AC4: pre-existing violation on unchanged line is not reported", async () => {
    const dir = repo({ "a.ts": `${LINE}\nconst x = 1;\n` });
    try {
      const fp = path.join(dir, "a.ts");
      const r = await check({
        tool_name: "Edit", cwd: dir,
        tool_input: { file_path: fp, old_string: "const x = 1;", new_string: "const x = 2;" },
      });
      expect(r.stdout).not.toContain("no-reflect-get");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
