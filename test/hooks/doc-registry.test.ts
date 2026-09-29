import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv } from "ajv";
import { WORKING_TYPES, FORBIDDEN, resolveDocPath, type DocTypeId } from "../../src/hooks/doc-registry.js";

import { forbiddenRedirect } from "../../hooks/lib/house-rules-config/manifest.mjs";

delete process.env.CLAUDE_PROJECT_DIR;

const ROOT = join(import.meta.dir, "..", "..");
const ids = Object.keys(WORKING_TYPES) as DocTypeId[];

const SAMPLE: Record<string, string> = {
  title: "Sample",
  created: "2026-01-01",
  status: "active",
  folds_into: "none",
  reason: "sample",
  question: "Q?",
  confidence: "medium",
};

function makeAjv() {
  const ajv = new Ajv({ strict: false });
  ajv.addFormat("date", /^\d{4}-\d{2}-\d{2}$/);
  return ajv;
}

function parseFrontmatter(text: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) throw new Error("no frontmatter");
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const fill = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => SAMPLE[k] ?? "");

function validate(id: DocTypeId, text: string): boolean {
  return makeAjv().validate(WORKING_TYPES[id].frontmatter, parseFrontmatter(fill(text))) as boolean;
}

describe("AC1 registry shape", () => {
  it("has exactly the expected keys", () => {
    expect([...ids].sort() as string[]).toEqual(
      ["design", "evidence", "handoff", "lessons", "map", "motive", "out-of-scope", "plan", "research", "spec", "ticket"].sort(),
    );
  });
  it("each entry has exactly 7 keys and tier working", () => {
    for (const id of ids) {
      expect(Object.keys(WORKING_TYPES[id]).sort()).toEqual(
        ["description", "frontmatter", "generates", "headings", "instruction", "template", "tier"],
      );
      expect(WORKING_TYPES[id].tier).toBe("working");
    }
  });
  it("evidence template is null, all others non-null", () => {
    expect(WORKING_TYPES.evidence.template).toBeNull();
    for (const id of ids.filter((i) => i !== "evidence")) expect(typeof WORKING_TYPES[id].template).toBe("string");
  });
});

describe("AC2 generates literals", () => {
  it("matches literal paths", () => {
    expect(WORKING_TYPES.motive.generates).toBe(".groundwork/work/{slug}/motive.md");
    expect(WORKING_TYPES.spec.generates).toBe(".groundwork/work/{slug}/spec.md");
    expect(WORKING_TYPES.handoff.generates).toBe(".groundwork/work/{slug}/handoff.md");
    expect(WORKING_TYPES.research.generates).toBe(".groundwork/work/{slug}/research/{name:kebab}.md");
    expect(WORKING_TYPES.ticket.generates).toBe(".groundwork/work/{slug}/tickets/{nn}-{name:kebab}.md");
  });
  it("every generates starts under the work dir", () => {
    for (const id of ids) expect(WORKING_TYPES[id].generates.startsWith(".groundwork/work/{slug}/")).toBe(true);
  });
});

describe("AC3 templates match schema and headings", () => {
  const withTemplate = ids.filter((i) => WORKING_TYPES[i].template !== null);
  for (const id of withTemplate) {
    it(`template for ${id} is valid`, () => {
      const path = join(ROOT, WORKING_TYPES[id].template as string);
      expect(existsSync(path)).toBe(true);
      const text = readFileSync(path, "utf8");
      expect(validate(id, text)).toBe(true);
      for (const h of WORKING_TYPES[id].headings) expect(text).toContain(`## ${h}`);
    });
  }
  it("seeded motive template missing status fails validation", () => {
    expect(validate("motive", "---\ncreated: 2026-01-01\n---\n# T\n")).toBe(false);
    expect(validate("motive", "---\ncreated: 2026-01-01\nstatus: active\n---\n# T\n")).toBe(true);
  });
});

describe("AC4 motive and spec schemas", () => {
  it("motive requires created date and status enum", () => {
    expect(validate("motive", "---\ncreated: 2026-01-01\nstatus: active\n---\n")).toBe(true);
    expect(validate("motive", "---\nstatus: active\n---\n")).toBe(false);
    expect(validate("motive", "---\ncreated: 2026-01-01\n---\n")).toBe(false);
    expect(validate("motive", "---\ncreated: yesterday\nstatus: active\n---\n")).toBe(false);
    expect(validate("motive", "---\ncreated: 2026-01-01\nstatus: bogus\n---\n")).toBe(false);
  });
  it("spec requires folds_into, and reason when none", () => {
    expect(validate("spec", "---\nfolds_into: doc/x.md\n---\n")).toBe(true);
    expect(validate("spec", "---\nfolds_into: none\nreason: temp\n---\n")).toBe(true);
    expect(validate("spec", "---\nfolds_into: none\n---\n")).toBe(false);
    expect(validate("spec", "---\nreason: x\n---\n")).toBe(false);
  });
  it("research requires question and confidence enum", () => {
    expect(validate("research", "---\nquestion: Q?\nconfidence: high\n---\n")).toBe(true);
    expect(validate("research", "---\nquestion: Q?\n---\n")).toBe(false);
    expect(validate("research", "---\nquestion: Q?\nconfidence: sure\n---\n")).toBe(false);
  });
});

describe("AC5 forbidden patterns", () => {
  it("lists the patterns with redirects", () => {
    expect(FORBIDDEN.map((f) => f.pattern)).toEqual([
      "**/adr/**",
      ".scratch/**",
      ".out-of-scope/**",
      "lessons/**",
      "learning-records/**",
      "to-questionnaire-*.md",
      "**/to-questionnaire-*.md",
    ]);
    for (const f of FORBIDDEN) expect(f.redirect.length).toBeGreaterThan(0);
    expect(FORBIDDEN[0].redirect).toContain("$GW event append --type DECISION");
    expect(FORBIDDEN[1].redirect).toContain(".groundwork/work/{slug}/");
    expect(FORBIDDEN[2].redirect).toContain(".groundwork/work/{slug}/out-of-scope.md");
    expect(FORBIDDEN[3].redirect).toContain(".groundwork/work/{slug}/lessons.md");
  });
});

describe("forbidden globs via vendored house-rules matcher", () => {
  const manifest = { forbidden: FORBIDDEN };
  const W = "Use `.groundwork/work/{slug}/";
  it("redirects mattpocock working-doc paths", () => {
    expect(forbiddenRedirect("learning-records/0001-x.md", manifest)).toBe(`${W}lessons.md\``);
    expect(forbiddenRedirect("to-questionnaire-foo.md", manifest)).toBe(`${W}\``);
    expect(forbiddenRedirect("sub/to-questionnaire-foo.md", manifest)).toBe(`${W}\``);
    expect(forbiddenRedirect("src/billing/docs/adr/0001-x.md", manifest)).toContain("$GW event append");
  });
  it("controls return null", () => {
    expect(forbiddenRedirect("docs/learning.md", manifest)).toBeNull();
    expect(forbiddenRedirect("questionnaire.md", manifest)).toBeNull();
  });
});

describe("bare-gw parity", () => {
  // Same predicate as findBareGwLines in test/instructions/bare-gw.test.ts.
  const isBareGw = (text: string) => /`gw\s/.test(text) || /^\s*gw\s/.test(text) || /`\S+\.ts\s/.test(text);
  it("no registry string uses bare gw", () => {
    const strings = [
      ...Object.values(WORKING_TYPES).flatMap((t) => Object.values(t).filter((v): v is string => typeof v === "string")),
      ...FORBIDDEN.flatMap((f) => [f.pattern, f.redirect]),
    ];
    expect(strings.filter(isBareGw)).toEqual([]);
    expect(isBareGw("`gw event append`")).toBe(true);
  });
});

describe("AC6 resolveDocPath", () => {
  it("resolves research example", () => {
    expect(resolveDocPath("research", { slug: "foo", name: "My Note" })).toBe(".groundwork/work/foo/research/my-note.md");
  });
  it("resolves ticket with plain and kebab params", () => {
    expect(resolveDocPath("ticket", { slug: "foo", nn: "01", name: "Do It Now" })).toBe(".groundwork/work/foo/tickets/01-do-it-now.md");
  });
  it("throws on missing param", () => {
    expect(() => resolveDocPath("research", { slug: "foo" })).toThrow(/name/);
  });
  it("camel and pascal cases", () => {
    const orig = WORKING_TYPES.plan.generates;
    try {
      WORKING_TYPES.plan.generates = ".groundwork/work/{slug}/{name:camel}-{name:pascal}.md";
      expect(resolveDocPath("plan", { slug: "s", name: "my cool-note" })).toBe(".groundwork/work/s/myCoolNote-MyCoolNote.md");
    } finally {
      WORKING_TYPES.plan.generates = orig;
    }
  });
});
