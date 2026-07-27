/**
 * Tests for hooks/lib/schema-io.mjs
 *
 * Coverage:
 *   - loadSchema: caches compiled validators (same reference on repeat call)
 *   - loadSchema: throws on missing schema file (operational-failure path)
 *   - ajvErrorsToLines: empty / null input
 *   - ajvErrorsToLines: required keyword → "missing required field: <name>"
 *   - ajvErrorsToLines: enum keyword → field + allowed values
 *   - ajvErrorsToLines: pattern keyword → field + pattern
 *   - ajvErrorsToLines: type keyword → field + got-type
 *   - ajvErrorsToLines: additionalProperties keyword → field name
 *   - ajvErrorsToLines: nested instancePath → bracket notation
 *   - ajvErrorsToLines: root instancePath with prefix
 *   - ajvErrorsToLines: root instancePath without prefix → "schema"
 *   - Output shape matches spec-lint ("invariant: problem") and rfc ("field: problem") styles
 */

import { mkdirSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// schema-io.mjs resolves schemas relative to its own __dirname. We exercise
// loadSchema with a temp schemas/ dir alongside a temp copy of the module.
// For unit-testing ajvErrorsToLines we import it directly — it has no
// side-effects and does not touch the filesystem.

const MODULE_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "hooks",
  "lib",
  "schema-io.mjs",
);

// Dynamic import for ESM interop
const schemaIo = await import(MODULE_PATH);
const { ajvErrorsToLines, loadSchema } = schemaIo;

// ---------------------------------------------------------------------------
// Fixtures — minimal valid JSON Schema 2020-12 files written to disk so
// loadSchema can find them in the repo's real schemas/ directory.
// ---------------------------------------------------------------------------

const SCHEMAS_DIR = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "schemas",
);

const TEST_SCHEMA_NAME = "_test-schema-io";
const TEST_SCHEMA_PATH = path.join(SCHEMAS_DIR, `${TEST_SCHEMA_NAME}.schema.json`);

const TEST_SCHEMA = {
  $id: `${TEST_SCHEMA_NAME}.schema.json`,
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    uid: { type: "string", pattern: "^R-\\d{8}-[A-Z0-9]{6}$" },
    status: { type: "string", enum: ["draft", "accepted", "rejected"] },
    count: { type: "integer" },
  },
  required: ["uid", "status"],
  additionalProperties: false,
};

beforeAll(() => {
  mkdirSync(SCHEMAS_DIR, { recursive: true });
  writeFileSync(TEST_SCHEMA_PATH, JSON.stringify(TEST_SCHEMA, null, 2), "utf8");
});

afterAll(() => {
  try { rmSync(TEST_SCHEMA_PATH, { force: true }); } catch { /* best-effort */ }
});

// ---------------------------------------------------------------------------
// loadSchema
// ---------------------------------------------------------------------------

describe("loadSchema", () => {
  it("returns a callable validator for a valid schema", () => {
    const validate = loadSchema(TEST_SCHEMA_NAME);
    expect(typeof validate).toBe("function");
  });

  it("caches — returns the exact same reference on a second call", () => {
    const first = loadSchema(TEST_SCHEMA_NAME);
    const second = loadSchema(TEST_SCHEMA_NAME);
    expect(first).toBe(second);
  });

  it("compiled validator returns true for valid data", () => {
    const validate = loadSchema(TEST_SCHEMA_NAME);
    const result = validate({ uid: "R-20260101-AABBCC", status: "draft" });
    expect(result).toBe(true);
  });

  it("compiled validator returns false for invalid data and populates errors", () => {
    const validate = loadSchema(TEST_SCHEMA_NAME);
    const result = validate({ uid: "BAD", status: "draft" });
    expect(result).toBe(false);
    expect(Array.isArray(validate.errors)).toBe(true);
    expect(validate.errors!.length).toBeGreaterThan(0);
  });

  it("throws on missing schema file (operational-failure path)", () => {
    expect(() => loadSchema("_nonexistent-schema-99999")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ajvErrorsToLines — error object factories
// ---------------------------------------------------------------------------

type AjvError = {
  keyword: string;
  instancePath: string;
  schemaPath: string;
  params: Record<string, unknown>;
  message?: string;
};

function makeError(overrides: Partial<AjvError>): AjvError {
  return {
    keyword: "type",
    instancePath: "/field",
    schemaPath: "#/properties/field/type",
    params: {},
    message: "must be string",
    ...overrides,
  };
}

describe("ajvErrorsToLines — empty / null input", () => {
  it("returns [] for null errors", () => {
    expect(ajvErrorsToLines(null as unknown as [], undefined)).toEqual([]);
  });

  it("returns [] for empty array", () => {
    expect(ajvErrorsToLines([], undefined)).toEqual([]);
  });
});

describe("ajvErrorsToLines — required keyword", () => {
  it("produces 'field: missing required field: <name>'", () => {
    const err = makeError({
      keyword: "required",
      instancePath: "",
      params: { missingProperty: "uid" },
      message: "must have required property 'uid'",
    });
    const lines = ajvErrorsToLines([err], "rfc");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("rfc: missing required field: uid");
  });
});

describe("ajvErrorsToLines — enum keyword", () => {
  it("appends allowed values list", () => {
    const err = makeError({
      keyword: "enum",
      instancePath: "/status",
      params: { allowedValues: ["draft", "accepted", "rejected"] },
      message: "must be equal to one of the allowed values",
    });
    const lines = ajvErrorsToLines([err], undefined);
    expect(lines[0]).toMatch(/^status: .*allowed: draft, accepted, rejected$/);
  });
});

describe("ajvErrorsToLines — pattern keyword", () => {
  it("appends the pattern string", () => {
    const err = makeError({
      keyword: "pattern",
      instancePath: "/uid",
      params: { pattern: "^R-\\d{8}-[A-Z0-9]{6}$" },
      message: "must match pattern",
    });
    const lines = ajvErrorsToLines([err], undefined);
    expect(lines[0]).toMatch(/^uid: must match pattern \(pattern:/);
  });
});

describe("ajvErrorsToLines — type keyword", () => {
  it("appends the actual type from params", () => {
    const err = makeError({
      keyword: "type",
      instancePath: "/count",
      params: { type: "string" },
      message: "must be integer",
    });
    const lines = ajvErrorsToLines([err], undefined);
    expect(lines[0]).toBe("count: must be integer (got string)");
  });
});

describe("ajvErrorsToLines — additionalProperties keyword", () => {
  it("includes the offending property name", () => {
    const err = makeError({
      keyword: "additionalProperties",
      instancePath: "",
      params: { additionalProperty: "extra_field" },
      message: "must NOT have additional properties",
    });
    const lines = ajvErrorsToLines([err], "rfc");
    expect(lines[0]).toBe("rfc: must NOT have additional properties: extra_field");
  });
});

describe("ajvErrorsToLines — instancePath formatting", () => {
  it("converts nested path to bracket-dot notation", () => {
    const err = makeError({
      instancePath: "/tasks/0/trigger",
      keyword: "type",
      params: { type: "null" },
      message: "must be string",
    });
    const lines = ajvErrorsToLines([err], undefined);
    expect(lines[0]).toMatch(/^tasks\[0\]\.trigger: /);
  });

  it("uses prefix for root instancePath", () => {
    const err = makeError({
      instancePath: "",
      keyword: "type",
      params: { type: "array" },
      message: "must be object",
    });
    const lines = ajvErrorsToLines([err], "rfc");
    expect(lines[0]).toMatch(/^rfc: /);
  });

  it("uses 'schema' when root instancePath and no prefix", () => {
    const err = makeError({
      instancePath: "",
      keyword: "type",
      params: {},
      message: "must be object",
    });
    const lines = ajvErrorsToLines([err], undefined);
    expect(lines[0]).toMatch(/^schema: /);
  });
});

describe("ajvErrorsToLines — output shape matches runner styles", () => {
  it("spec-lint style: 'invariant-name: problem' — no extra prefix applied", () => {
    // spec-lint pushes `violations.push(`enum-value: ...`)` — the caller
    // supplies the invariant name as the prefix here.
    const err = makeError({
      keyword: "enum",
      instancePath: "/type",
      params: { allowedValues: ["concept", "requirement"] },
      message: "must be equal to one of the allowed values",
    });
    const lines = ajvErrorsToLines([err], undefined);
    // field derived from instancePath = "type", no extra prefix
    expect(lines[0]).toMatch(/^type: .*allowed: concept, requirement/);
  });

  it("rfc style: 'field: problem' matches validateFrontmatter error strings", () => {
    // rfc.mjs pushes `errors.push(`uid: does not match ...`)` — same shape.
    const err = makeError({
      keyword: "pattern",
      instancePath: "/uid",
      params: { pattern: "^R-\\d{8}-[A-Z0-9]{6}$" },
      message: "must match pattern",
    });
    const lines = ajvErrorsToLines([err], undefined);
    expect(lines[0]).toMatch(/^uid: /);
  });
});

// ---------------------------------------------------------------------------
// Compile-smoke: every schemas/*.schema.json must load without throwing.
//
// This test discovers schema files DYNAMICALLY so that adding a new schema
// without making it compilable is impossible to hide — any broken schema will
// be caught here without any manual list update.
// ---------------------------------------------------------------------------

describe("compile-smoke — all schemas/*.schema.json must compile", () => {
  // Collect file names once at describe time so the individual test titles
  // are visible in the report before any test runs.
  const schemaFiles = readdirSync(SCHEMAS_DIR).filter(
    (f) => f.endsWith(".schema.json") && !f.startsWith("_"),
  );

  it("discovers at least one schema file (guard against empty-dir false pass)", () => {
    expect(schemaFiles.length).toBeGreaterThan(0);
  });

  for (const filename of schemaFiles) {
    // Strip the ".schema.json" suffix to get the loadSchema name.
    const name = filename.replace(/\.schema\.json$/, "");
    it(`loadSchema("${name}") compiles without throwing`, () => {
      // loadSchema caches; calling it again is cheap and returns the cached
      // validator — we just need to confirm no throw on first load.
      expect(() => loadSchema(name)).not.toThrow();
    });
  }
});
