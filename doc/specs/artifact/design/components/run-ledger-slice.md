---
id: "artifact-component-run-ledger-slice"
type: "component"
title: "Run-Ledger Slice"
tags: [component, slice, ledger]
---

# Run-Ledger Slice

## Anatomy

A run-ledger slice is the primary scheduling unit inside a groundwork run. It lives in `RunLedger.slices[]` and tracks one unit of work from claim to completion.

```
Slice {
  id          string          — unique within the run (e.g. "s1", "auth-handler")
  wave        int?            — execution wave number (default 1)
  status      string          — "pending" | "in_progress" | "complete"
  kind        string          — "impl" | "plan" | "diagnose" | "design" | "fog"
  desc        string?         — human-readable description
  blocked_by  string[]?       — ids of slices that must complete first
  acceptance  string?         — semicolon-separated acceptance criteria
  ticket      string?         — id of the linked ticket document
  covers_ac   string[]?       — acceptance-criterion ids from the motive charter
  decisions   string|string[]?— DECISION event id(s) this slice produces or implements
  completed_at string?        — ISO-8601 timestamp; set by `gw ledger complete`
  session_id  string?         — session that completed this slice; set by `gw ledger complete`
  created_by  string?         — session that created this slice
}
```

## Variants — kinds

| Kind | Pacing-exempt? | Typical producer |
|---|---|---|
| `impl` | No | Implementer agents |
| `design` | No | Designer agents |
| `plan` | Yes | Planner agents |
| `diagnose` | Yes | Debugger agents |
| `fog` | Yes | Orchestrator (open questions without known size) |

Pacing-exempt kinds do not consume the one-impl-wave-per-session budget.

## States

| Status | Meaning |
|---|---|
| `pending` | Claimed but not started |
| `in_progress` | Actively being implemented |
| `complete` | Done; `completed_at` and `session_id` are set |

## Field specs

| Field | Required | CLI flag | Notes |
|---|---|---|---|
| `id` | Yes | positional | Unique within the run |
| `wave` | No | `--wave N` | Defaults to 1 |
| `kind` | No | `--kind` | Defaults to `impl` |
| `desc` | No | `--desc "…"` | Human-readable purpose |
| `blocked_by` | No | `--blocked-by a,b` | Comma-separated ids |
| `acceptance` | No | `--acceptance "a;b"` | Semicolon-separated criteria |
| `ticket` | No | `--ticket <tid>` | Ticket document id |
| `covers_ac` | No | `--covers-ac "AC1,AC2"` | Charter AC ids covered |
| `decisions` | No | `--decisions "D-1,D-2"` | Journal DECISION ids |

## Usage

```bash
# Add a new impl slice in wave 1
ledger add s1 --desc "Implement token handler" --acceptance "token is validated;error is 401"

# Add a plan slice (pacing-exempt)
ledger add p1 --kind plan --desc "Research auth options"

# Link a ticket and decision at claim time
ledger add s2 --ticket 01-build-handler --decisions D-7

# Mark complete
ledger complete s1
```

## Related requirements

- [[../../requirements/artifact-r-001-ledger-records-slice-completion|R-001]] — completion fields required
- [[../../requirements/artifact-r-007-ticket-is-the-durable-work-object|R-007]] — ticket linkage
- [[../../requirements/artifact-r-010-slice-decisions-field-links-slices-to-journal-decision-events|R-010]] — decisions linkage

## Related notes

- [[../flows/slice-lifecycle]] — state machine
- [[../reference/slice-fields-reference]] — all fields at a glance
- [[../recipes/add-a-ticket]] — how to create and link a ticket
