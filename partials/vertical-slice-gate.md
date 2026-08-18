A vertical slice is a thin end-to-end behavior cutting through all layers (types → logic → surface → test) for ONE outcome. Each file is owned by exactly ONE slice per wave — no shared ownership across siblings.

Shared types needed by multiple slices MUST be defined in the tracer-bullet (first) slice; all slices that depend on those types list the tracer-bullet in `blocked_by` and do not re-define them.

- Test files: each slice owns its own test file; shared harness/fixtures go in Wave 0.
- Generated or schema files: treat as a single-owner file, serialize in Wave 0.

Single-slice waves on non-trivial work are a failure mode — they mean the domain was not decomposed. If you find yourself authoring only one slice, reconsider whether genuine parallelism exists before proceeding.
