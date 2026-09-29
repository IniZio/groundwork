import { describe, it, expect } from "bun:test";
import {
  ConfigError,
  PRESETS,
  RULE_IDS,
  RULE_OPTION_KEYS,
  RULE_SEVERITIES,
  SEVERITIES,
  TOP_LEVEL_KEYS,
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
const SA = 'rules["stray-artifacts"]';

describe("parseConfig valid input", () => {
  it("normalizes the full shape", () => {
    const text = JSON.stringify({
      $schema: "https://x",
      rules: {
        "commit-message": ["error", { preset: "conventional" }],
        "comment-density": "error",
        "stray-artifacts": "error",
      },
    });
    expect(parseConfig(text)).toEqual({
      rules: {
        "commit-message": { severity: "error", options: { preset: "conventional" } },
        "comment-density": { severity: "error", options: {} },
        "stray-artifacts": { severity: "error", options: {} },
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
    expect(parseConfig('{"rules":{"stray-artifacts":["error"]}}')).toEqual({
      rules: { "stray-artifacts": { severity: "error", options: {} } },
    });
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
      expectConfigError(`{"rules":{"stray-artifacts":${v}}}`, SA, SHAPE);
    }
  });

  it("rejects a bad severity string", () => {
    expectConfigError('{"rules":{"stray-artifacts":"fatal"}}', SA, SEV);
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
    const off = capture('{"rules":{"stray-artifacts":"off"}}');
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
    expectConfigError('{"rules":{"stray-artifacts":["error",{"x":1}]}}', `${SA}[1].x`, []);
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
      '{"rules":{"stray-artifacts":1}}',
      '{"rules":{"stray-artifacts":"fatal"}}',
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
    expect(RULE_IDS).toEqual(["commit-message", "comment-density", "stray-artifacts"]);
    expect(SEVERITIES).toEqual(["error"]);
    expect(RULE_SEVERITIES).toEqual({
      "commit-message": ["error"],
      "comment-density": ["error"],
      "stray-artifacts": ["error"],
    });
    expect(PRESETS).toEqual(["handbook", "conventional", "subject-only"]);
    expect(RULE_OPTION_KEYS).toEqual({
      "commit-message": ["preset"],
      "comment-density": [],
      "stray-artifacts": [],
    });
    expect(TOP_LEVEL_KEYS).toEqual(["$schema", "rules"]);
  });
});
