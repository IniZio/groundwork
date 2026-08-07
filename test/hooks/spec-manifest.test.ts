/**
 * spec-manifest tests — S0 (spec-io/schema-io API) and S1 (spec-lint manifest invariants).
 *
 * S0 tests invoke spec-io/schema-io functions via Node.js ESM child processes
 * to avoid vite-node/createRequire compatibility uncertainty.
 * S1 tests spawn spec-lint against temp fixture trees, following the pattern
 * established in test/hooks/spec-lint.test.ts.
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

// ─── Paths ───────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const SPEC_MJS = path.join(REPO_ROOT, "hooks", "spec.mjs");
const LINT_MJS = path.join(REPO_ROOT, "hooks", "spec-lint.mjs");
const SPEC_IO = path.join(REPO_ROOT, "hooks", "lib", "spec-io.mjs");
const SCHEMA_IO = path.join(REPO_ROOT, "hooks", "lib", "schema-io.mjs");
const LIVE_SPEC_DIR = path.join(REPO_ROOT, "doc", "specs");

// ─── Process helpers ─────────────────────────────────────────────────────────

/** Run a snippet of ESM code in a fresh Node.js process via stdin. */
function runEsmScript(code: string): {
  code: number;
  stdout: string;
  stderr: string;
} {
  try {
    const stdout = execFileSync("node", ["--input-type=module"], {
      input: code,
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

/** Spawn `spec.mjs build` against a project dir. */
function build(projectDir: string): {
  code: number;
  stdout: string;
  stderr: string;
} {
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
      stderr: `BUILD FAILED: ${err.stderr ?? ""}`,
    };
  }
}

/** Spawn `spec-lint.mjs` against a project dir. */
function lint(
  projectDir: string,
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

// ─── Fixture helpers ─────────────────────────────────────────────────────────

/**
 * Write a minimal concept README.md under `projectDir/doc/specs/<relDir>/`.
 * Values that are `null` are serialised as bare YAML null.
 */
function writeConcept(
  projectDir: string,
  relDir: string,
  fields: Record<string, string | null>,
): void {
  const dir = path.join(projectDir, "doc", "specs", relDir);
  mkdirSync(dir, { recursive: true });
  const fm = Object.entries(fields)
    .map(([k, v]) => (v === null ? `${k}: null` : `${k}: "${v}"`))
    .join("\n");
  const title = (fields.title ?? "Test Concept").replace(/"/g, "");
  writeFileSync(
    path.join(dir, "README.md"),
    `---\n${fm}\n---\n\n# ${title}\n`,
  );
}

/** Write a `spec.yaml` into `projectDir/doc/specs/<relDir>/`. */
function writeSpecYaml(
  projectDir: string,
  relDir: string,
  content: string,
): void {
  const dir = path.join(projectDir, "doc", "specs", relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "spec.yaml"), content);
}

/** Minimal valid concept frontmatter — passes all existing spec-lint invariants. */
const MIN_CONCEPT: Record<string, string | null> = {
  id: "C-TESTCONCEPT",
  type: "concept",
  title: "Test Concept",
  summary: "Test concept.",
  parent: null,
  origin_decision_ref: "test-motive#D-1",
};

// ─── S0: spec-io / schema-io API ─────────────────────────────────────────────

describe("S0: spec-io schema and index API", () => {
  it("S0-AC1: loadSchema('spec-manifest') compiles without error and returns a validate function", () => {
    const r = runEsmScript(`
      import { loadSchema } from '${SCHEMA_IO}';
      const v = loadSchema('spec-manifest');
      if (typeof v !== 'function') throw new Error('not a function: ' + typeof v);
      process.stdout.write('OK\\n');
    `);
    expect(r.stderr, `ESM error: ${r.stderr}`).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("OK");
  });

  it("S0-AC3: buildIndexData returns exactly the known node IDs with and without spec.yaml files", () => {
    // Stringified here so we can embed them in the ESM script without a file round-trip.
    const expectedJson = JSON.stringify(
      [
        "ARTIFACT-R-001",
        "ARTIFACT-R-003",
        "ARTIFACT-R-004",
        "ARTIFACT-R-005",
        "ARTIFACT-R-006",
        "ARTIFACT-R-007",
        "ARTIFACT-R-008",
        "ARTIFACT-R-009",
        "ARTIFACT-R-010",
        "ARTIFACT-R-011",
        "ARTIFACT-R-012",
        "C-ARTIFACT",
        "C-ENFORCEMENT",
        "C-GROUNDWORK",
        "C-ORCHESTRATION",
        "C-VERIFICATION",
        "ENFORCEMENT-R-001",
        "ORCHESTRATION-R-001",
        "ORCHESTRATION-R-002",
        "ORCHESTRATION-R-003",
        "ORCHESTRATION-R-004",
        "PACING-R-001",
        "PACING-R-002",
        "PACING-R-003",
        "PACING-R-004",
        "PACING-R-005",
        "PACING-R-006",
        "SEAL-R-001",
        "VERIFICATION-R-001",
        "VERIFICATION-R-002",
        "VERIFICATION-R-003",
        "VERIFICATION-R-004",
      ].sort(),
    );

    const r = runEsmScript(`
      import { cpSync, readdirSync, statSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
      import { tmpdir } from 'node:os';
      import { join } from 'node:path';
      import { buildIndexData } from '${SPEC_IO}';

      const expected = ${expectedJson};
      const liveSpecDir = '${LIVE_SPEC_DIR}';

      // Step 1: live tree with existing spec.yaml files in place
      const { nodes: nodesLive } = buildIndexData(liveSpecDir);
      const idsLive = Object.keys(nodesLive).sort();

      // Step 2: copy the spec dir and delete every spec.yaml in the copy
      const tmpCopy = mkdtempSync(join(tmpdir(), 'gw-s0ac3-'));
      try {
        cpSync(liveSpecDir, tmpCopy, { recursive: true });

        function deleteSpecYamls(dir) {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, entry.name);
            if (entry.isDirectory()) deleteSpecYamls(p);
            else if (entry.name === 'spec.yaml') unlinkSync(p);
          }
        }
        deleteSpecYamls(tmpCopy);

        const { nodes: nodesNoManifest } = buildIndexData(tmpCopy);
        const idsNoManifest = Object.keys(nodesNoManifest).sort();

        process.stdout.write(JSON.stringify({ idsLive, idsNoManifest }) + '\\n');
      } finally {
        rmSync(tmpCopy, { recursive: true, force: true });
      }
    `);

    expect(r.code, `script error: ${r.stderr}`).toBe(0);
    const { idsLive, idsNoManifest } = JSON.parse(r.stdout.trim()) as {
      idsLive: string[];
      idsNoManifest: string[];
    };
    const expected = JSON.parse(expectedJson) as string[];
    expect(idsLive).toEqual(expected);
    expect(idsNoManifest).toEqual(expected);
  });

  it("S0-AC4: buildIndexData attaches views[] to concept nodes when spec.yaml is present (and not when absent)", () => {
    const r = runEsmScript(`
      import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
      import { tmpdir } from 'node:os';
      import { join } from 'node:path';
      import { buildIndexData } from '${SPEC_IO}';

      const tmp = mkdtempSync(join(tmpdir(), 'gw-s0ac4-'));
      try {
        const conceptDir = join(tmp, 'tc');
        mkdirSync(conceptDir, { recursive: true });

        writeFileSync(join(conceptDir, 'README.md'),
          '---\\nid: C-TC\\ntype: concept\\ntitle: TC\\nsummary: TC summary.\\norigin_decision_ref: test-motive#D-1\\n---\\n\\n# TC\\n');
        writeFileSync(join(conceptDir, 'overview.md'),
          '---\\ntype: overview\\nid: V-TC-OVERVIEW\\n---\\n\\n# TC Overview\\n');

        // Without spec.yaml: concept node should have no views (or empty array)
        const { nodes: nodesWithout } = buildIndexData(tmp);
        const viewsBefore = nodesWithout['C-TC']?.views ?? [];

        // Write spec.yaml that declares the overview view
        writeFileSync(join(conceptDir, 'spec.yaml'),
          'id: C-TC\\ntitle: TC\\nsummary: TC summary.\\nstatus: draft\\nviews:\\n  - type: overview\\n    file: overview.md\\n');

        // With spec.yaml: concept node should have the views array populated
        const { nodes: nodesWith } = buildIndexData(tmp);
        const viewsAfter = nodesWith['C-TC']?.views ?? [];

        process.stdout.write(JSON.stringify({ viewsBefore, viewsAfter }) + '\\n');
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    `);

    expect(r.code, `script error: ${r.stderr}`).toBe(0);
    const { viewsBefore, viewsAfter } = JSON.parse(r.stdout.trim()) as {
      viewsBefore: Array<{ type: string; file: string }>;
      viewsAfter: Array<{ type: string; file: string }>;
    };
    // Control: no views without spec.yaml
    expect(viewsBefore).toHaveLength(0);
    // With spec.yaml: views are attached
    expect(viewsAfter).toHaveLength(1);
    expect(viewsAfter[0]).toMatchObject({ type: "overview", file: "overview.md" });
  });

  it("S0-AC5: view files listed in spec.yaml are excluded from node construction (control: included when spec.yaml absent)", () => {
    const r = runEsmScript(`
      import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
      import { tmpdir } from 'node:os';
      import { join } from 'node:path';
      import { buildIndexData } from '${SPEC_IO}';

      const tmp = mkdtempSync(join(tmpdir(), 'gw-s0ac5-'));
      try {
        const conceptDir = join(tmp, 'tc');
        mkdirSync(conceptDir, { recursive: true });

        writeFileSync(join(conceptDir, 'README.md'),
          '---\\nid: C-TC\\ntype: concept\\ntitle: TC\\nsummary: TC summary.\\norigin_decision_ref: test-motive#D-1\\n---\\n\\n# TC\\n');

        // View file with indexable concept frontmatter — would normally become a node
        writeFileSync(join(conceptDir, 'flows.md'),
          '---\\nid: C-TC-FLOWS\\ntype: concept\\ntitle: TC Flows\\nsummary: TC flows view.\\norigin_decision_ref: test-motive#D-1\\n---\\n\\n# TC Flows\\n');

        // Control (no spec.yaml): flows.md IS indexed as its own node
        const { nodes: nodesWithout } = buildIndexData(tmp);
        const withoutYaml = Object.keys(nodesWithout).sort();

        // Write spec.yaml listing flows.md as a view
        writeFileSync(join(conceptDir, 'spec.yaml'),
          'id: C-TC\\ntitle: TC\\nsummary: TC summary.\\nstatus: draft\\nviews:\\n  - type: flows\\n    file: flows.md\\n');

        // With spec.yaml: flows.md should NOT be a node (excluded by pre-pass)
        const { nodes: nodesWith } = buildIndexData(tmp);
        const withYaml = Object.keys(nodesWith).sort();

        process.stdout.write(JSON.stringify({ withoutYaml, withYaml }) + '\\n');
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    `);

    expect(r.code, `script error: ${r.stderr}`).toBe(0);
    const { withoutYaml, withYaml } = JSON.parse(r.stdout.trim()) as {
      withoutYaml: string[];
      withYaml: string[];
    };
    // Control: without spec.yaml, flows.md is indexed as a node
    expect(withoutYaml).toContain("C-TC-FLOWS");
    // With spec.yaml: flows.md is excluded — only the concept node remains
    expect(withYaml).not.toContain("C-TC-FLOWS");
    expect(withYaml).toContain("C-TC");
  });

  it("S0-AC6: loadSpecManifest returns empty errors for a valid manifest and errors listing the missing field for an invalid one", () => {
    const r = runEsmScript(`
      import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
      import { tmpdir } from 'node:os';
      import { join } from 'node:path';
      import { loadSpecManifest } from '${SPEC_IO}';

      const tmp = mkdtempSync(join(tmpdir(), 'gw-s0ac6-'));
      try {
        const validDir = join(tmp, 'valid');
        const invalidDir = join(tmp, 'invalid');
        mkdirSync(validDir, { recursive: true });
        mkdirSync(invalidDir, { recursive: true });

        // Valid: all required fields present
        writeFileSync(join(validDir, 'spec.yaml'),
          'id: C-VALID\\ntitle: Valid\\nsummary: Valid concept.\\nstatus: draft\\nviews: []\\n');

        // Invalid: missing required 'summary'
        writeFileSync(join(invalidDir, 'spec.yaml'),
          'id: C-INVALID\\ntitle: Invalid\\nstatus: draft\\nviews: []\\n');

        const [validResult, invalidResult] = await Promise.all([
          loadSpecManifest(validDir),
          loadSpecManifest(invalidDir),
        ]);

        process.stdout.write(JSON.stringify({
          validErrors: validResult.errors,
          validManifestId: validResult.manifest?.id ?? null,
          invalidErrorFields: invalidResult.errors.map(e => e.field),
          invalidErrorProblems: invalidResult.errors.map(e => e.problem),
        }) + '\\n');
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    `);

    expect(r.code, `script error: ${r.stderr}`).toBe(0);
    const { validErrors, validManifestId, invalidErrorFields, invalidErrorProblems } =
      JSON.parse(r.stdout.trim()) as {
        validErrors: unknown[];
        validManifestId: string | null;
        invalidErrorFields: string[];
        invalidErrorProblems: string[];
      };
    expect(validErrors).toHaveLength(0);
    expect(validManifestId).toBe("C-VALID");
    // spec-io's _loadSpecManifestSync maps all AJV errors to instancePath (not
    // missingProperty), so field is '(root)' for required violations; the field
    // name appears in the AJV problem message instead.
    expect(invalidErrorFields.length).toBeGreaterThan(0);
    expect(invalidErrorProblems.some((p) => p.includes("summary"))).toBe(true);
  });

  it("S0-AC7: isIndexStale is false after a fresh index write and true after touching spec.yaml mtime", () => {
    const r = runEsmScript(`
      import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
      import { tmpdir } from 'node:os';
      import { join } from 'node:path';
      import { buildIndexData, isIndexStale, generatedDirPath, indexJsonPath } from '${SPEC_IO}';

      const tmp = mkdtempSync(join(tmpdir(), 'gw-s0ac7-'));
      try {
        const specDir = join(tmp, 'doc', 'specs');
        const conceptDir = join(specDir, 'tc');
        mkdirSync(conceptDir, { recursive: true });

        const readmePath = join(conceptDir, 'README.md');
        const specYamlPath = join(conceptDir, 'spec.yaml');

        writeFileSync(readmePath,
          '---\\nid: C-TC\\ntype: concept\\ntitle: TC\\nsummary: TC.\\norigin_decision_ref: test-motive#D-1\\n---\\n\\n# TC\\n');
        writeFileSync(specYamlPath,
          'id: C-TC\\ntitle: TC\\nsummary: TC.\\nstatus: draft\\nviews: []\\n');

        // Backdate spec files so the index will appear newer
        const past = new Date(Date.now() - 60000);
        utimesSync(readmePath, past, past);
        utimesSync(specYamlPath, past, past);

        // Write the index (mtime is now — newer than spec files)
        const genDir = generatedDirPath(specDir);
        mkdirSync(genDir, { recursive: true });
        const idxPath = indexJsonPath(specDir);
        const { nodes, errors } = buildIndexData(specDir);
        writeFileSync(idxPath, JSON.stringify({ nodes, errors, version: 3 }));

        // Index is fresh — must NOT be stale
        const step1 = isIndexStale(specDir);

        // Touch spec.yaml into the future — index is now older
        const future = new Date(Date.now() + 60000);
        utimesSync(specYamlPath, future, future);

        // Index must now be stale
        const step2 = isIndexStale(specDir);

        if (step1 !== false) throw new Error('Expected not stale after fresh write, got: ' + step1);
        if (step2 !== true)  throw new Error('Expected stale after touching spec.yaml, got: ' + step2);

        process.stdout.write('OK\\n');
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    `);

    expect(r.code, `script error: ${r.stderr}`).toBe(0);
    expect(r.stdout.trim()).toBe("OK");
  });
});

// ─── S1: spec-lint manifest invariants ───────────────────────────────────────

describe("S1: spec-lint manifest invariants", () => {
  let projectDir = "";

  beforeEach(() => {
    projectDir = mkdtempSync(path.join(tmpdir(), "gw-s1-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("S1-AC1: spec-lint exits 0 on the current live spec tree (regression check)", () => {
    // The live index already exists at doc/specs/_generated/index.json —
    // run lint directly without rebuilding so tests stay read-only on the live tree.
    const r = lint(REPO_ROOT);
    expect(
      r.code,
      `lint failures:\n${r.stdout}\n${r.stderr}`,
    ).toBe(0);
  });

  it("S1-AC2: manifest-invalid violation emitted and process exits 1 when spec.yaml has an extra field", () => {
    writeConcept(projectDir, "testconcept", MIN_CONCEPT);
    // 'deprecated' is not in spec-manifest.schema.json (additionalProperties: false)
    writeSpecYaml(
      projectDir,
      "testconcept",
      [
        'id: "C-TESTCONCEPT"',
        'title: "Test Concept"',
        'summary: "Test concept."',
        "status: draft",
        "views: []",
        "deprecated: true",
      ].join("\n") + "\n",
    );

    const br = build(projectDir);
    expect(br.code, `build failed: ${br.stderr}`).toBe(0);

    const r = lint(projectDir);

    const expectedLine =
      'LINT_DRIFT C-TESTCONCEPT: manifest-invalid: concept "C-TESTCONCEPT" spec.yaml field "(root)": must NOT have additional properties';
    const lines = r.stdout.split("\n");
    expect(
      lines.some((l) => l === expectedLine),
      `expected line not found in:\n${r.stdout}`,
    ).toBe(true);
    expect(r.code).toBe(1);
  });

  it("S1-AC3: required-field violation emitted and process exits 1 when a view file is missing required frontmatter field", () => {
    writeConcept(projectDir, "testconcept", MIN_CONCEPT);

    // View file: has 'id' but is missing 'type' → triggers required-field for 'type'
    const viewDir = path.join(projectDir, "doc", "specs", "testconcept");
    writeFileSync(
      path.join(viewDir, "flows.md"),
      "---\nid: V-TESTCONCEPT-FLOWS\n---\n\n# Flows\n",
    );

    writeSpecYaml(
      projectDir,
      "testconcept",
      [
        'id: "C-TESTCONCEPT"',
        'title: "Test Concept"',
        'summary: "Test concept."',
        "status: draft",
        "views:",
        "  - type: flows",
        "    file: flows.md",
      ].join("\n") + "\n",
    );

    const br = build(projectDir);
    expect(br.code, `build failed: ${br.stderr}`).toBe(0);

    const r = lint(projectDir);

    const expectedLine =
      'LINT_DRIFT C-TESTCONCEPT: required-field: view file "flows.md" in concept "C-TESTCONCEPT" is missing required field "type"';
    const lines = r.stdout.split("\n");
    expect(
      lines.some((l) => l === expectedLine),
      `expected line not found in:\n${r.stdout}`,
    ).toBe(true);
    expect(r.code).toBe(1);
  });

  it("S1-AC4a: missing-view-file violation emitted and process exits 1 when spec.yaml references a nonexistent view file", () => {
    writeConcept(projectDir, "testconcept", MIN_CONCEPT);
    writeSpecYaml(
      projectDir,
      "testconcept",
      [
        'id: "C-TESTCONCEPT"',
        'title: "Test Concept"',
        'summary: "Test concept."',
        "status: draft",
        "views:",
        "  - type: flows",
        "    file: does-not-exist.md",
      ].join("\n") + "\n",
    );

    const br = build(projectDir);
    expect(br.code, `build failed: ${br.stderr}`).toBe(0);

    const r = lint(projectDir);

    const expectedLine =
      'LINT_DRIFT C-TESTCONCEPT: missing-view-file: concept "C-TESTCONCEPT" declares view file "does-not-exist.md" which does not exist';
    const lines = r.stdout.split("\n");
    expect(
      lines.some((l) => l === expectedLine),
      `expected line not found in:\n${r.stdout}`,
    ).toBe(true);
    expect(r.code).toBe(1);
  });

  it("S1-AC4b: no type-name-missing or manifest-invalid violation when type_names.names is empty", () => {
    writeConcept(projectDir, "testconcept", MIN_CONCEPT);
    writeSpecYaml(
      projectDir,
      "testconcept",
      [
        'id: "C-TESTCONCEPT"',
        'title: "Test Concept"',
        'summary: "Test concept."',
        "status: draft",
        "views: []",
        "lint:",
        "  data-model:",
        "    type_names:",
        '      source: "types"',
        "      names: []",
      ].join("\n") + "\n",
    );

    const br = build(projectDir);
    expect(br.code, `build failed: ${br.stderr}`).toBe(0);

    // Anchor: confirm C-TESTCONCEPT was actually indexed before checking the negative
    const indexPath = path.join(
      projectDir,
      "doc",
      "specs",
      "_generated",
      "index.json",
    );
    const indexJson = JSON.parse(readFileSync(indexPath, "utf8")) as {
      nodes: Record<string, unknown>;
    };
    expect(Object.keys(indexJson.nodes)).toContain("C-TESTCONCEPT");

    const r = lint(projectDir);

    const conceptLines = r.stdout
      .split("\n")
      .filter((l) => l.includes("C-TESTCONCEPT"));
    expect(
      conceptLines.some((l) => l.includes("type-name-missing")),
      `unexpected type-name-missing in:\n${r.stdout}`,
    ).toBe(false);
    expect(
      conceptLines.some((l) => l.includes("manifest-invalid")),
      `unexpected manifest-invalid in:\n${r.stdout}`,
    ).toBe(false);
  });

  it("S1-AC5: type-name-missing violation emitted and process exits 1 when named TypeScript type is absent from src/", () => {
    writeConcept(projectDir, "testconcept", MIN_CONCEPT);
    writeSpecYaml(
      projectDir,
      "testconcept",
      [
        'id: "C-TESTCONCEPT"',
        'title: "Test Concept"',
        'summary: "Test concept."',
        "status: draft",
        "views: []",
        "lint:",
        "  data-model:",
        "    type_names:",
        '      source: "types"',
        "      names:",
        "        - NonExistentTypeXyzAbc",
      ].join("\n") + "\n",
    );

    const br = build(projectDir);
    expect(br.code, `build failed: ${br.stderr}`).toBe(0);

    const r = lint(projectDir);

    const expectedLine =
      'LINT_DRIFT C-TESTCONCEPT: type-name-missing: concept "C-TESTCONCEPT" lint.data-model.type_names: TypeScript type/interface "NonExistentTypeXyzAbc" not found in src/';
    const lines = r.stdout.split("\n");
    expect(
      lines.some((l) => l === expectedLine),
      `expected line not found in:\n${r.stdout}`,
    ).toBe(true);
    expect(r.code).toBe(1);
  });

  it("S1-AC6: unsupported-source violation emitted and process exits 1 when type_names source is not 'types'", () => {
    writeConcept(projectDir, "testconcept", MIN_CONCEPT);
    writeSpecYaml(
      projectDir,
      "testconcept",
      [
        'id: "C-TESTCONCEPT"',
        'title: "Test Concept"',
        'summary: "Test concept."',
        "status: draft",
        "views: []",
        "lint:",
        "  data-model:",
        "    type_names:",
        '      source: "prisma"',
        "      names:",
        "        - SomeModel",
      ].join("\n") + "\n",
    );

    const br = build(projectDir);
    expect(br.code, `build failed: ${br.stderr}`).toBe(0);

    const r = lint(projectDir);

    const expectedLine =
      "LINT_DRIFT C-TESTCONCEPT: unsupported-source: concept \"C-TESTCONCEPT\" lint.data-model.type_names has unsupported source 'prisma'; only 'types' is supported in this repo";
    const lines = r.stdout.split("\n");
    expect(
      lines.some((l) => l === expectedLine),
      `expected line not found in:\n${r.stdout}`,
    ).toBe(true);
    expect(r.code).toBe(1);
  });

  it("S1-AC7: spec-lint --rfc mode exits without crash and resolves spec_delta targets without missing-target errors", () => {
    // Build a fixture project with a concept node and a minimal RFC whose
    // rfc.md contains "uid: R-TESTUID" and a spec_delta pointing at the concept.
    // findRfcDirSync reads rfc.md and matches on the "uid: <uid>" string.
    writeConcept(projectDir, "testconcept", MIN_CONCEPT);
    writeSpecYaml(
      projectDir,
      "testconcept",
      [
        'id: "C-TESTCONCEPT"',
        'title: "Test Concept"',
        'summary: "Test concept."',
        "status: draft",
        "views: []",
      ].join("\n") + "\n",
    );

    const br = build(projectDir);
    expect(br.code, `build failed: ${br.stderr}`).toBe(0);

    // Create the RFC directory with a rfc.md that findRfcDirSync can match.
    // The spec_delta points at the concept file so targets ARE resolved.
    const rfcDir = path.join(projectDir, ".groundwork", "rfcs", "0001-test-rfc");
    mkdirSync(rfcDir, { recursive: true });
    writeFileSync(
      path.join(rfcDir, "rfc.md"),
      [
        "uid: R-TESTUID",
        "",
        "# Test RFC",
        "",
        "A fixture RFC for spec-lint --rfc mode testing.",
        "",
        "spec_delta:",
        "  target: doc/specs/testconcept/README.md",
      ].join("\n") + "\n",
    );

    const r = lint(projectDir, ["--rfc", "R-TESTUID"]);

    // Must not be a usage/config error
    expect(r.code).not.toBe(2);
    // RFC must have been found (no "not found" message in stderr)
    expect(r.stderr).not.toContain("not found");
    // All spec_delta targets must have resolved on disk
    expect(r.stderr).not.toContain("spec_delta target does not exist on disk");
    // Lint ran (either clean or violations found, but did not crash)
    expect(r.stdout + r.stderr).not.toContain("spec index not found");
    // Strong anchor: proves RFC found → spec_delta parsed → target resolved → lint ran to completion
    expect(
      r.stdout,
      `expected clean message, got stdout:\n${r.stdout}\nstderr:\n${r.stderr}`,
    ).toContain("spec lint --rfc R-TESTUID: clean — no violations found.");
  });
});
