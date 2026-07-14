# Issue-Type Routing Detail

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

  "Bug path" -> "Assess: obvious?" [label="typo, known config"];
  "Bug path" -> "invoke skill diagnose" [label="root cause unclear"];
  "Assess: obvious?" -> "implement directly (fix)";
  "implement directly (fix)" -> "invoke skill advisor-gate";
  "invoke skill diagnose" -> "invoke skill advisor-gate";

  "Change path" -> "Assess scope";
  "Assess scope" -> "Trivial" [label="single-line, zero ambiguity"];
  "Assess scope" -> "SmallClear" [label="clear & low-risk, <1 day"];
  "Assess scope" -> "SmallRisky" [label="ambiguous or risky, <1 day"];

  "Trivial" -> "implement directly";
  "implement directly" -> "invoke skill advisor-gate";

  "SmallClear" -> "implement directly";

  "SmallRisky" -> "invoke skill interview (quick)";
  "invoke skill interview (quick)" -> "implement";
  "implement" -> "invoke skill advisor-gate";

  "Feature path" -> "invoke skill interview (full)";
  "invoke skill interview (full)" -> "invoke skill implement";
  "invoke skill implement" -> "invoke skill vertical-slice (writes ledger)";
  "invoke skill vertical-slice (writes ledger)" -> "fan out general-purpose agents";
  "fan out general-purpose agents" -> "invoke skill advisor-gate";

  "Spike" -> "invoke skill prototype";
  "invoke skill prototype" -> "Check escalation signals" [label="findings inform next step"];

  "Docs-Only" -> "implement directly";
  "invoke skill advisor-gate" -> "Get APPROVE";
  "Get APPROVE" -> "Use question tool to present result";
}
```

## Bug Path Detail

**Load `diagnose` for any bug that needs investigation.** Exception: obvious fix (typo in a known file, known config value, clear localized regression you can spot without exploration).

```
[obvious typo/config]  fix directly → invoke skill "advisor-gate"
[anything else]        invoke skill "diagnose" FIRST → (skill runs 6-phase loop) → invoke skill "advisor-gate"
```

**Rule of thumb:** If you're about to explore the codebase with `task` to understand a bug → stop. Load `diagnose`. It has the exploration built in.

**Examples:**
- ❌ `"The filter is broken"` → don't explore; load `diagnose`
- ❌ `"Submit button doesn't work"` → don't explore; load `diagnose`
- ❌ `"Error on line 42"` without obvious fix → don't explore; load `diagnose`
- ✅ `"Fix typo 'backgroud' → 'background'"` → obvious, fix directly
- ✅ `"Port 8080 is already in use"` → known config, fix directly

## Change Path Detail

**Trivial** (direct): Single-file, single-line changes with zero ambiguity. Examples: typo fix, rename variable, update hex color, change constant value, add a missing import.

**Small change — clear & low-risk** (implement directly): Well-understood, localized changes where the approach and impact are obvious. Examples: add a simple validation rule, update a default config value, extract a helper function, add a missing null check, wire up a new field to an existing form.

**Small change — ambiguous or risky** (interview quick → implement): Changes where requirements, scope, or side-effects are unclear; changes that touch shared code, public APIs, auth, or multiple modules. Examples: modify a shared data model, change an API response shape, alter permission checks, refactor a core utility.

**Escalation:** If during implementation the work grows beyond 1 day or feels uncertain → stop, load `interview` and synthesize a plan.

## Feature Path Detail

- Only use when work is **clearly** multi-day or architectural from the start.
- **Mandatory skill-tool invocations:** `interview` → `implement` (→ `vertical-slice`) → `advisor-gate`. Never skip.
- `implement` runs `vertical-slice` first to decompose into conflict-free parallel slices and write the run ledger.
- If unsure whether it's ≥1 day → use the **Change** path and escalate if needed.

## Triage Pre-Check Detail

1. **Dedup against the rejection KB.** Scan `.groundwork/out-of-scope/*.md` and match by concept (not keyword). On a match: surface to user (Confirm / Reconsider / Disagree), append to that file's *Prior requests*.
2. **Conflict → stop and ask.** If classification signals conflict (trivial vs risky, bug vs feature), state the conflict and ask which framing is correct — don't silently pick one.
3. **Negative scope is first-class.** State what is explicitly out of scope alongside success criteria for every slice/brief.
