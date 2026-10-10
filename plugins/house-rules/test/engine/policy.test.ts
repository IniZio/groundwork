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
});

describe("policyForRoot", () => {
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
