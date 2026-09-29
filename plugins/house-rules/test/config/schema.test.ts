import { describe, it, expect } from "bun:test";
import {
  ConfigError,
  PRESETS,
  RULE_IDS,
  RULE_OPTION_KEYS,
  RULE_SEVERITIES,
  SEVERITIES,
  TIERS,
  TOP_LEVEL_KEYS,
  TYPE_KEYS,
  FORBIDDEN_KEYS,
  parseConfig,
} from "../../src/config/schema.mjs";

type Allowed = string[];

function allowedText(allowed: Allowed): string {
  return allowed.length === 0 ? "no options" : allowed.join(", ");
}

function capture(text: string): any {
  expect(() => parseConfig(text)).toThrow();
  try {
    parseConfig(text);
  } catch (err) {
    return err;
  }
  throw new Error("parseConfig did not throw");
}

function expectConfigError(
  text: string,
  path: string,
  allowed: Allowed,
  ...substrings: string[]
): void {
  const err = capture(text);
  expect(err instanceof ConfigError).toBe(true);
  expect(err.path).toBe(path);
  expect(err.allowed).toEqual(allowed);
  if (path !== "") expect(err.message).toContain(path);
  for (const a of allowed) expect(err.message).toContain(a);
  expect(err.message).toContain(`allowed: ${allowedText(allowed)}`);
  for (const s of substrings) expect(err.message).toContain(s);
}

const SEV = ["error"];
const SHAPE = ["severity string", "[severity]", "[severity, options]"];
const CD = 'rules["comment-density"]';
const CM = 'rules["commit-message"]';
const SA = 'rules["artifact-structure"]';

describe("parseConfig valid input", () => {
  it("normalizes the full shape", () => {
    const text = JSON.stringify({
      $schema: "https://x",
      rules: {
        "commit-message": ["error", { preset: "conventional" }],
        "comment-density": "error",
        "artifact-structure": "error",
      },
    });
    expect(parseConfig(text)).toEqual({
      rules: {
        "commit-message": { severity: "error", options: { preset: "conventional" } },
        "comment-density": { severity: "error", options: {} },
        "artifact-structure": { severity: "error", options: {} },
      },
    });
  });

  it("leaves absent rules absent", () => {
    const out = parseConfig('{"rules":{"comment-density":"error"}}');
    expect(out).toEqual({
      rules: { "comment-density": { severity: "error", options: {} } },
    });
  });

  it("accepts the single-element array form", () => {
    expect(parseConfig('{"rules":{"artifact-structure":["error"]}}')).toEqual({
      rules: { "artifact-structure": { severity: "error", options: {} } },
    });
  });

  it("accepts the old stray-artifacts id as an alias key", () => {
    expect(parseConfig('{"rules":{"stray-artifacts":"error"}}')).toEqual({
      rules: { "stray-artifacts": { severity: "error", options: {} } },
    });
  });

  it("accepts the new artifact-structure id alone", () => {
    expect(parseConfig('{"rules":{"artifact-structure":"error"}}')).toEqual({
      rules: { "artifact-structure": { severity: "error", options: {} } },
    });
  });

  it("accepts both alias and canonical keys at parse level", () => {
    const out = parseConfig('{"rules":{"stray-artifacts":"error","artifact-structure":"error"}}');
    expect(Object.keys(out.rules).sort()).toEqual(["artifact-structure", "stray-artifacts"]);
  });

  it("accepts an empty object", () => {
    expect(parseConfig("{}")).toEqual({ rules: {} });
  });

  it("accepts every preset", () => {
    for (const preset of PRESETS) {
      const out = parseConfig(`{"rules":{"commit-message":["error",{"preset":"${preset}"}]}}`);
      expect(out.rules["commit-message"]).toEqual({ severity: "error", options: { preset } });
    }
  });
});

describe("parseConfig invalid input", () => {
  it("rejects invalid JSON", () => {
    expectConfigError("{not json", "", ["valid JSON"], "invalid JSON");
  });

  it("rejects a non-object root", () => {
    expectConfigError("[]", "", ["object"]);
    expectConfigError("null", "", ["object"]);
  });

  it("rejects an unknown top-level key", () => {
    expectConfigError('{"foo":1}', "foo", ["$schema", "rules"], "unknown key");
  });

  it("rejects a non-string $schema", () => {
    expectConfigError('{"$schema":1}', "$schema", ["string"]);
  });

  it("rejects non-object rules", () => {
    expectConfigError('{"rules":[]}', "rules", ["object"]);
  });

  it("rejects the old flat shape with a migration hint", () => {
    expectConfigError(
      '{"commit-message":{"preset":"handbook"}}',
      "commit-message",
      ["$schema", "rules"],
      '{"rules":{"commit-message":["error",{"preset":"handbook"}]}}',
    );
  });

  it("rejects an unknown rule", () => {
    expectConfigError('{"rules":{"foo":"error"}}', 'rules["foo"]', [...RULE_IDS], "unknown rule");
  });

  it("rejects a bad value shape", () => {
    for (const v of ["1", "[]", '["error",{},1]']) {
      expectConfigError(`{"rules":{"artifact-structure":${v}}}`, SA, SHAPE);
    }
  });

  it("rejects a bad severity string", () => {
    expectConfigError('{"rules":{"artifact-structure":"fatal"}}', SA, SEV);
  });

  it("rejects off and warn severities for every rule", () => {
    for (const rule of [CM, CD, SA]) {
      for (const sev of ["off", "warn"]) {
        const err = capture(`{"rules":{${JSON.stringify(rule.slice(7, -2))}:"${sev}"}}`);
        expect(err.path).toBe(rule);
        expect(err.message).toContain("invalid severity; allowed: error");
        const arr = capture(`{"rules":{${JSON.stringify(rule.slice(7, -2))}:["${sev}"]}}`);
        expect(arr.path).toBe(`${rule}[0]`);
        expect(arr.message).toContain("invalid severity; allowed: error");
      }
    }
    const off = capture('{"rules":{"artifact-structure":"off"}}');
    expect(off.path).toBe(SA);
    expect(off.message).toContain("allowed: error");
  });

  it("rejects a bad severity in array form", () => {
    expectConfigError('{"rules":{"comment-density":["loud"]}}', `${CD}[0]`, SEV);
  });

  it("restricts commit-message severity to error", () => {
    for (const sev of ["warn", "off"]) {
      expectConfigError(`{"rules":{"commit-message":"${sev}"}}`, CM, ["error"]);
      expectConfigError(`{"rules":{"commit-message":["${sev}"]}}`, `${CM}[0]`, ["error"]);
    }
  });

  it("rejects non-object options", () => {
    expectConfigError('{"rules":{"comment-density":["error","x"]}}', `${CD}[1]`, ["object"]);
  });

  it("rejects unknown options", () => {
    expectConfigError(
      '{"rules":{"comment-density":["error",{"foo":1}]}}',
      `${CD}[1].foo`,
      [],
      "unknown option",
    );
    expectConfigError('{"rules":{"artifact-structure":["error",{"x":1}]}}', `${SA}[1].x`, [
      "govern",
      "types",
      "forbidden",
    ]);
  });

  it("rejects a bad preset", () => {
    expectConfigError(
      '{"rules":{"commit-message":["error",{"preset":"angular"}]}}',
      `${CM}[1].preset`,
      [...PRESETS],
    );
  });

  it("rejects max_per_100 as an unknown option", () => {
    for (const v of ["5", "0", "100", "101", "5.5", '"5"']) {
      const err = capture(`{"rules":{"comment-density":["error",{"max_per_100":${v}}]}}`);
      expect(err.path).toBe(`${CD}[1].max_per_100`);
      expect(err.allowed).toEqual([]);
      expect(err.message).toContain("unknown option; allowed: no options");
    }
  });

  it("never mentions env vars or bypasses in messages", () => {
    const samples = [
      "{not json",
      "[]",
      '{"foo":1}',
      '{"$schema":1}',
      '{"rules":[]}',
      '{"commit-message":{"preset":"handbook"}}',
      '{"rules":{"foo":"error"}}',
      '{"rules":{"artifact-structure":1}}',
      '{"rules":{"artifact-structure":"fatal"}}',
      '{"rules":{"comment-density":["loud"]}}',
      '{"rules":{"commit-message":"off"}}',
      '{"rules":{"comment-density":["error","x"]}}',
      '{"rules":{"comment-density":["error",{"foo":1}]}}',
      '{"rules":{"commit-message":["error",{"preset":"angular"}]}}',
      '{"rules":{"comment-density":["error",{"max_per_100":101}]}}',
    ];
    for (const s of samples) {
      const err = capture(s);
      expect(err.message).not.toMatch(/env|HOUSE_RULES_|kill.?switch|bypass/i);
    }
  });
});

describe("exported constants", () => {
  it("pins exact values", () => {
    expect(RULE_IDS).toEqual(["commit-message", "comment-density", "artifact-structure"]);
    expect(SEVERITIES).toEqual(["error"]);
    expect(RULE_SEVERITIES).toEqual({
      "commit-message": ["error"],
      "comment-density": ["error"],
      "artifact-structure": ["error"],
    });
    expect(PRESETS).toEqual(["handbook", "conventional", "subject-only"]);
    expect(RULE_OPTION_KEYS).toEqual({
      "commit-message": ["preset"],
      "comment-density": [],
      "artifact-structure": ["govern", "types", "forbidden"],
    });
    expect(TIERS).toEqual(["product", "working", "ephemeral"]);
    expect(TYPE_KEYS).toEqual([
      "tier",
      "generates",
      "description",
      "instruction",
      "template",
      "frontmatter",
      "headings",
    ]);
    expect(FORBIDDEN_KEYS).toEqual(["pattern", "redirect"]);
    expect(TOP_LEVEL_KEYS).toEqual(["$schema", "rules"]);
  });
});

const fullType: any = {
  tier: "working",
  generates: "{dir}/research/{name:kebab}.md",
  description: "Research note",
  instruction: "Write findings",
  template: "# {title}\n",
  frontmatter: { type: "object", properties: { title: { type: "string" } } },
  headings: ["Summary", "Sources"],
};
const manifest: any = {
  govern: ["docs/**"],
  types: { research: fullType, plain: { tier: "product", generates: "docs/{name}.md" } },
  forbidden: [{ pattern: "**/scratch/**", redirect: "docs/{slug}.md" }],
};
const withOpts = (id: string, opts: unknown) =>
  JSON.stringify({ rules: { [id]: ["error", opts] } });

describe("AC1 artifact-structure manifest options", () => {
  for (const id of ["artifact-structure", "stray-artifacts"]) {
    it(`AC1: accepts ["error",{govern,types,forbidden}] with every type key (${id})`, () => {
      expect(TYPE_KEYS.every((k: string) => k in fullType)).toBe(true);
      const out: any = parseConfig(withOpts(id, manifest));
      expect(out.rules[id]).toEqual({ severity: "error", options: manifest });
    });

    it(`AC1: unknown type key throws ConfigError with exact path (${id})`, () => {
      const bad = { types: { research: { ...fullType, bogus: 1 } } };
      const err = capture(withOpts(id, bad));
      expect(err instanceof ConfigError).toBe(true);
      expect(err.path).toBe(`rules["${id}"][1].types.research.bogus`);
      expect(err.allowed).toEqual([...TYPE_KEYS]);
    });
  }

  it('AC1: unknown type key path is exactly rules["artifact-structure"][1].types.research.bogus', () => {
    const err = capture(withOpts("artifact-structure", { types: { research: { ...fullType, bogus: 1 } } }));
    expect(err.path).toBe('rules["artifact-structure"][1].types.research.bogus');
  });

  it("AC1: forbidden entry unknown key throws with path", () => {
    const err = capture(
      withOpts("artifact-structure", { forbidden: [{ pattern: "a", redirect: "b", bogus: 1 }] }),
    );
    expect(err instanceof ConfigError).toBe(true);
    expect(err.path).toBe(`${SA}[1].forbidden[0].bogus`);
    expect(err.allowed).toEqual([...FORBIDDEN_KEYS]);
  });

  it("AC1: forbidden entry missing redirect throws", () => {
    const err = capture(withOpts("artifact-structure", { forbidden: [{ pattern: "a" }] }));
    expect(err.path).toBe(`${SA}[1].forbidden[0].redirect`);
  });

  it("AC1: rejects a bad tier", () => {
    const err = capture(withOpts("artifact-structure", { types: { r: { tier: "x", generates: "a" } } }));
    expect(err.path).toBe(`${SA}[1].types.r.tier`);
    expect(err.allowed).toEqual([...TIERS]);
  });

  it("AC1: rejects headings that is not an array", () => {
    const err = capture(
      withOpts("artifact-structure", { types: { r: { tier: "product", generates: "a", headings: "H" } } }),
    );
    expect(err.path).toBe(`${SA}[1].types.r.headings`);
    expect(err.allowed).toEqual(["string[]"]);
  });

  it("AC1: rejects a type missing generates", () => {
    const err = capture(withOpts("artifact-structure", { types: { r: { tier: "product" } } }));
    expect(err.path).toBe(`${SA}[1].types.r.generates`);
    expect(err.message).toContain("required");
  });

  it("AC1: rejects a type missing tier", () => {
    const err = capture(withOpts("artifact-structure", { types: { r: { generates: "a" } } }));
    expect(err.path).toBe(`${SA}[1].types.r.tier`);
  });
});

describe("AC2 legacy shapes keep options empty", () => {
  for (const id of ["artifact-structure", "stray-artifacts"]) {
    for (const v of ['"error"', '["error"]', '["error",{}]']) {
      it(`AC2: ${id} ${v} parses with options {} and no types key`, () => {
        const rule = (parseConfig(`{"rules":{"${id}":${v}}}`) as any).rules[id];
        expect(rule).toEqual({ severity: "error", options: {} });
        expect(Object.hasOwn(rule.options, "types")).toBe(false);
      });
    }
  }
});
