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

function parseFrontmatter(text: string): Record<string, string | string[]> {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) throw new Error("no frontmatter");
  const out: Record<string, string | string[]> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const flow = /^\[(.*)\]$/.exec(kv[2]);
    out[kv[1]] = flow ? flow[1].split(",").map((v) => v.trim().replace(/^["']|["']$/g, "")).filter(Boolean) : kv[2].replace(/^["']|["']$/g, "");
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
      ["adr", "design", "evidence", "handoff", "lessons", "map", "motive", "out-of-scope", "plan", "pr-body", "research", "spec", "issue"].sort(),
    );
  });
  it("each entry has exactly 7 required keys, plus headingsWhen only on issue, and the right tier", () => {
    const required = ["description", "frontmatter", "generates", "headings", "instruction", "template", "tier"];
    for (const id of ids) {
      const expected = id === "issue" ? [...required, "headingsWhen"].sort() : required;
      expect(Object.keys(WORKING_TYPES[id]).sort()).toEqual(expected);
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
    expect(WORKING_TYPES.issue.generates).toBe(".groundwork/work/{slug}/tickets/{nn}-{name:kebab}.md");
    expect(WORKING_TYPES.adr.generates).toBe(".groundwork/adr/{nnnn}-{name:kebab}.md");
  });
  it("every generates starts under the work dir", () => {
    for (const id of ids) {
      if (id === "adr") {
        expect(WORKING_TYPES[id].generates).toBe(".groundwork/adr/{nnnn}-{name:kebab}.md");
        continue;
      }
      expect(WORKING_TYPES[id].tier).not.toBe("product");
      expect(WORKING_TYPES[id].generates.startsWith(".groundwork/work/{slug}/")).toBe(true);
    }
  });
  it("pr-body resolves under the work dir", () => {
    expect(resolveDocPath("pr-body", { slug: "demo" })).toBe(".groundwork/work/demo/pr-body.md");
  });
  it("pr-body headings are the six sections", () => {
    expect(WORKING_TYPES["pr-body"].headings).toEqual(["Summary", "Why", "Changes", "Impact", "Review focus", "Proof"]);
  });
  it("forbids per-slug human views under doc/ but not snapshot docs", () => {
    const redirect = "doc/ describes the current code only; draft change intent in `.groundwork/work/{slug}/pr-body.md`";
    for (const p of ["doc/demo/motive.md", "doc/demo/spec.md", "doc/demo/tickets/01-x.md"]) expect(forbiddenRedirect(p, { forbidden: FORBIDDEN })).toBe(redirect);
    for (const p of ["doc/spec/billing.md", "doc/architecture.md"]) expect(forbiddenRedirect(p, { forbidden: FORBIDDEN })).toBeNull();
  });
  it("forbids per-slug human views under docs/ but not snapshot docs", () => {
    const redirect = "doc/ describes the current code only; draft change intent in `.groundwork/work/{slug}/pr-body.md`";
    for (const p of ["docs/demo/motive.md", "docs/demo/spec.md", "docs/demo/tickets/01-x.md"]) expect(forbiddenRedirect(p, { forbidden: FORBIDDEN })).toBe(redirect);
    for (const p of ["docs/spec/billing.md", "docs/architecture.md"]) expect(forbiddenRedirect(p, { forbidden: FORBIDDEN })).toBeNull();
  });
  it("adr instruction exempts format-only migration", () => {
    expect(WORKING_TYPES.adr.instruction).toContain("format-only migration (frontmatter or headings) may edit an accepted record");
  });
});

describe("AC3 templates match schema and headings", () => {
  const withTemplate = ids.filter((i) => WORKING_TYPES[i].template !== null);
  for (const id of withTemplate) {
    it(`template for ${id} is valid`, () => {
      const path = join(ROOT, WORKING_TYPES[id].template as string);
      expect(existsSync(path)).toBe(true);
      const text = readFileSync(path, "utf8");
      if (id === "pr-body") expect(text.startsWith("---")).toBe(false);
      else expect(validate(id, text)).toBe(true);
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
  it("adr requires status enum, and superseded_by when superseded", () => {
    expect(validate("adr", "---\nstatus: accepted\n---\n")).toBe(true);
    expect(validate("adr", "---\nsuperseded_by: x\n---\n")).toBe(false);
    expect(validate("adr", "---\nstatus: bogus\n---\n")).toBe(false);
    expect(validate("adr", "---\nstatus: superseded\n---\n")).toBe(false);
    expect(validate("adr", "---\nstatus: superseded\nsuperseded_by: .groundwork/adr/0002-y.md\n---\n")).toBe(true);
    expect(validate("adr", "---\nstatus: accepted\ndate: 2026-10-11\n---\n")).toBe(true);
    expect(validate("adr", "---\nstatus: accepted\ndate: yesterday\n---\n")).toBe(false);
    expect(validate("adr", "---\nstatus: accepted\nsupersedes: [moor@main ADR 0005]\n---\n")).toBe(true);
    expect(validate("adr", "---\nstatus: accepted\nsupersedes: moor@main ADR 0005\n---\n")).toBe(false);
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
      "**/doc/adr/**",
      "**/docs/adr/**",
      ".scratch/**",
      ".out-of-scope/**",
      "lessons/**",
      "learning-records/**",
      "to-questionnaire-*.md",
      "**/to-questionnaire-*.md",
      "doc/*/motive.md",
      "doc/*/spec.md",
      "doc/*/tickets/**",
      "docs/*/motive.md",
      "docs/*/spec.md",
      "docs/*/tickets/**",
    ]);
    for (const f of FORBIDDEN) expect(f.redirect.length).toBeGreaterThan(0);
    expect(FORBIDDEN[0].redirect).toContain("$GW event append --type DECISION");
    expect(FORBIDDEN[0].redirect).toContain(".groundwork/adr/");
    expect(FORBIDDEN[1].redirect).toContain(".groundwork/adr/");
    expect(FORBIDDEN[2].redirect).toContain(".groundwork/work/{slug}/");
    expect(FORBIDDEN[3].redirect).toContain(".groundwork/work/{slug}/out-of-scope.md");
    expect(FORBIDDEN[4].redirect).toContain(".groundwork/work/{slug}/lessons.md");
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
    for (const p of ["doc/adr/0001-x.md", "docs/adr/0001-x.md", "src/billing/docs/adr/0001-x.md"]) {
      expect(forbiddenRedirect(p, manifest)).toContain(".groundwork/adr/");
    }
  });
  it("controls return null", () => {
    expect(forbiddenRedirect(".groundwork/adr/0001-x.md", manifest)).toBeNull();
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
  it("resolves issue with plain and kebab params", () => {
    expect(resolveDocPath("issue", { slug: "foo", nn: "01", name: "Do It Now" })).toBe(".groundwork/work/foo/tickets/01-do-it-now.md");
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

describe("issue type", () => {
  const schema = () => WORKING_TYPES.issue.frontmatter;
  const ok = (obj: Record<string, unknown>) => makeAjv().validate(schema(), obj) as boolean;

  it("accepts a full frontmatter object and a minimal one", () => {
    expect(
      ok({
        title: "Fix login",
        status: "in-progress",
        assignee: "agent",
        priority: "high",
        tags: ["auth", "bug"],
        parent: "[[demo]]",
        blocked_by: ["[[other]]"],
        source: "user report",
        created: "2026-01-01",
      }),
    ).toBe(true);
    expect(ok({ title: "T", status: "triage" })).toBe(true);
  });
  it("rejects a status outside the enum", () => {
    expect(ok({ title: "T", status: "active" })).toBe(false);
  });
  it("rejects missing title or status", () => {
    expect(ok({ status: "todo" })).toBe(false);
    expect(ok({ title: "T" })).toBe(false);
  });
  it("requires the Acceptance criteria heading only while status is todo or in-progress", () => {
    expect(WORKING_TYPES.issue.headingsWhen).toEqual([
      { property: "status", in: ["todo", "in-progress"], headings: ["Acceptance criteria"] },
    ]);
  });
  it("is the only type matching a tickets path", () => {
    const concrete = ".groundwork/work/demo/tickets/01-demo.md";
    const toRegex = (g: string) =>
      new RegExp("^" + g.split(/\{[^}]+\}/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]+") + "$");
    const matching = ids.filter((id) => toRegex(WORKING_TYPES[id].generates).test(concrete));
    expect(matching).toEqual(["issue"]);
  });
  const tpl = () => readFileSync(join(ROOT, "templates/doc-types/issue.md"), "utf8");
  it("template validates against the schema", () => {
    expect(validate("issue", tpl())).toBe(true);
  });
  it("template has no H1", () => {
    expect(/^# /m.test(tpl())).toBe(false);
  });
  it("template has acceptance criteria and comments", () => {
    const text = tpl();
    expect(text).toContain("## Acceptance criteria");
    expect(text).toMatch(/^- \[ \]/m);
    expect(text).toContain("## Comments");
  });
});
