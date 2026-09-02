/**
 * spec coverage.verified must not credit a requirement whose frontmatter
 * verification: is not "automated", even when @verifies annotations exist.
 *
 * Regression for the defect where PACING-R-010 (verification: unverified)
 * was reported as verified solely because a test file contained an `@verifies`
 * annotation that named pacing-r-010.
 */

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "hooks",
  "spec.mjs",
);

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), "gw-spec-cov-"));
  writeFileSync(
    path.join(projectDir, "package.json"),
    JSON.stringify({ name: "cov-test" }),
  );
});
afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
  delete env.CLAUDE_CODE_SESSION_ID;
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      env,
      encoding: "utf8",
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return {
      code: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

describe("coverage.verified excludes non-automated requirements", () => {
  it("does not count a requirement with verification:unverified even when annotated", () => {
    // --- spec tree ---
    const sd = path.join(projectDir, "doc", "specs");
    mkdirSync(sd, { recursive: true });

    // Root concept
    writeFileSync(
      path.join(sd, "index.md"),
      [
        "---",
        "id: C-COV",
        "type: concept",
        "title: Coverage Test Concept",
        "parent: null",
        "---",
        "",
        "# Coverage Test Concept",
        "",
      ].join("\n"),
    );

    // Requirement A — verification: automated (should count)
    const reqDir = path.join(sd, "requirements");
    mkdirSync(reqDir, { recursive: true });
    writeFileSync(
      path.join(reqDir, "req-auto.md"),
      [
        "---",
        "id: test-r-auto",
        "concept: C-COV",
        "type: requirement",
        "ears: The system shall do auto.",
        "pattern: ubiquitous",
        "verify: Observe output.",
        "verification: automated",
        "criticality: must",
        "origin_decision_ref: test#D-1",
        "status: active",
        "---",
        "",
        "Commentary.",
        "",
      ].join("\n"),
    );

    // Requirement B — verification: unverified (must NOT count even if annotated)
    writeFileSync(
      path.join(reqDir, "req-unverified.md"),
      [
        "---",
        "id: test-r-unverified",
        "concept: C-COV",
        "type: requirement",
        "ears: The system shall do unverified thing.",
        "pattern: ubiquitous",
        "verify: Observe output.",
        "verification: unverified",
        "criticality: must",
        "origin_decision_ref: test#D-1",
        "status: active",
        "---",
        "",
        "Commentary.",
        "",
      ].join("\n"),
    );

    // --- test file with @verifies for BOTH requirements ---
    const testDir = path.join(projectDir, "test");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      path.join(testDir, "stub.test.ts"),
      [
        "// @verifies test-r-auto",
        "// @verifies test-r-unverified",
        "// stub test file — annotations only, no real tests",
      ].join("\n"),
    );

    // --- build ---
    const r = run(["build"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);

    const cov = JSON.parse(
      readFileSync(
        path.join(sd, "_generated", "coverage.json"),
        "utf8",
      ),
    );

    // Top-level verified count: only TEST-R-AUTO qualifies (1 of 2)
    expect(cov.verified, `verified count was ${cov.verified as number}, expected 1 — TEST-R-UNVERIFIED must not be credited`).toBe(1);

    // Per-requirement: TEST-R-UNVERIFIED.verified must be false despite annotation
    const unvEntry = cov.by_requirement["test-r-unverified"] as { verified: boolean; tests: string[] };
    expect(unvEntry.tests.length, "annotation must still be recorded in .tests").toBeGreaterThan(0);
    expect(unvEntry.verified, "by_requirement.test-r-unverified.verified must be false").toBe(false);

    // Per-requirement: TEST-R-AUTO.verified must be true
    const autoEntry = cov.by_requirement["test-r-auto"] as { verified: boolean; tests: string[] };
    expect(autoEntry.verified, "by_requirement.test-r-auto.verified must be true").toBe(true);
  });
});
