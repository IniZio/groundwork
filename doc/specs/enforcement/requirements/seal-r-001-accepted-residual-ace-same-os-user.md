---
id: seal-r-001
title: Accepted residual — arbitrary-code-execution as the same OS user can forge a valid seal
concept: "[[enforcement/index]]"
criticality: must
verification: manual
ears_pattern: Ubiquitous
verification_method: Inspection
design: "[[design/concepts/hook-architecture]]"
status: implemented
source: sealed-gate#D-10
verifies: []
---

## Statement

The sealed-gate design provides tamper-evidence against the realistic threat model (CLI misuse, direct `Write`/`Edit` tool calls, and simple Bash mutation patterns) but **shall not** be construed as guaranteeing containment against a subagent with arbitrary code execution running as the same OS user. Such a subagent can read the seal key from disk and write a correctly re-sealed ledger via `computeSeal(canonicalReleaseState(ledger), key)`, bypassing the stop-gate entirely. This is an accepted, documented residual risk.

## Why

Perfect containment without OS-level isolation (a separate UID, container boundary, seccomp policy, or equivalent mechanism) is impossible: any process running as the same user can read and write any file that user owns. The sealed-gate feature is a defense-in-depth measure against common, non-adversarial failure modes — accidental CLI misuse, guard-bypass via direct file writes, and simple Bash injection. It is not a security boundary. Documenting this residual explicitly prevents over-reliance on the mechanism and provides a clear anchor for future hardening decisions (e.g. storing the key in a separate process, kernel keyring, or external secret store).

## Fit criterion

Not automatically testable. Verification requires threat-model review: confirm that `hooks/lib/gate-seal.mjs` stores the key at a filesystem path readable by the ambient process user (`<projectDir>/.groundwork/runs/<sessionId>.seal.key`, mode 0600), and that nothing at the OS level prevents an arbitrary process running as that user from reading the key and calling `computeSeal` to produce a valid seal for any desired ledger state.

## Verification procedure

Manual — not automatable; the threat model is validated by review of `hooks/lib/gate-seal.mjs` (key storage) and `test/hooks/sealed-gate-vectors.test.ts` (documents the boundary of what IS tested).
