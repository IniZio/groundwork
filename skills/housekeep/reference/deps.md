# Housekeep — deps mode

Load this file only when the user selects `deps` mode. The shared posture and completion gate in `SKILL.md` apply.

## When to use this mode

- Dependency hygiene after AI-generated changes that added or ignored deps
- Periodic hygiene sweep of the dependency tree
- Pre-release dep audit before cutting a version

## Smells

| Smell | Definition |
|---|---|
| **Unused dependencies** | Declared but never imported/required anywhere in the source tree |
| **Outdated dependencies** | Several majors behind current; security-relevant lag |
| **Vulnerable dependencies** | Known CVEs against declared versions |
| **Duplicate functionality** | Two deps doing the same job (e.g. two HTTP clients, two date libs) |
| **Phantom deps** | Imported but not declared — classic Node/monorepo hoisting issue; works by accident |

## Severity mapping

Default SEV tiers for deps smells (rubric: consequence × blast-radius; context can bump ±1 per SKILL.md):

| Smell | Default SEV | Rationale |
|---|---|---|
| **Vulnerable dependencies** | SEV1 | Security consequence; potentially wide blast-radius |
| **Phantom deps** | SEV2 | Works by accident — latent breakage risk on install/upgrade |
| **Unused dependencies** | SEV3 | Maintainability; safe to delete |
| **Duplicate functionality** | SEV3 | Maintainability; consolidation is low-risk |
| **Outdated dependencies** | SEV3 (default) / SEV1 (if carrying a known CVE) | The CVE case is an explicit context bump per the rubric |

These are defaults the rubric can adjust. The pass order below (unused → outdated → vulnerable → duplicate) already flows safest-first, which maps roughly SEV3 → SEV3 → SEV1 → SEV3 — the triage gate may reorder when a SEV1 vulnerability warrants immediate attention.

## Findings backlog and triage gate

Deps mode reuses the **shared findings-backlog format** and the **interactive triage gate** defined in `SKILL.md` (see "Shared findings backlog format" and "Step 4 — Triage gate"). Do not redefine the table schema or gate here. Collect every smell as a Finding during the scan; present the severity-sorted backlog to the user before any edits begin.

## Passes

Mirror the deslop pass structure: one smell-focused pass at a time, verification after each.

- **Pass 1: Remove unused deps** — delete declarations; confirm nothing imports them.
- **Pass 2: Pin/upgrade outdated** — one major bump per diff; tests green between bumps.
- **Pass 3: Patch vulnerabilities** — CVE triage; prefer upgrade over suppress/ignore.
- **Pass 4: Consolidate duplicate functionality** — pick one dep, migrate call sites, remove the other.

Re-run the FULL test suite after EACH pass. Dep changes have wide blast radius — a passing unit suite is not enough; run integration/e2e where they exist.

## Tooling hints (examples, not mandates)

Name the common tool per ecosystem; do not mandate a single one.

| Concern | Common tools |
|---|---|
| Unused deps | `depcheck` (Node), `pipdeptree` / `pip-reqs` (Python), `cargo-udeps` (Rust), `go mod tidy -v` (Go) |
| Outdated deps | `npm outdated`, `pip list --outdated`, `cargo outdated`, `go list -m -u all` |
| Security audit | `npm audit`, `pip-audit`, `cargo audit`, `govulncheck` |

## Quality gates (deps-specific)

- Full test suite green (unit + integration + e2e where present)
- Lockfile committed and consistent with manifests
- `audit` clean OR every accepted risk annotated with rationale
- If a gate fails, REVERT the dep change — never force through a dep break

## Risk note

Dep changes have the widest blast radius of any housekeep mode. Prefer the smallest safe diff. One major upgrade per verification cycle. If a dep touch fails a gate, backing out is the correct move — not patching forward.
