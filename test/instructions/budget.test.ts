import { describe, it, expect } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");

const FILE_ROWS: { surface: string; relPath: string }[] = [
  { surface: "orchestrator.md",          relPath: "agents/orchestrator.md" },
  { surface: "general-purpose / implementer.md", relPath: "agents/implementer.md" },
  { surface: "advisor.md",               relPath: "agents/advisor.md" },
  { surface: "qa.md",                    relPath: "agents/qa.md" },
  { surface: "implement/SKILL.md",       relPath: "skills/implement/SKILL.md" },
  { surface: "vertical-slice/SKILL.md",  relPath: "skills/vertical-slice/SKILL.md" },
  { surface: "advisor-gate/SKILL.md",    relPath: "skills/advisor-gate/SKILL.md" },
  { surface: "pause/SKILL.md",           relPath: "skills/pause/SKILL.md" },
  { surface: "continue/SKILL.md",        relPath: "skills/continue/SKILL.md" },
  { surface: "motive/SKILL.md",          relPath: "skills/motive/SKILL.md" },
];

function parseDocBytes(surface: string): number | null {
  const doc = readFileSync(path.join(ROOT, "doc/instruction-budget.md"), "utf8");
  for (const line of doc.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cols = line.split("|").map(c => c.trim()).filter(Boolean);
    if (cols[0] === surface) {
      const v2bytes = parseInt(cols[3], 10);
      return isNaN(v2bytes) ? null : v2bytes;
    }
  }
  return null;
}

describe("instruction-budget.md — v2 byte counts match files at HEAD", () => {
  for (const { surface, relPath } of FILE_ROWS) {
    it(`${surface} byte count is current`, () => {
      const docBytes = parseDocBytes(surface);
      if (docBytes === null) throw new Error(`surface '${surface}' not found in doc table`);
      const actualBytes = statSync(path.join(ROOT, relPath)).size;
      expect(
        actualBytes,
        `${relPath}: doc says ${docBytes} bytes but file is ${actualBytes} bytes — rerun: wc -c ${relPath}`,
      ).toBe(docBytes);
    });
  }

  it("SessionStart injection byte count is current (normalised)", () => {
    const docBytes = parseDocBytes("SessionStart injection");
    if (docBytes === null) throw new Error("surface 'SessionStart injection' not found in doc table");
    // Set CLAUDE_PLUGIN_ROOT to the real root so no mismatch line is injected.
    // Then normalise environment-dependent parts before measuring:
    //   - actual repo path → /GROUNDWORK_ROOT
    //   - git sha → (XXXXXXX)
    // This keeps the test a real drift detector while being checkout/commit agnostic.
    const result = spawnSync("bun", ["src/hooks/session-start.ts"], {
      input: "{}",
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT },
      cwd: ROOT,
    });
    if (result.status !== 0) throw new Error(`session-start hook exited ${result.status}: ${result.stderr.toString()}`);
    const out = JSON.parse(result.stdout.toString("utf8")) as { hookSpecificOutput: { additionalContext: string } };
    const raw = out.hookSpecificOutput.additionalContext;
    const rootEscaped = ROOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const norm = raw
      .replace(new RegExp(rootEscaped, "g"), "/GROUNDWORK_ROOT")
      .replace(/\([0-9a-f]{7,40}\)/g, "(XXXXXXX)");
    const actualBytes = Buffer.byteLength(norm, "utf8");
    expect(
      actualBytes,
      `SessionStart additionalContext (normalised): doc says ${docBytes} bytes but hook emits ${actualBytes} bytes — update doc row`,
    ).toBe(docBytes);
  });
});
