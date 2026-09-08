/**
 * Parity tests: prose-negation-guard and prose-modality-guard share logic via
 * hooks/lib/prose-helpers.mjs. These tests run BOTH guards' real entry points
 * as child processes to prove the two call sites behave identically on
 * shared-logic inputs — not just that the extracted module works in isolation.
 *
 * @verifies TOKEN-ECONOMY-R-004
 * @verifies TOKEN-ECONOMY-R-005
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MATCH_THRESHOLD } from "../../hooks/lib/prose-helpers.mjs";

const NEGATION_HOOK = path.resolve(import.meta.dirname, "..", "..", "hooks", "prose-negation-guard.mjs");
const MODALITY_HOOK = path.resolve(import.meta.dirname, "..", "..", "hooks", "prose-modality-guard.mjs");

const PROSE_PATH = "/home/newman/.local/share/groundwork/agents-src/junior-orchestrator.md";
const CODE_PATH = "/home/newman/.local/share/groundwork/src/lib/foo.ts";

function runHook(hookPath: string, payload: unknown): { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } } {
  const out = execFileSync("node", [hookPath], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env },
  });
  return out.trim() ? JSON.parse(out) : {};
}

function editPayload(filePath: string, oldString: string, newString: string) {
  return {
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    tool_input: { file_path: filePath, old_string: oldString, new_string: newString },
  };
}

function fired(result: ReturnType<typeof runHook>): boolean {
  return typeof result.hookSpecificOutput?.permissionDecisionReason === "string";
}

describe("MATCH_THRESHOLD constant", () => {
  it("is 0.4 in prose-helpers.mjs", () => {
    expect(MATCH_THRESHOLD).toBe(0.4);
  });
});

describe("isProse parity", () => {
  it("negation guard: .ts file removing 'not' from inline text → passthrough", () => {
    const r = runHook(NEGATION_HOOK, editPayload(CODE_PATH, "// must not call", "// must call"));
    expect(fired(r)).toBe(false);
  });

  it("modality guard: .ts file with may→will change → passthrough", () => {
    const r = runHook(MODALITY_HOOK, editPayload(CODE_PATH, "// the hook may fire", "// the hook will fire"));
    expect(fired(r)).toBe(false);
  });

  it("negation guard: .md file removing 'not' → fires advisory", () => {
    const r = runHook(NEGATION_HOOK, editPayload(PROSE_PATH, "You MUST NOT delegate.", "You MUST delegate."));
    expect(fired(r)).toBe(true);
  });

  it("modality guard: .md file with may→will change → fires advisory", () => {
    const r = runHook(MODALITY_HOOK, editPayload(PROSE_PATH, "The model may delegate.", "The model will delegate."));
    expect(fired(r)).toBe(true);
  });
});

describe("wholesale-deletion passthrough (below MATCH_THRESHOLD)", () => {
  const old = "You MUST NOT delegate wholesale. The model may also skip.";
  const novel = "Completely unrelated sentence about bananas.";

  it("negation guard: wholesale rewrite → passthrough (treated as deletion)", () => {
    const r = runHook(NEGATION_HOOK, editPayload(PROSE_PATH, old, novel));
    expect(fired(r)).toBe(false);
  });

  it("modality guard: wholesale rewrite → passthrough (treated as deletion)", () => {
    const r = runHook(MODALITY_HOOK, editPayload(PROSE_PATH, old, novel));
    expect(fired(r)).toBe(false);
  });

  it("negation guard: near-miss rewrite (Jaccard=0.20) → passthrough at threshold 0.4", () => {
    // {you,must,not,implement,features,directly}→{you,should,implement,clean,solutions,here}: intersect=2 union=10 J=0.20
    const nearOld = "You MUST NOT implement features directly.";
    const nearNew = "You should implement clean solutions here.";
    const r = runHook(NEGATION_HOOK, editPayload(PROSE_PATH, nearOld, nearNew));
    expect(fired(r)).toBe(false);
  });

  it("modality guard: near-miss rewrite (Jaccard≈0.33) → passthrough at threshold 0.4", () => {
    // {the,orchestrator,may,delegate,tasks,broadly}→{the,orchestrator,will,send,work,broadly}: intersect=3 union=9 J≈0.33
    const nearOld = "The orchestrator may delegate tasks broadly.";
    const nearNew = "The orchestrator will send work broadly.";
    const r = runHook(MODALITY_HOOK, editPayload(PROSE_PATH, nearOld, nearNew));
    expect(fired(r)).toBe(false);
  });
});

describe("sentence-aligned detection (high vocabulary overlap)", () => {
  it("negation guard: in-place negation removal fires (EV2)", () => {
    const old = "You MUST NOT implement. You must not skip the gate.";
    const nw = "You MUST implement. You must not skip the gate.";
    const r = runHook(NEGATION_HOOK, editPayload(PROSE_PATH, old, nw));
    expect(fired(r)).toBe(true);
  });

  it("modality guard: in-place hedge upgrade fires (EV1)", () => {
    const old = "The orchestrator may delegate. A junior may spawn workers.";
    const nw = "The orchestrator will delegate. A junior may spawn workers.";
    const r = runHook(MODALITY_HOOK, editPayload(PROSE_PATH, old, nw));
    expect(fired(r)).toBe(true);
  });
});

describe("near-threshold detection (Jaccard strictly in (0.4, 0.5))", () => {
  it("negation guard: negation removed at Jaccard≈0.43 → fires (0.4 threshold load-bearing)", () => {
    // {agents,must,not,skip,this}→{agents,must,always,skip,here}: intersect=3 union=7 J=3/7≈0.429
    const old = "Agents MUST NOT skip this.";
    const nw = "Agents MUST always skip here.";
    const r = runHook(NEGATION_HOOK, editPayload(PROSE_PATH, old, nw));
    expect(fired(r)).toBe(true);
  });

  it("modality guard: hedge upgraded at Jaccard≈0.43 → fires (0.4 threshold load-bearing)", () => {
    // {the,model,may,skip,this}→{the,model,will,skip,here}: intersect=3 union=7 J=3/7≈0.429
    const old = "The model may skip this.";
    const nw = "The model will skip here.";
    const r = runHook(MODALITY_HOOK, editPayload(PROSE_PATH, old, nw));
    expect(fired(r)).toBe(true);
  });
});
