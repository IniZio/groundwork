/**
 * Regression tests for spec-lint.mjs passes 0a and 0b.
 *
 * Pass 0a — File-walk YAML-parse scan:
 *   Walks doc/specs/**\/requirements\/*.md directly; emits `yaml-parse-error`
 *   and exits non-zero for any file whose YAML frontmatter throws on parse.
 *   This is the ONLY gate for unparseable files, because buildIndexData silently
 *   skips them (they produce no index node, so byFile loop never sees them).
 *
 * Pass 0b — Count-parity check (full-tree mode only):
 *   Compares on-disk requirement-file count from walkReqFiles against the count
 *   of unique relPath values among indexed requirement nodes. A mismatch emits
 *   `count-parity` and exits non-zero. Skipped in --rfc mode.
 *
 * Each pass: one positive (fires) + one negative (clean tree stays silent).
 * Every test asserts exit code AND printed stdout via the real subprocess path.
 * Fixtures pin GROUNDWORK_PROJECT_DIR to a scratch tree — never touches doc/specs/.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SPEC_LINT = resolve(
  new URL(import.meta.url).pathname,
  "../../../hooks/spec-lint.mjs",
);

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run spec-lint against a given project dir.
 * No --rfc flag → full-tree mode (required for Pass 0b).
 */
function runLint(projectDir: string, args: string[] = []): RunResult {
  try {
    const stdout = execFileSync(process.execPath, [SPEC_LINT, ...args], {
      env: { ...process.env, GROUNDWORK_PROJECT_DIR: projectDir },
      encoding: "utf8",
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err: any) {
    return {
      code: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

let tmpDir: string | null = null;

function makeSpecTree(): string {
  tmpDir = mkdtempSync(join(tmpdir(), "spec-lint-pass0-"));
  const specsDir = join(tmpDir, "doc", "specs");
  mkdirSync(specsDir, { recursive: true });
  return tmpDir;
}

/**
 * Write a minimal concept so buildIndexData finds a concept root.
 */
function writeConcept(dir: string, conceptId: string): void {
  const conceptDir = join(dir, "doc", "specs", conceptId.toLowerCase());
  mkdirSync(conceptDir, { recursive: true });
  writeFileSync(
    join(conceptDir, "README.md"),
    [
      "---",
      `id: ${conceptId}`,
      "type: concept",
      `title: Test Concept ${conceptId}`,
      "summary: A test concept for spec-lint pass0 fixtures.",
      "parent: null",
      "---",
      "",
      `# Test Concept ${conceptId}`,
      "",
    ].join("\n"),
  );
}

/**
 * Write a valid (well-formed) requirement file in the concept's requirements/ dir.
 * This file IS picked up by walkReqFiles AND produces a requirement node in the index.
 */
function writeGoodReq(dir: string, conceptId: string, reqId: string): void {
  const reqDir = join(dir, "doc", "specs", conceptId.toLowerCase(), "requirements");
  mkdirSync(reqDir, { recursive: true });
  const slug = reqId.toLowerCase();
  writeFileSync(
    join(reqDir, `${slug}.md`),
    [
      "---",
      `id: ${reqId}`,
      "type: requirement",
      `concept: ${conceptId}`,
      "title: A valid test requirement",
      "status: implemented",
      // Use unverified to avoid triggering automated-unverified (no @verifies in fixture)
      "verification: unverified",
      "criticality: must",
      "---",
      "",
      `## ${reqId.toUpperCase()} — A valid test requirement {#${slug}}`,
      "",
      "The system **shall** do something testable.",
      "",
      "- **Why** — Without this, correctness breaks.",
      "- **Fit criterion** — After the action, the result is verified.",
      "- **Verification**: unverified — manual inspection.",
      "- **Criticality**: must",
      "",
    ].join("\n"),
  );
}

/**
 * Write a requirement file with UNPARSEABLE YAML frontmatter (unclosed flow
 * sequence). js-yaml throws "unexpected end of the stream within a flow
 * collection" on parse. buildIndexData silently skips such files — Pass 0a is
 * the only gate for them.
 */
function writeUnparseableReq(dir: string, conceptId: string, reqId: string): string {
  const reqDir = join(dir, "doc", "specs", conceptId.toLowerCase(), "requirements");
  mkdirSync(reqDir, { recursive: true });
  const slug = reqId.toLowerCase();
  const absPath = join(reqDir, `${slug}.md`);
  writeFileSync(
    absPath,
    [
      "---",
      `id: ${reqId}`,
      "type: requirement",
      // Unclosed flow sequence — js-yaml throws here
      "tags: [unclosed",
      "---",
      "",
      "This file has unparseable YAML frontmatter.",
      "",
    ].join("\n"),
  );
  return absPath;
}

/**
 * Write a requirement file that IS found by walkReqFiles (lives in requirements/)
 * but is SILENTLY DROPPED from the index by buildIndexData (no id field →
 * buildIndexData cannot key the node, skips it). Valid YAML so Pass 0a is silent;
 * only Pass 0b fires.
 *
 * Full-tree mode only: Pass 0b is guarded by `if (!rfcMode)`, which is satisfied
 * by runLint() called with no --rfc flag.
 */
function writeSilentlyDroppedReq(dir: string, conceptId: string, filename: string): string {
  const reqDir = join(dir, "doc", "specs", conceptId.toLowerCase(), "requirements");
  mkdirSync(reqDir, { recursive: true });
  const absPath = join(reqDir, filename);
  writeFileSync(
    absPath,
    [
      "---",
      // No `id:` field — buildIndexData cannot produce an indexed node for this file.
      // The YAML is well-formed (no parse error), so Pass 0a is silent.
      "type: requirement",
      `concept: ${conceptId}`,
      "title: A silently dropped requirement",
      "status: implemented",
      "verification: automated",
      "criticality: must",
      "---",
      "",
      "This file has valid YAML but no id field.",
      "",
    ].join("\n"),
  );
  return absPath;
}

afterEach(() => {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

// ---------------------------------------------------------------------------
// Pass 0a POSITIVE — unparseable frontmatter fires yaml-parse-error
// ---------------------------------------------------------------------------
//
// NOTE on fixture interaction: a file with unparseable YAML is also silently
// dropped from the index, so Pass 0b (count-parity) fires on the same fixture.
// To ensure these tests bite Pass 0a specifically — not just count-parity — each
// test asserts BOTH exit code AND the yaml-parse-error content token. That way
// disabling Pass 0a turns the content assertion red even though count-parity
// still drives a non-zero exit.

describe("Pass 0a positive — unparseable YAML frontmatter fires yaml-parse-error", () => {
  it("exits non-zero and emits yaml-parse-error naming the offending file", () => {
    const dir = makeSpecTree();
    writeConcept(dir, "C-PASS0A");
    const absPath = writeUnparseableReq(dir, "C-PASS0A", "c-pass0a-r-001");

    const r = runLint(dir);

    // Exit code proves a violation was found
    expect(
      r.code,
      `Expected non-zero exit (yaml-parse-error) but got 0.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    ).not.toBe(0);
    // Content proves it was yaml-parse-error, not a different violation
    expect(
      r.stdout,
      `Expected stdout to contain 'yaml-parse-error'.\nstdout: ${r.stdout}`,
    ).toContain("yaml-parse-error");
    // File path proves the violation is attributed to the right file
    expect(
      r.stdout,
      `Expected stdout to name the offending file path.\nstdout: ${r.stdout}`,
    ).toContain(absPath);
  });

  it("names the offending file in stdout (file-path assertion isolates Pass 0a from count-parity)", () => {
    const dir = makeSpecTree();
    writeConcept(dir, "C-PASS0A");
    const absPath = writeUnparseableReq(dir, "C-PASS0A", "c-pass0a-r-002");

    const r = runLint(dir);

    expect(
      r.stdout,
      `Expected stdout to contain the offending file path after yaml-parse-error.\nstdout: ${r.stdout}`,
    ).toContain(absPath);
    expect(
      r.stdout,
      `Expected stdout to contain 'yaml-parse-error'.\nstdout: ${r.stdout}`,
    ).toContain("yaml-parse-error");
  });
});

// ---------------------------------------------------------------------------
// Pass 0a NEGATIVE — clean tree exits 0 with no yaml-parse-error
// ---------------------------------------------------------------------------

describe("Pass 0a negative — well-formed tree is silent", () => {
  it("exits 0 and emits no yaml-parse-error for a clean spec tree", () => {
    const dir = makeSpecTree();
    writeConcept(dir, "C-PASS0A");
    writeGoodReq(dir, "C-PASS0A", "c-pass0a-r-001");

    const r = runLint(dir);

    expect(
      r.stdout,
      `Expected no yaml-parse-error but stdout was:\n${r.stdout}`,
    ).not.toContain("yaml-parse-error");
    expect(
      r.code,
      `Expected exit 0 on clean tree but got ${r.code}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Pass 0b POSITIVE — silently-dropped file triggers count-parity
// ---------------------------------------------------------------------------
//
// Full-tree mode is exercised here: runLint() is called with no --rfc flag,
// so rfcMode is false and the `if (!rfcMode)` guard at Pass 0b is entered.

describe("Pass 0b positive — on-disk file absent from index fires count-parity", () => {
  it("exits non-zero when a requirements file is on disk but not in the index", () => {
    const dir = makeSpecTree();
    writeConcept(dir, "C-PASS0B");
    writeGoodReq(dir, "C-PASS0B", "c-pass0b-r-001");       // counted in both
    writeSilentlyDroppedReq(dir, "C-PASS0B", "dropped.md"); // on disk only

    // Full-tree mode: no --rfc flag → rfcMode=false → Pass 0b runs
    const r = runLint(dir);

    expect(
      r.code,
      `Expected non-zero exit (count-parity) but got 0.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    ).not.toBe(0);
  });

  it("names count-parity in stdout when disk count exceeds index count", () => {
    const dir = makeSpecTree();
    writeConcept(dir, "C-PASS0B");
    writeGoodReq(dir, "C-PASS0B", "c-pass0b-r-001");
    writeSilentlyDroppedReq(dir, "C-PASS0B", "dropped.md");

    const r = runLint(dir);

    expect(
      r.stdout,
      `Expected stdout to contain 'count-parity'.\nstdout: ${r.stdout}`,
    ).toContain("count-parity");
  });
});

// ---------------------------------------------------------------------------
// Pass 0b NEGATIVE — clean tree exits 0 with no count-parity (full-tree mode)
// ---------------------------------------------------------------------------

describe("Pass 0b negative — balanced tree is silent in full-tree mode", () => {
  it("exits 0 and emits no count-parity when all disk files appear in the index", () => {
    const dir = makeSpecTree();
    writeConcept(dir, "C-PASS0B");
    writeGoodReq(dir, "C-PASS0B", "c-pass0b-r-001");

    // Full-tree mode: no --rfc flag
    const r = runLint(dir);

    expect(
      r.stdout,
      `Expected no count-parity but stdout was:\n${r.stdout}`,
    ).not.toContain("count-parity");
    expect(
      r.code,
      `Expected exit 0 on clean tree but got ${r.code}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    ).toBe(0);
  });
});
