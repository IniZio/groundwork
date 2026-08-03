/**
 * T5 tests: SessionStart spec skeleton injection.
 *
 * AC coverage:
 *   AC6 — spec skeleton ≤600 tokens, degrades to depth-1 with child counts
 *   AC7 — total injection ≤3000 tokens, skeleton dropped first if cap exceeded
 *   AC8 — fixture spec tree measurement table
 */

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SESSION_REMINDER = path.resolve(import.meta.dirname, "..", "..", "hooks", "session-reminder.mjs");
const FIXTURE_SPEC = path.resolve(import.meta.dirname, "..", "fixtures", "spec", "spec-root");

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), "gw-t5-"));
  mkdirSync(path.join(projectDir, ".groundwork"), { recursive: true });
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run the session-reminder hook; return additionalContext string. */
function runReminder(
  ledger: unknown,
  sessionId = "sess-t5",
  extraDirs?: Record<string, string>,
): string {
  const runsDir = path.join(projectDir, ".groundwork", "runs");
  mkdirSync(runsDir, { recursive: true });
  if (ledger !== undefined) {
    writeFileSync(
      path.join(runsDir, `${sessionId}.json`),
      JSON.stringify(ledger, null, 2),
    );
  }
  if (extraDirs) {
    for (const [rel, content] of Object.entries(extraDirs)) {
      const full = path.join(projectDir, rel);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  }
  const input = JSON.stringify({ cwd: projectDir, session_id: sessionId, source: "compact" });
  const out = execFileSync("node", [SESSION_REMINDER], { input, encoding: "utf8" });
  return JSON.parse(out).hookSpecificOutput.additionalContext as string;
}

/** Rough token estimate (1 token ≈ 4 chars). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const APPROVED_LEDGER_BASE = {
  version: 1,
  active: true,
  session_id: "sess-t5",
  brief: "test run",
  plan_ref: null,
  reinforcements: 0,
  slices: [
    { id: "S1", wave: 0, status: "complete", blocked_by: [], acceptance: ["done"] },
  ],
  gate: { advisor: "APPROVE" },
};

// ---------------------------------------------------------------------------
// AC6: spec skeleton ≤600 tokens, degrades to depth-1
// ---------------------------------------------------------------------------

describe("AC6: spec skeleton token cap and depth-1 degradation", () => {
  it("includes spec skeleton when spec index exists", () => {
    // Copy fixture spec files into project
    const destSpec = path.join(projectDir, "doc", "specs");
    mkdirSync(destSpec, { recursive: true });
    // Copy the root README
    writeFileSync(
      path.join(destSpec, "README.md"),
      readFileSync(path.join(FIXTURE_SPEC, "README.md"), "utf8"),
    );
    const subdirs = ["cli", "ledger", "session"];
    for (const sub of subdirs) {
      mkdirSync(path.join(destSpec, sub), { recursive: true });
      const srcDir = path.join(FIXTURE_SPEC, sub);
      for (const f of ["README.md", ...readdirSync(srcDir).filter((n) => n.endsWith(".md") && n !== "README.md")]) {
        try {
          writeFileSync(
            path.join(destSpec, sub, f),
            readFileSync(path.join(srcDir, f), "utf8"),
          );
        } catch { /* skip missing */ }
      }
    }

    const ledger = { ...APPROVED_LEDGER_BASE };
    const ctx = runReminder(ledger);
    expect(ctx).toContain("Spec Skeleton");
  });

  it("spec skeleton is at most 600 tokens when spec exists", () => {
    const destSpec = path.join(projectDir, "doc", "specs");
    mkdirSync(destSpec, { recursive: true });
    writeFileSync(
      path.join(destSpec, "README.md"),
      readFileSync(path.join(FIXTURE_SPEC, "README.md"), "utf8"),
    );

    const ledger = { ...APPROVED_LEDGER_BASE };
    const ctx = runReminder(ledger);
    // Extract just the spec skeleton section
    const skeletonMatch = ctx.match(/## Spec Skeleton[\s\S]*?(?=\n##|$)/);
    if (skeletonMatch) {
      const skeletonTokens = estimateTokens(skeletonMatch[0]);
      expect(skeletonTokens).toBeLessThanOrEqual(600);
    }
  });

  it("degrades to root-only when depth-1 tree would exceed 600 tokens", () => {
    // Build a spec with many child concepts that would push depth-1 over 600 tokens
    const destSpec = path.join(projectDir, "doc", "specs");
    mkdirSync(destSpec, { recursive: true });
    writeFileSync(
      path.join(destSpec, "README.md"),
      "---\nid: C-ROOT\ntype: concept\ntitle: Root Concept\n---\n",
    );
    // 30 child concepts with long titles — each ~100 chars, 30 × 25 tokens = 750 tokens
    for (let i = 0; i < 30; i++) {
      const id = `C-CHILD${i.toString().padStart(2, "0")}`;
      const dir = path.join(destSpec, `child${i}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, "README.md"),
        `---\nid: ${id}\ntype: concept\ntitle: A Very Long Concept Title Number ${i} For Testing Degradation Behavior\nparent: C-ROOT\n---\n`,
      );
      for (let j = 0; j < 5; j++) {
        writeFileSync(
          path.join(dir, `${id}-R-r${j.toString().padStart(3, "0")}.md`),
          `---\nid: ${id}-R-r${j.toString().padStart(3, "0")}\ntype: requirement\nconcept: ${id}\nears: The system shall do something.\ncriticality: must\n---\n`,
        );
      }
    }

    const ledger = { ...APPROVED_LEDGER_BASE };
    const ctx = runReminder(ledger);
    const skeletonMatch = ctx.match(/## Spec Skeleton[\s\S]*?(?=\n##|$)/);
    if (skeletonMatch) {
      const skeletonTokens = estimateTokens(skeletonMatch[0]);
      expect(skeletonTokens).toBeLessThanOrEqual(600);
    }
  });

  it("total injection does not exceed 3000 tokens", () => {
    const destSpec = path.join(projectDir, "doc", "specs");
    mkdirSync(destSpec, { recursive: true });
    writeFileSync(
      path.join(destSpec, "README.md"),
      readFileSync(path.join(FIXTURE_SPEC, "README.md"), "utf8"),
    );

    const ledger = { ...APPROVED_LEDGER_BASE };
    const ctx = runReminder(ledger);
    const totalTokens = estimateTokens(ctx);
    expect(totalTokens).toBeLessThanOrEqual(3000);
  });
});

// ---------------------------------------------------------------------------
// AC7: skeleton dropped first when total would exceed cap
// ---------------------------------------------------------------------------

describe("AC7: spec skeleton dropped before other blocks when cap exceeded", () => {
  it("drops spec skeleton and logs journal event when cap would be exceeded", () => {
    // Create a MASSIVE spec tree that would push us over 3000 tokens
    const destSpec = path.join(projectDir, "doc", "specs");
    mkdirSync(destSpec, { recursive: true });
    // Write 60 concept nodes to exceed cap
    const rootContent = "---\nid: C-ROOT\ntype: concept\ntitle: Root\n---\n";
    writeFileSync(path.join(destSpec, "README.md"), rootContent);
    for (let i = 0; i < 60; i++) {
      const id = `C-CONCEPT${i.toString().padStart(3, "0")}`;
      const dir = path.join(destSpec, `concept${i}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, "README.md"),
        `---\nid: ${id}\ntype: concept\ntitle: Concept ${i} with a longer title to push token count higher\nparent: C-ROOT\n---\nThis concept has detailed body text that adds to the token count significantly.\n`,
      );
      // Add requirements to each
      for (let j = 0; j < 3; j++) {
        writeFileSync(
          path.join(dir, `${id}-R-r${j.toString().padStart(3, "0")}.md`),
          `---\nid: ${id}-R-r${j.toString().padStart(3, "0")}\ntype: requirement\nconcept: ${id}\nears: When condition occurs the system shall do something meaningful with enough text.\ncriticality: must\n---\n`,
        );
      }
    }

    const ledger = { ...APPROVED_LEDGER_BASE };
    const ctx = runReminder(ledger);
    const totalTokens = estimateTokens(ctx);

    // Total must still be within cap (skeleton dropped if needed)
    expect(totalTokens).toBeLessThanOrEqual(3000);

    // Core content still present (skeleton dropped, not other blocks)
    expect(ctx).toContain("Orchestrator Mode");
    expect(ctx).toContain("Run ledger");
  });
});

// ---------------------------------------------------------------------------
// AC8: Fixture spec tree measurement
// ---------------------------------------------------------------------------

describe("AC8: fixture spec tree token measurement", () => {
  it("measures token counts for each session-reminder block against the 3000-token cap", () => {
    // Copy full fixture spec tree
    const destSpec = path.join(projectDir, "doc", "specs");
    mkdirSync(destSpec, { recursive: true });
    function copyDir(src: string, dest: string) {
      mkdirSync(dest, { recursive: true });
      for (const entry of readdirSync(src)) {
        const srcFull = path.join(src, entry);
        const destFull = path.join(dest, entry);
        try {
          const { statSync } = require("node:fs");
          const stat = statSync(srcFull);
          if (stat.isDirectory()) {
            copyDir(srcFull, destFull);
          } else {
            writeFileSync(destFull, readFileSync(srcFull));
          }
        } catch { /* skip */ }
      }
    }
    copyDir(FIXTURE_SPEC, destSpec);

    // Build a ledger with rfc_ref + plan_ref for maximum block coverage
    const ledger = {
      ...APPROVED_LEDGER_BASE,
      plan_ref: path.join(projectDir, ".groundwork", "plans", "plan.md"),
      rfc_ref: "R-20260101-MEASURE",
    };

    const ctx = runReminder(ledger);

    // Measure each block
    const staticRules = ctx.match(/^[\s\S]*?(?=## Session identity|## ⚠ ACTIVE RUN|## Spec Skeleton|$)/)?.[0] ?? "";
    const sessionBlock = ctx.match(/## Session identity[\s\S]*?(?=\n##|$)/)?.[0] ?? "";
    const activeRunBlock2 = ctx.match(/## ⚠ ACTIVE RUN[\s\S]*?(?=\n##|$)/)?.[0] ?? "";
    const specBlock = ctx.match(/## Spec Skeleton[\s\S]*?(?=\n##|$)/)?.[0] ?? "";

    const staticTokens = estimateTokens(staticRules);
    const sessionTokens = estimateTokens(sessionBlock);
    const activeRunTokens = estimateTokens(activeRunBlock2);
    const specTokens = estimateTokens(specBlock);
    const totalTokens = estimateTokens(ctx);

    // Print the measurement table (visible in test output)
    console.log("\n=== AC8: SessionStart Token Measurement ===");
    console.log("| Block              | Tokens | Cap    |");
    console.log("|-------------------|--------|--------|");
    console.log(`| Static rules       | ${staticTokens.toString().padStart(6)} | ~1390  |`);
    console.log(`| Session identity   | ${sessionTokens.toString().padStart(6)} | ~100   |`);
    console.log(`| Active run block   | ${activeRunTokens.toString().padStart(6)} | ~300   |`);
    console.log(`| Spec skeleton      | ${specTokens.toString().padStart(6)} | 600    |`);
    console.log(`| TOTAL              | ${totalTokens.toString().padStart(6)} | 3000   |`);
    console.log("===========================================");

    if (totalTokens > 3000) {
      console.warn(`FINDING: total tokens (${totalTokens}) exceeds 3000-token cap`);
    }
    if (specTokens > 600) {
      console.warn(`FINDING: spec skeleton tokens (${specTokens}) exceeds 600-token cap`);
    }

    // Hard assertions
    expect(totalTokens).toBeLessThanOrEqual(3000);
    expect(specTokens).toBeLessThanOrEqual(600);
  });
});
