import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020Mod from "ajv/dist/2020.js";
import addFormatsMod from "ajv-formats";
import { WORKING_TYPES } from "../../../../src/hooks/doc-registry.js";
import { missingHeadings, parseFrontmatter, validateFrontmatter, type FmSchema } from "../../src/engine/frontmatter.js";

// nodenext typing wraps CJS default exports; bun returns them directly.
const unwrap = <T>(m: unknown): T => ((m as { default?: T }).default ?? m) as T;
const Ajv2020 = unwrap<new (o: object) => { compile(s: object): (v: unknown) => boolean }>(Ajv2020Mod);
const addFormats = unwrap<(a: unknown, f?: string[]) => void>(addFormatsMod);
const SRC = join(import.meta.dir, "../../src");

describe("frontmatter", () => {
  test("AC1 no node_modules: runs from a bare copy of src", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-ac1-"));
    try {
      cpSync(SRC, join(dir, "src"), { recursive: true });
      const script = `
        import { parseFrontmatter, validateFrontmatter } from "./src/engine/frontmatter.ts";
        const p = parseFrontmatter("---\\ncreated: 2026-09-01\\nstatus: active\\n---\\n# x\\n");
        if (!p.ok) throw new Error(p.error);
        const s = { type: "object", required: ["created"], properties: { created: { type: "string", format: "date" }, status: { enum: ["done"] } } };
        console.log(JSON.stringify({ data: p.data, errs: validateFrontmatter(s, p.data) }));
      `;
      const env: Record<string, string | undefined> = { ...process.env };
      delete env.CLAUDE_PROJECT_DIR;
      const r = Bun.spawnSync([process.execPath, "-e", script], { cwd: dir, env: env as Record<string, string> });
      expect(r.stderr.toString()).toBe("");
      const out = JSON.parse(r.stdout.toString());
      expect(out.data).toEqual({ created: "2026-09-01", status: "active" });
      expect(out.errs).toHaveLength(1);
      expect(out.errs[0]).toContain("status:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("AC2 differential vs Ajv2020", () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv, ["date"]);
    const fm = (yaml: string) => {
      const r = parseFrontmatter(`---\n${yaml}\n---\n`);
      if (!r.ok) throw new Error(r.error);
      return r.data;
    };
    const dateSchema = { type: "object", properties: { created: { type: "string", format: "date" } } };
    const spec = WORKING_TYPES.spec.frontmatter as FmSchema;
    const oneOfS = { oneOf: [{ type: "string" }, { enum: ["a", 1] }] };
    const cases: [string, FmSchema, unknown][] = [
      ["type string ok", { type: "string" }, "x"],
      ["type string bad", { type: "string" }, 1],
      ["type object ok", { type: "object" }, {}],
      ["type object array", { type: "object" }, []],
      ["type object null", { type: "object" }, null],
      ["type array ok", { type: "array" }, [1]],
      ["type array bad", { type: "array" }, {}],
      ["type number ok", { type: "number" }, 1.5],
      ["type number str", { type: "number" }, "1"],
      ["type integer ok", { type: "integer" }, 3],
      ["type integer float", { type: "integer" }, 3.5],
      ["type boolean ok", { type: "boolean" }, false],
      ["type boolean bad", { type: "boolean" }, 0],
      ["type null ok", { type: "null" }, null],
      ["type null bad", { type: "null" }, 0],
      ["required ok", { required: ["a"] }, { a: 1 }],
      ["required missing", { required: ["a", "b"] }, { a: 1 }],
      ["required non-object", { required: ["a"] }, "str"],
      ["properties ok", { properties: { a: { type: "string" } } }, { a: "x" }],
      ["properties bad", { properties: { a: { type: "string" } } }, { a: 1 }],
      ["properties absent key", { properties: { a: { type: "string" } } }, { b: 1 }],
      ["properties non-object", { properties: { a: { type: "string" } } }, 5],
      ["enum ok", { enum: ["a", "b"] }, "b"],
      ["enum bad", { enum: ["a", "b"] }, "c"],
      ["enum mixed", { enum: ["a", 1, null] }, null],
      ["enum object", { enum: [{ x: 1 }] }, { x: 1 }],
      ["const ok", { const: "none" }, "none"],
      ["const bad", { const: "none" }, "some"],
      ["const number", { const: 1 }, 1],
      ["pattern ok", { pattern: "^a+$" }, "aaa"],
      ["pattern bad", { pattern: "^a+$" }, "ab"],
      ["pattern non-string", { pattern: "^a+$" }, 5],
      ["format date ok", { format: "date" }, "2026-09-01"],
      ["format date bad month", { format: "date" }, "2026-13-01"],
      ["format date bad day", { format: "date" }, "2026-02-30"],
      ["format date leap ok", { format: "date" }, "2024-02-29"],
      ["format date leap bad", { format: "date" }, "2023-02-29"],
      ["format date shape", { format: "date" }, "2026-9-1"],
      ["format date non-string", { format: "date" }, 20260901],
      ["yaml bare date", dateSchema, fm("created: 2026-09-01")],
      ["yaml quoted date", dateSchema, fm('created: "2026-09-01"')],
      ["yaml bad date", dateSchema, fm("created: 2026-02-30")],
      ["yaml non-date", dateSchema, fm("created: soon")],
      ["yaml nested date", { type: "object", properties: { a: { type: "object", properties: { d: { format: "date" } } } } }, fm("a:\n  d: 2026-01-31")],
      ["if/then then-fails", spec, { folds_into: "none" }],
      ["if/then then-ok", spec, { folds_into: "none", reason: "r" }],
      ["if/then if-false", spec, { folds_into: "doc.md" }],
      ["if/then missing required", spec, {}],
      ["if only", { if: { const: 1 } }, 2],
      ["then without if", { then: { const: 1 } }, 2],
      ["oneOf exactly one", oneOfS, "x"],
      ["oneOf none", oneOfS, 5],
      ["oneOf two", { oneOf: [{ type: "string" }, { enum: ["a"] }] }, "a"],
      ["oneOf empty-branch pair", { oneOf: [{}, {}] }, 1],
      ["motive ok", WORKING_TYPES.motive.frontmatter as FmSchema, fm("created: 2026-09-01\nstatus: active")],
      ["motive bad enum", WORKING_TYPES.motive.frontmatter as FmSchema, fm("created: 2026-09-01\nstatus: nope")],
    ];
    expect(cases.length).toBeGreaterThanOrEqual(30);
    for (const [name, schema, value] of cases) {
      const ajvOk = ajv.compile(schema)(value) as boolean;
      const ours = validateFrontmatter(schema, value);
      expect([name, ours.length === 0]).toEqual([name, ajvOk]);
    }
  });

  const specSchema = WORKING_TYPES.spec.frontmatter as FmSchema;

  test("AC2 seeded: missing required key names the key", () => {
    const errs = validateFrontmatter(specSchema, { reason: "x" });
    expect(errs.join("\n")).toContain('missing required key "folds_into"');
  });

  test("AC2 seeded: bad enum value names the key", () => {
    const errs = validateFrontmatter(WORKING_TYPES.motive.frontmatter as FmSchema, {
      created: "2026-09-01",
      status: "bogus",
    });
    expect(errs).toHaveLength(1);
    expect(errs[0]).toStartWith("status:");
  });

  test("AC2 seeded: folds_into none without reason", () => {
    const errs = validateFrontmatter(specSchema, { folds_into: "none" });
    expect(errs.join("\n")).toContain('missing required key "reason"');
    expect(validateFrontmatter(specSchema, { folds_into: "none", reason: "r" })).toEqual([]);
  });

  test("AC3 unsupported keyword", () => {
    const errs = validateFrontmatter({ type: "object", properties: { a: { type: "string", minLength: 3 } } }, { a: "x" });
    expect(errs.join("\n")).toContain('unsupported schema keyword "minLength"');
    expect(validateFrontmatter({ $ref: "#/x" }, {}).join()).toContain('unsupported schema keyword "$ref"');
    expect(validateFrontmatter({ format: "email" }, "a").join()).toContain('unsupported schema keyword "format: email"');
    expect(validateFrontmatter({ title: "t", description: "d", $schema: "s" }, 1)).toEqual([]);
  });

  test("AC7 missing Bun.YAML is visible error", () => {
    const bun = (globalThis as unknown as { Bun: { YAML?: unknown } }).Bun;
    const saved = bun.YAML;
    try {
      bun.YAML = undefined;
      const r = parseFrontmatter("---\na: 1\n---\n");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("Bun.YAML");
    } finally {
      bun.YAML = saved;
    }
  });

  test("parseFrontmatter: no block, body split, yaml error", () => {
    expect(parseFrontmatter("# hi\n")).toEqual({ ok: true, data: null, body: "# hi\n" });
    expect(parseFrontmatter("---\na: 1\n---\n# hi\n")).toEqual({ ok: true, data: { a: 1 }, body: "# hi\n" });
    expect(parseFrontmatter("---\n---\nx")).toEqual({ ok: true, data: {}, body: "x" });
    expect(parseFrontmatter("---\na: [1\n---\n").ok).toBe(false);
  });

  test("missingHeadings", () => {
    const body = "# Title\n## Decisions\ntext\n```\n## Hidden\n```\n### Open questions\n";
    expect(missingHeadings(body, ["Decisions", "Open questions"])).toEqual([]);
    expect(missingHeadings(body, ["## Decisions", "### Open questions"])).toEqual([]);
    expect(missingHeadings(body, ["# Decisions"])).toEqual(["# Decisions"]);
    expect(missingHeadings(body, ["Hidden", "Nope"])).toEqual(["Hidden", "Nope"]);
    expect(missingHeadings("Decisions\n#Decisions\n", ["Decisions"])).toEqual(["Decisions"]);
  });
});
