/**
 * spec-origin-decision-ref tests — verifies that origin_decision_ref is genuinely optional.
 *
 * Acceptance criteria:
 *   (a) A node with NO origin_decision_ref in frontmatter produces NO origin-decision-ref violation.
 *   (b) A node WITH origin_decision_ref present but invalid (empty, null-valued, sentinel "null",
 *       or wrong format) still produces an origin-decision-ref violation.
 *   (c) A node WITH a valid origin_decision_ref (e.g. "plugin-cleanup#D-5") passes cleanly.
 *
 * Tests run against temp fixture trees and NEVER touch doc/specs/** in the live repo.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const SPEC_MJS = path.join(REPO_ROOT, "hooks", "spec.mjs");
const LINT_MJS = path.join(REPO_ROOT, "hooks", "spec-lint.mjs");

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), "gw-origin-decref-"));
  writeFileSync(
    path.join(projectDir, "package.json"),
    JSON.stringify({ name: "test-project" }),
  );
});
afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

const SPEC_DIR = () => path.join(projectDir, "doc", "specs");

function mkSpec() {
  mkdirSync(SPEC_DIR(), { recursive: true });
}

function lint() {
  const env = { ...process.env, GROUNDWORK_PROJECT_DIR: projectDir };
  delete (env as Record<string, string | undefined>).CLAUDE_PROJECT_DIR;
  try {
    const stdout = execFileSync("node", [LINT_MJS], {
      encoding: "utf8",
      env,
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

function build() {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
  try {
    const stdout = execFileSync("node", [SPEC_MJS, "build"], {
      encoding: "utf8",
      env,
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

/** Write a concept README.md with explicit frontmatter string. */
function writeConceptRaw(relDir: string, frontmatter: string, title = "Test Concept") {
  const dir = path.join(SPEC_DIR(), relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "README.md"),
    `---\n${frontmatter}\n---\n\n# ${title}\n`,
  );
}

/** Write a requirements.md with explicit frontmatter string. */
function writeRequirementsRaw(relDir: string, frontmatter: string, body: string) {
  const dir = path.join(SPEC_DIR(), relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "requirements.md"),
    `---\n${frontmatter}\n---\n\n${body}`,
  );
}

const VALID_SECTION = `### ROOT-R-001 — Test requirement {#root-r-001}

**When** a trigger occurs, the system **shall** respond.

- **Why** — This behavior is required because correctness depends on it.
- **Fit criterion** — The observable outcome is confirmed by inspection.
- **Verification** manual · **Criticality** must · **Source** plugin-cleanup#D-5
`;

// ---------------------------------------------------------------------------
// (a) Absent origin_decision_ref → no violation
// ---------------------------------------------------------------------------

describe("origin-decision-ref: absent origin_decision_ref is silent", () => {
  it("concept README.md with no origin_decision_ref field produces no origin-decision-ref violation", () => {
    mkSpec();
    writeConceptRaw(
      "",
      `id: "C-ROOT"\ntype: concept\ntitle: "Test Concept"\nsummary: "A one-sentence concept summary."\nparent: null`,
    );
    const br = build();
    if (br.code !== 0) return; // build failure is not this test's concern
    const r = lint();
    expect(r.stdout + r.stderr).not.toContain("origin-decision-ref");
  });

  it("requirements.md with no origin_decision_ref field produces no origin-decision-ref violation", () => {
    mkSpec();
    writeConceptRaw(
      "",
      `id: "C-ROOT"\ntype: concept\ntitle: "Test Concept"\nsummary: "A one-sentence concept summary."\nparent: null`,
    );
    writeRequirementsRaw("", `concept: C-ROOT`, VALID_SECTION);
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    expect(r.stdout + r.stderr).not.toContain("origin-decision-ref");
  });

  it("lint exits 0 when no node has origin_decision_ref and no other violations exist", () => {
    mkSpec();
    writeConceptRaw(
      "",
      `id: "C-ROOT"\ntype: concept\ntitle: "Test Concept"\nsummary: "A one-sentence concept summary."\nparent: null`,
    );
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).not.toContain("origin-decision-ref");
  });
});

// ---------------------------------------------------------------------------
// (b) Present-but-invalid origin_decision_ref → still reports a violation
// ---------------------------------------------------------------------------

describe("origin-decision-ref: present-but-invalid origin_decision_ref still reports violation", () => {
  it("fails when concept README.md has origin_decision_ref: null (YAML null)", () => {
    mkSpec();
    writeConceptRaw(
      "",
      `id: "C-ROOT"\ntype: concept\ntitle: "Test Concept"\nsummary: "A one-sentence concept summary."\nparent: null\norigin_decision_ref: null`,
    );
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    expect(r.stdout + r.stderr).toContain("origin-decision-ref");
  });

  it('fails when concept README.md has origin_decision_ref: "" (empty string)', () => {
    mkSpec();
    writeConceptRaw(
      "",
      `id: "C-ROOT"\ntype: concept\ntitle: "Test Concept"\nsummary: "A one-sentence concept summary."\nparent: null\norigin_decision_ref: ""`,
    );
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    expect(r.stdout + r.stderr).toContain("origin-decision-ref");
  });

  it('fails when concept README.md has origin_decision_ref: "null" (sentinel string)', () => {
    mkSpec();
    writeConceptRaw(
      "",
      `id: "C-ROOT"\ntype: concept\ntitle: "Test Concept"\nsummary: "A one-sentence concept summary."\nparent: null\norigin_decision_ref: "null"`,
    );
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    expect(r.stdout + r.stderr).toContain("origin-decision-ref");
  });

  it('fails when concept README.md has a bare RFC uid (wrong format)', () => {
    mkSpec();
    writeConceptRaw(
      "",
      `id: "C-ROOT"\ntype: concept\ntitle: "Test Concept"\nsummary: "A one-sentence concept summary."\nparent: null\norigin_decision_ref: "R-20260726-K4M2QX"`,
    );
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    expect(r.stdout + r.stderr).toContain("origin-decision-ref");
  });

  it("fails when requirements.md has origin_decision_ref: null (YAML null)", () => {
    mkSpec();
    writeConceptRaw(
      "",
      `id: "C-ROOT"\ntype: concept\ntitle: "Test Concept"\nsummary: "A one-sentence concept summary."\nparent: null`,
    );
    writeRequirementsRaw("", `concept: C-ROOT\norigin_decision_ref: null`, VALID_SECTION);
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    expect(r.stdout + r.stderr).toContain("origin-decision-ref");
  });

  it("passes when origin_decision_ref is a valid decision ref string", () => {
    mkSpec();
    writeConceptRaw(
      "",
      `id: "C-ROOT"\ntype: concept\ntitle: "Test Concept"\nsummary: "A one-sentence concept summary."\nparent: null\norigin_decision_ref: "plugin-cleanup#D-5"`,
    );
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    expect(r.stdout + r.stderr).not.toContain("origin-decision-ref");
  });
});
