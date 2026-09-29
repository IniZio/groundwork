import { describe, it, test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { WORKING_TYPES, FORBIDDEN } from "../../src/hooks/doc-registry.js";
import { buildRecipe, renderRecipe } from "../../src/cli/recipe.js";
// @ts-ignore vendored .mjs with hand-written .d.mts
import { resolveConfig } from "../../hooks/lib/house-rules-config/resolve.mjs";
import { renderPath, compileGenerates, matchPath } from "../../hooks/lib/house-rules-config/manifest.mjs";

const REPO = path.resolve(import.meta.dir, "../..");
const MAIN = path.join(REPO, "src/cli/main.ts");
const SCHEMA = path.join(REPO, "plugins/house-rules/house-rules.schema.json");
const root = mkdtempSync(path.join(tmpdir(), "gw-recipe-parity-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const childEnv = { ...process.env } as Record<string, string>;
delete childEnv.CLAUDE_PROJECT_DIR;
delete childEnv.GROUNDWORK_DB;

function runRecipe(cwd: string) {
  return spawnSync("bun", [MAIN, "recipe"], { cwd, env: childEnv, encoding: "utf8", timeout: 15000 });
}
function tempDir(name: string): string {
  const d = path.join(root, name);
  mkdirSync(d, { recursive: true });
  return d;
}

type Recipe = { rules: { "artifact-structure": ["error", { govern: string[]; types: Record<string, any>; forbidden: unknown[] }] } };
const FIELDS = ["tier", "generates", "description", "instruction", "frontmatter", "headings"] as const;

// Returns named mismatches ("<type>.<field>: ...") so both the parity test and the bite test share one oracle.
function parityMismatches(recipe: Recipe): string[] {
  const out: string[] = [];
  const opts = recipe.rules["artifact-structure"][1];
  const reg = WORKING_TYPES as Record<string, any>;
  for (const id of Object.keys(reg)) {
    const got = opts.types[id];
    if (!got) { out.push(`${id}: missing from recipe`); continue; }
    for (const f of FIELDS) {
      if (JSON.stringify(got[f]) !== JSON.stringify(reg[id][f])) out.push(`${id}.${f}: differs from registry`);
    }
    if (reg[id].template === null) {
      if ("template" in got) out.push(`${id}.template: must be omitted`);
    } else {
      const bytes = readFileSync(path.join(REPO, reg[id].template), "utf8");
      if (got.template !== bytes) out.push(`${id}.template: differs from ${reg[id].template}`);
    }
  }
  for (const id of Object.keys(opts.types)) if (!(id in reg)) out.push(`${id}: not in registry`);
  if (JSON.stringify(opts.forbidden) !== JSON.stringify(FORBIDDEN)) out.push("forbidden: differs from FORBIDDEN");
  return out;
}

const printed = () => JSON.parse(renderRecipe()) as Recipe;

describe("recipe CLI", () => {
  it("AC1 recipe prints valid JSON, exits 0 and leaves .house-rules.json untouched", () => {
    const withFile = tempDir("with");
    const original = '{"rules":{"commit-message":["warn"]}}\n';
    const file = path.join(withFile, ".house-rules.json");
    writeFileSync(file, original);
    const a = runRecipe(withFile);
    expect(a.status).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(original);

    const without = tempDir("without");
    const b = runRecipe(without);
    expect(b.status).toBe(0);
    expect(existsSync(path.join(without, ".house-rules.json"))).toBe(false);

    const parsed = JSON.parse(b.stdout);
    expect(b.stdout).toBe(renderRecipe());
    expect(Object.keys(parsed)).toEqual(["rules"]);
    const [sev, opts] = parsed.rules["artifact-structure"];
    expect(sev).toBe("error");
    expect(opts.govern).toEqual([".groundwork/**/*.md"]);
    expect(Object.keys(opts.types).sort()).toEqual(Object.keys(WORKING_TYPES).sort());
    expect(Array.isArray(opts.forbidden)).toBe(true);
    expect(JSON.parse(a.stdout)).toEqual(parsed);
  });
});

describe("recipe validity", () => {
  it("AC2 recipe passes vendored parseConfig/resolveConfig", () => {
    const d = tempDir("resolve");
    writeFileSync(path.join(d, ".house-rules.json"), renderRecipe());
    const resolved = resolveConfig(d);
    expect(resolved.rules["artifact-structure"].severity).toBe("error");
    expect(Object.keys(resolved.rules["artifact-structure"].options.types ?? {}).sort()).toEqual(
      Object.keys(WORKING_TYPES).sort(),
    );
  });

  it("AC2 recipe validates against house-rules.schema.json via Ajv", () => {
    const validate = new Ajv2020({ strict: false }).compile(JSON.parse(readFileSync(SCHEMA, "utf8")));
    const ok = validate(printed());
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });
});

describe("recipe parity with registry", () => {
  const recipe = printed();
  test("AC3 parity: type-id set equals registry key set", () => {
    expect(Object.keys(recipe.rules["artifact-structure"][1].types).sort()).toEqual(Object.keys(WORKING_TYPES).sort());
  });
  test("AC3 parity: FORBIDDEN matches exactly", () => {
    expect(recipe.rules["artifact-structure"][1].forbidden).toEqual(FORBIDDEN);
  });
  test("AC3 parity: buildRecipe() equals the printed JSON", () => {
    expect(JSON.parse(JSON.stringify(buildRecipe()))).toEqual(recipe);
  });
  test.each(Object.keys(WORKING_TYPES))("AC3 parity: every WORKING_TYPES entry: %s", (id) => {
    const reg = (WORKING_TYPES as Record<string, any>)[id];
    const got = recipe.rules["artifact-structure"][1].types[id];
    expect(got).toBeDefined();
    for (const f of FIELDS) expect(got[f]).toEqual(reg[f]);
    if (reg.template === null) expect("template" in got).toBe(false);
    else expect(got.template).toBe(readFileSync(path.join(REPO, reg.template), "utf8"));
    expect(parityMismatches(recipe).filter((m) => m.startsWith(`${id}.`) || m.startsWith(`${id}:`))).toEqual([]);
  });
  test("AC3 parity: comparator reports no mismatches on the real recipe", () => {
    expect(parityMismatches(recipe)).toEqual([]);
  });
});

describe("recipe parity bite", () => {
  it("AC4 bite: mutated field is reported naming type id and field", () => {
    const copy = printed();
    copy.rules["artifact-structure"][1].types.spec.instruction += " (mutated)";
    expect(parityMismatches(copy)).toContain("spec.instruction: differs from registry");
  });
  it("AC4 bite: dropped type is reported naming the type id", () => {
    const copy = printed();
    delete copy.rules["artifact-structure"][1].types.plan;
    expect(parityMismatches(copy)).toContain("plan: missing from recipe");
  });
  it("AC4 bite: template drift and extra evidence template are reported", () => {
    const copy = printed();
    copy.rules["artifact-structure"][1].types.motive.template += "x";
    copy.rules["artifact-structure"][1].types.evidence.template = "";
    const m = parityMismatches(copy);
    expect(m.some((x) => x.startsWith("motive.template"))).toBe(true);
    expect(m).toContain("evidence.template: must be omitted");
  });
});

describe("recipe round trip", () => {
  test.each(Object.keys(WORKING_TYPES))("AC5 round trip: manifest.mjs accepts renderPath for type %s", (id) => {
    const d = tempDir(`rt-${id}`);
    writeFileSync(path.join(d, ".house-rules.json"), renderRecipe());
    const manifest = resolveConfig(d).rules["artifact-structure"].options;
    const def = manifest.types![id];
    const params: Record<string, string> = {};
    for (const { name } of compileGenerates(def.generates).params) params[name] = name === "slug" ? "foo-bar" : "sample-x";
    const rendered = renderPath(def.generates, params);
    expect(typeof rendered).toBe("string");
    expect(matchPath(rendered, manifest)?.type).toBe(id);
  });
});
