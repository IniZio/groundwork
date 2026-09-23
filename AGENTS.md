## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/`. See `doc/agents/issue-tracker.md`.

### Triage labels

Default five roles (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix), recorded as a `Status:` line. See `doc/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` for terms; decisions are `DECISION` events recorded with `gw event append`, not ADR files. See `doc/agents/domain.md`.
