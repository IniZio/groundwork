---
title: Stacked PR planning (follow-up motive stacked-prs)
---

# Stacked PR planning (follow-up motive stacked-prs)

Status: ready-for-human
Type: task

## Goal

Split from pre-release-hardening by user decision. Lands on top of the human-layer skill and PR body v4.

## Acceptance criteria

Planner slices PH-17..PH-23 (see the planner report in the 2026-10-11 session):
- PH-17 pr/index.md + pr/<nn>-*.md doc types, per-PR gate (H1 on index, H2 per PR), pr-body type removed in the same slice; index carries Stacks tables with prod/test/exempt lines, tier+reason, verify (CI/reviewer/author-only), oversize reason.
- PH-18 sweep pr-body.md references.
- PH-19 slices.pr ledger column, `gw slice add --pr NN`.
- PH-20 per-PR dispatch gate in spawn-model-guard; stacks independent.
- PH-21 vertical-slice stack plan in stack order with per-PR scaffolding; ship section in human-layer with gh-stack, monolith retirement by close-with-link, never force-push.
- PH-22 stack index checker. PH-23 stack size meter (git numstat; prod/test/exempt).

Open: Q6 budget enforced vs advisory (planner: reject only missing reasons and >2 oversize per stack); Q7 cross-check declared vs measured lines at ship time (planner: yes).

## Comments

Evidence: moor PR #1 restack (38,334 lines into 29 PRs) by session moor-95.

2026-10-11, moor-95 after the local 30-PR build (reviewed 37,808 lines: must 11,845 / should 7,441 / optional 18,522; exempt 887):
- artifact-structure rejects `.groundwork/work/<slug>/pr/<nn>-<name>.md` and `pr/index.md`; PH-17 must add those types (bodies parked in a scratchpad meanwhile).
- junior-orchestrator cannot spawn groundwork:human-doc-reviewer (depth guard), so stack bodies went unreviewed. Either the human-layer review loop runs in the main thread, or the depth guard allows the reviewer.
- Dev-journal vocabulary leaked into committed non-doc files (~105 "decision N" / "motive.md" refs in the parity inventory, exclusions.toml, harness contract). The checker should scan the PR diff's added lines, not only pr bodies and doc/.
- Blob permalinks pinned to branch SHAs break after amending a lower stack branch and rebasing. Need a re-pin step (old to new SHA per branch) after any restack, plus a link-exists check, likely in pr-links.ts.
