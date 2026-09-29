import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  ConfigError,
  PRESETS,
  RULE_IDS,
  RULE_OPTION_KEYS,
  RULE_SEVERITIES,
  TOP_LEVEL_KEYS,
  parseConfig,
} from "../../src/config/schema.mjs";

const schemaPath = join(import.meta.dir, "..", "..", "house-rules.schema.json");
const schema: any = JSON.parse(readFileSync(schemaPath, "utf8"));
const validate = new Ajv2020().compile(schema);

const sorted = (xs: readonly string[]) => [...xs].sort();
const ruleNodes: Record<string, any> = schema.properties.rules.properties;

function optionsNode(id: string): any {
  return ruleNodes[id].oneOf[1].prefixItems[1];
}

describe("schema constants parity", () => {
  it("top-level keys match TOP_LEVEL_KEYS", () => {
    expect(sorted(Object.keys(schema.properties))).toEqual(sorted(TOP_LEVEL_KEYS));
  });

  it("rule ids match RULE_IDS", () => {
    expect(sorted(Object.keys(ruleNodes))).toEqual(sorted(RULE_IDS));
  });

  it("additionalProperties is false at root and rules", () => {
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.rules.additionalProperties).toBe(false);
  });

  it("walker visits every rule", () => {
    let visited = 0;
    for (const id of RULE_IDS) {
      expect(ruleNodes[id]).toBeDefined();
      expect(optionsNode(id)).toBeDefined();
      visited++;
    }
    expect(visited).toBe(RULE_IDS.length);
    expect(visited).toBeGreaterThan(0);
  });

  for (const id of RULE_IDS) {
    describe(id, () => {
      it("severity enums match RULE_SEVERITIES", () => {
        const expected = sorted(RULE_SEVERITIES[id]);
        expect(sorted(ruleNodes[id].oneOf[0].enum)).toEqual(expected);
        expect(sorted(ruleNodes[id].oneOf[1].prefixItems[0].enum)).toEqual(expected);
      });

      it("options object is closed with keys matching RULE_OPTION_KEYS", () => {
        const node = optionsNode(id);
        expect(node.additionalProperties).toBe(false);
        expect(sorted(Object.keys(node.properties))).toEqual(sorted(RULE_OPTION_KEYS[id]));
      });
    });
  }

  it("preset enum matches PRESETS", () => {
    const preset = optionsNode("commit-message").properties.preset;
    expect(preset.type).toBe("string");
    expect(sorted(preset.enum)).toEqual(sorted(PRESETS));
  });
});

const fixtures: [string, unknown, boolean][] = [
  ["empty object", {}, true],
  ["$schema string", { $schema: "x" }, true],
  ["empty rules", { rules: {} }, true],
  ["comment-density error string", { rules: { "comment-density": "error" } }, true],
  ["stray-artifacts error string", { rules: { "stray-artifacts": "error" } }, true],
  ["commit-message error string", { rules: { "commit-message": "error" } }, true],
  ["comment-density [error]", { rules: { "comment-density": ["error"] } }, true],
  ["stray-artifacts [error]", { rules: { "stray-artifacts": ["error"] } }, true],
  ["commit-message [error]", { rules: { "commit-message": ["error"] } }, true],
  ["preset handbook", { rules: { "commit-message": ["error", { preset: "handbook" }] } }, true],
  ["preset conventional", { rules: { "commit-message": ["error", { preset: "conventional" }] } }, true],
  ["preset subject-only", { rules: { "commit-message": ["error", { preset: "subject-only" }] } }, true],
  ["comment-density empty options", { rules: { "comment-density": ["error", {}] } }, true],
  ["stray-artifacts empty options", { rules: { "stray-artifacts": ["error", {}] } }, true],
  ["comment-density warn", { rules: { "comment-density": "warn" } }, false],
  ["comment-density off", { rules: { "comment-density": "off" } }, false],
  ["comment-density [warn]", { rules: { "comment-density": ["warn"] } }, false],
  ["stray-artifacts warn", { rules: { "stray-artifacts": "warn" } }, false],
  ["stray-artifacts off", { rules: { "stray-artifacts": "off" } }, false],
  ["stray-artifacts [warn, {}]", { rules: { "stray-artifacts": ["warn", {}] } }, false],
  ["comment-density max_per_100", { rules: { "comment-density": ["error", { max_per_100: 5 }] } }, false],
  ["comment-density max_per_100 empty-ish", { rules: { "comment-density": ["error", { max_per_100: 0 }] } }, false],
  ["unknown top-level key", { extra: 1 }, false],
  ["unknown rule", { rules: { nope: "warn" } }, false],
  ["comment-density preset option", { rules: { "comment-density": ["error", { preset: "handbook" }] } }, false],
  ["stray-artifacts unknown option", { rules: { "stray-artifacts": ["error", { x: 1 }] } }, false],
  ["bad severity fatal", { rules: { "comment-density": "fatal" } }, false],
  ["commit-message warn", { rules: { "commit-message": "warn" } }, false],
  ["commit-message off", { rules: { "commit-message": "off" } }, false],
  ["commit-message [warn]", { rules: { "commit-message": ["warn"] } }, false],
  ["bad preset", { rules: { "commit-message": ["error", { preset: "bogus" }] } }, false],
  ["empty tuple", { rules: { "comment-density": [] } }, false],
  ["three-element tuple", { rules: { "comment-density": ["error", {}, {}] } }, false],
  ["tuple string options", { rules: { "comment-density": ["error", "x"] } }, false],
  ["tuple null options", { rules: { "comment-density": ["error", null] } }, false],
  ["old shape preset object", { "commit-message": { preset: "handbook" } }, false],
  ["$schema number", { $schema: 1 }, false],
  ["rules as array", { rules: [] }, false],
  ["root as array", [], false],
];

describe("ajv and parseConfig agree", () => {
  it("has enough fixtures", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(15);
  });

  it.each(fixtures)("%s", (_label, value, expected) => {
    const ajvValid = validate(value);
    let parseOk = true;
    try {
      parseConfig(JSON.stringify(value));
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      parseOk = false;
    }
    expect(ajvValid).toBe(expected);
    expect(parseOk).toBe(expected);
  });
});
