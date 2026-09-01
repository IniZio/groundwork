---
id: "C-GW-CLI"
type: "moc"
title: "gw Command Surface"
summary: "Sixteen gw ledger subcommands that read and mutate the legacy JSON run store; init is absent and requires bin/ledger directly."
parent: C-GROUNDWORK
status: "draft"
---

# gw Command Surface

> This index covers the `gw ledger` command surface as implemented in `src/gw/cli/commands/ledger.ts`. It specifies the subcommand registry, required flags, run-store path contract, write-token authority, JSON envelope shape, and exit-code semantics.

The `gw` CLI exposes 16 ledger subcommands that operate on the same legacy JSON run store (`hooks/ledger.mjs`, `hooks/lib/ledger-io.mjs`). The `init` subcommand is deliberately absent — ledger initialization still requires `bin/ledger init`. Decision D6 (behavior-preservation) is the hard constraint: the `gw` path must read and write the same store format and path as the legacy hooks, or the stop-gate reads a different file and the completion gate passes vacuously.

## Requirements

| Id | Title | Criticality |
|----|-------|-------------|
| [[requirements/gw-cli-r-001-subcommand-registry\|R-001]] | Subcommand registry — 16 subcommands, no init | must |
| [[requirements/gw-cli-r-002-motive-flag-required\|R-002]] | --motive flag required on every subcommand | must |
| [[requirements/gw-cli-r-003-motive-validation\|R-003]] | Motive slug validation against ledger | must |
| [[requirements/gw-cli-r-004-run-store-path\|R-004]] | Run-store path contract matches legacy hooks | must |
| [[requirements/gw-cli-r-005-write-token-authority\|R-005]] | Write-token authority on mutating subcommands | must |
| [[requirements/gw-cli-r-006-json-envelope-contract\|R-006]] | --json envelope shape and stdout contract | should |
| [[requirements/gw-cli-r-007-exit-code-contract\|R-007]] | Exit-code semantics: 0 / 1 / 2 | must |
