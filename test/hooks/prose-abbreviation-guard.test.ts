/**
 * Tests for prose-abbreviation-guard.mjs (TOKEN-ECONOMY-R-006).
 *
 * Groups:
 *   (a) RED  — ad-hoc abbreviation newly introduced → guard fires
 *   (b) RED  — domain vocabulary expanded (pure replacement) → guard fires
 *   (c) GREEN — abbreviation already present in old_string → no fire
 *   (d) GREEN — first-use definition pattern (both forms in new) → no fire
 *   (e) GREEN — 'impl' inside another word → no fire
 *   (f) GREEN — non-prose file (.ts) → passthrough
 *   (g) GREEN — non-Edit tool (Bash) → passthrough
 *   (h) GREEN — escape hatch env var → passthrough
 *
 * @verifies TOKEN-ECONOMY-R-006
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HOOK = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "hooks",
  "prose-abbreviation-guard.mjs",
);

const PROSE_PATH = "/home/newman/.local/share/groundwork/agents-src/junior-orchestrator.md";
const CODE_PATH = "/home/newman/.local/share/groundwork/src/lib/foo.ts";

type Decision = {
  hookSpecificOutput?: {
    permissionDecision?: string;
    permissionDecisionReason?: string;
  };
};

function runHook(payload: unknown, env?: Record<string, string>): Decision {
  const out = execFileSync("node", [HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return out.trim() ? JSON.parse(out) : {};
}

function editPayload(
  filePath: string,
  oldString: string,
  newString: string,
) {
  return {
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    tool_input: { file_path: filePath, old_string: oldString, new_string: newString },
  };
}

function fired(result: Decision): boolean {
  return typeof result.hookSpecificOutput?.permissionDecisionReason === "string";
}

// ---------------------------------------------------------------------------
// (a) RED — ad-hoc abbreviation newly introduced
// POSITIVE CONTROL: this is the violating fixture; the guard MUST fire here.
// If the guard's detection logic is broken this group goes red — that's the
// perturbation bite proof.
// ---------------------------------------------------------------------------
describe("prose-abbreviation-guard — contraction newly introduced (guard fires)", () => {
  it("(a1) 'cfg' introduced in new_string → advisory fires with 'cfg' in reason", () => {
    const result = runHook(
      editPayload(
        PROSE_PATH,
        "Set the configuration value.",
        "Set the cfg value.",
      ),
    );
    expect(fired(result)).toBe(true);
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain("cfg");
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain(
      "TOKEN-ECONOMY-R-006",
    );
  });

  it("(a2) 'impl' introduced as standalone word → no advisory (impl is domain vocabulary per D-4)", () => {
    const result = runHook(
      editPayload(
        PROSE_PATH,
        "The implementation handles this case.",
        "The impl handles this case.",
      ),
    );
    expect(fired(result)).toBe(false);
  });

  it("(a3) 'fn' introduced as standalone word → advisory fires", () => {
    const result = runHook(
      editPayload(
        PROSE_PATH,
        "Pass a function to the caller.",
        "Pass a fn to the caller.",
      ),
    );
    expect(fired(result)).toBe(true);
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain("fn");
  });

  it("(a4) 'req' introduced as standalone word → advisory fires", () => {
    const result = runHook(
      editPayload(
        PROSE_PATH,
        "Every requirement must be traceable.",
        "Every req must be traceable.",
      ),
    );
    expect(fired(result)).toBe(true);
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain("req");
  });

  it("(a5) permissionDecision is 'allow' (advisory-only, never blocks)", () => {
    const result = runHook(
      editPayload(PROSE_PATH, "Set the configuration.", "Set the cfg."),
    );
    expect(result.hookSpecificOutput?.permissionDecision).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// (b) RED — domain vocabulary expanded (pure replacement, short form lost)
// ---------------------------------------------------------------------------
describe("prose-abbreviation-guard — domain vocabulary expanded (guard fires)", () => {
  it("(b1) 'AC' replaced by 'acceptance criteria' → advisory fires with 'AC' in reason", () => {
    const result = runHook(
      editPayload(
        PROSE_PATH,
        "Each AC must be verifiable.",
        "Each acceptance criteria must be verifiable.",
      ),
    );
    expect(fired(result)).toBe(true);
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain("AC");
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain(
      "TOKEN-ECONOMY-R-006",
    );
  });

  it("(b2) 'TBD' replaced by 'to be determined' → advisory fires with 'TBD' in reason", () => {
    const result = runHook(
      editPayload(
        PROSE_PATH,
        "The scope is TBD.",
        "The scope is to be determined.",
      ),
    );
    expect(fired(result)).toBe(true);
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain("TBD");
  });

  it("(b3) 'TBR' replaced by 'to be reviewed' → advisory fires with 'TBR' in reason", () => {
    const result = runHook(
      editPayload(
        PROSE_PATH,
        "This decision is TBR.",
        "This decision is to be reviewed.",
      ),
    );
    expect(fired(result)).toBe(true);
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain("TBR");
  });
});

// ---------------------------------------------------------------------------
// (c) GREEN — abbreviation already present in old_string → no new introduction
// ---------------------------------------------------------------------------
describe("prose-abbreviation-guard — abbreviation pre-existing (passthrough)", () => {
  it("(c1) 'cfg' in both old and new → not newly introduced → no advisory", () => {
    const result = runHook(
      editPayload(PROSE_PATH, "Set the cfg value.", "Set the cfg=true value."),
    );
    expect(fired(result)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (d) GREEN — first-use definition pattern: new retains both forms
// ---------------------------------------------------------------------------
describe("prose-abbreviation-guard — first-use definition pattern (passthrough)", () => {
  it("(d1) 'acceptance criteria (AC)' in new retains short form → no advisory", () => {
    const result = runHook(
      editPayload(
        PROSE_PATH,
        "Each AC must be verifiable.",
        "Each acceptance criteria (AC) must be verifiable.",
      ),
    );
    expect(fired(result)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (e-impl) GREEN — impl is domain vocabulary (D-4), not a prohibited abbreviation
// Regression: guard must NOT fire when impl appears in new_string.
// This group proves sensitivity from the other side: if impl were re-added to
// the contraction list these tests would go RED (bite proof documented below).
// ---------------------------------------------------------------------------
describe("prose-abbreviation-guard — impl is preserved domain vocabulary (passthrough)", () => {
  it("(e-impl-1) ledger slice kind '--kind plan|diagnose|design|impl' newly introduced → no advisory", () => {
    const result = runHook(
      editPayload(
        PROSE_PATH,
        "Add slices with --kind plan.",
        "Add slices with --kind plan|diagnose|design|impl.",
      ),
    );
    expect(fired(result)).toBe(false);
  });

  it("(e-impl-2) standalone 'impl' wave reference newly introduced → no advisory", () => {
    const result = runHook(
      editPayload(
        PROSE_PATH,
        "The wave completes.",
        "The impl wave completes.",
      ),
    );
    expect(fired(result)).toBe(false);
  });

  it("(e-impl-3) expanding impl to 'implementation' → advisory fires (expansion direction)", () => {
    const result = runHook(
      editPayload(
        PROSE_PATH,
        "kind defaults to impl.",
        "kind defaults to implementation.",
      ),
    );
    expect(fired(result)).toBe(true);
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain("impl");
  });
});

// ---------------------------------------------------------------------------
// (e) GREEN — 'impl' inside another word (not standalone)
// ---------------------------------------------------------------------------
describe("prose-abbreviation-guard — 'impl' inside longer word (passthrough)", () => {
  it("(e1) 'implementation' does not match \\bimpl\\b → no advisory", () => {
    const result = runHook(
      editPayload(
        PROSE_PATH,
        "The system handles this.",
        "The implementation handles this.",
      ),
    );
    expect(fired(result)).toBe(false);
  });

  it("(e2) 'implements' does not match \\bimpl\\b → no advisory", () => {
    const result = runHook(
      editPayload(
        PROSE_PATH,
        "The class does this.",
        "The class implements the interface.",
      ),
    );
    expect(fired(result)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (f) GREEN — non-prose file type → passthrough
// ---------------------------------------------------------------------------
describe("prose-abbreviation-guard — non-prose file type (passthrough)", () => {
  it("(f1) .ts file with 'cfg' introduced → no advisory (code surface)", () => {
    const result = runHook(
      editPayload(CODE_PATH, "const configuration = {}", "const cfg = {}"),
    );
    expect(fired(result)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (g) GREEN — non-Edit tool → passthrough
// ---------------------------------------------------------------------------
describe("prose-abbreviation-guard — non-Edit tool (passthrough)", () => {
  it("(g1) Bash tool → empty output (passthrough)", () => {
    const result = runHook({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "echo hello" },
    });
    expect(result.hookSpecificOutput).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (h) GREEN — escape hatch env var
// ---------------------------------------------------------------------------
describe("prose-abbreviation-guard — escape hatch disables guard", () => {
  it("(h1) GROUNDWORK_PROSE_ABBREVIATION_GUARD=0 → passthrough even when 'cfg' introduced", () => {
    const result = runHook(
      editPayload(PROSE_PATH, "Set the configuration.", "Set the cfg."),
      { GROUNDWORK_PROSE_ABBREVIATION_GUARD: "0" },
    );
    expect(result.hookSpecificOutput).toBeUndefined();
  });
});
