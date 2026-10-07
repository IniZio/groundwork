/**
 * Parity test: doc/authoring-rules.md and rules/authoring-rules.md must agree
 * on every load-bearing rule. Checks meaning-bearing markers, not exact prose,
 * so either file can be reworded as long as the rule is present in both.
 *
 * "Load-bearing" = a rule whose removal causes incorrect model behavior.
 * The forbidden zones are weighted most heavily.
 */

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const DOC = path.join(ROOT, "doc/authoring-rules.md");
const RUNTIME = path.join(ROOT, "rules/authoring-rules.md");

/**
 * Each entry: { name, patterns }
 * The rule is present if ANY pattern matches (case-insensitive).
 * Both doc and runtime must contain the rule.
 */
const LOAD_BEARING_RULES: { name: string; patterns: RegExp[] }[] = [
  {
    name: "negations inviolable (not/never/no/only/except preserved)",
    patterns: [
      /negation/i,
      /never remove.*\bnot\b/i,
      /\bnot\b.*\bnever\b.*\bno\b.*\bonly\b.*\bexcept\b/i,
    ],
  },
  {
    name: "modality preserved (never upgrade may/could/might to will/does/always)",
    patterns: [
      /modality/i,
      /never upgrade.*may/i,
      /may.*could.*might.*appears to/i,
    ],
  },
  {
    name: "no invented abbreviations",
    patterns: [
      /invented abbreviation/i,
    ],
  },
  {
    name: "evidence verbatim (citations, test output, file:line, errors not paraphrased)",
    patterns: [
      /evidence verbatim/i,
      /verbatim.*citation/i,
      /never paraphrase/i,
    ],
  },
  {
    name: "sequencing prose not compressed (multi-step sequences stay full sentences)",
    patterns: [
      /sequencing prose/i,
      /multi.?step.*misread/i,
      /sequencing.*not compressed/i,
    ],
  },
  {
    name: "never grow (compression never adds words)",
    patterns: [/never grow/i],
  },
  {
    name: "auto-clarity (security, irreversible, ambiguity stay full sentences)",
    patterns: [/auto-clarity/i],
  },
  {
    name: "no arrows as prose shorthand",
    patterns: [/no arrows/i],
  },
  {
    name: "routing rule (reviewer yes/no flip goes to human view)",
    patterns: [/flip a reviewer'?s yes\/no/i],
  },
  {
    name: "human writing standard section",
    patterns: [/human writing standard/i],
  },
  {
    name: "lead with the point",
    patterns: [/lead with the point/i],
  },
  {
    name: "no baseline CI claims",
    patterns: [/baseline CI/i],
  },
  {
    name: "file mentions as permalinks pinned to a commit",
    patterns: [/permalink/i],
  },
  {
    name: "flows as diagrams",
    patterns: [/diagram/i],
  },
  {
    name: "each decision carries rejected alternative",
    patterns: [/rejected alternative/i],
  },
  {
    name: "controlled English ASD-STE100",
    patterns: [/ASD-STE100/i],
  },
  {
    name: "no agent bookkeeping in human view",
    patterns: [/agent bookkeeping/i],
  },
];

function rulePresent(content: string, rule: { name: string; patterns: RegExp[] }): boolean {
  return rule.patterns.some(p => p.test(content));
}

describe("authoring-rules parity: doc vs runtime", () => {
  const docContent = readFileSync(DOC, "utf8");
  const runtimeContent = readFileSync(RUNTIME, "utf8");

  it("runtime rules file exists and is non-empty", () => {
    expect(runtimeContent.trim().length).toBeGreaterThan(0);
  });

  for (const rule of LOAD_BEARING_RULES) {
    it(`doc contains: ${rule.name}`, () => {
      expect(
        rulePresent(docContent, rule),
        `doc/authoring-rules.md missing load-bearing rule: "${rule.name}"`,
      ).toBe(true);
    });

    it(`runtime contains: ${rule.name}`, () => {
      expect(
        rulePresent(runtimeContent, rule),
        `rules/authoring-rules.md missing load-bearing rule: "${rule.name}" — runtime file has drifted from doc`,
      ).toBe(true);
    });
  }
});

describe("routing rule stated once", () => {
  const ROUTING = /flip a reviewer'?s yes\/no/gi;
  const count = (content: string) => (content.match(ROUTING) ?? []).length;

  it("doc/authoring-rules.md states the routing rule exactly once", () => {
    const n = count(readFileSync(DOC, "utf8"));
    expect(n, `doc/authoring-rules.md routing rule appears ${n} times, expected exactly 1`).toBe(1);
  });

  it("rules/authoring-rules.md states the routing rule exactly once", () => {
    const n = count(readFileSync(RUNTIME, "utf8"));
    expect(n, `rules/authoring-rules.md routing rule appears ${n} times, expected exactly 1`).toBe(1);
  });
});
