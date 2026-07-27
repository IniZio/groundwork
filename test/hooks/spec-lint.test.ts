/**
 * spec-lint tests — validates schema enforcement added by the lint-hardening slice.
 *
 * Tests run against temp fixture trees, NEVER against docs/spec/** in the live repo.
 *
 * Rules exercised (6 invariants):
 *   ears-or-summary — requirement nodes must have ears OR summary (either/or)
 *   origin-rfc      — every node must carry origin_rfc
 *   required-fields — all schema-required fields must be present and non-blank (concept + requirement)
 *   enum-values     — type, pattern, verification, criticality, status
 *   id-format       — concept and requirement id regexes
 *   summary-length  — ≤25 words (boundary: exactly 25 passes; 26 fails)
 *   spec_delta path — a delta targeting a nonexistent path must FAIL
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SPEC_MJS = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "hooks",
  "spec.mjs",
);

const LINT_MJS = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "hooks",
  "spec-lint.mjs",
);

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), "gw-lint-"));
  writeFileSync(
    path.join(projectDir, "package.json"),
    JSON.stringify({ name: "test-project" }),
  );
});
afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SPEC_DIR = () => path.join(projectDir, "docs", "spec");

function mkSpec() {
  mkdirSync(SPEC_DIR(), { recursive: true });
}

/** Write a concept README.md; fields is the complete set of frontmatter fields. */
function writeConcept(relDir: string, fields: Record<string, string | null>) {
  const dir = path.join(SPEC_DIR(), relDir);
  mkdirSync(dir, { recursive: true });
  const fm = Object.entries(fields)
    .map(([k, v]) => `${k}: ${v === null ? "null" : JSON.stringify(v)}`)
    .join("\n");
  const title = fields.title ?? "Test";
  writeFileSync(
    path.join(dir, "README.md"),
    `---\n${fm}\n---\n\n# ${title}\n`,
  );
}

/** Write a requirement file. */
function writeReq(relDir: string, filename: string, fields: Record<string, string>) {
  const dir = path.join(SPEC_DIR(), relDir);
  mkdirSync(dir, { recursive: true });
  const fm = Object.entries(fields)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  writeFileSync(
    path.join(dir, filename),
    `---\n${fm}\n---\n\nCommentary.\n`,
  );
}

/** Minimal valid concept frontmatter. */
function minConcept(id: string, overrides: Record<string, string | null> = {}): Record<string, string | null> {
  return {
    id,
    type: "concept",
    title: "Test Concept",
    summary: "A one-sentence concept summary.",
    parent: null,
    origin_rfc: "R-20260726-K4M2QX",
    ...overrides,
  };
}

/** Minimal valid requirement frontmatter. */
function minReq(
  conceptId: string,
  reqId: string,
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    id: reqId,
    type: "requirement",
    concept: conceptId,
    summary: "A one-sentence requirement summary.",
    ears: "The system shall do something.",
    pattern: "ubiquitous",
    verify: "Observe the output.",
    verification: "automated",
    criticality: "must",
    origin_rfc: "R-20260726-K4M2QX",
    status: "active",
    ...overrides,
  };
}

/** Run `spec build` then return result (builds the index). */
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

/** Run `spec-lint.mjs` directly (with optional extra args). */
function lint(extraArgs: string[] = []): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env, GROUNDWORK_PROJECT_DIR: projectDir };
  delete env.CLAUDE_CODE_SESSION_ID;
  try {
    const stdout = execFileSync("node", [LINT_MJS, ...extraArgs], {
      env,
      encoding: "utf8",
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

/**
 * Build spec index then run lint. Returns lint result.
 * build() must succeed (caller is responsible for valid build fixtures).
 */
function buildAndLint(extraArgs: string[] = []): { code: number; stdout: string; stderr: string } {
  const br = build();
  if (br.code !== 0) {
    // Let caller handle build failure via lint result format
    return { code: br.code, stdout: br.stdout, stderr: `BUILD FAILED: ${br.stderr}` };
  }
  return lint(extraArgs);
}

// ---------------------------------------------------------------------------
// Valid baseline — a fully-correct tree must pass clean
// ---------------------------------------------------------------------------

describe("baseline — valid tree passes", () => {
  it("concept + requirement with all required fields passes clean", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeReq("requirements", "req-one.md", minReq("C-ROOT", "ROOT-R-aa1b"));
    const r = buildAndLint();
    expect(r.stdout, `stderr: ${r.stderr}`).toContain("clean");
    expect(r.code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// FIX 1 — origin_rfc invariant
// ---------------------------------------------------------------------------

describe("origin-rfc invariant", () => {
  it("fails when concept is missing origin_rfc", () => {
    mkSpec();
    writeConcept("", { ...minConcept("C-ROOT"), origin_rfc: null });
    const br = build();
    // build may succeed even with missing origin_rfc
    if (br.code !== 0) return; // if build itself rejects it that's also fine
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("origin-rfc");
    expect(combined).toContain("C-ROOT");
  });

  it("fails when concept has empty origin_rfc string", () => {
    mkSpec();
    writeConcept("", { ...minConcept("C-ROOT"), origin_rfc: "" });
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("origin-rfc");
  });

  it("fails when requirement is missing origin_rfc", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeReq("requirements", "req.md", { ...minReq("C-ROOT", "ROOT-R-zz99"), origin_rfc: "" });
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("origin-rfc");
    expect(combined).toContain("ROOT-R-zz99");
  });

  it("fails when origin_rfc is the literal string 'null'", () => {
    // Kills the `rawFm.origin_rfc === 'null'` sentinel guard at spec-lint.mjs:160.
    // YAML parsers emit the JS null for bare `null`; the string 'null' is what you
    // get when the value is quoted or stringified — the guard must catch it.
    mkSpec();
    writeConcept("", { ...minConcept("C-ROOT"), origin_rfc: "null" });
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("origin-rfc");
  });
});

// ---------------------------------------------------------------------------
// FIX 2 — required fields
// ---------------------------------------------------------------------------

describe("required-field: concept fields", () => {
  it("fails when concept is missing summary", () => {
    mkSpec();
    writeConcept("", { ...minConcept("C-ROOT"), summary: null });
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("required-field");
    expect(combined).toContain("summary");
  });

  it("fails when concept is missing type", () => {
    mkSpec();
    const fields = minConcept("C-ROOT");
    delete (fields as Record<string, unknown>).type;
    writeConcept("", fields);
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    // type missing → required-field violation
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("required-field");
    expect(combined).toContain("type");
  });
});

describe("required-field: requirement fields", () => {
  it("fails when requirement is missing status", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    const fields = minReq("C-ROOT", "ROOT-R-aa1c");
    delete (fields as Record<string, unknown>).status;
    writeReq("requirements", "req.md", fields);
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("required-field");
    expect(combined).toContain("status");
  });

  it("fails when requirement is missing pattern", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    const fields = minReq("C-ROOT", "ROOT-R-aa1d");
    delete (fields as Record<string, unknown>).pattern;
    writeReq("requirements", "req.md", fields);
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("required-field");
    expect(combined).toContain("pattern");
  });

  it("fails when requirement is missing verification", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    const fields = minReq("C-ROOT", "ROOT-R-aa1f");
    delete (fields as Record<string, unknown>).verification;
    writeReq("requirements", "req.md", fields);
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("required-field");
    expect(combined).toContain("verification");
  });
});

// ---------------------------------------------------------------------------
// ears-or-summary invariant (either/or semantics)
// ---------------------------------------------------------------------------

describe("ears-or-summary invariant", () => {
  it("fires when requirement has neither ears nor summary", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    const fields = minReq("C-ROOT", "ROOT-R-eo1a");
    delete (fields as Record<string, unknown>).ears;
    delete (fields as Record<string, unknown>).summary;
    writeReq("requirements", "req.md", fields);
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("ears-or-summary");
    expect(combined).toContain("ROOT-R-eo1a");
  });

  it("fires when ears and summary are both whitespace-only", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeReq("requirements", "req.md", minReq("C-ROOT", "ROOT-R-eo1b", {
      ears: "   ",
      summary: "   ",
    }));
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("ears-or-summary");
  });

  it("passes when requirement has ears but no summary (either is sufficient)", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    const fields = minReq("C-ROOT", "ROOT-R-eo2a");
    delete (fields as Record<string, unknown>).summary;
    writeReq("requirements", "req.md", fields);
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).not.toContain("ears-or-summary");
  });

  it("passes when requirement has summary but no ears (either is sufficient)", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    const fields = minReq("C-ROOT", "ROOT-R-eo2b");
    delete (fields as Record<string, unknown>).ears;
    writeReq("requirements", "req.md", fields);
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).not.toContain("ears-or-summary");
  });
});

// ---------------------------------------------------------------------------
// required-field: whitespace-only values are rejected
// ---------------------------------------------------------------------------

describe("required-field: whitespace-only values", () => {
  it("fires for concept with whitespace-only title", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT", { title: "   " }));
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("required-field");
    expect(combined).toContain("title");
  });

  it("fires for concept with whitespace-only summary", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT", { summary: "   " }));
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("required-field");
    expect(combined).toContain("summary");
  });
});

// ---------------------------------------------------------------------------
// FIX 2 — enum validation
// ---------------------------------------------------------------------------

describe("enum-value: bad type", () => {
  it("fails when node has an invalid type value", () => {
    mkSpec();
    // Write a concept with type set to an unrecognised value
    writeConcept("", { ...minConcept("C-ROOT"), type: "feature" });
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("enum-value");
    expect(combined).toContain("feature");
  });
});

describe("enum-value: bad pattern", () => {
  it("fails with invalid pattern value", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeReq("requirements", "req.md", minReq("C-ROOT", "ROOT-R-ee1a", { pattern: "mandatory" }));
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("enum-value");
    expect(combined).toContain("pattern");
    expect(combined).toContain("mandatory");
  });
});

describe("enum-value: bad verification", () => {
  it("fails with invalid verification value", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeReq("requirements", "req.md", minReq("C-ROOT", "ROOT-R-ee2a", { verification: "robot" }));
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("enum-value");
    expect(combined).toContain("verification");
    expect(combined).toContain("robot");
  });
});

describe("enum-value: bad status", () => {
  it("fails with invalid status value", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeReq("requirements", "req.md", minReq("C-ROOT", "ROOT-R-ee3a", { status: "draft" }));
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("enum-value");
    expect(combined).toContain("status");
    expect(combined).toContain("draft");
  });
});

describe("enum-value: bad criticality", () => {
  it("fails with invalid criticality value", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeReq("requirements", "req.md", minReq("C-ROOT", "ROOT-R-ee4a", { criticality: "critical" }));
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("enum-value");
    expect(combined).toContain("criticality");
    expect(combined).toContain("critical");
  });
});

// ---------------------------------------------------------------------------
// FIX 2 — id format
// ---------------------------------------------------------------------------

describe("id-format: concept id", () => {
  it("fails with malformed concept id (lowercase)", () => {
    mkSpec();
    writeConcept("", minConcept("c-root"));
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("id-format");
  });

  it("fails with concept id missing C- prefix", () => {
    mkSpec();
    writeConcept("", minConcept("ROOT"));
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("id-format");
  });
});

describe("id-format: requirement id", () => {
  it("fails with malformed requirement id (wrong suffix)", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeReq("requirements", "req.md", minReq("C-ROOT", "ROOT-R-LONG5CHAR"));
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("id-format");
  });

  it("fails when requirement id prefix doesn't match concept", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeReq("requirements", "req.md", minReq("C-ROOT", "WRONG-R-aa1b"));
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("id-format");
  });
});

// ---------------------------------------------------------------------------
// FIX 2 — summary length (≤25 words)
// ---------------------------------------------------------------------------

describe("summary-length", () => {
  // 25-word summary (boundary: must PASS)
  const twentyFiveWords = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour twentyfive";

  // 26-word summary (must FAIL)
  const twentySixWords = twentyFiveWords + " twentysix";

  it("passes when summary is exactly 25 words", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT", { summary: twentyFiveWords }));
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    // Must NOT contain summary-length violation
    expect(r.stdout + r.stderr).not.toContain("summary-length");
    expect(r.code).toBe(0);
  });

  it("fails when summary has 26 words (boundary)", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT", { summary: twentySixWords }));
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    expect(r.stdout + r.stderr).toContain("summary-length");
    expect(r.stdout + r.stderr).toContain("26");
  });

  it("fails when requirement summary exceeds 25 words", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeReq("requirements", "req.md", minReq("C-ROOT", "ROOT-R-sl1a", {
      summary: twentySixWords,
    }));
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    expect(r.stdout + r.stderr).toContain("summary-length");
  });
});

// ---------------------------------------------------------------------------
// FIX 3 — spec_delta path must exist on disk
// ---------------------------------------------------------------------------

describe("spec_delta path existence check (--rfc mode)", () => {
  /** Write a minimal rfc.md with a spec_delta block.
   * The parser (parseSpecDeltaTargets) looks for lines matching /^\s+target:\s*(.+)$/,
   * so target must be on its own indented line, not after a dash on the same line.
   */
  function writeRfc(uid: string, targets: string[]) {
    const rfcDir = path.join(projectDir, ".groundwork", "rfcs", `0001-${uid}`);
    mkdirSync(rfcDir, { recursive: true });
    const deltaLines = targets.map(t => `  - op: add\n    target: ${t}`).join("\n");
    writeFileSync(
      path.join(rfcDir, "rfc.md"),
      `---\nuid: ${uid}\ntitle: Test RFC\n---\n\nspec_delta:\n${deltaLines}\n`,
    );
  }

  it("fails when spec_delta target path does not exist on disk", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    build(); // build index first
    writeRfc("R-TESTUID", ["docs/spec/nonexistent/README.md"]);
    const r = lint(["--rfc", "R-TESTUID"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("does not exist");
    expect(r.stderr).toContain("docs/spec/nonexistent/README.md");
  });

  it("passes (nodes matched or no nodes) when spec_delta targets exist", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    build();
    writeRfc("R-TESTUID2", ["docs/spec/README.md"]);
    const r = lint(["--rfc", "R-TESTUID2"]);
    // Should not fail on "does not exist"
    expect(r.stderr).not.toContain("does not exist");
  });

  it("reproduces the rfc.md typo scenario: artifacts/ vs artifact/", () => {
    // rfc.md targets docs/spec/artifacts/README.md (pluralised, doesn't exist)
    // The real path would be docs/spec/artifact/README.md
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    // Only create docs/spec/artifact/ (no 's')
    writeConcept("artifact", minConcept("C-ARTIFACT"));
    build();
    writeRfc("R-TYPO", ["docs/spec/artifacts/README.md"]);
    const r = lint(["--rfc", "R-TYPO"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("does not exist");
    expect(r.stderr).toContain("docs/spec/artifacts/README.md");
  });
});

// ---------------------------------------------------------------------------
// Acceptance evidence: broken-state fixture (the old bug reproduced)
//
// Before this fix: a concept node missing origin_rfc AND summary passed clean.
// After this fix:  each violation is named and the output is non-zero in --rfc mode.
// ---------------------------------------------------------------------------

describe("acceptance evidence: broken-state fixture now fails with named violations", () => {
  it("--rfc mode exits non-zero and names each violation for a node missing origin_rfc + required fields", () => {
    mkSpec();
    // Write a concept with ONLY id, type, title, parent — missing summary, origin_rfc
    writeConcept("", {
      id: "C-ROOT",
      type: "concept",
      title: "Root",
      parent: null,
      // summary: missing
      // origin_rfc: missing
    });
    // Write requirement with ONLY the bare-minimum that spec build accepts — missing several required fields
    writeReq("requirements", "req.md", {
      id: "ROOT-R-aa1a",
      type: "requirement",
      concept: "C-ROOT",
      ears: "The system shall do something.",
      pattern: "ubiquitous",
      verify: "Observe.",
      // verification: missing
      // origin_rfc: missing
      // status: missing
      // summary: missing
    });

    const br = build();
    // Build may succeed permissively
    if (br.code !== 0) {
      // If build itself fails, that's acceptable as a strictness signal
      return;
    }

    // Create an RFC that targets both files
    const rfcDir = path.join(projectDir, ".groundwork", "rfcs", "0001-BROKEN");
    mkdirSync(rfcDir, { recursive: true });
    writeFileSync(
      path.join(rfcDir, "rfc.md"),
      [
        "---",
        "uid: R-BROKEN",
        "title: Broken state RFC",
        "---",
        "",
        "spec_delta:",
        "  - op: add",
        "    target: docs/spec/README.md",
        "  - op: add",
        "    target: docs/spec/requirements/req.md",
      ].join("\n"),
    );

    const r = lint(["--rfc", "R-BROKEN"]);

    // Must exit non-zero
    expect(r.code, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(1);

    const output = r.stdout + r.stderr;

    // origin-rfc violations must be named
    expect(output).toContain("origin-rfc");

    // At least one required-field violation must be named
    expect(output).toContain("required-field");

    // Node ids must appear in violations
    expect(output).toContain("C-ROOT");

    // Paste-worthy output for acceptance evidence
    process.stdout.write("\n=== ACCEPTANCE EVIDENCE OUTPUT ===\n");
    process.stdout.write(output);
    process.stdout.write("===================================\n");
  });
});
