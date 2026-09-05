# Reach and Coverage — Extended Procedure

## The Central Question

Before running any check: did the thing you changed actually reach the thing you are measuring?

- **Reach unknown → prove reach first** (Branch 1 below).
- **Reach established → proceed to the standard procedure** in SKILL.md.

Reach is established only when you hold an output — rendered, built, or logged — that shows your change at the observation point. Reading code, tracing imports, or reasoning about the path leaves reach unknown.

---

## Branch 1 — Reach is unknown: prove reach first

Use when you have not confirmed that your change propagates to the artifact the check observes.

**Step 1 — Vary the input and diff two rendered outputs.**

Render or build the artifact twice: once with a distinguishing test value, once without. Diff the outputs. The diffed region must contain your change. If it does not, reach is not established — your change is inert at the observation point. Do not proceed to a live check.

**Step 2 — Observe runtime identity, not tool success messages.**

After a deployment, read a value that changes only when the runtime creates a new instance: pod UID, process ID, inode, file mtime, or generation counter. A deployment tool's "success" message reports its own operation, not whether a new runtime instance started. A new pod UID is evidence; "rollout successful" is not.

**Step 3 — Record the identity before the change.**

Record the before-value so the after-value is comparable. Without a before-baseline, a new UID proves nothing.

---

## Worked Examples

### Inert config key (non-IaC)

A Next.js app reads feature flags from `config/flags.ts`. A developer adds `enableDarkMode: true`, runs the app, and reports the feature is active. Reach is unproven: `flags.ts` might not be imported by the component that renders the toggle. To prove reach: add `console.error("FLAGS LOADED")` inside `flags.ts`, load the page, and verify the console output. If the log does not appear, the module is not reached — the flag change is inert. Only after the log appears has reach been established.

### Rendered template output (non-IaC)

A Helm chart receives a patch intended to add a `podAnnotations` block. Before deploying, run `helm template . --set podAnnotations.deployedAt=CANARY | grep -A5 podAnnotations`. If no `podAnnotations` block appears in the rendered Deployment, the chart does not plumb the key. A subsequent `helm upgrade` produces a byte-identical Deployment; `kubectl rollout status` reports success against the old pods. Fix the chart template before claiming the deployment is new.

### Jest ignore-pattern scope gap (Branch 2 worked example)

A Jest config contains `testPathIgnorePatterns: ["src/legacy/"]`. A developer claims all tests in `src/` are covered. To prove it: create `src/legacy/broken.test.ts` with a throwing test. Run the suite. If the fail count does not rise, `src/legacy/` is outside the real scope. Revert the file, re-run, confirm the baseline returns before drawing any conclusion about scope.

### Assertion with silent regex gap (Branch 2 worked example)

A migration assertion script claims to cover three application databases and returns `3 pass, 0 fail`. Inject a schema violation into each database in turn. Run the script after each injection. If any injection does not raise the fail count, that database is outside the real scope. After each injection, revert it and re-run the control; confirm it returns `3 pass, 0 fail` before injecting into the next. Declare coverage only after all three injections each raised the count and all three control re-runs returned the recorded baseline.

---

## Runtime identity rule

Do not accept a tool's "success" output as evidence of runtime change. Read a runtime identity value (UID, PID, inode, mtime, generation) that changes only when a new instance is created. A violation count that dropped means the detector's coverage changed at least as often as it means the problem shrank — compare the set of violations, not the cardinality.
