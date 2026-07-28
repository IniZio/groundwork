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

    RunLedger ||--o{ Slice : "contains"
    RunLedger ||--o| Gate : "has"
    RFC ||--o{ SpecManifest : "references via spec_delta"
    JournalEntry }o--|| RunLedger : "belongs to session"
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
