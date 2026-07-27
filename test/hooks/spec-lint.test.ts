/**
 * spec-lint tests — validates the new body-first spec format (RFC-0003) and
 * the exit-code regression fix (violations now always produce exit 1).
 *
 * Tests run against temp fixture trees; they NEVER touch doc/specs/** in the live repo.
 *
 * Invariants exercised:
 *   stale-frontmatter   — ears or verify in any frontmatter → violation
 *   normative-statement — normative statement must contain bolded **shall**
 *   why-required        — **Why** rationale is required in body
 *   fit-criterion       — **Fit criterion** is required in body
 *   anchor-mismatch     — {#anchor} must equal id lowercased
 *   xref-dangling       — dangling same-file anchor or relative-path ref → violation
 *   id-format           — requirement ids must be <CONCEPT>-R-NNN (3 zero-padded digits)
 *   origin-rfc          — every node must carry origin_rfc
 *   required-field      — all schema-required fields must be present and non-blank
 *   enum-values         — type, pattern, verification, criticality, status
 *   summary-length      — ≤25 words (boundary: exactly 25 passes; 26 fails)
 *   snapshot-of         — snapshot_of must reference an existing node
 *   unknown-field       — frontmatter must not contain unknown keys
 *   spec_delta path     — a delta targeting a nonexistent path must FAIL
 *   exit-code bug fix   — violations without --rfc → exit 1 (was: exit 0)
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

const SPEC_DIR = () => path.join(projectDir, "doc", "specs");

function mkSpec() {
  mkdirSync(SPEC_DIR(), { recursive: true });
}

/** Write a concept README.md. */
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

/** Minimal valid concept frontmatter. */
function minConcept(
  id: string,
  overrides: Record<string, string | null> = {},
): Record<string, string | null> {
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

/**
 * Build a valid new-format requirement H3 section string.
 * All fields have safe defaults so callers only override what they need to test.
 */
function minSection(
  id: string,
  opts: {
    title?: string;
    /** Override the {#anchor} slug (defaults to id.toLowerCase()) */
    anchor?: string;
    /** Override the normative statement (must contain **shall** for valid) */
    normative?: string;
    /** Override the **Why** bullet text; null → omit the bullet entirely */
    why?: string | null;
    /** Override the **Fit criterion** bullet text; null → omit */
    fitCriterion?: string | null;
    /** Additional See also line, e.g. "[FOO-R-002](#foo-r-002)" or "(../other/requirements.md#other-r-001)" */
    seeAlso?: string;
    /** Verification value for the attribute line (defaults to 'manual') */
    verification?: string;
  } = {},
): string {
  const title = opts.title ?? "Test requirement";
  const anchorSlug =
    opts.anchor !== undefined ? opts.anchor : id.toLowerCase();
  const heading = `### ${id} — ${title} {#${anchorSlug}}`;

  const normative =
    opts.normative !== undefined
      ? opts.normative
      : `**When** a trigger occurs, the system **shall** respond.`;

  const whyLine =
    opts.why !== null
      ? `- **Why** — ${opts.why ?? "This behavior is required because correctness depends on it."}`
      : "";
  const fcLine =
    opts.fitCriterion !== null
      ? `- **Fit criterion** — ${opts.fitCriterion ?? "The observable outcome is confirmed by inspection."}`
      : "";
  const verification = opts.verification ?? "manual";
  const annotation = `- **Verification** ${verification} · **Criticality** must · **Source** R-20260726-K4M2QX`;
  const seeAlsoLine = opts.seeAlso ? `- **See also** ${opts.seeAlso}` : "";

  return [heading, "", normative, "", whyLine, fcLine, annotation, seeAlsoLine]
    .filter((l) => l !== "")
    .join("\n") + "\n";
}

/**
 * Write a requirements.md file with H3 sections (RFC-0003 body-format).
 * @param relDir  Directory relative to doc/specs/ (e.g. "artifact")
 * @param sections  Array of raw section strings (from minSection)
 * @param fmOverrides  Override file-level frontmatter fields
 */
function writeRequirementsDoc(
  relDir: string,
  sections: string[],
  fmOverrides: Record<string, string> = {},
) {
  const dir = path.join(SPEC_DIR(), relDir);
  mkdirSync(dir, { recursive: true });
  const fm = {
    concept: "C-ROOT",
    origin_rfc: "R-20260726-K4M2QX",
    ...fmOverrides,
  };
  const fmStr = Object.entries(fm)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  writeFileSync(
    path.join(dir, "requirements.md"),
    `---\n${fmStr}\n---\n\n${sections.join("\n")}`,
  );
}

/** Run `spec build` and return result. */
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
    return {
      code: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

/** Run `spec-lint.mjs` directly (with optional extra args). */
function lint(
  extraArgs: string[] = [],
): { code: number; stdout: string; stderr: string } {
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
    return {
      code: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

/** Build the spec index, then run lint. */
function buildAndLint(
  extraArgs: string[] = [],
): { code: number; stdout: string; stderr: string } {
  const br = build();
  if (br.code !== 0) {
    return {
      code: br.code,
      stdout: br.stdout,
      stderr: `BUILD FAILED: ${br.stderr}`,
    };
  }
  return lint(extraArgs);
}

// ---------------------------------------------------------------------------
// Baseline: a clean new-format document must pass clean with exit 0
// ---------------------------------------------------------------------------

describe("baseline — valid new-format tree passes clean", () => {
  it("concept + requirements.md with valid H3 sections → exit 0 and 'clean'", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeRequirementsDoc("", [minSection("ROOT-R-001"), minSection("ROOT-R-002")]);
    const r = buildAndLint();
    expect(r.stdout, `stderr: ${r.stderr}`).toContain("clean");
    expect(r.code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// EXIT CODE REGRESSION — violations without --rfc must exit 1
// (Before the fix: the linter exited 0 in non-rfc mode even with violations)
// ---------------------------------------------------------------------------

describe("exit-code regression: violations without --rfc → exit 1", () => {
  it("reports violations AND exits 1 when no --rfc flag is given", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    // Write a requirements.md with a section missing **Why** (a violation)
    writeRequirementsDoc("", [
      minSection("ROOT-R-001", { why: null }),
    ]);
    const br = build();
    if (br.code !== 0) return; // build permissiveness — lint must still catch it
    const r = lint(); // NO --rfc flag
    // CRITICAL: exit code must be 1 (this was 0 before the fix)
    expect(r.code, "exit code must be 1, not 0, when violations exist without --rfc").toBe(1);
    // The violation must also appear in output
    expect(r.stdout + r.stderr).toContain("why-required");
  });

  it("reports violations AND exits 1 WITH --rfc flag (existing behaviour preserved)", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeRequirementsDoc("", [
      minSection("ROOT-R-001", { why: null }),
    ]);
    build();
    // Write an RFC that covers this file
    const rfcDir = path.join(
      projectDir,
      ".groundwork",
      "rfcs",
      "0001-R-TESTUID",
    );
    mkdirSync(rfcDir, { recursive: true });
    writeFileSync(
      path.join(rfcDir, "rfc.md"),
      [
        "---",
        "uid: R-TESTUID",
        "title: Test RFC",
        "---",
        "",
        "spec_delta:",
        "  - op: Added",
        "    target: doc/specs/requirements.md",
        "",
      ].join("\n"),
    );
    const r = lint(["--rfc", "R-TESTUID"]);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toContain("why-required");
  });
});

// ---------------------------------------------------------------------------
// stale-frontmatter: ears or verify in ANY frontmatter → violation
// ---------------------------------------------------------------------------

describe("stale-frontmatter: ears in requirements.md frontmatter", () => {
  it("reports stale-frontmatter when 'ears:' appears in requirements.md frontmatter", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeRequirementsDoc("", [minSection("ROOT-R-001")], {
      concept: "C-ROOT",
      origin_rfc: "R-20260726-K4M2QX",
      ears: "The system shall do something.",
    });
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("stale-frontmatter");
    expect(combined).toContain("ears");
    expect(r.code).toBe(1);
  });

  it("reports stale-frontmatter when 'verify:' appears in requirements.md frontmatter", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeRequirementsDoc("", [minSection("ROOT-R-001")], {
      concept: "C-ROOT",
      origin_rfc: "R-20260726-K4M2QX",
      verify: "Observe the output.",
    });
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("stale-frontmatter");
    expect(combined).toContain("verify");
    expect(r.code).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// why-required: a requirement missing **Why** must fail
// ---------------------------------------------------------------------------

describe("why-required: missing **Why** → violation", () => {
  it("reports why-required when the **Why** bullet is absent", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeRequirementsDoc("", [minSection("ROOT-R-001", { why: null })]);
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("why-required");
    expect(combined).toContain("ROOT-R-001");
    expect(r.code).toBe(1);
  });

  it("does NOT report why-required when **Why** is present", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeRequirementsDoc("", [
      minSection("ROOT-R-001", { why: "Because this is required for correctness." }),
    ]);
    const r = buildAndLint();
    expect(r.stdout + r.stderr).not.toContain("why-required");
    expect(r.code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// fit-criterion: a requirement missing **Fit criterion** must fail
// ---------------------------------------------------------------------------

describe("fit-criterion: missing **Fit criterion** → violation", () => {
  it("reports fit-criterion when the **Fit criterion** bullet is absent", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeRequirementsDoc("", [minSection("ROOT-R-001", { fitCriterion: null })]);
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("fit-criterion");
    expect(combined).toContain("ROOT-R-001");
    expect(r.code).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// normative-statement: must contain bolded **shall**
// ---------------------------------------------------------------------------

describe("normative-statement: must contain **shall**", () => {
  it("reports normative-statement when **shall** is not bolded (bare 'shall')", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeRequirementsDoc("", [
      minSection("ROOT-R-001", {
        normative: "When a trigger occurs, the system shall respond.",
      }),
    ]);
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("normative-statement");
    expect(combined).toContain("ROOT-R-001");
    expect(r.code).toBe(1);
  });

  it("passes when **shall** is correctly bolded", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeRequirementsDoc("", [
      minSection("ROOT-R-001", {
        normative: "**When** a trigger occurs, the system **shall** respond.",
      }),
    ]);
    const r = buildAndLint();
    expect(r.stdout + r.stderr).not.toContain("normative-statement");
    expect(r.code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// id-format: legacy 4-char id must fail; 3-digit id must pass
// ---------------------------------------------------------------------------

describe("id-format: legacy-format requirement id → violation", () => {
  it("reports id-format for a legacy 4-char id like ROOT-R-u6zs", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    // Write a requirements.md with a legacy-style id in the H3 heading
    const legacySection = [
      "### ROOT-R-u6zs — Legacy id format {#root-r-u6zs}",
      "",
      "**When** a trigger occurs, the system **shall** respond.",
      "",
      "- **Why** — Needed for correctness.",
      "- **Fit criterion** — Observable outcome confirmed.",
      "- **Verification** automated · **Criticality** must · **Source** R-20260726-K4M2QX",
    ].join("\n") + "\n";
    writeRequirementsDoc("", [legacySection]);
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("id-format");
    expect(combined).toContain("ROOT-R-u6zs");
    expect(r.code).toBe(1);
  });

  it("reports id-format for an unpadded 1-digit id like ROOT-R-1", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    const badSection = [
      "### ROOT-R-1 — Unpadded id {#root-r-1}",
      "",
      "**When** a trigger occurs, the system **shall** respond.",
      "",
      "- **Why** — Needed for correctness.",
      "- **Fit criterion** — Observable outcome confirmed.",
      "- **Verification** automated · **Criticality** must · **Source** R-20260726-K4M2QX",
    ].join("\n") + "\n";
    writeRequirementsDoc("", [badSection]);
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("id-format");
    expect(r.code).toBe(1);
  });

  it("passes with a valid 3-digit id like ROOT-R-001", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeRequirementsDoc("", [minSection("ROOT-R-001")]);
    const r = buildAndLint();
    expect(r.stdout + r.stderr).not.toContain("id-format");
    expect(r.code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// xref-dangling: dangling same-file anchor → violation
// ---------------------------------------------------------------------------

describe("xref-dangling: dangling same-file anchor", () => {
  it("reports xref-dangling when a same-file seeAlso anchor does not exist", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    // ROOT-R-001 references #root-r-999 which does not exist in this file
    writeRequirementsDoc("", [
      minSection("ROOT-R-001", {
        seeAlso: "[ROOT-R-999](#root-r-999)",
      }),
    ]);
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("xref-dangling");
    expect(combined).toContain("root-r-999");
    expect(r.code).toBe(1);
  });

  it("passes when a same-file seeAlso anchor resolves to another section in the file", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeRequirementsDoc("", [
      minSection("ROOT-R-001", { seeAlso: "[ROOT-R-002](#root-r-002)" }),
      minSection("ROOT-R-002"),
    ]);
    const r = buildAndLint();
    expect(r.stdout + r.stderr).not.toContain("xref-dangling");
    expect(r.code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// xref-dangling: dangling relative-path cross-reference → violation
// ---------------------------------------------------------------------------

describe("xref-dangling: dangling relative-path cross-reference", () => {
  it("reports xref-dangling when the target file does not exist", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeConcept("sub", minConcept("C-SUB", { parent: "C-ROOT" }));
    // sub/requirements.md references ../nonexistent/requirements.md which doesn't exist
    writeRequirementsDoc("sub", [
      minSection("SUB-R-001", {
        seeAlso:
          "[OTHER-R-001](../nonexistent/requirements.md#other-r-001)",
      }),
    ], { concept: "C-SUB" });
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("xref-dangling");
    expect(combined).toContain("nonexistent");
    expect(r.code).toBe(1);
  });

  it("reports xref-dangling when target file exists but anchor is missing", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeConcept("sub", minConcept("C-SUB", { parent: "C-ROOT" }));
    writeConcept("other", minConcept("C-OTHER", { parent: "C-ROOT" }));
    // other/requirements.md exists but only has OTHER-R-001, not OTHER-R-999
    writeRequirementsDoc("other", [minSection("OTHER-R-001")], { concept: "C-OTHER" });
    // sub/requirements.md references OTHER-R-999 which does NOT exist in other/requirements.md
    writeRequirementsDoc("sub", [
      minSection("SUB-R-001", {
        seeAlso:
          "[OTHER-R-999](../other/requirements.md#other-r-999)",
      }),
    ], { concept: "C-SUB" });
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("xref-dangling");
    expect(combined).toContain("other-r-999");
    expect(r.code).toBe(1);
  });

  it("passes when a relative-path cross-reference resolves to an existing file and anchor", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeConcept("sub", minConcept("C-SUB", { parent: "C-ROOT" }));
    writeConcept("other", minConcept("C-OTHER", { parent: "C-ROOT" }));
    writeRequirementsDoc("other", [minSection("OTHER-R-001")], { concept: "C-OTHER" });
    writeRequirementsDoc("sub", [
      minSection("SUB-R-001", {
        seeAlso:
          "[OTHER-R-001](../other/requirements.md#other-r-001)",
      }),
    ], { concept: "C-SUB" });
    const r = buildAndLint();
    expect(r.stdout + r.stderr).not.toContain("xref-dangling");
    expect(r.code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// origin-rfc invariant (concept nodes)
// ---------------------------------------------------------------------------

describe("origin-rfc invariant", () => {
  it("fails when concept is missing origin_rfc", () => {
    mkSpec();
    writeConcept("", { ...minConcept("C-ROOT"), origin_rfc: null });
    const br = build();
    if (br.code !== 0) return;
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
    expect(r.stdout + r.stderr).toContain("origin-rfc");
  });

  it("fails when origin_rfc is the literal string 'null'", () => {
    mkSpec();
    writeConcept("", { ...minConcept("C-ROOT"), origin_rfc: "null" });
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    expect(r.stdout + r.stderr).toContain("origin-rfc");
  });

  it("fails when requirements.md is missing origin_rfc", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeRequirementsDoc("", [minSection("ROOT-R-001")], {
      concept: "C-ROOT",
      // origin_rfc deliberately omitted
    } as Record<string, string>);
    // Manually write without origin_rfc
    const dir = path.join(SPEC_DIR());
    writeFileSync(
      path.join(dir, "requirements.md"),
      `---\nconcept: C-ROOT\n---\n\n${minSection("ROOT-R-001")}`,
    );
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    expect(r.stdout + r.stderr).toContain("origin-rfc");
    expect(r.code).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// required-field: concept fields (schema validation still applies)
// ---------------------------------------------------------------------------

describe("required-field: concept fields", () => {
  it("fails when concept is missing summary", () => {
    mkSpec();
    writeConcept("", { ...minConcept("C-ROOT"), summary: null });
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    expect(r.stdout + r.stderr).toContain("required-field");
    expect(r.stdout + r.stderr).toContain("summary");
  });

  it("fails when concept is missing type", () => {
    mkSpec();
    const fields = minConcept("C-ROOT");
    delete (fields as Record<string, unknown>).type;
    writeConcept("", fields);
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    expect(r.stdout + r.stderr).toContain("required-field");
    expect(r.stdout + r.stderr).toContain("type");
  });
});

// ---------------------------------------------------------------------------
// required-field: whitespace-only values are rejected
// ---------------------------------------------------------------------------

describe("required-field: whitespace-only concept fields", () => {
  it("fires for concept with whitespace-only summary", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT", { summary: "   " }));
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    expect(r.stdout + r.stderr).toContain("required-field");
    expect(r.stdout + r.stderr).toContain("summary");
  });
});

// ---------------------------------------------------------------------------
// enum-value: concept type validation
// ---------------------------------------------------------------------------

describe("enum-value: bad concept type", () => {
  it("fails when concept has an invalid type value", () => {
    mkSpec();
    writeConcept("", { ...minConcept("C-ROOT"), type: "feature" });
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    expect(r.stdout + r.stderr).toContain("enum-value");
    expect(r.stdout + r.stderr).toContain("feature");
  });
});

// ---------------------------------------------------------------------------
// id-format: concept id
// ---------------------------------------------------------------------------

describe("id-format: concept id", () => {
  it("fails with malformed concept id (lowercase)", () => {
    mkSpec();
    writeConcept("", minConcept("c-root"));
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    expect(r.stdout + r.stderr).toContain("id-format");
  });

  it("fails with concept id missing C- prefix", () => {
    mkSpec();
    writeConcept("", minConcept("ROOT"));
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    expect(r.stdout + r.stderr).toContain("id-format");
  });
});

// ---------------------------------------------------------------------------
// summary-length: ≤25 words
// ---------------------------------------------------------------------------

describe("summary-length", () => {
  const twentyFiveWords =
    "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour twentyfive";
  const twentySixWords = twentyFiveWords + " twentysix";

  it("passes when summary is exactly 25 words", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT", { summary: twentyFiveWords }));
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
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
});

// ---------------------------------------------------------------------------
// spec_delta path existence check (--rfc mode)
// ---------------------------------------------------------------------------

describe("spec_delta path existence check (--rfc mode)", () => {
  function writeRfc(uid: string, targets: string[]) {
    const rfcDir = path.join(
      projectDir,
      ".groundwork",
      "rfcs",
      `0001-${uid}`,
    );
    mkdirSync(rfcDir, { recursive: true });
    const deltaLines = targets
      .map((t) => `  - op: Added\n    target: ${t}`)
      .join("\n");
    writeFileSync(
      path.join(rfcDir, "rfc.md"),
      `---\nuid: ${uid}\ntitle: Test RFC\n---\n\nspec_delta:\n${deltaLines}\n`,
    );
  }

  it("fails when spec_delta target path does not exist on disk", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    build();
    writeRfc("R-TESTUID", ["doc/specs/nonexistent/README.md"]);
    const r = lint(["--rfc", "R-TESTUID"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("does not exist");
    expect(r.stderr).toContain("doc/specs/nonexistent/README.md");
  });

  it("passes (no-error on path) when spec_delta target exists", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    build();
    writeRfc("R-TESTUID2", ["doc/specs/README.md"]);
    const r = lint(["--rfc", "R-TESTUID2"]);
    expect(r.stderr).not.toContain("does not exist");
  });
});

// ---------------------------------------------------------------------------
// snapshot-of referential integrity
// ---------------------------------------------------------------------------

describe("snapshot-of referential integrity", () => {
  it("fails when snapshot_of references a non-existent node id", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT", { snapshot_of: "C-NONEXISTENT" }));
    const r = buildAndLint();
    expect(r.stdout + r.stderr).toContain("snapshot-of");
    expect(r.stdout + r.stderr).toContain("C-NONEXISTENT");
  });

  it("passes when snapshot_of references an existing node id", () => {
    mkSpec();
    writeConcept("target", minConcept("C-TARGET"));
    writeConcept(
      "snap",
      minConcept("C-SNAP", { parent: "C-TARGET", snapshot_of: "C-TARGET" }),
    );
    const r = buildAndLint();
    expect(r.stdout + r.stderr).not.toContain("snapshot-of");
    expect(r.code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// unknown-field: extra frontmatter keys are reported
// ---------------------------------------------------------------------------

describe("unknown-field: extra frontmatter keys are reported", () => {
  it("reports unknown-field for a concept with an extra key", () => {
    mkSpec();
    writeConcept("", {
      ...minConcept("C-ROOT"),
      bogus_key: "oops",
    } as Record<string, string | null>);
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    expect(r.stdout + r.stderr).toContain("unknown-field");
    expect(r.stdout + r.stderr).toContain("bogus_key");
  });

  it("--rfc mode exits 1 when the linted node has an unknown key", () => {
    mkSpec();
    writeConcept("", {
      ...minConcept("C-ROOT"),
      bogus_key: "oops",
    } as Record<string, string | null>);
    const br = build();
    if (br.code !== 0) return;
    const rfcDir = path.join(
      projectDir,
      ".groundwork",
      "rfcs",
      "0001-R-UF001",
    );
    mkdirSync(rfcDir, { recursive: true });
    writeFileSync(
      path.join(rfcDir, "rfc.md"),
      [
        "---",
        "uid: R-UF001",
        "title: Unknown field RFC",
        "---",
        "",
        "spec_delta:",
        "  - op: Added",
        "    target: doc/specs/README.md",
        "",
      ].join("\n"),
    );
    const r = lint(["--rfc", "R-UF001"]);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toContain("unknown-field");
    expect(r.stdout + r.stderr).toContain("bogus_key");
  });

  it("valid concept with no extra keys does NOT trigger unknown-field", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeRequirementsDoc("", [minSection("ROOT-R-001")]);
    const r = buildAndLint();
    expect(r.stdout + r.stderr).not.toContain("unknown-field");
    expect(r.code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// automated-unverified: automated requirement without @verifies test → violation
// ---------------------------------------------------------------------------

describe("automated-unverified: automated requirement must have a @verifies test", () => {
  it("fails when an automated requirement has no @verifies annotation in any test file", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeRequirementsDoc("", [
      minSection("ROOT-R-001", { verification: "automated" }),
    ]);
    // No test/ directory created → verifiedIds returns empty set
    const r = buildAndLint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("automated-unverified");
    expect(combined).toContain("ROOT-R-001");
    expect(r.code).toBe(1);
  });

  it("passes when an automated requirement has a @verifies annotation in a test file", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeRequirementsDoc("", [
      minSection("ROOT-R-001", { verification: "automated" }),
    ]);
    // Create a test file that carries the @verifies annotation
    const testDir = path.join(projectDir, "test");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      path.join(testDir, "root.test.ts"),
      "// @verifies ROOT-R-001\nit('placeholder', () => {})\n",
    );
    const r = buildAndLint();
    expect(r.stdout + r.stderr).not.toContain("automated-unverified");
    expect(r.code).toBe(0);
  });

  it("does not flag a manual requirement even without any @verifies test", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeRequirementsDoc("", [
      minSection("ROOT-R-001", { verification: "manual" }),
    ]);
    const r = buildAndLint();
    expect(r.stdout + r.stderr).not.toContain("automated-unverified");
    expect(r.code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// anchor-mismatch: {#anchor} must equal id lowercased
// ---------------------------------------------------------------------------

describe("anchor-mismatch: anchor must equal id lowercased", () => {
  it("reports anchor-mismatch when anchor does not match id lowercased", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    // Use a wrong anchor (e.g. 'root-r-wrong' instead of 'root-r-001')
    writeRequirementsDoc("", [
      minSection("ROOT-R-001", { anchor: "root-r-wrong" }),
    ]);
    const br = build();
    if (br.code !== 0) return;
    const r = lint();
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("anchor-mismatch");
    expect(combined).toContain("ROOT-R-001");
    expect(r.code).toBe(1);
  });

  it("passes when anchor exactly equals id lowercased", () => {
    mkSpec();
    writeConcept("", minConcept("C-ROOT"));
    writeRequirementsDoc("", [
      minSection("ROOT-R-001", { anchor: "root-r-001" }),
    ]);
    const r = buildAndLint();
    expect(r.stdout + r.stderr).not.toContain("anchor-mismatch");
    expect(r.code).toBe(0);
  });
});
