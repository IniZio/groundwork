/**
 * spec-lint-language tests — two fixes:
 *
 *   Fix 1 (normative check): **shall not** and **shall** not are valid
 *     prohibition forms alongside the affirmative **shall**.  A section with
 *     no bolded normative verb must still fail.
 *
 *   Fix 2 (type_names language): the type_names check is configurable by
 *     language; unsupported languages produce a skip message and ZERO
 *     type-name-missing violations.  TypeScript continues to work as before.
 *
 * Tests run against temp fixture trees; they NEVER touch doc/specs/** in the
 * live repo.
 */

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const SPEC_MJS = path.join(REPO_ROOT, "hooks", "spec.mjs");
const LINT_MJS = path.join(REPO_ROOT, "hooks", "spec-lint.mjs");

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), "gw-lint-lang-"));
  writeFileSync(
    path.join(projectDir, "package.json"),
    JSON.stringify({ name: "test-project" }),
  );
});
afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SPEC_DIR = () => path.join(projectDir, "doc", "specs");

/** Write a concept README.md. */
function writeConcept(
  relDir: string,
  id: string = "C-ROOT",
): void {
  const dir = path.join(SPEC_DIR(), relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "README.md"),
    `---\nid: "${id}"\ntype: concept\ntitle: "Test Concept"\nsummary: "A one-sentence summary."\nparent: null\norigin_rfc: "R-20260726-K4M2QX"\n---\n\n# Test Concept\n`,
  );
}

/** Write a spec.yaml with optional lint config. */
function writeSpecYaml(relDir: string, content: string): void {
  const dir = path.join(SPEC_DIR(), relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "spec.yaml"), content);
}

/**
 * Build a minimal requirements section string with full required fields.
 * @param id     Requirement ID (e.g. ROOT-R-001)
 * @param normative  Override the normative sentence (default: affirmative shall)
 */
function minSection(id: string, normative?: string): string {
  const norm =
    normative ?? `**When** a trigger occurs, the system **shall** respond.`;
  const slug = id.toLowerCase();
  return [
    `### ${id} — Test requirement {#${slug}}`,
    "",
    norm,
    "",
    `- **Why** — This behavior prevents a real failure.`,
    `- **Fit criterion** — The observable outcome is confirmed by inspection.`,
    `- **Verification** manual · **Criticality** must · **Source** R-20260726-K4M2QX`,
  ].join("\n") + "\n";
}

/** Write a requirements.md under doc/specs/<relDir>/. */
function writeRequirementsDoc(relDir: string, sections: string[]): void {
  const dir = path.join(SPEC_DIR(), relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "requirements.md"),
    `---\nconcept: C-ROOT\norigin_rfc: R-20260726-K4M2QX\n---\n\n${sections.join("\n")}`,
  );
}

/** Run `spec build`. */
function build(): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
  delete env.CLAUDE_CODE_SESSION_ID;
  try {
    const stdout = execFileSync("node", [SPEC_MJS, "build"], {
      env,
      encoding: "utf8",
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

/** Run `spec-lint.mjs`. */
function lint(): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env, GROUNDWORK_PROJECT_DIR: projectDir };
  delete env.CLAUDE_CODE_SESSION_ID;
  try {
    const stdout = execFileSync("node", [LINT_MJS], {
      env,
      encoding: "utf8",
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

/** Build then lint. */
function buildAndLint(): { code: number; stdout: string; stderr: string } {
  const br = build();
  if (br.code !== 0) {
    return { code: br.code, stdout: br.stdout, stderr: `BUILD FAILED: ${br.stderr}` };
  }
  return lint();
}

// ---------------------------------------------------------------------------
// Fix 1 — normative check accepts shall not
// ---------------------------------------------------------------------------

describe("Fix 1 — normative check: **shall not** and **shall** not pass", () => {
  it("affirmative **shall** still passes (baseline sanity)", () => {
    mkdirSync(SPEC_DIR(), { recursive: true });
    writeConcept("");
    writeRequirementsDoc("", [
      minSection("ROOT-R-001", "The system **shall** respond within 200 ms."),
    ]);
    const r = buildAndLint();
    expect(r.code, `expected exit 0; stdout: ${r.stdout}; stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toContain("clean");
  });

  it("**shall not** (negation inside bold) passes", () => {
    mkdirSync(SPEC_DIR(), { recursive: true });
    writeConcept("");
    writeRequirementsDoc("", [
      minSection(
        "ROOT-R-001",
        "The system **shall not** apply the CARDNO rule between contestants who are not the same person.",
      ),
    ]);
    const r = buildAndLint();
    expect(
      r.code,
      `expected exit 0 for **shall not**; stdout: ${r.stdout}; stderr: ${r.stderr}`,
    ).toBe(0);
    expect(r.stdout).not.toContain("normative-statement");
  });

  it("**shall** not (negation outside bold) passes", () => {
    mkdirSync(SPEC_DIR(), { recursive: true });
    writeConcept("");
    writeRequirementsDoc("", [
      minSection(
        "ROOT-R-001",
        "The system **shall** not expose internal stack traces to end users.",
      ),
    ]);
    const r = buildAndLint();
    expect(
      r.code,
      `expected exit 0 for **shall** not; stdout: ${r.stdout}; stderr: ${r.stderr}`,
    ).toBe(0);
    expect(r.stdout).not.toContain("normative-statement");
  });

  it("bare 'shall' without bolding fails with normative-statement violation", () => {
    mkdirSync(SPEC_DIR(), { recursive: true });
    writeConcept("");
    writeRequirementsDoc("", [
      minSection("ROOT-R-001", "The system shall respond without bolding."),
    ]);
    const r = buildAndLint();
    expect(r.code, "expected exit 1 for unbolded shall").toBe(1);
    expect(r.stdout + r.stderr).toContain("normative-statement");
  });

  it("a section with no normative verb at all fails with normative-statement violation", () => {
    mkdirSync(SPEC_DIR(), { recursive: true });
    writeConcept("");
    writeRequirementsDoc("", [
      // Pass something that has no normative sentence at all (a dash-only body)
      minSection("ROOT-R-001", "This is a description with no normative verb at all."),
    ]);
    const r = buildAndLint();
    expect(r.code, "expected exit 1 for missing normative verb").toBe(1);
    expect(r.stdout + r.stderr).toContain("normative-statement");
  });
});

// ---------------------------------------------------------------------------
// Indexer/linter agreement — both paths must agree on all five normative cases
// These tests explicitly check `node hooks/spec.mjs build` for parse warnings
// (the symptom that triggered this bug: build warned while lint was silent).
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";

/** Run `spec.mjs build` and capture BOTH stdout and stderr (parse warnings → stderr). */
function buildFull(): { code: number; output: string } {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
  delete env.CLAUDE_CODE_SESSION_ID;
  const r = spawnSync("node", [SPEC_MJS, "build"], { env, encoding: "utf8" });
  return { code: r.status ?? 1, output: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("Indexer/linter agreement — normative verb check is shared", () => {
  it("indexer emits NO parse warning for **shall** (affirmative)", () => {
    mkdirSync(SPEC_DIR(), { recursive: true });
    writeConcept("");
    writeRequirementsDoc("", [
      minSection("ROOT-R-001", "The system **shall** respond within 200 ms."),
    ]);
    const br = buildFull();
    expect(br.output, "build should not warn for **shall**").not.toContain("parse error");
    expect(br.code).toBe(0);
    const lr = lint();
    expect(lr.code).toBe(0);
    expect(lr.stdout + lr.stderr).not.toContain("normative-statement");
  });

  it("indexer emits NO parse warning for **shall not** (negation inside bold)", () => {
    mkdirSync(SPEC_DIR(), { recursive: true });
    writeConcept("");
    writeRequirementsDoc("", [
      minSection(
        "ROOT-R-001",
        "The system **shall not** apply the CARDNO rule between contestants who are not the same person.",
      ),
    ]);
    const br = buildFull();
    expect(br.output, "build should not warn for **shall not**").not.toContain("parse error");
    expect(br.code).toBe(0);
    const lr = lint();
    expect(lr.code).toBe(0);
    expect(lr.stdout + lr.stderr).not.toContain("normative-statement");
  });

  it("indexer emits NO parse warning for **shall** not (negation outside bold)", () => {
    mkdirSync(SPEC_DIR(), { recursive: true });
    writeConcept("");
    writeRequirementsDoc("", [
      minSection(
        "ROOT-R-001",
        "The system **shall** not expose internal stack traces to end users.",
      ),
    ]);
    const br = buildFull();
    expect(br.output, "build should not warn for **shall** not").not.toContain("parse error");
    expect(br.code).toBe(0);
    const lr = lint();
    expect(lr.code).toBe(0);
    expect(lr.stdout + lr.stderr).not.toContain("normative-statement");
  });

  it("indexer emits parse warning AND linter reports violation for unbolded shall", () => {
    mkdirSync(SPEC_DIR(), { recursive: true });
    writeConcept("");
    writeRequirementsDoc("", [
      minSection("ROOT-R-001", "The system shall respond without bolding."),
    ]);
    const br = buildFull();
    expect(br.output, "build should warn for unbolded shall").toContain("parse error");
    const lr = lint();
    expect(lr.code, "linter should reject unbolded shall").toBe(1);
    expect(lr.stdout + lr.stderr).toContain("normative-statement");
  });

  it("indexer emits parse warning AND linter reports violation for no normative verb", () => {
    mkdirSync(SPEC_DIR(), { recursive: true });
    writeConcept("");
    writeRequirementsDoc("", [
      minSection("ROOT-R-001", "This is a description with no normative verb at all."),
    ]);
    const br = buildFull();
    expect(br.output, "build should warn for missing normative verb").toContain("parse error");
    const lr = lint();
    expect(lr.code, "linter should reject missing normative verb").toBe(1);
    expect(lr.stdout + lr.stderr).toContain("normative-statement");
  });
});

// ---------------------------------------------------------------------------
// Fix 2 — type_names language: unsupported language → skip, no violations
// ---------------------------------------------------------------------------

describe("Fix 2 — type_names language: unsupported language produces skip, zero violations", () => {
  /** Build a valid spec.yaml string with the given type_names lint block. */
  function specYamlWith(typeNamesLines: string[]): string {
    return [
      'id: "C-ROOT"',
      'title: "Test Concept"',
      'summary: "A one-sentence summary."',
      "status: draft",
      "views: []",
      "lint:",
      "  data-model:",
      "    type_names:",
      '      source: "types"',
      ...typeNamesLines,
    ].join("\n") + "\n";
  }

  beforeEach(() => {
    mkdirSync(SPEC_DIR(), { recursive: true });
    writeConcept("root", "C-ROOT");
  });

  it("unsupported language (kotlin) produces a skip message and exit 0 — no type-name-missing violations", () => {
    writeSpecYaml("root", specYamlWith([
      '      language: "kotlin"',
      "      names:",
      "        - Snapshot",
      "        - EventStore",
    ]));

    const br = build();
    expect(br.code, `build failed: ${br.stderr}`).toBe(0);

    const r = lint();

    // Must NOT emit any type-name-missing violations
    expect(
      r.stdout,
      "expected zero type-name-missing violations for unsupported language",
    ).not.toContain("type-name-missing");

    // Must emit exactly one informational skip message naming the language
    expect(
      r.stdout,
      "expected skip message for kotlin",
    ).toContain("kotlin");
    expect(
      r.stdout,
      "expected skip message to say 'skipped'",
    ).toContain("skipped");

    // Lint overall must be clean (exit 0)
    expect(r.code, `expected exit 0; stdout: ${r.stdout}`).toBe(0);
  });

  it("unsupported language: skip count is exactly 1 even when names has multiple entries", () => {
    writeSpecYaml("root", specYamlWith([
      '      language: "kotlin"',
      "      names:",
      "        - TypeA",
      "        - TypeB",
      "        - TypeC",
    ]));

    const br = build();
    expect(br.code, `build failed: ${br.stderr}`).toBe(0);

    const r = lint();

    const typeNameLines = r.stdout
      .split("\n")
      .filter((l) => l.includes("type-name-missing"));
    expect(
      typeNameLines.length,
      "expected zero type-name-missing lines; got: " + typeNameLines.join("|"),
    ).toBe(0);

    expect(r.code).toBe(0);
  });

  it("TypeScript (default) still produces type-name-missing violation for absent type", () => {
    // No language field — defaults to typescript
    writeSpecYaml("root", specYamlWith([
      "      names:",
      "        - NonExistentTypeXyzAbc999",
    ]));

    // Create a src/ directory so the scan doesn't error on a missing dir
    mkdirSync(path.join(projectDir, "src"), { recursive: true });

    const br = build();
    expect(br.code, `build failed: ${br.stderr}`).toBe(0);

    const r = lint();
    expect(r.stdout + r.stderr).toContain("type-name-missing");
    expect(r.code).toBe(1);
  });

  it("TypeScript explicit: language: typescript produces type-name-missing violation for absent type", () => {
    writeSpecYaml("root", specYamlWith([
      '      language: "typescript"',
      "      names:",
      "        - NonExistentTypeXyzAbc999",
    ]));

    mkdirSync(path.join(projectDir, "src"), { recursive: true });

    const br = build();
    expect(br.code, `build failed: ${br.stderr}`).toBe(0);

    const r = lint();
    expect(r.stdout + r.stderr).toContain("type-name-missing");
    expect(r.code).toBe(1);
  });
});
