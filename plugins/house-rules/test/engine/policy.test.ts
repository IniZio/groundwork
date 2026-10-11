import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BUILTIN_POLICY, policyForRoot } from "../../src/engine/policy.js";

const NEW_IDS = ["type-escape-hatches", "no-module-mocking", "code-smells"];

function tmpWith(text: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hr-policy-"));
  if (text !== null) fs.writeFileSync(path.join(dir, ".house-rules.json"), text);
  return dir;
}

describe("BUILTIN_POLICY", () => {
  it("lists the 3 new ids at warn, no autofix", () => {
    for (const id of NEW_IDS) {
      expect(BUILTIN_POLICY[id]).toEqual({ severity: "warn", autofix: false });
    }
  });

  it("lists effect at off, no autofix", () => {
    expect(BUILTIN_POLICY["effect"]).toEqual({ severity: "off", autofix: false });
  });
});

describe("policyForRoot", () => {
  it("defaults require-safety-comment-for-type-assertion to warn and overlays off", () => {
    const id = "require-safety-comment-for-type-assertion";
    expect(policyForRoot(tmpWith(JSON.stringify({ rules: {} })))[id]).toEqual({ severity: "warn", autofix: false });
    expect(policyForRoot(tmpWith(JSON.stringify({ rules: { [id]: "off" } })))[id]).toEqual({
      severity: "off",
      autofix: false,
    });
  });

  it("overlays configured effect warn and defaults effect off", () => {
    const on = policyForRoot(tmpWith(JSON.stringify({ rules: { effect: "warn" } })));
    expect(on["effect"]).toEqual({ severity: "warn", autofix: false });
    const dflt = policyForRoot(tmpWith(JSON.stringify({ rules: {} })));
    expect(dflt["effect"]).toEqual({ severity: "off", autofix: false });
  });

  it("keeps effect off when config invalid", () => {
    expect(policyForRoot(tmpWith("{not json"))["effect"]).toEqual({ severity: "off", autofix: false });
    expect(policyForRoot(tmpWith(JSON.stringify({ rules: { effect: "error" } })))["effect"]).toEqual({
      severity: "off",
      autofix: false,
    });
  });

  it("applies configured off/warn to new ids only", () => {
    const dir = tmpWith(
      JSON.stringify({ rules: { "type-escape-hatches": "off", "code-smells": "warn", "comment-density": "error" } }),
    );
    const p = policyForRoot(dir);
    expect(p["type-escape-hatches"].severity).toBe("off");
    expect(p["code-smells"].severity).toBe("warn");
    expect(p["no-module-mocking"].severity).toBe("warn");
    expect(p["comment-density"]).toEqual(BUILTIN_POLICY["comment-density"]);
    expect(p["artifact-structure"]).toEqual(BUILTIN_POLICY["artifact-structure"]);
  });

  it("falls back to BUILTIN_POLICY when config missing", () => {
    expect(policyForRoot(tmpWith(null))).toEqual(BUILTIN_POLICY);
  });

  it("falls back to BUILTIN_POLICY when config invalid", () => {
    expect(policyForRoot(tmpWith("{not json"))).toEqual(BUILTIN_POLICY);
    expect(policyForRoot(tmpWith(JSON.stringify({ rules: { "code-smells": "error" } })))).toEqual(BUILTIN_POLICY);
  });
});
