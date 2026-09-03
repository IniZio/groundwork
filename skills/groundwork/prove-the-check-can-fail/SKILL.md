---
name: prove-the-check-can-fail
description: Before reporting any assertion, test, or deployment check as green, prove it can turn red. A check that has never failed for the right reason is not evidence — it is rationalization.
---

# Prove the Check Can Fail

## MUST Invoke

Before reporting any assertion, test suite result, metric, or deployment verification as passing, you MUST apply this skill. This is not optional.

A green check is not evidence unless you have seen it fail for the right reason. Five instances across two sessions — plus a sixth produced during this skill's own promotion — demonstrated that plausible causal chains are not a substitute for execution. The rationalization that killed each instance was identical: "the mechanism is sound, therefore the result is correct." In every case, no one executed the mechanism.

## When to Use

**Invoke when any of these apply:**
- You are about to report a test, assertion, or check as passing
- You are writing or extending a check and claiming it covers a stated scope
- You have run a deployment verification command and are about to call it success
- A subagent returns a pass claim you have not re-run yourself

**Do NOT invoke when:**
- An injection-and-revert cycle was already completed this session for this check, and the control result is recorded, and the check has not been modified since

---

## The Central Question

**Did the thing I changed actually reach the thing I'm measuring?**

- **Unknown → prove reach first** (Branch 1).
- **Established → prove coverage** (Branch 2).

Reach is **established** only when you are holding an output — rendered, built, or logged — that shows your change at the observation point. If your basis is reading code, tracing imports, or reasoning about the path, reach is **unknown**: take Branch 1.

---

## Branch 1 — Reach is unknown: prove reach first

Use this branch whenever you have not confirmed that your change propagates to the artifact the check observes.

**Step 1 — Vary the input and diff two rendered outputs.**

Render or build the artifact twice: once with a distinguishing test value, once without it. Diff the outputs. The diffed region MUST contain your change. If it does not, reach is not established — your change is inert at the observation point. Do not proceed to a live check.

**Step 2 — Observe runtime identity, not tool success messages.**

After a deployment, read a value that changes only when the runtime creates a new instance: pod UID, process ID, inode, file mtime, or generation counter. A deployment tool's "success" message reports its own operation, not whether a new runtime instance started. A new pod UID is evidence; "rollout successful" is not.

**Step 3 — Record the identity before the change.**

Record the before-value so the after-value is comparable. Without a before-baseline, a new UID proves nothing.

**Worked example — inert config key (non-IaC):**
A Next.js app reads feature flags from `config/flags.ts`. A developer adds `enableDarkMode: true`, runs the app, and reports the feature is active. Reach is unproven: `flags.ts` might not be imported by the component that renders the toggle. To prove reach: add `console.error("FLAGS LOADED")` inside `flags.ts`, load the page, and verify the console output. If the log does not appear, the module is not reached — the flag change is inert and no behavior will change. Only after the log appears has reach been established.

**Worked example — rendered template output (non-IaC):**
A Helm chart receives a patch intended to add a `podAnnotations` block. Before deploying, run `helm template . --set podAnnotations.deployedAt=CANARY | grep -A5 podAnnotations`. If no `podAnnotations` block appears in the rendered Deployment, the chart does not plumb the key. A subsequent `helm upgrade` produces a byte-identical Deployment; `kubectl rollout status` reports success against the old pods. Stop. Fix the chart template before claiming the deployment is new.

---

## Branch 2 — Reach is established: prove coverage

Use this branch when you have confirmed the check observes what you changed and you are verifying that the check's claimed scope is complete.

**Step 1 — Record the baseline.**

Run the check and record the exact result: count, status, or output (e.g., `3 pass, 0 fail`). This is the control value.

**Step 2 — Inject one real violation per element of the claimed scope.**

For each item the check claims to cover, inject a violation inside that specific item. Run the check. The result MUST change. If it does not, that element is outside the real scope and the claim is false — revise the scope claim before proceeding.

Enumerate the claimed scope from the check's own configuration — the regex alternation, the ignore list, the glob — not from the commit message or the documentation. Where the two disagree, the configuration is the real scope and the claim is false.

**Step 3 — Revert the injection.**

Remove the injected violation.

**Step 4 — Re-run the control and confirm the baseline returns.**

Run the check again. It MUST return to the exact value recorded in Step 1. This step is mandatory, not optional. A revert without a control re-run leaves an undetected injected violation in the repo. Do not proceed to the next element or declare the check sound until the control value is restored.

Repeat Steps 2–4 for each element of the claimed scope.

**Worked example — ignore-pattern scope gap (non-IaC):**
A Jest config contains `testPathIgnorePatterns: ["src/legacy/"]`. A developer claims all tests in `src/` are covered. To prove it: create `src/legacy/broken.test.ts` with `test('injected', () => { throw new Error('injected') })`. Run the suite. If the fail count does not rise, `src/legacy/` is outside the real scope; the coverage claim covers only `src/` minus `src/legacy/`. Revert the file (`git checkout -- src/legacy/broken.test.ts` or delete it), re-run, confirm the baseline returns before drawing any conclusion about scope.

**Worked example — assertion with silent regex gap (non-IaC):**
A migration assertion script claims to cover three application databases and returns `3 pass, 0 fail`. To prove coverage: insert a schema violation (e.g., rename a required column) into each database in turn. Run the script after each injection. If any injection does not raise the fail count, that database is outside the real scope. After each injection, revert it and re-run the control; confirm it returns `3 pass, 0 fail` before injecting into the next database. Declare coverage only after all three injections each raised the count AND all three control re-runs each returned the recorded baseline.

---

## What NOT to Do

- Do not report a check as green without having seen it turn red for the right reason. A check that has never failed is not evidence — it is a claim.
- Do not accept a tool's "success" output as evidence of runtime change. Read a runtime identity value (UID, PID, inode, mtime, generation) that changes only when a new instance is created.
- Do not skip the control re-run after reverting an injection. An unclosed revert loop is an injected violation left in the repo.
- Do not trust a subagent's pass claim. Re-run the decisive command yourself before citing it as evidence. A subagent pass is a hypothesis, not a result.
- Do not substitute plausible reasoning for execution. Every link in a causal chain from change to observation must be traced by command output, not by argument.
- Do not skip this skill because the project is not infrastructure. The failure pattern — plausible chain, no execution, inert fix — occurs in any codebase.
- Do not read a violation count below the documented baseline as good news. A count that dropped means the detector's coverage changed at least as often as it means the problem shrank. Compare the set of violations, not the cardinality.
