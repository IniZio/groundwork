# Issue-Type Routing Detail

## Codex Scope

The routing graph is shared workflow guidance. In Codex, invoke skills through
the available skill surface and represent planning, slicing, and review in the
host plan. References below to dispatch, question prompts, ledgers, or gates
describe other hosts unless explicitly marked Codex-compatible; do not treat
them as native Codex capabilities.

Full routing flow digraph and extended examples.

## Routing Flow Digraph

```
digraph flow {
  "User message" -> "Classify: Bug or not?";

  "Classify: Bug or not?" -> "Bug path" [label="something broken"];
  "Classify: Bug or not?" -> "Change path" [label="change, refactor"];
  "Classify: Bug or not?" -> "Feature path" [label="feature"];
  "Classify: Bug or not?" -> "Spike" [label="uncertain approach"];
  "Classify: Bug or not?" -> "Docs-Only" [label="documentation"];
  "Classify: Bug or not?" -> "Research path" [label="deep research, prior-art, open question"];

  "Bug path" -> "Assess: obvious?" [label="typo, known config"];
  "Bug path" -> "debugger agent (observe→hypothesize→isolate→fix)" [label="root cause unclear"];
  "Assess: obvious?" -> "implement directly (fix)";
  "implement directly (fix)" -> "invoke skill advisor-gate";
  "debugger agent (observe→hypothesize→isolate→fix)" -> "invoke skill advisor-gate";

  "Change path" -> "Assess scope";
  "Assess scope" -> "Trivial" [label="single-line, zero ambiguity"];
  "Assess scope" -> "SmallClear" [label="clear & low-risk, <1 day"];
  "Assess scope" -> "SmallRisky" [label="ambiguous or risky, <1 day"];

  "Trivial" -> "implement directly";
  "implement directly" -> "invoke skill advisor-gate";

  "SmallClear" -> "implement directly";

  "SmallRisky" -> "invoke skill quick-interview";
  "invoke skill quick-interview" -> "implement";
  "implement" -> "invoke skill advisor-gate";

  "Feature path" -> "feature-planning pipeline (feature-interview -> planner) -> motive_ref";
  "feature-planning pipeline (feature-interview -> planner) -> motive_ref" -> "invoke skill implement";
  "invoke skill implement" -> "invoke skill vertical-slice (writes ledger)";
  "invoke skill vertical-slice (writes ledger)" -> "fan out general-purpose agents";
  "fan out general-purpose agents" -> "invoke skill advisor-gate";

  "Spike" -> "invoke skill prototype";
  "invoke skill prototype" -> "Check escalation signals" [label="findings inform next step"];

  "Docs-Only" -> "implement directly";

  "Research path" -> "explore agent (quick-locate)" [label="known codebase, find/trace"];
  "Research path" -> "researcher agent (deep research)" [label="prior art, open question, survey"];
  "researcher agent (deep research)" -> "invoke skill advisor-gate";

  "invoke skill advisor-gate" -> "Get APPROVE";
  "Get APPROVE" -> "Use question tool to present result";
}
```

## Bug Path Detail

**Route any bug that needs investigation to `groundwork:debugger`.** It runs the 6-phase diagnose protocol internally. Exception: obvious fix (typo in a known file, known config value, clear localized regression you can spot without exploration) → fix directly via `general-purpose`.

```
[obvious typo/config]  general-purpose direct → invoke skill "advisor-gate"
[anything else]        task groundwork:debugger → (runs 6-phase diagnose loop) → invoke skill "advisor-gate"
```

**Rule of thumb:** If you're about to explore the codebase with `task` to understand a bug → stop. Delegate to `groundwork:debugger`. It has the exploration built in.

**Examples:**
- ❌ `"The filter is broken"` → don't explore; delegate to `groundwork:debugger`
- ❌ `"Submit button doesn't work"` → don't explore; delegate to `groundwork:debugger`
- ❌ `"Error on line 42"` without obvious fix → don't explore; delegate to `groundwork:debugger`
- ✅ `"Fix typo 'backgroud' → 'background'"` → obvious, fix directly
- ✅ `"Port 8080 is already in use"` → known config, fix directly

## Change Path Detail

**Trivial** (direct): Single-file, single-line changes with zero ambiguity. Examples: typo fix, rename variable, update hex color, change constant value, add a missing import.

**Small change — clear & low-risk** (implement directly): Well-understood, localized changes where the approach and impact are obvious. Examples: add a simple validation rule, update a default config value, extract a helper function, add a missing null check, wire up a new field to an existing form.

**Small change — ambiguous or risky** (quick-interview → implement): Changes where requirements, scope, or side-effects are unclear; changes that touch shared code, public APIs, auth, or multiple modules. Examples: modify a shared data model, change an API response shape, alter permission checks, refactor a core utility.

**Escalation:** If during implementation the work grows beyond 1 day or feels uncertain → stop, load `feature-interview` and synthesize a plan.

## Feature Path Detail

- Only use when work is **clearly** multi-day or architectural from the start.
- **Mandatory skill-tool invocations:** feature-planning pipeline (`feature-interview` → `planner`) → durable `motive_ref` (charter at `.groundwork/motives/<slug>/motive.md` + DECISION events) → `implement` (→ `vertical-slice`) → `advisor-gate`. Never skip. `feature-interview` and `planner` are BOTH retained, not competing alternatives — `feature-interview` is the human front door; `planner` is the delegated stage that emits the motive charter.
- **A non-trivial feature MUST have a `motive_ref` (produced by the `feature-interview` → `planner` pipeline) before `vertical-slice` fans out.** No memory-only plans; no fan-out until the charter exists.
- `implement` runs `vertical-slice` first to decompose into conflict-free parallel slices and write the run ledger (recording `motive_ref`).
- If unsure whether it's ≥1 day → use the **Change** path and escalate if needed.
- **Trivial / small-clear / docs / obvious-bug fast-paths stay unchanged** — HARD-GATE and `motive_ref` apply to non-trivial work only.

## Triage Pre-Check Detail

1. **Dedup against the rejection KB.** Scan `.groundwork/out-of-scope/*.md` and match by concept (not keyword). On a match: surface to user (Confirm / Reconsider / Disagree), append to that file's *Prior requests*.
2. **Conflict → stop and ask.** If classification signals conflict (trivial vs risky, bug vs feature), state the conflict and ask which framing is correct — don't silently pick one.
3. **Negative scope is first-class.** State what is explicitly out of scope alongside success criteria for every slice/brief.
