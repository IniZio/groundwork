import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runRules, isBlocking } from "../../src/engine/run.js";
import { loadRules } from "../../src/engine/registry.js";
import type { Rule, RuleContext, Finding } from "../../src/engine/types.js";
import type { PolicyEntry } from "../../src/engine/policy.js";

// ---------------------------------------------------------------------------
// Type-level parity: DiffHunk in types.ts must be mutually assignable with
// the structural twin in src/hooks/lib/work-scope.ts (HR-02 moves it there).
// ---------------------------------------------------------------------------
const _diffHunkAtoB: import('../../src/hooks/lib/work-scope.js').DiffHunk =
  {} as import('../../src/engine/types.js').DiffHunk;
const _diffHunkBtoA: import('../../src/engine/types.js').DiffHunk =
  {} as import('../../src/hooks/lib/work-scope.js').DiffHunk;
// Suppress unused-variable warnings (values are intentionally unused)
void _diffHunkAtoB; void _diffHunkBtoA;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CTX: RuleContext = { repoRoot: "/repo", mode: "guard" };

function makeRule(id: string, findings: Finding[]): Rule {
  return {
    id,
    meta: { description: `stub rule ${id}` },
    vehicles: ["diff"],
    check: () => findings,
  };
}

function makeFinding(filePath: string, extra?: Partial<Finding>): Finding {
  return {
    ruleId: "test-rule",
    path: filePath,
    message: "test message",
    fingerprintBasis: `${filePath}:test`,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// runRules — severity filtering
// ---------------------------------------------------------------------------

describe("runRules — severity filtering", () => {
  it("off drops a rule's findings entirely", async () => {
    const rule = makeRule("my-rule", [makeFinding("src/foo.ts")]);
    const policy: Record<string, PolicyEntry> = {
      "my-rule": { severity: "off", autofix: false },
    };
    const findings = await runRules([rule], CTX, policy, []);
    expect(findings).toHaveLength(0);
  });

  it("warn keeps findings but isBlocking returns false", async () => {
    const rule = makeRule("my-rule", [makeFinding("src/foo.ts")]);
    const policy: Record<string, PolicyEntry> = {
      "my-rule": { severity: "warn", autofix: false },
    };
    const findings = await runRules([rule], CTX, policy, []);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warn");
    expect(isBlocking(findings)).toBe(false);
  });

  it("error keeps findings and isBlocking returns true", async () => {
    const rule = makeRule("my-rule", [makeFinding("src/foo.ts")]);
    const policy: Record<string, PolicyEntry> = {
      "my-rule": { severity: "error", autofix: false },
    };
    const findings = await runRules([rule], CTX, policy, []);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(isBlocking(findings)).toBe(true);
  });

  it("rule with no policy entry defaults to warn", async () => {
    const rule = makeRule("unknown-rule", [makeFinding("src/foo.ts")]);
    const findings = await runRules([rule], CTX, {}, []);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warn");
    expect(isBlocking(findings)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runRules — ignore patterns (glob precision)
// ---------------------------------------------------------------------------

describe("runRules — ignore patterns", () => {
  it("ignored path is dropped from results", async () => {
    const rule = makeRule("my-rule", [
      makeFinding("src/test/fixtures/sample.ts"),
      makeFinding("src/real.ts"),
    ]);
    const policy: Record<string, PolicyEntry> = {
      "my-rule": { severity: "error", autofix: false },
    };
    const ignore = ["**/test/fixtures/**"];
    const findings = await runRules([rule], CTX, policy, ignore);
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe("src/real.ts");
  });

  it("node_modules path is dropped by DEFAULT_IGNORE", async () => {
    const rule = makeRule("my-rule", [
      makeFinding("node_modules/lib/index.ts"),
    ]);
    const policy: Record<string, PolicyEntry> = {
      "my-rule": { severity: "error", autofix: false },
    };
    const findings = await runRules([rule], CTX, policy);
    expect(findings).toHaveLength(0);
  });

  it("isBlocking false when only ignored findings existed", async () => {
    const rule = makeRule("my-rule", [makeFinding("node_modules/x.ts")]);
    const policy: Record<string, PolicyEntry> = {
      "my-rule": { severity: "error", autofix: false },
    };
    const findings = await runRules([rule], CTX, policy);
    expect(isBlocking(findings)).toBe(false);
  });

  // Glob precision: **/test/fixtures/** must NOT match paths that merely contain
  // "fixtures" but not under a "test" directory.
  it("src/latest/fixtures/x.ts is NOT ignored by **/test/fixtures/**", async () => {
    const rule = makeRule("my-rule", [makeFinding("src/latest/fixtures/x.ts")]);
    const policy: Record<string, PolicyEntry> = {
      "my-rule": { severity: "error", autofix: false },
    };
    const findings = await runRules([rule], CTX, policy, ["**/test/fixtures/**"]);
    expect(findings).toHaveLength(1);
  });

  it("plugins/house-rules/test/fixtures/a.ts IS ignored by **/test/fixtures/**", async () => {
    const rule = makeRule("my-rule", [makeFinding("plugins/house-rules/test/fixtures/a.ts")]);
    const policy: Record<string, PolicyEntry> = {
      "my-rule": { severity: "error", autofix: false },
    };
    const findings = await runRules([rule], CTX, policy, ["**/test/fixtures/**"]);
    expect(findings).toHaveLength(0);
  });

  it("test/fixtures/a.ts IS ignored by **/test/fixtures/**", async () => {
    const rule = makeRule("my-rule", [makeFinding("test/fixtures/a.ts")]);
    const policy: Record<string, PolicyEntry> = {
      "my-rule": { severity: "error", autofix: false },
    };
    const findings = await runRules([rule], CTX, policy, ["**/test/fixtures/**"]);
    expect(findings).toHaveLength(0);
  });

  it(".github/x.yml is NOT ignored by .git/**", async () => {
    const rule = makeRule("my-rule", [makeFinding(".github/x.yml")]);
    const policy: Record<string, PolicyEntry> = {
      "my-rule": { severity: "error", autofix: false },
    };
    const findings = await runRules([rule], CTX, policy, [".git/**"]);
    expect(findings).toHaveLength(1);
  });

  it("node_modules/a/b.js IS ignored by node_modules/**", async () => {
    const rule = makeRule("my-rule", [makeFinding("node_modules/a/b.js")]);
    const policy: Record<string, PolicyEntry> = {
      "my-rule": { severity: "error", autofix: false },
    };
    const findings = await runRules([rule], CTX, policy, ["node_modules/**"]);
    expect(findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// loadRules — temp dir stubs
// ---------------------------------------------------------------------------

describe("loadRules — directory loading", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "house-rules-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads 2 stub rules from temp dir", async () => {
    const rule1Dir = path.join(tmpDir, "rule-alpha");
    const rule2Dir = path.join(tmpDir, "rule-beta");
    fs.mkdirSync(rule1Dir, { recursive: true });
    fs.mkdirSync(rule2Dir, { recursive: true });

    fs.writeFileSync(
      path.join(rule1Dir, "index.ts"),
      `export default { id: "rule-alpha", meta: { description: "alpha" }, vehicles: [], check: () => [] };`,
    );
    fs.writeFileSync(
      path.join(rule2Dir, "index.ts"),
      `export default { id: "rule-beta", meta: { description: "beta" }, vehicles: [], check: () => [] };`,
    );

    const rules = await loadRules(tmpDir);
    expect(rules).toHaveLength(2);
    const ids = rules.map((r) => r.id).sort();
    expect(ids).toEqual(["rule-alpha", "rule-beta"]);
  });

  it("throws when rule id does not match directory name", async () => {
    const badDir = path.join(tmpDir, "correct-name");
    fs.mkdirSync(badDir, { recursive: true });

    fs.writeFileSync(
      path.join(badDir, "index.ts"),
      `export default { id: "wrong-id", meta: { description: "bad" }, vehicles: [], check: () => [] };`,
    );

    await expect(loadRules(tmpDir)).rejects.toThrow("wrong-id");
  });
});
