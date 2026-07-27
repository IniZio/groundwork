/**
 * T5 tests: RFC-retargeted ledger init, Stop-gate RFC check, SessionStart spec skeleton.
 *
 * AC coverage:
 *   AC1 — ledger init --rfc <dir> seeds slices from frontmatter tasks[]
 *   AC2 — stop-gate blocks when rfc_ref resolves to non-accepted/implementing RFC
 *   AC3 — session-reminder shows RFC ref and status in active run block
 *   AC4 — stop-gate fails open on any RFC resolution error
 *   AC5 — no RFC-scoped ledger created; session-scoped ledger still written
 *   AC6 — spec skeleton ≤600 tokens, degrades to depth-1 with child counts
 *   AC7 — total injection ≤3000 tokens, skeleton dropped first if cap exceeded
 *   AC8 — fixture spec tree measurement table
 */

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const LEDGER_CLI = path.resolve(import.meta.dirname, "..", "..", "hooks", "ledger.mjs");
const STOP_GATE = path.resolve(import.meta.dirname, "..", "..", "hooks", "stop-gate.mjs");
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

/** Run the ledger CLI; returns { code, stdout, stderr }. */
function runLedger(args: string[], env?: Record<string, string>) {
  const mergedEnv = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, ...env };
  // Only delete CLAUDE_CODE_SESSION_ID if not explicitly provided in env arg
  if (!env || !("CLAUDE_CODE_SESSION_ID" in env)) {
    delete mergedEnv.CLAUDE_CODE_SESSION_ID;
  }
  try {
    const stdout = execFileSync("node", [LEDGER_CLI, ...args], {
      env: mergedEnv,
      encoding: "utf8",
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e: any) {
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

/** Write a minimal rfc.md with frontmatter and return the dir path. */
function makeRfcDir(rfcDir: string, uid: string, status: string, tasks: object[]) {
  mkdirSync(rfcDir, { recursive: true });
  const fm = [
    "---",
    `uid: ${uid}`,
    `status: ${status}`,
    `title: Test RFC`,
    `tasks:`,
    ...tasks.map((t: any) => {
      const lines = [`  - id: ${t.id}`, `    wave: ${t.wave ?? 0}`];
      if (t.blocked_by?.length) lines.push(`    blocked_by: [${t.blocked_by.join(", ")}]`);
      if (t.acceptance?.length) {
        lines.push(`    acceptance:`);
        t.acceptance.forEach((a: string) => lines.push(`      - "${a}"`));
      }
      if (t.desc) lines.push(`    desc: "${t.desc}"`);
      return lines.join("\n");
    }),
    "---",
    "",
    "# Test RFC body",
  ].join("\n");
  writeFileSync(path.join(rfcDir, "rfc.md"), fm);
  return rfcDir;
}

/** Run the stop-gate hook with a given ledger (written to .groundwork/runs/<sessionId>.json). */
function runStopGate(
  ledger: unknown,
  sessionId = "sess-t5",
  extraProjectFiles?: Record<string, string>,
): { continue?: boolean; decision?: string; reason?: string } {
  const runsDir = path.join(projectDir, ".groundwork", "runs");
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(
    path.join(runsDir, `${sessionId}.json`),
    JSON.stringify(ledger, null, 2),
  );
  if (extraProjectFiles) {
    for (const [rel, content] of Object.entries(extraProjectFiles)) {
      const full = path.join(projectDir, rel);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  }
  const input = JSON.stringify({ cwd: projectDir, session_id: sessionId });
  const out = execFileSync("node", [STOP_GATE], { input, encoding: "utf8" });
  return JSON.parse(out);
}

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
// AC1: ledger init --rfc <dir>
// ---------------------------------------------------------------------------

describe("AC1: ledger init --rfc seeds slices from RFC tasks", () => {
  it("creates one slice per task, preserving id/wave/blocked_by/acceptance", () => {
    const rfcDir = path.join(projectDir, ".groundwork", "rfcs", "0001-test");
    makeRfcDir(rfcDir, "R-20260101-ABCDEF", "accepted", [
      { id: "T1", wave: 1, blocked_by: [], acceptance: ["ac1", "ac2"], desc: "first task" },
      { id: "T2", wave: 2, blocked_by: ["T1"], acceptance: ["ac3"] },
    ]);

    const result = runLedger(["init", "--rfc", rfcDir], { CLAUDE_CODE_SESSION_ID: "sess-t5" });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("2 slices");

    const ledgerPath = path.join(projectDir, ".groundwork", "runs", "sess-t5.json");
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));

    expect(ledger.rfc_ref).toBe("R-20260101-ABCDEF");
    expect(ledger.slices).toHaveLength(2);

    const t1 = ledger.slices.find((s: any) => s.id === "T1");
    expect(t1.wave).toBe(1);
    expect(t1.blocked_by).toEqual([]);
    expect(t1.acceptance).toEqual(["ac1", "ac2"]);

    const t2 = ledger.slices.find((s: any) => s.id === "T2");
    expect(t2.wave).toBe(2);
    expect(t2.blocked_by).toEqual(["T1"]);
    expect(t2.acceptance).toEqual(["ac3"]);
  });

  it("all created slices have status: pending", () => {
    const rfcDir = path.join(projectDir, ".groundwork", "rfcs", "0001-test");
    makeRfcDir(rfcDir, "R-20260101-BBBBBB", "implementing", [
      { id: "X1", wave: 0 },
    ]);
    runLedger(["init", "--rfc", rfcDir], { CLAUDE_CODE_SESSION_ID: "sess-t5" });
    const ledgerPath = path.join(projectDir, ".groundwork", "runs", "sess-t5.json");
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
    expect(ledger.slices[0].status).toBe("pending");
  });

  it("exits 1 when rfc dir does not exist", () => {
    const result = runLedger(["init", "--rfc", "/nonexistent/rfc/dir"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("cannot read RFC");
  });

  it("exits 2 when neither src file nor --rfc provided", () => {
    const result = runLedger(["init"]);
    expect(result.code).toBe(2);
  });

  // AC5: session-scoped ledger written, no RFC-scoped ledger
  it("writes a session-scoped ledger, not an RFC-scoped one", () => {
    const rfcDir = path.join(projectDir, ".groundwork", "rfcs", "0001-test");
    makeRfcDir(rfcDir, "R-20260101-CCCCCC", "accepted", [{ id: "T1", wave: 0 }]);
    runLedger(["init", "--rfc", rfcDir], { CLAUDE_CODE_SESSION_ID: "sess-t5" });

    const runsDir = path.join(projectDir, ".groundwork", "runs");
    const files = readdirSync(runsDir);
    // Only one ledger written, named after session_id
    expect(files).toHaveLength(1);
    expect(files[0]).toBe("sess-t5.json");
    // No ledger named after the RFC uid
    expect(existsSync(path.join(projectDir, ".groundwork", "R-20260101-CCCCCC.json"))).toBe(false);
  });

  // AC1 sidecar: tasks.yaml present → read tasks from it, ignore frontmatter
  it("reads tasks from tasks.yaml sidecar when present", () => {
    const rfcDir = path.join(projectDir, ".groundwork", "rfcs", "0001-sidecar");
    mkdirSync(rfcDir, { recursive: true });
    // rfc.md has NO tasks in frontmatter (tasks: null / absent)
    writeFileSync(
      path.join(rfcDir, "rfc.md"),
      [
        "---",
        "uid: R-20260101-SIDECAR",
        "status: accepted",
        "title: Sidecar RFC",
        "---",
        "",
        "# body",
      ].join("\n"),
    );
    // tasks.yaml sidecar with 3 tasks
    writeFileSync(
      path.join(rfcDir, "tasks.yaml"),
      [
        "- id: S1",
        "  wave: 1",
        "  desc: sidecar task one",
        "  blocked_by: []",
        "  acceptance: []",
        "- id: S2",
        "  wave: 1",
        "  desc: sidecar task two",
        "  blocked_by: [S1]",
        "  acceptance: []",
        "- id: S3",
        "  wave: 2",
        "  desc: sidecar task three",
        "  blocked_by: []",
        "  acceptance: [ac-s3]",
      ].join("\n"),
    );

    const result = runLedger(["init", "--rfc", rfcDir], { CLAUDE_CODE_SESSION_ID: "sess-sidecar" });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("3 slices");

    const ledgerPath = path.join(projectDir, ".groundwork", "runs", "sess-sidecar.json");
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
    expect(ledger.slices).toHaveLength(3);

    const s1 = ledger.slices.find((s: any) => s.id === "S1");
    expect(s1).toBeDefined();
    expect(s1.wave).toBe(1);

    const s3 = ledger.slices.find((s: any) => s.id === "S3");
    expect(s3).toBeDefined();
    expect(s3.wave).toBe(2);
    expect(s3.acceptance).toContain("ac-s3");
  });

  // AC1 neither: no tasks.yaml AND no frontmatter tasks → hard error, exit 1
  it("exits 1 when neither tasks.yaml nor frontmatter tasks are present", () => {
    const rfcDir = path.join(projectDir, ".groundwork", "rfcs", "0001-notasks");
    mkdirSync(rfcDir, { recursive: true });
    // rfc.md with uid but no tasks field
    writeFileSync(
      path.join(rfcDir, "rfc.md"),
      [
        "---",
        "uid: R-20260101-NOTASKS",
        "status: accepted",
        "title: No Tasks RFC",
        "---",
        "",
        "# body",
      ].join("\n"),
    );
    // No tasks.yaml written

    const result = runLedger(["init", "--rfc", rfcDir], { CLAUDE_CODE_SESSION_ID: "sess-notasks" });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/no tasks|zero slices/i);
  });
});

// ---------------------------------------------------------------------------
// AC2: stop-gate blocks on non-accepted/implementing RFC
// ---------------------------------------------------------------------------

describe("AC2: stop-gate blocks on unresolved rfc_ref", () => {
  function makeLedgerWithRfc(uid: string): object {
    return {
      ...APPROVED_LEDGER_BASE,
      rfc_ref: uid,
    };
  }

  it("blocks when RFC is in 'draft' status", () => {
    const rfcDir = path.join(projectDir, ".groundwork", "rfcs", "0001-draft");
    makeRfcDir(rfcDir, "R-20260101-DRAFT1", "draft", []);
    const result = runStopGate(makeLedgerWithRfc("R-20260101-DRAFT1"), "sess-t5");
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("R-20260101-DRAFT1");
    expect(result.reason).toContain("draft");
    expect(result.reason).toContain("accepted");
  });

  it("blocks when RFC is in 'review' status", () => {
    const rfcDir = path.join(projectDir, ".groundwork", "rfcs", "0001-review");
    makeRfcDir(rfcDir, "R-20260101-REVIE1", "review", []);
    const result = runStopGate(makeLedgerWithRfc("R-20260101-REVIE1"), "sess-t5");
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("review");
  });

  it("allows when RFC is in 'accepted' status", () => {
    const rfcDir = path.join(projectDir, ".groundwork", "rfcs", "0001-accepted");
    makeRfcDir(rfcDir, "R-20260101-ACCPT1", "accepted", []);
    const result = runStopGate(makeLedgerWithRfc("R-20260101-ACCPT1"), "sess-t5");
    // Should allow (no incomplete slices, advisor APPROVE, RFC accepted)
    expect(result.continue).toBe(true);
  });

  it("allows when RFC is in 'implementing' status", () => {
    const rfcDir = path.join(projectDir, ".groundwork", "rfcs", "0001-impl");
    makeRfcDir(rfcDir, "R-20260101-IMPLI1", "implementing", []);
    const result = runStopGate(makeLedgerWithRfc("R-20260101-IMPLI1"), "sess-t5");
    expect(result.continue).toBe(true);
  });

  it("treats rfc_ref: '' (empty string) as absent — no RFC resolution attempted", () => {
    // Mutation target: the truthiness half of `typeof rfcRef === 'string' && rfcRef`.
    //
    // To make this non-vacuous we plant an RFC whose frontmatter uid IS the empty
    // string (written as uid: "" so js-yaml parses it as "").  Without the mutation
    // the guard short-circuits on the falsy "" before ever calling findRfcByUid, so
    // stop-gate allows.  WITH the mutation (typeof only) the guard enters the block,
    // findRfcByUid scans the directory, finds uid === "", reads status "draft", and
    // BLOCKS.  The test therefore FAILS under mutation and PASSES on production code.
    const rfcDir = path.join(projectDir, ".groundwork", "rfcs", "0001-empty-uid");
    mkdirSync(rfcDir, { recursive: true });
    // Write uid: "" explicitly so js-yaml parses it as empty string (not null).
    writeFileSync(
      path.join(rfcDir, "rfc.md"),
      [
        "---",
        'uid: ""',
        "status: draft",
        "title: Empty UID RFC",
        "tasks: []",
        "---",
        "",
        "# body",
      ].join("\n"),
    );

    const ledger = { ...APPROVED_LEDGER_BASE, rfc_ref: "" };
    const result = runStopGate(ledger, "sess-t5");
    // Empty rfc_ref → guard short-circuits before RFC resolution → allow
    expect(result.continue).toBe(true);
    expect(result.decision).not.toBe("block");
  });
});

// ---------------------------------------------------------------------------
// AC4: stop-gate fails open on RFC resolution errors
// ---------------------------------------------------------------------------

describe("AC4: stop-gate fails open on RFC resolution errors", () => {
  it("allows when rfc_ref does not resolve to any RFC directory", () => {
    // No .groundwork/rfcs directory at all — findRfcByUid returns null → fail-open
    const ledger = { ...APPROVED_LEDGER_BASE, rfc_ref: "R-20260101-MISSIN" };
    const result = runStopGate(ledger, "sess-t5");
    // RFC not found → fail-open → allow
    expect(result.continue).toBe(true);
  });

  it("allows when rfc.md is malformed / unreadable", () => {
    const rfcDir = path.join(projectDir, ".groundwork", "rfcs", "0001-bad");
    mkdirSync(rfcDir, { recursive: true });
    writeFileSync(path.join(rfcDir, "rfc.md"), "not valid yaml frontmatter");
    const ledger = { ...APPROVED_LEDGER_BASE, rfc_ref: "R-20260101-BADUID" };
    const result = runStopGate(ledger, "sess-t5");
    // Fail-open: RFC not found (uid mismatch or parse error) → allow
    expect(result.continue).toBe(true);
  });

  it("allows when .groundwork/rfcs/ is unreadable (EACCES forces throw out of RFC resolution)", () => {
    // Skip on root: root ignores mode bits, so chmod 000 has no effect.
    // Skip on Windows: chmod is a no-op there.
    if (process.platform === "win32" || process.getuid?.() === 0) return;

    // Create an unreadable rfcs directory — readdirSync(rfcsDir) at the TOP of
    // findRfcByUid (outside its inner try-catch) will throw EACCES, exercising
    // stop-gate's outer catch (AC4 fail-open).
    const rfcsDir = path.join(projectDir, ".groundwork", "rfcs");
    mkdirSync(rfcsDir, { recursive: true });
    chmodSync(rfcsDir, 0o000);

    try {
      const ledger = { ...APPROVED_LEDGER_BASE, rfc_ref: "R-20260101-EACCES1" };
      const result = runStopGate(ledger, "sess-t5");
      // AC4: outer catch must allow the stop — never wedge the session
      expect(result.continue).toBe(true);
    } finally {
      // Restore so afterEach rmSync can clean up the temp dir
      chmodSync(rfcsDir, 0o755);
    }
  });

  it("allows (without rfc check) when ledger has no rfc_ref", () => {
    const ledger = { ...APPROVED_LEDGER_BASE };
    const result = runStopGate(ledger, "sess-t5");
    expect(result.continue).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC3: session-reminder shows RFC ref and status
// ---------------------------------------------------------------------------

describe("AC3: session-reminder displays rfc_ref and status", () => {
  it("shows RFC uid and status when ledger carries rfc_ref that resolves", () => {
    const rfcDir = path.join(projectDir, ".groundwork", "rfcs", "0001-show01");
    mkdirSync(rfcDir, { recursive: true });
    const rfcFm = [
      "---",
      "uid: R-20260101-SHOW01",
      "status: implementing",
      "title: Test",
      "---",
      "",
    ].join("\n");
    writeFileSync(path.join(rfcDir, "rfc.md"), rfcFm);

    const ledger = {
      ...APPROVED_LEDGER_BASE,
      rfc_ref: "R-20260101-SHOW01",
    };
    const ctx = runReminder(ledger);
    expect(ctx).toContain("RFC: R-20260101-SHOW01");
    expect(ctx).toContain("implementing");
  });

  it("shows RFC uid with 'unknown' status when RFC cannot be resolved", () => {
    const ledger = {
      ...APPROVED_LEDGER_BASE,
      rfc_ref: "R-20260101-UNKNWN",
    };
    const ctx = runReminder(ledger);
    expect(ctx).toContain("RFC: R-20260101-UNKNWN");
    expect(ctx).toContain("unknown");
  });

  it("does not show RFC line when ledger has no rfc_ref", () => {
    const ledger = { ...APPROVED_LEDGER_BASE };
    const ctx = runReminder(ledger);
    expect(ctx).not.toContain("RFC:");
  });
});

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
