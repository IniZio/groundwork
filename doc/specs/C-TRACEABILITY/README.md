# Traceability

The traceability system makes the full spec→code→end-product-artifact chain legible. It surfaces broken, unproven, stale, and missing links across a single unified chain:

```
objective → spec-req → slice → self-test → live-verify → gate
                                                    ↑
                                           artifact-evidence
```

## Why

Three hard questions must be answerable at a glance:

1. Are we building the correct product/feature? (objective → spec-req coverage)
2. Did we cover every deliverable, test it, AND live-verify it? (slice → test → gate coverage)
3. Did we specify everything with no detail left out? (spec-req completeness)

## Key decisions

- **D-3**: Mechanical links are computed deterministically from the spine; semantic classification is sourced from recorded gate verdicts.
- **D-4**: Artifact evidence references carry a build/data hash for staleness detection.
- **D-7**: A read-only spine-adapter interface isolates the store from all consumers.
- **D-8**: GATE and VERIFICATION events carry an optional per-link scope field.
- **D-9**: Visualization follows wave-band topology with semantic edge styling.

## Constraints

See [constraints.md](constraints.md) for normative requirements (TRACEABILITY-R-001 through TRACEABILITY-R-006).
