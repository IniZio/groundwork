# session-metrics

`metrics.py` measures how a Claude Code orchestrator uses subagents. It reads
transcripts under `~/.claude/projects/<slug>/` and never writes there. It needs
Python 3 and the standard library only.

```
python3 -I evals/session-metrics/metrics.py \
  [--era NAME=START..END]... [--min-mb 2] [--json out.json] <project-dir>...
```

Each `--era` takes ISO timestamps (UTC); END is optional and exclusive. A
session belongs to the era of its first timestamp. With no `--era`, every
session falls in one era named `all`. A session counts when its main transcript
is at least `--min-mb` and it made at least one Agent call.

## Output

One table with an era per column:

- Volume: sessions, wall hours, orchestrator-active hours, user prompts, Agent calls.
- Fan-out: parallel dispatch % (Agent calls sharing a requestId), mean width,
  continuation-style dispatches %.
- Time: share of active time with 0 and with 2+ subagents running (medians over
  sessions), lead foreground Bash time as a share of active time.
- Subagents: transcript count, median minutes, median tool calls, share with 40 or
  more tool calls, median start-up context of worker types.
- Cost: total, per active hour, per user prompt, main-thread share.

A second table gives, per era, the cost of worker subagents bucketed by tool
calls (1-19, 20-39, 40-79, 80+): count, $/agent, $/tool call, median context per request.

Active time runs from a user prompt to the last record before the next prompt.
Usage is counted once per message id. Prices are per million tokens in the
`PRICE` table. `--json` writes the per-session raw stats.

Transcripts are scanned in parallel; five project directories (about 5 GB) take
under 10 seconds on 12 cores.

Claude Code deletes transcripts after about 30 days, so a comparison point has
to be recorded while it exists. `baseline-2026-11-02.md` holds the v2 versus
v3 numbers and the targets for the next change.
