import { describe, it, expect } from "bun:test";
import { runRules, isBlocking } from "../../src/engine/run.js";
import { exitCodeFor } from "../../src/cli/report.js";
import type { Rule, RuleContext, Finding, Severity } from "../../src/engine/types.js";
import type { PolicyEntry } from "../../src/engine/policy.js";

const CTX: RuleContext = { repoRoot: "/repo", mode: "guard" };

function makeRule(id: string, findings: Finding[]): Rule {
  return { id, meta: { description: `stub rule ${id}` }, check: () => findings };
}

function makeFinding(severity?: Severity): Finding {
  const f: Finding = {
    ruleId: "my-rule",
    path: "src/foo.ts",
    message: "test message",
    fingerprintBasis: "src/foo.ts:test",
  };
  return severity === undefined ? f : { ...f, severity };
}

async function runWith(rule: Severity, tag?: Severity) {
  const policy: Record<string, PolicyEntry> = {
    "my-rule": { severity: rule, autofix: false },
  };
  return runRules([makeRule("my-rule", [makeFinding(tag)])], CTX, policy, []);
}

// gate.ts filters the stamped result on `f.severity === 'error'` to decide Stop blocking.
const gateBlocks = (fs: Array<{ severity: string }>) => fs.filter((f) => f.severity === "error").length > 0;

describe("runRules — finding severity can only lower the rule severity", () => {
  it("a finding tagged warn under an error rule reports as warn and does not block", async () => {
    const findings = await runWith("error", "warn");
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warn");
    expect(isBlocking(findings)).toBe(false);
  });

  it("a finding tagged error under a warn rule stays warn", async () => {
    const findings = await runWith("warn", "error");
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warn");
    expect(isBlocking(findings)).toBe(false);
  });

  it("an untagged finding keeps the rule's severity", async () => {
    const findings = await runWith("error");
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(isBlocking(findings)).toBe(true);
  });

  it("a rule set to off yields no findings even when the finding is tagged error or warn", async () => {
    expect(await runWith("off", "error")).toHaveLength(0);
    expect(await runWith("off", "warn")).toHaveLength(0);
  });

  it("exit code and Stop blocking follow the effective severity", async () => {
    const lowered = await runWith("error", "warn");
    expect(exitCodeFor(lowered)).toBe(0);
    expect(gateBlocks(lowered)).toBe(false);

    const untagged = await runWith("error");
    expect(exitCodeFor(untagged)).toBe(1);
    expect(gateBlocks(untagged)).toBe(true);
  });
});
