# Agent-teams review, 2026-11-16

Named teammates (Agent `name` plus `SendMessage` follow-up rounds) became newman-mode's default for related rounds on 2026-11-02. On 2026-11-07 the skill added a retire-after-three-rounds rule. This review compares moor before and after, and decides whether teams stay on.

## Output and spend, moor

Spend is bucketed by each request's own timestamp across every moor transcript, main and subagent, so a session's later life counts in the era it happened. Work hours are the union of thread activity with gaps of 5 minutes or less. Every merged PR in each window was authored by the same user.

| | One-shot workers 10-25..11-01 | Teams 11-02..11-06 | Teams with retire rule 11-07..11-16 |
|---|---|---|---|
| Merged PRs | 228 | 217 | 192 |
| Lines changed in merged PRs | 117,755 | 118,101 | 125,369 |
| Spend | $1,054 | $1,494 | $2,033 |
| Lead share of spend | 46% | 27% | 22% |
| Work hours | 80 | 62 | 80 |
| $ per merged PR | 4.62 | 6.89 | 10.59 |
| $ per 1k changed lines | 8.9 | 12.7 | 16.2 |
| Merged PRs per work hour | 2.84 | 3.51 | 2.41 |
| Active time with 2+ subagents, median (`metrics.py`) | 11% | 19% | 6% |

The first teams week bought 24% more PRs per work hour at 49% more per PR. After the retire rule, PRs per work hour fell below the one-shot baseline and cost per PR more than doubled.

## Where the premium comes from

Subagent runs with 5 or more tool calls, all projects, 11-07..11-16, by the model that dominated each run's spend:

| | Runs | Spend | $ per tool call | Median calls | Median peak context |
|---|---|---|---|---|---|
| Sonnet one-shot | 111 | $120 | 0.038 | 21 | 91k |
| Sonnet teammate | 66 | $88 | 0.039 | 26 | 93k |
| Opus one-shot | 21 | $34 | 0.048 | 27 | 95k |
| Opus teammate | 153 | $1,008 | 0.083 | 62 | 157k |
| Fable teammate | 16 | $96 | 0.176 | 35 | 176k |

The teammate mechanism costs nothing extra by itself: Sonnet teammates match Sonnet one-shots. The premium is long-lived Opus and Fable threads. Leads spawned 168 named teammates on Opus or Fable against 65 on Sonnet. Teammate cost per call rose with the number of `<teammate-message>` records it received (an approximate round count that includes the spawn and peer messages): $0.057 at 0 to 1, $0.078 at 2 to 3, $0.109 at 4 or more. Teammates sat idle for more than 5 minutes at a stretch for 64% of their wall time in both teams eras.

## Confounds

- The 40-call fold hook was retired on 2026-11-02, the same day teams started (c823bcce).
- Work mix differs by week. Mean PR size grew from 516 to 653 changed lines.
- Within-era team versus solo sessions are not comparable, because the solo sessions after 11-07 are few and small.

## Decision

Named teammates are off by default. newman-mode returns to poteto-mode's fresh worker per round. With `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` set to `0`, a `claude -p` probe listed no `name` parameter on Agent and still listed `SendMessage` and `ListAgents`, so cross-session messaging keeps working.

The one-shot baseline transcripts age out of `~/.claude/projects` in early December 2026. This file is the record.
