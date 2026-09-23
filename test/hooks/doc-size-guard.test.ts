/**
 * test/hooks/doc-size-guard.test.ts
 *
 * AC map:
 *   AC 1 — violation printed for over-budget doc-class file missing structural
 *           elements; message names path, class, tokens, budget, missing element
 *   AC 6 — fail-open: any error → allow, exit 0
 *   AC 7 — registered for Write/Edit/MultiEdit only; other tools pass through
 *   Bite — structurally complete file at over-budget → no violation (proves guard
 *           is not vacuous)
 *
 * rootDir is passed explicitly to check() so tests never call process.chdir().
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { check } from "../../src/hooks/doc-size-guard.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "doc-size-guard-"));
  mkdirSync(path.join(tmpDir, ".groundwork", "plans"), { recursive: true });
});

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function prdPath(name: string): string {
  return path.join(tmpDir, ".groundwork", "plans", name);
}

function bigContent(): string { return "x".repeat(11000); }

function bigStructured(): string {
  return "# Title\n\nIntro text here.\n\n## Section One\n\nContent.\n\n" + "x".repeat(11000);
}

// ---------------------------------------------------------------------------
// Allow fixture
// ---------------------------------------------------------------------------

describe("doc-size-guard — allow", () => {
  it("ALLOW: within-budget doc-class file — no output", () => {
    const fp = prdPath(`small-${Date.now()}.md`);
    writeFileSync(fp, "# Doc\n\n## Section\n\nShort.\n");
    const r = check({ tool_name: "Write", tool_input: { file_path: fp } }, tmpDir);
    expect(r.stdout).toBe("");
    expect(r.exit).toBe(0);
  });

  it("ALLOW: unclassified file even if large — no output", () => {
    const fp = path.join(tmpDir, "unclassified.md");
    writeFileSync(fp, bigContent());
    const r = check({ tool_name: "Write", tool_input: { file_path: fp } }, tmpDir);
    expect(r.stdout).toBe("");
  });

  it("ALLOW: non-guarded tool (Read) — no output (AC 7)", () => {
    const fp = prdPath(`read-tool-${Date.now()}.md`);
    writeFileSync(fp, bigContent());
    const r = check({ tool_name: "Read", tool_input: { file_path: fp } }, tmpDir);
    expect(r.stdout).toBe("");
  });

  it("ALLOW: over-budget file with BOTH structural elements — guard silent", () => {
    const fp = prdPath(`structured-${Date.now()}.md`);
    writeFileSync(fp, bigStructured());
    const r = check({ tool_name: "Write", tool_input: { file_path: fp } }, tmpDir);
    expect(r.stdout).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Violation fixture (AC 1)
// ---------------------------------------------------------------------------

describe("doc-size-guard — violation (AC 1)", () => {
  it("VIOLATION: over-budget file missing both elements — violation printed", () => {
    const fp = prdPath(`violation-${Date.now()}.md`);
    writeFileSync(fp, bigContent());
    const r = check({ tool_name: "Write", tool_input: { file_path: fp } }, tmpDir);
    expect(r.stdout).toContain("doc-size-guard: violation");
    expect(r.exit).toBe(0);
  });

  it("VIOLATION: message names path, class, tokens, budget, and missing (AC 1)", () => {
    const fp = prdPath(`fields-${Date.now()}.md`);
    writeFileSync(fp, bigContent());
    const r = check({ tool_name: "Write", tool_input: { file_path: fp } }, tmpDir);
    expect(r.stdout).toContain(fp);
    expect(r.stdout).toContain("plan");
    expect(r.stdout).toMatch(/~\d+ \(budget \d+\)/);
    expect(r.stdout).toContain("missing:");
  });

  it("VIOLATION: fires for Edit tool", () => {
    const fp = prdPath(`edit-${Date.now()}.md`);
    writeFileSync(fp, bigContent());
    const r = check({ tool_name: "Edit", tool_input: { file_path: fp } }, tmpDir);
    expect(r.stdout).toContain("doc-size-guard: violation");
  });

  it("VIOLATION: fires for MultiEdit tool", () => {
    const fp = prdPath(`multiedit-${Date.now()}.md`);
    writeFileSync(fp, bigContent());
    const r = check({ tool_name: "MultiEdit", tool_input: { file_path: fp } }, tmpDir);
    expect(r.stdout).toContain("doc-size-guard: violation");
  });

  it("VIOLATION: missing summary-header only — reports summary-header", () => {
    const fp = prdPath(`no-summary-${Date.now()}.md`);
    writeFileSync(fp, "## Section\n\nContent.\n\n" + "x".repeat(11000));
    const r = check({ tool_name: "Write", tool_input: { file_path: fp } }, tmpDir);
    expect(r.stdout).toContain("summary-header");
  });

  it("VIOLATION: missing section-anchor only — reports section-anchor", () => {
    const fp = prdPath(`no-anchor-${Date.now()}.md`);
    writeFileSync(fp, "# Title\n\nIntro.\n\n" + "x".repeat(11000));
    const r = check({ tool_name: "Write", tool_input: { file_path: fp } }, tmpDir);
    expect(r.stdout).toContain("section-anchor");
  });
});

// ---------------------------------------------------------------------------
// Bite proof
// ---------------------------------------------------------------------------

describe("doc-size-guard — bite proof", () => {
  it("BITE: within-budget → no output; over-budget missing elements → violation", () => {
    const fp = prdPath(`bite-${Date.now()}.md`);

    writeFileSync(fp, "x".repeat(5000));
    const r1 = check({ tool_name: "Write", tool_input: { file_path: fp } }, tmpDir);
    expect(r1.stdout).toBe("");

    writeFileSync(fp, "x".repeat(11000));
    const r2 = check({ tool_name: "Write", tool_input: { file_path: fp } }, tmpDir);
    expect(r2.stdout).toContain("doc-size-guard: violation");
  });
});

// ---------------------------------------------------------------------------
// Fail-open (AC 6)
// ---------------------------------------------------------------------------

describe("doc-size-guard — fail-open (AC 6)", () => {
  it("fail-open: null input — allow, exit 0", () => {
    const r = check(null);
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("fail-open: non-existent file — allow, exit 0", () => {
    const fp = prdPath(`nonexistent-${Date.now()}.md`);
    const r = check({ tool_name: "Write", tool_input: { file_path: fp } }, tmpDir);
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("fail-open: SDK embedded agent — allow, exit 0", () => {
    const fp = prdPath(`sdk-${Date.now()}.md`);
    writeFileSync(fp, bigContent());
    const orig = process.env.CLAUDE_CODE_ENTRYPOINT;
    process.env.CLAUDE_CODE_ENTRYPOINT = "sdk-py";
    try {
      const r = check({ tool_name: "Write", tool_input: { file_path: fp } }, tmpDir);
      expect(r.exit).toBe(0);
      expect(r.stdout).toBe("");
    } finally {
      if (orig === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT;
      else process.env.CLAUDE_CODE_ENTRYPOINT = orig;
    }
  });
});
