---
name: prove-the-check-can-fail
description: Verify a check can fail before reporting its result as evidence.
---

# Prove the Check Can Fail

## Trigger

Invoke before reporting any assertion, test suite result, metric, or deployment verification as passing — including a pass claim returned by a subagent.

A green check is not evidence unless you have seen it fail for the right reason. The rationalization pattern is invariant: "the mechanism is sound, therefore the result is correct." Plausible chains are not a substitute for execution.

Skip only when an injection-and-revert cycle was completed this session for this check, the control result is recorded, and the check has not been modified since.

## Procedure

**1. Record the baseline.** Run the check; record the exact result (count, status, output string).

**2. Inject a real violation.** Introduce a known defect inside each element of the claimed scope — one at a time. Enumerate scope from the check's own configuration (the regex, the glob, the ignore list), not from documentation. Where they disagree, the configuration is the real scope.

**3. Confirm red for the right reason.** The result must change. If it does not, that element is outside the real scope; revise the scope claim before proceeding.

**4. Restore and re-confirm baseline.** Revert the injection and re-run the check. It must return the exact value from step 1. A revert without a control re-run leaves an injected violation in the repo.

For the reach-proof branch (when propagation from change to observation point is unconfirmed) and worked examples, see [`reference/reach-and-coverage.md`](reference/reach-and-coverage.md).

## Failure Modes

**Failure: All-negative guard is vacuous when value is silently absent** — an optional chain or drifted parser returns `undefined` without error; every negative assertion passes trivially. In the AC coverage audit, `view.acCoverage?.[k] ?? []` masked a renamed API field and all negative assertions passed, proving nothing. Establish a positive control first: prove the harness can observe the value present, then assert absence.

**Failure: Source-text assertion gameable by comment** — `expect(src).toContain(rule)` is satisfied by a comment in the source; the behavioural constraint is unverified. A parity guard matched a comment and shipped a broken constraint. Assert behaviour via execution; add a fail-safe default; then complete a red→green cycle on the live path.

**Failure: Oracle blinded by widened accept-all set** — a whitelist-based losslessness oracle widens its allowlist to accept every value; `Has()` always returns true; the oracle is vacuous while tests stay green. Inspect the oracle's data source independently and demand a red→green bite proof on the real handler, not on the test diff.

**Failure: Guard detects but result discarded before output** — a correct detection swallowed before printing produces a guard that is always silent on failure. A lint pass computed a violation count then discarded it before the exit-code path; tests stayed green. Assert the printed line and exit code, not the internal predicate.

**Failure: Red→green proves sensitivity, not seam coverage** — stashing the fix and re-running proves the test bites but not that it exercises both surfaces of the seam it was meant to cover. A stash-based bite proof is necessary but not sufficient; read the test to confirm both surfaces run.

**Failure: Freshness check proves consistency, not correctness** — comparing generated output against a fresh re-run of the same generator agrees even when both are wrong, leaving the content contract unverified. Pin the contract against an independent source, not a re-run of the same generator.

## Remaining Modes

Full causal chains and corrections for the following modes are in [`reference/failure-modes.md`](reference/failure-modes.md):

- Fixture under gitignored path ships empty
- Ambient env makes spec tests vacuous
- Guard weakened to go green by subagent
- AC verified against wrong source yields wrong-but-green fix
- Mutation report with numbering gap hides the survivor
- Pipe to tail hides exit code
- Tests bypass deployed invocation path
- Red→green perturbation destroys sibling work
- Git-stash baseline blind to untracked files
- Parity test blinded by narrowed input
- Auditor shares the defect class
- Guard blind to its own failure case

## Completion

Proving is complete when the check has been observed to fail for the right reason and the check returns the exact baseline value after revert.
