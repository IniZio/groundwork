## Agent skills

### Issue tracker

Issues live as local markdown files under `.groundwork/work/<slug>/`. See `doc/agents/issue-tracker.md`.

### Triage labels

Default five roles (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix), recorded as a `Status:` line. See `doc/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` for terms; decisions are `DECISION` events (`gw event append`); a decision that spans motives or needs full reasoning also gets an ADR at `.groundwork/adr/NNNN-name.md`, linked from the event. See `doc/agents/domain.md`.
