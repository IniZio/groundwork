# Housekeep — learnings-staleness mode

Load this file only when the user selects `learnings-staleness` mode. The shared spine, finding format, severity rubric, triage gate, and completion gate in `SKILL.md` apply.

Learnings-staleness revalidates each promoted learning against current source to find entries whose premises no longer hold — the feature was deleted, the pattern was changed, or the incident was permanently fixed.

## Triggers

`housekeep learnings`, `stale learnings`, `revalidate learnings`

## What learnings are

Promoted learnings are captured rules from past incidents and sessions. They live in the project memory index (`~/.claude/projects/<project>/memory/MEMORY.md`) as one-line entries, each pointing to a sidecar `.md` file in the same directory. The sidecar contains the full incident record, root cause, and the rule that was extracted.

## Smell catalog

| Smell | Definition | Default SEV |
|---|---|---|
| **Contradicted learning** | The learning says "X happens if you do Y" but current source shows Y no longer does X | SEV2 — the rule is now wrong guidance |
| **Deleted-feature learning** | The learning is about a feature, file, or pattern that no longer exists in source | SEV3 — the rule is now vacuous |
| **Resolved-incident learning** | The learning documents a workaround for an incident that has been permanently fixed | SEV3 — the workaround may now be counterproductive |
| **Superseded learning** | A newer learning in the same memory file contradicts this entry, making it stale | SEV3 |
| **Orphaned sidecar** | The MEMORY.md index references a sidecar file that does not exist on disk | SEV2 — causes recall failures |

Context bumps apply: a contradicted learning on a security or correctness boundary → SEV1; a vacuous learning about a long-retired experiment → SEV4.

## Scan procedure

The scan is different from a code scan — it works against a memory index, not directly against source files.

1. Read `~/.claude/projects/<project>/memory/MEMORY.md` to enumerate all learning entries and their sidecar file paths.
2. For each entry:
   a. Confirm the sidecar file exists on disk. Missing → Orphaned sidecar finding.
   b. Read the sidecar and extract the central claim (the rule the learning encodes).
   c. Grep current source to verify whether the claim still holds.
   d. Check whether a newer entry in MEMORY.md contradicts this one.
3. Flag any entry where:
   - The referenced file or symbol no longer exists in source
   - The described behavior has changed
   - A newer entry in the memory file contradicts it

Batch all grep checks with `ctx_batch_execute` — never sequential greps.

## Passes

- **Pass 1 — Orphaned sidecars:** for each MEMORY.md entry, confirm the sidecar file exists. Record any missing sidecar as a finding.
- **Pass 2 — Contradicted and superseded learnings:** grep-verify each learning's central claim against current source. Flag entries where the claim no longer holds, and flag pairs where a newer entry contradicts an older one.
- **Pass 3 — Deleted-feature and resolved-incident learnings:** identify learnings about features or patterns removed from source, and learnings about workarounds for incidents that appear to be permanently fixed. Propose archive or deletion for each, subject to user triage.

## Triage note

Learnings represent hard-won incident knowledge. The triage gate is especially important here — never delete a learning without user confirmation. When a learning's status is ambiguous (feature removed but the pattern might return, incident fixed but the fix could regress), Defer is the safe default. Deletion is appropriate only when the learning's premise no longer exists in any form.

## Quality gates

- Every MEMORY.md entry has a sidecar file that exists on disk
- No sidecar file exists on disk without a corresponding MEMORY.md entry
- No promoted learning's central claim is directly contradicted by current source

If a gate fails, triage the offending entry with the user before taking action — do not delete or modify a learning unilaterally.

## Posture note

This mode is archive-favoring over deletion. Prefer proposing an archive (move to a dated archive section in MEMORY.md, keep the sidecar) over outright deletion, unless the learning's premise is confirmed fully absent from the codebase. Do not write new learnings or revise learning content during this pass — identify, triage, and clean only.
