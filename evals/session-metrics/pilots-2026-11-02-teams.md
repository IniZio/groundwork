# Agent-teams pilots, 2026-11-02

Two moor features run as Claude Code agent teams (lead plus four in-process teammates on Sonnet via `groundwork:worker`), measured with `metrics.py` against the single-worker baseline in `baseline-2026-11-02.md`. Pilot 1 ran issue #889 with a Fable 5.1 lead, no task tools, and a cold build directory per teammate. Pilot 2 ran issue #754 with an Opus 5.5 lead, `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, build directories copied warm from pilot 1, `cargo check` between tests, and one commit per slice.

| | v2 | v3.3+ | pilot 1 (#889) | pilot 2 (#754) |
|---|---|---|---|---|
| Wall time to draft PR | | | 58 min | 66 min |
| PR size | | | +2143 / -180, 58 files, 16 commits, CI green, merged | +1645 / -194, 94 files, 9 commits |
| Tasks | | | 18 of 18 | 22 of 25, one live check failed on a real defect |
| Agent calls per active hour | 4.9 | 3.8 | 18.1 | 10.1 |
| Parallel dispatch % | 24 | 16 | 15 | 40 |
| Active time with no subagent % | 41 | 65 | 19 | 6 |
| Active time with 2+ subagents % | 28 | 10 | 81 | 93 |
| Continuation-style dispatches % | 1 | 13 | 0 | 0 |
| Lead foreground Bash % of active | 2 | 18 | 7 | 1 |
| Cost | $6.54 per active hour | $8.93 per active hour | $23 total, $24 per active hour | $22 total, $22 per active hour |
| Lead share of cost | 30% | 48% | 55% | 23% |

Pilot 1 numbers are the 08:10Z snapshot taken at its PR; its transcript kept receiving monitor notifications afterwards, which inflate the idle rows if rerun. Pilot 2 was measured at its PR.

## What the pilots showed

- Teams buy wall-clock, not dollars. Each pilot delivered a multi-surface feature with tests and docs in about an hour, against an estimated two to three hours of serial single-worker dispatch for the same task count, at about the same spend per task. Cost per hour is two and a half times the baseline because four agents run at once.
- The lead is the overhead that model choice controls. Fable 5.1 as lead cost $12.60 of pilot 1's $23; Opus 5.5 as lead cost $5 of pilot 2's $22.
- A build directory per teammate in a Rust repo is a cold full build per teammate. Pilot 1 spent its first 25 minutes at load 18 on 12 cores with teammates inside rustc for 20 of 26 minutes. Copying one warm directory per teammate cut cargo time to 3 to 6 minutes per teammate in pilot 2.
- Task tools are gated by the lead's model. On Fable 5.1 they are absent unless `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` is exported before launch; pilot 1's lead built a file board instead. Pilot 2 used TaskCreate for 25 tasks, but the lead pre-assigned owners rather than letting teammates self-claim, and the tracer task held the whole team for the first 14 minutes.
- An idle teammate is not woken by a Monitor or background task. Pilot 2's live teammate parked on a Monitor for a 120-second check, the lead waited on the teammate, and both idled for 8 minutes until a human prompted the lead.
- Pilot 2 found a defect through its live check: a setup_failed Box whose machine never came up has no setup-failure timestamp, so the grace-period auto-close skips it. That is left as task T25 on PR #917.

## Decision

Teams are an opt-in for a large, well-specified feature, not the default. The daily work is many small prompt-driven items and live checks, where the fixed cost of decomposition and team setup never amortizes. When a team is used: Opus lead; task tools exported; warm build cache copied per teammate; `cargo check` between checks; teammates never end a turn on a watch; the lead treats a teammate idle with an open task as stalled after a few minutes; one commit per slice.
