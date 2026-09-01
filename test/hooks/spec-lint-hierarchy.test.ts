/**
 * spec-lint-hierarchy.test.ts — hierarchy invariants (D-22)
 *
 * Covers exactly-one-root, parent-resolves, no-cycles, parent-field-present.
 *
 * Isolation guarantee: every test creates its own mkdtempSync tree and sets
 * GROUNDWORK_PROJECT_DIR to that temp dir.  CLAUDE_PROJECT_DIR from the
 * ambient environment is overridden by GROUNDWORK_PROJECT_DIR (which takes
 * precedence in spec-lint.mjs's resolution chain), so tests never accidentally
 * assert against the real doc/specs tree.
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

const LINT_MJS = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "hooks",
  "spec-lint.mjs",
);

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), "gw-hier-"));
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

/**
 * Write a concept node.  `filename` defaults to "README.md".
 * Pass `fields` without a `parent` key to omit the parent field entirely
 * (triggering the parent-field-present invariant).
 */
function writeConcept(
  relDir: string,
  fields: Record<string, string | null | undefined>,
  filename = "README.md",
): void {
  const dir = path.join(SPEC_DIR(), relDir);
  mkdirSync(dir, { recursive: true });
  const fm = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v === null ? "null" : JSON.stringify(v)}`)
    .join("\n");
  const title = (fields.title as string) ?? "Test";
  writeFileSync(
    path.join(dir, filename),
    `---\n${fm}\n---\n\n# ${title}\n`,
  );
}

/** Run spec-lint.mjs directly against the temp project dir. */
function lint(): { code: number; stdout: string; stderr: string } {
  // GROUNDWORK_PROJECT_DIR takes priority over CLAUDE_PROJECT_DIR in spec-lint.mjs,
  // so setting it here overrides any ambient CLAUDE_PROJECT_DIR from the test runner.
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
    return {
      code: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

// ---------------------------------------------------------------------------
// Minimal valid tree helper — one root + one child
// ---------------------------------------------------------------------------

function writeValidTree(): void {
  mkSpec();
  // Root: parent: null
  writeConcept("", {
    id: "C-ROOT",
    type: "concept",
    title: "Root",
    summary: "The root concept.",
    parent: null,
  });
  // Child: parent resolves to C-ROOT
  writeConcept("child", {
    id: "C-CHILD",
    type: "concept",
    title: "Child",
    summary: "A child concept.",
    parent: "C-ROOT",
  }, "index.md");
}

// ---------------------------------------------------------------------------
// Invariant 1: exactly-one-root
// ---------------------------------------------------------------------------

describe("exactly-one-root — multiple roots (historical defect reproduction)", () => {
  it("RED: emits exactly-one-root when two concepts declare parent: null", () => {
    mkSpec();
    writeConcept("", {
      id: "C-ROOT",
      type: "concept",
      title: "Root",
      summary: "Root concept.",
      parent: null,
    });
    // Second root — reproduces the historical defect (e.g. C-VERIFICATION before T4)
    writeConcept("other", {
      id: "C-OTHER",
      type: "concept",
      title: "Other",
      summary: "Another root.",
      parent: null,
    }, "index.md");

    const r = lint();
    expect(r.code, `stdout: ${r.stdout}`).toBe(1);
    expect(r.stdout).toContain("exactly-one-root");
    expect(r.stdout).toContain("2 root concepts");
    expect(r.stdout).toMatch(/C-ROOT.*C-OTHER|C-OTHER.*C-ROOT/);
  });

  it("GREEN: passes clean when exactly one root", () => {
    writeValidTree();
    const r = lint();
    expect(r.code, `stdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toContain("clean");
  });
});

describe("exactly-one-root — zero roots", () => {
  it("RED: emits exactly-one-root when no concept declares parent: null", () => {
    mkSpec();
    // Both concepts declare a non-null parent; no root exists
    writeConcept("", {
      id: "C-A",
      type: "concept",
      title: "A",
      summary: "Concept A.",
      parent: "C-B",
    });
    writeConcept("child", {
      id: "C-B",
      type: "concept",
      title: "B",
      summary: "Concept B.",
      parent: "C-A",
    }, "index.md");

    const r = lint();
    expect(r.code, `stdout: ${r.stdout}`).toBe(1);
    expect(r.stdout).toContain("exactly-one-root");
    expect(r.stdout).toContain("no root concept");
  });
});

// ---------------------------------------------------------------------------
// Invariant 2: parent-resolves
// ---------------------------------------------------------------------------

describe("parent-resolves", () => {
  it("RED: emits parent-resolves when parent id does not exist", () => {
    mkSpec();
    writeConcept("", {
      id: "C-ROOT",
      type: "concept",
      title: "Root",
      summary: "Root.",
      parent: null,
    });
    writeConcept("child", {
      id: "C-CHILD",
      type: "concept",
      title: "Child",
      summary: "Child.",
      parent: "C-NONEXISTENT",
    }, "index.md");

    const r = lint();
    expect(r.code, `stdout: ${r.stdout}`).toBe(1);
    expect(r.stdout).toContain("parent-resolves");
    expect(r.stdout).toContain("C-CHILD");
    expect(r.stdout).toContain("C-NONEXISTENT");
  });

  it("GREEN: passes clean when parent resolves to a known concept", () => {
    writeValidTree();
    const r = lint();
    expect(r.code, `stdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toContain("clean");
  });
});

// ---------------------------------------------------------------------------
// Invariant 3: no-cycles
// ---------------------------------------------------------------------------

describe("no-cycles", () => {
  it("RED: emits no-cycles when concepts form a parent cycle", () => {
    mkSpec();
    writeConcept("", {
      id: "C-ROOT",
      type: "concept",
      title: "Root",
      summary: "Root.",
      parent: null,
    });
    // C-A → C-B → C-A  (cycle)
    writeConcept("a", {
      id: "C-A",
      type: "concept",
      title: "A",
      summary: "A.",
      parent: "C-B",
    }, "index.md");
    writeConcept("b", {
      id: "C-B",
      type: "concept",
      title: "B",
      summary: "B.",
      parent: "C-A",
    }, "index.md");

    const r = lint();
    expect(r.code, `stdout: ${r.stdout}`).toBe(1);
    expect(r.stdout).toContain("no-cycles");
  });

  it("GREEN: passes clean on a linear tree with no cycles", () => {
    writeValidTree();
    const r = lint();
    expect(r.code, `stdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toContain("clean");
  });
});

// ---------------------------------------------------------------------------
// Invariant 4: parent-field-present
// ---------------------------------------------------------------------------

describe("parent-field-present", () => {
  it("RED: emits parent-field-present when concept has no parent field at all", () => {
    mkSpec();
    // Root has explicit parent: null — valid
    writeConcept("", {
      id: "C-ROOT",
      type: "concept",
      title: "Root",
      summary: "Root.",
      parent: null,
    });
    // Child has NO parent field (undefined → omitted from YAML)
    writeConcept("child", {
      id: "C-CHILD",
      type: "concept",
      title: "Child",
      summary: "Child.",
      parent: undefined, // omitted from frontmatter
    }, "index.md");

    const r = lint();
    expect(r.code, `stdout: ${r.stdout}`).toBe(1);
    expect(r.stdout).toContain("parent-field-present");
    expect(r.stdout).toContain("C-CHILD");
  });

  it("GREEN: concept with explicit parent: null does NOT trigger parent-field-present", () => {
    mkSpec();
    // Single root with explicit parent: null
    writeConcept("", {
      id: "C-ROOT",
      type: "concept",
      title: "Root",
      summary: "Root.",
      parent: null,
    });

    const r = lint();
    // May or may not be 0 depending on other invariants, but must not contain parent-field-present
    expect(r.stdout).not.toContain("parent-field-present");
  });
});
