import { describe, it, expect } from "bun:test";
import {
  ConfigError,
  MAX_PER_100_RANGE,
  PRESETS,
  RULE_IDS,
  RULE_OPTION_KEYS,
  RULE_SEVERITIES,
  SEVERITIES,
  TOP_LEVEL_KEYS,
  parseConfig,
} from "../../src/config/schema.mjs";

type Allowed = string[] | { min: number; max: number };

function allowedText(allowed: Allowed): string {
  return Array.isArray(allowed)
    ? allowed.join(", ")
    : `integer ${allowed.min}..${allowed.max}`;
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
  if (Array.isArray(allowed)) {
    for (const a of allowed) expect(err.message).toContain(a);
  }
  expect(err.message).toContain(`allowed: ${allowedText(allowed)}`);
  for (const s of substrings) expect(err.message).toContain(s);
}

const SEV = ["off", "warn", "error"];
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
        "comment-density": ["error", { max_per_100: 5 }],
        "stray-artifacts": "error",
      },
    });
    expect(parseConfig(text)).toEqual({
      rules: {
        "commit-message": { severity: "error", options: { preset: "conventional" } },
        "comment-density": { severity: "error", options: { max_per_100: 5 } },
        "stray-artifacts": { severity: "error", options: {} },
      },
    });
  });

  it("leaves absent rules absent", () => {
    const out = parseConfig('{"rules":{"comment-density":"warn"}}');
    expect(out).toEqual({
      rules: { "comment-density": { severity: "warn", options: {} } },
    });
  });

  it("accepts the single-element array form", () => {
    expect(parseConfig('{"rules":{"stray-artifacts":["off"]}}')).toEqual({
      rules: { "stray-artifacts": { severity: "off", options: {} } },
    });
  });

  it("accepts an empty object", () => {
    expect(parseConfig("{}")).toEqual({ rules: {} });
  });

  it("accepts max_per_100 boundaries", () => {
    for (const n of [0, 100]) {
      const out = parseConfig(`{"rules":{"comment-density":["error",{"max_per_100":${n}}]}}`);
      expect(out).toEqual({
        rules: { "comment-density": { severity: "error", options: { max_per_100: n } } },
      });
    }
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
      ["max_per_100"],
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

  it("rejects out-of-range or non-integer max_per_100", () => {
    for (const v of ["5.5", "-1", "101", '"5"']) {
      expectConfigError(
        `{"rules":{"comment-density":["error",{"max_per_100":${v}}]}}`,
        `${CD}[1].max_per_100`,
        { min: 0, max: 100 },
        "0..100",
      );
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
    expect(SEVERITIES).toEqual(["off", "warn", "error"]);
    expect(RULE_SEVERITIES).toEqual({
      "commit-message": ["error"],
      "comment-density": ["off", "warn", "error"],
      "stray-artifacts": ["off", "warn", "error"],
    });
    expect(PRESETS).toEqual(["handbook", "conventional", "subject-only"]);
    expect(MAX_PER_100_RANGE).toEqual({ min: 0, max: 100 });
    expect(RULE_OPTION_KEYS).toEqual({
      "commit-message": ["preset"],
      "comment-density": ["max_per_100"],
      "stray-artifacts": [],
    });
    expect(TOP_LEVEL_KEYS).toEqual(["$schema", "rules"]);
  });
});
