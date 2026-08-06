---
type: data-model
id: C-ARTIFACT
---

# Artifact Data Model

```mermaid
erDiagram
    RunLedger {
        string session_id
        string task
        string active
        string write_token
        string rfc_ref
    }
    Slice {
        string id
        int wave
        string status
        string desc
        string blocked_by
        string acceptance
        string completed_at
        string decisions
    }
    Gate {
        string advisor
        string citation
        string rubric
    }
    RFC {
        string uid
        int ordinal
        string slug
        string title
        string status
        string classification
        string spec_delta
    }
    JournalEntry {
        string session_id
        string timestamp
        string event_type
        object payload
    }
    SpecManifest {
        string id
        string title
        string summary
        string status
        array views
        object relations
        object lint
    }

    Ticket {
        string id
        string type
        string slug
        string motive_slug
        string status
        string tickets_dir
    }

    RunLedger ||--o{ Slice : "contains"
    RunLedger ||--o| Gate : "has"
    RFC ||--o{ SpecManifest : "references via spec_delta"
    JournalEntry }o--|| RunLedger : "belongs to session"
    Ticket ||--o{ Slice : "addressed by (1..n)"
```

## Run Ledger fields

| Field | Type | Description |
|---|---|---|
| `session_id` | string | Unique identifier for the session that created this ledger |
| `task` | string | Human-readable description of the run's goal |
| `slices` | Slice[] | Ordered list of work slices tracked in this run |
| `gate` | Gate | Advisor verdict record; `null` until gate is recorded |
| `active` | boolean | Whether this run is still in progress |
| `write_token` | string | Opaque token required by ledger CLI to mutate this ledger |
| `rfc_ref` | string? | Optional path to the motivating RFC directory |

## Ticket fields

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier for the ticket; derived from the filename stem (e.g. `01-research-domain-model`) |
| `type` | string | Controlled type prefix; one of the eight values in the closed vocabulary below |
| `slug` | string | Kebab-case file stem used as the on-disk filename (without `.md`) |
| `motive_slug` | string | Slug of the owning motive |
| `status` | string | Lifecycle state: `open`, `decided`, `superseded` |
| `tickets_dir` | string? | Resolved directory path where this ticket file lives; overridden by charter `tickets_dir` |

A ticket document contains the following required H2 sections in order: **Question**, **Context**, **Evidence**, **Decision**, **Ruled out**, **Revisions**, **Links**. The planner fills Question and Context when opening the ticket; the implementer appends Evidence, Decision, and Ruled out at completion (ORCHESTRATION-R-003).

The `Slice.ticket` field (optional string) records which ticket a slice is delivering against, establishing the 1..n relationship: one ticket may be addressed by one or more slices across one or more sessions.

The `Slice.decisions` field (optional string or string array) records zero or more journal DECISION event ids that this slice produces or is governed by, establishing the m..n relationship: one decision may be cited by multiple slices, and one slice may cite multiple decisions.

### Ticket type vocabulary

The `type` field is a **closed** enum. Exactly these eight values are valid (ARTIFACT-R-012):

| Type | Intent | Maps to ledger `--kind` |
|---|---|---|
| `research` | Gather evidence; always requires a primary-source citation in Evidence | `plan` |
| `choose` | Evaluate options and commit to one | `plan` |
| `model` | Define or revise a domain model or schema | `design` |
| `build` | Implement a slice of production behaviour | `impl` |
| `grill` | Adversarial review or stress-test of a prior decision | `plan` |
| `spec` | Author or update a spec requirement | `plan` |
| `fix` | Diagnose and repair a defect | `diagnose` |
| `chore` | Housekeeping with no user-facing behaviour change | `impl` |

The filename convention for a ticket is `<NN>-<type>-<slug>.md`, where `<NN>` is a zero-padded two-digit ordinal unique within the motive's ticket corpus and `<slug>` is a kebab-case description. Example: `10-research-domain-model.md`. The `Type:` metadata field in the ticket document must match the filename type segment.

## RFC fields

| Field | Type | Description |
|---|---|---|
| `uid` | string | Unique identifier (e.g. `R-20260726-K4M2QX`) |
| `ordinal` | integer | Sequential number within the RFC series |
| `slug` | string | Short kebab-case name for file naming |
| `title` | string | Human-readable decision title |
| `status` | string | Lifecycle state: `draft`, `accepted`, `superseded` |
| `classification` | string | Scope classification: `major`, `minor`, `patch` |
| `spec_delta` | string | Path or reference to spec requirements affected by this RFC |
