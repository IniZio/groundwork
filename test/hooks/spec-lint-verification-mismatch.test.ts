/**
 * spec-lint verification-mismatch hard-error rule tests.
 *
 * Rule: frontmatter `verification:` must agree with body `**Verification**` label.
 * Mode: HARD ERROR — offenders cause exit 1 (T66 promoted from advisory warn mode).
 *
 * Invariants exercised:
 *   verification-mismatch — fm=unverified/body=automated fires (positive)
 *   verification-mismatch — fm=automated/body=unverified fires (reverse positive)
 *   verification-mismatch — fm=automated/body=automated is silent (negative)
 *   exit code — exits 1 when a verification-mismatch violation exists
 *
 * Tests run against temp fixture trees; they NEVER touch doc/specs/** in the live repo.
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

/** Run spec-lint against a given project dir. */
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
  tmpDir = mkdtempSync(join(tmpdir(), "spec-lint-vm-"));
  const specsDir = join(tmpDir, "doc", "specs");
  mkdirSync(specsDir, { recursive: true });
  return tmpDir;
}

/**
 * Write a minimal concept README so buildIndexData finds the concept.
 */
function writeConcept(dir: string, conceptId: string, conceptTitle = "Test Concept"): void {
  const conceptDir = join(dir, "doc", "specs", conceptId.toLowerCase());
  mkdirSync(conceptDir, { recursive: true });
  writeFileSync(
    join(conceptDir, "README.md"),
    [
      "---",
      `id: ${conceptId}`,
      "type: concept",
      `title: ${conceptTitle}`,
      "summary: A test concept for spec-lint fixtures.",
      "parent: null",
      "---",
      "",
      `# ${conceptTitle}`,
      "",
    ].join("\n"),
  );
}

/**
 * Write a D-15 individual requirement file with controlled frontmatter and body verification.
 *
 * Shape A canonical format: H2 heading + bullet attributes.
 */
function writeIndividualReq(
  dir: string,
  conceptId: string,
  reqId: string,
  fmVerification: string,
  bodyVerification: string,
): void {
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
      "title: A test requirement",
      "status: implemented",
      `verification: ${fmVerification}`,
      "criticality: must",
      "---",
      "",
      `## ${reqId.toUpperCase()} — A test requirement {#${slug}}`,
      "",
      "The system **shall** do something testable.",
      "",
      "- **Why** — Without this, correctness breaks.",
      "- **Fit criterion** — After the action, the result is verified.",
      `- **Verification**: ${bodyVerification} — unit tests in test/hooks/.`,
      "- **Criticality**: must",
      "",
    ].join("\n"),
  );
}

afterEach(() => {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

// ---------------------------------------------------------------------------
// Positive control: fm=unverified / body=automated — MUST be a hard error
// ---------------------------------------------------------------------------

describe("verification-mismatch: fm=unverified, body=automated fires", () => {
  it("prints LINT_DRIFT line naming the requirement id", () => {
    const dir = makeSpecTree();
    writeConcept(dir, "C-TEST");
    writeIndividualReq(dir, "C-TEST", "c-test-r-001", "unverified", "automated");
    const r = runLint(dir);
    // Violation must appear in stdout as LINT_DRIFT
    expect(r.stdout).toContain("LINT_DRIFT");
    expect(r.stdout).toContain("verification-mismatch");
    expect(r.stdout).toContain("c-test-r-001");
  });

  it("mentions both disagreeing values in the violation", () => {
    const dir = makeSpecTree();
    writeConcept(dir, "C-TEST");
    writeIndividualReq(dir, "C-TEST", "c-test-r-001", "unverified", "automated");
    const r = runLint(dir);
    expect(r.stdout).toContain("unverified");
    expect(r.stdout).toContain("automated");
  });

  it("exits 1 because mismatch is now a hard error", () => {
    const dir = makeSpecTree();
    writeConcept(dir, "C-TEST");
    writeIndividualReq(dir, "C-TEST", "c-test-r-001", "unverified", "automated");
    const r = runLint(dir);
    expect(
      r.code,
      `Expected exit 1 (hard error) but got ${r.code}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Reverse positive control: fm=manual / body=unverified — MUST ALSO be a hard error
// ---------------------------------------------------------------------------

describe("verification-mismatch: fm=manual, body=unverified fires (reverse direction)", () => {
  it("prints LINT_DRIFT line for the reverse mismatch direction", () => {
    const dir = makeSpecTree();
    writeConcept(dir, "C-TEST");
    // Use manual/unverified to avoid automated-unverified confounding; 3-digit numeric id required.
    writeIndividualReq(dir, "C-TEST", "c-test-r-010", "manual", "unverified");
    const r = runLint(dir);
    expect(r.stdout).toContain("LINT_DRIFT");
    expect(r.stdout).toContain("verification-mismatch");
    expect(r.stdout).toContain("c-test-r-010");
  });

  it("verification-mismatch IS now a hard error (causes exit 1)", () => {
    const dir = makeSpecTree();
    writeConcept(dir, "C-TEST");
    // Use manual/unverified to avoid automated-unverified confounding the exit code.
    // ID must be a valid 3-digit numeric format (no letter suffix).
    writeIndividualReq(dir, "C-TEST", "c-test-r-010", "manual", "unverified");
    const r = runLint(dir);
    // The violation line must appear
    expect(r.stdout).toContain("LINT_DRIFT");
    expect(r.stdout).toContain("verification-mismatch");
    // verification-mismatch is now a hard error — must exit 1
    expect(r.code).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Negative control: agreeing values — MUST be silent on verification-mismatch
// ---------------------------------------------------------------------------

describe("verification-mismatch: agreeing values produce no violation", () => {
  it("does NOT emit verification-mismatch when both are automated (exits 1 only for automated-unverified, not this rule)", () => {
    const dir = makeSpecTree();
    writeConcept(dir, "C-TEST");
    writeIndividualReq(dir, "C-TEST", "c-test-r-003", "automated", "automated");
    const r = runLint(dir);
    // The advisory rule must NOT fire — no verification-mismatch in output
    expect(r.stdout + r.stderr).not.toContain("verification-mismatch");
    // NOTE: exit may be 1 here because automated-unverified fires (no @verifies tag);
    // that is a separate rule. This test only verifies THIS rule is silent.
  });

  it("does NOT emit verification-mismatch when frontmatter and body agree (unverified/unverified) and exits 0", () => {
    const dir = makeSpecTree();
    writeConcept(dir, "C-TEST");
    // Use unverified/unverified so automated-unverified does not confound exit code
    writeIndividualReq(dir, "C-TEST", "c-test-r-004", "unverified", "unverified");
    const r = runLint(dir);
    expect(r.stdout).not.toContain("verification-mismatch");
    // unverified requirements have no @verifies obligation — clean exit
    expect(r.code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Violation count line appears with correct count
// ---------------------------------------------------------------------------

describe("verification-mismatch: count line in output", () => {
  it("prints the count of violations when there are offenders and exits 1", () => {
    const dir = makeSpecTree();
    writeConcept(dir, "C-TEST");
    writeIndividualReq(dir, "C-TEST", "c-test-r-001", "unverified", "automated");
    writeIndividualReq(dir, "C-TEST", "c-test-r-002", "unverified", "automated");
    const r = runLint(dir);
    // Should mention 2 violations in the summary line
    expect(r.stdout).toMatch(/2 violations? found/);
    expect(r.code).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Regression: prose quoting the attribute syntax must not be captured (T68)
//
// Shape: body prose quotes `- **Verification**:` in backticks (line before the
// real bullet).  The real bullet agrees with frontmatter.  Rule must be silent.
// ---------------------------------------------------------------------------

describe("verification-mismatch: prose-quoted attribute syntax is not captured", () => {
  /**
   * Write a requirement whose body contains:
   *   - a prose line quoting `- **Verification**:` and `- **Criticality**:` inside backticks
   *   - followed by the REAL bullet lines that agree with frontmatter
   *
   * This is the R-006 shape that was silently corrupted by the unanchored regex.
   */
  function writeProseQuotingReq(
    dir: string,
    conceptId: string,
    reqId: string,
    fmVerification: string,
    bodyVerification: string,
  ): void {
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
        "title: A test requirement",
        "status: implemented",
        `verification: ${fmVerification}`,
        "criticality: must",
        "---",
        "",
        `## ${reqId.toUpperCase()} — A test requirement {#${slug}}`,
        "",
        "The system **shall** do something testable.",
        "",
        // Prose line that QUOTES the attribute syntax — must not be captured
        "Annotations include `- **Verification**:` and `- **Criticality**:` bullets.",
        "",
        "- **Why** — Without this, correctness breaks.",
        "- **Fit criterion** — After the action, the result is verified.",
        // Real attribute bullets — must be captured
        `- **Verification**: ${bodyVerification} — unit tests in test/hooks/.`,
        "- **Criticality**: must",
        "",
      ].join("\n"),
    );
  }

  it("emits NO verification-mismatch when prose quotes the syntax but real bullet agrees with frontmatter", () => {
    const dir = makeSpecTree();
    writeConcept(dir, "C-TEST");
    // Both frontmatter and the real body bullet say "manual"; the prose line quotes the syntax
    writeProseQuotingReq(dir, "C-TEST", "c-test-r-068", "manual", "manual");
    const r = runLint(dir);
    expect(r.stdout).not.toContain("verification-mismatch");
    expect(r.code).toBe(0);
  });

  it("DOES emit verification-mismatch when real bullet disagrees with frontmatter (prose quote is not the cause)", () => {
    const dir = makeSpecTree();
    writeConcept(dir, "C-TEST");
    // Frontmatter says manual, real bullet says unverified — mismatch must still fire
    writeProseQuotingReq(dir, "C-TEST", "c-test-r-069", "manual", "unverified");
    const r = runLint(dir);
    expect(r.stdout).toContain("verification-mismatch");
    expect(r.stdout).toContain("c-test-r-069");
    expect(r.code).toBe(1); // now a hard error
  });
});
