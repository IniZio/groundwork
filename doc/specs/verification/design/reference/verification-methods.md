# Verification Methods Reference

## Verification method values

| Value | Meaning | Used for |
|-------|---------|----------|
| `Test` | Automated test suite asserts the behaviour | Requirements enforced mechanically by a hook or test |
| `Inspection` | Manual review of a session transcript or artefact | Requirements that require human judgment |

## Stop-gate exit codes

| Code | Meaning |
|------|---------|
| 0 | Session-end allowed |
| non-zero | Session-end blocked; reason in stdout |

The stop gate is fail-open: any unexpected error causes exit 0 (allow) to avoid wedging a session.

## EARS pattern values used in this concept

| Pattern | Template | Example |
|---------|----------|---------|
| `IF-THEN` | If `<trigger>`, then `<system>` shall `<response>` | If the Stop hook fires and any slice is pending, then the hook shall block session end |

## Advisor verdict values

| Verdict | Blocking? | Description |
|---------|-----------|-------------|
| `APPROVE` | No | Work is genuinely complete; real-world checks passed |
| `CORRECTION` | Yes | Specific blocking issues found; must be fixed this session |
| `STOP` | Yes | Fundamental problem; re-planning required |

## Slice status values (relevant to stop gate)

| Status | Terminal? | Stop-gate effect |
|--------|-----------|-----------------|
| `pending` | No | Blocks |
| `in_progress` | No | Blocks |
| `complete` | Yes | Does not block |
| `skipped` | Yes | Does not block |
