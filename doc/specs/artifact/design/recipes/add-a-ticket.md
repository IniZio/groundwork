---
id: "artifact-recipe-add-a-ticket"
type: "recipe"
title: "How to add a ticket and link it to a slice"
tags: [recipe, how-to, ticket, slice]
---

# How to add a ticket and link it to a slice

## Goal

Create a durable ticket document for cross-session tracking and link it to one or more run-ledger slices so the work stays traceable across sessions.

## Before you start

- You have an active run ledger (`gw ledger status --motive <slug>` shows an active run).
- You know the motive slug (e.g. `my-feature`).
- You have a kebab-case description for the ticket (e.g. `auth-token-design`).
- You know the ticket type (one of: `research`, `choose`, `model`, `build`, `grill`, `spec`, `fix`, `chore`).

## Steps

### 1. Determine the next ordinal

List existing tickets to find the next available two-digit ordinal:

```bash
ls .groundwork/motives/my-feature/tickets/
# e.g. 01-research-domain-model.md  02-choose-auth-lib.md
# → next ordinal is 03
```

### 2. Create the ticket file

The filename must follow the convention `<NN>-<type>-<slug>.md` (ARTIFACT-R-012):

```bash
cat > .groundwork/motives/my-feature/tickets/03-build-auth-token-design.md << 'EOF'
# Auth Token Design

Type: build
Status: open

## Question

## Context

## Evidence

## Decision

## Ruled out

## Revisions

## Links
EOF
```

The seven H2 sections are required and must appear in this order (ARTIFACT-R-007).

### 3. Link the ticket to a slice

When adding or updating a slice, supply `--ticket` with the ticket id (the filename stem without `.md`):

```bash
gw ledger add --motive <slug> s3 --desc "Implement auth token handler" \
  --ticket 03-build-auth-token-design \
  --kind build
```

Or update an existing slice:

```bash
gw ledger set --motive <slug> s3 --ticket 03-build-auth-token-design
```

### 4. Verify the link

```bash
gw ledger show --motive <slug> s3
# Output includes: ticket: "03-build-auth-token-design"
```

## Ticket location override

If the motive charter has a `tickets_dir` field, tickets live there instead of the default `.groundwork/motives/<slug>/tickets/` (ARTIFACT-R-009). Check the charter before creating the file:

```bash
grep tickets_dir .groundwork/motives/my-feature/motive.md
```

## Related notes

- [[../components/run-ledger-slice]] — slice field specs including `ticket`
- [[../flows/slice-lifecycle]] — slice states
- [[../reference/slice-fields-reference]] — all CLI flags
- [[../../requirements/artifact-r-007-ticket-is-the-durable-work-object|R-007]] — ticket shape requirement
- [[../../requirements/artifact-r-009-ticket-location-resolution|R-009]] — location resolution
- [[../../requirements/artifact-r-012-ticket-filename-follows-nn-type-slug-convention|R-012]] — filename convention
