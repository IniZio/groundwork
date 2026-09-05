---
name: engineering-judgment
description: Apply senior-engineer judgment — choose toolchain-enforced structure and test the product from the user's perspective against real hosted dependencies.
---

Two failure classes account for most agentic rework: structure held by convention instead of the toolchain, and tests that green-light regressions the real product surfaces.

**Failure: convention-held structure** — boundaries drawn by file-path naming or import discipline → any implementer adds a convenience import and drift accumulates → cross-concern files form undetected. Choose a module system the toolchain enforces; a cross-boundary import then fails at build or lint, not in a code review.

**Failure: cross-concern handler** — one handler imports auth, session, rendering, audit, and policy → any change to one concern requires editing the shared handler → coupling masks gaps. Before the NestJS migration, `router.ts` in agentic-artifacts mixed OAuth redirect, session cookies, HTML rendering, audit callback wiring, and authorization in one file; the user had to migrate the whole server to break it. Assign each concern its own module with a narrow interface.

**Failure: optional load-bearing wiring** — a collaborator typed as `?`-optional on a service-options struct → caller omits it with no compile error → behaviour is silently disabled. In agentic-artifacts, `auditRecord` was optional in `WebOptions`; the same audit regression landed twice before anyone noticed. Required collaborators are required fields; absent wiring is a compile error.

**Failure: stub-built app** — tests assemble their own app from stubs → the real wiring path is never exercised → a wiring regression stays green. In agentic-artifacts, the audit test was documented "Offline — stub store, stub auth" and built its own app instance; it would have stayed green through any regression in real wiring. Acceptance tests load the production factory; stubs enter only through interfaces the production code exposes.

**Failure: synthetic auth in tests** — tests mint a JWT locally → the real token issuer is never exercised → issuer-side failures are invisible. The after state in agentic-artifacts runs a full login flow against a locally hosted Authgear instance and is documented as "deliberately does NOT mock any services." Acceptance tests obtain tokens through the production identity provider, hosted locally.

**Failure: horizontal test slicing** — all test effort goes to unit tests → acceptance and integration layers are never written → the shape of each unit is verified but the assembled product is not. In nexus3, early tests used stubbed listeners; the user added `//go:build integration` tests booting real VMs before cross-boundary behaviour was confirmed. Plan the test pyramid from the acceptance layer down; unit tests fill gaps the acceptance layer cannot reach cheaply.

## Decisions the planner records

Before cutting any slice, record two journal decisions:

**Structure decision** — which toolchain enforcer was chosen, alternatives considered (e.g. NestJS `@Module` over bare Express; Go `internal/` over naming conventions; dependency-cruiser over manual review), and why.

**Test-strategy decision** — which layer is the acceptance layer, which dependencies are hosted for real, which are stubbed under a waiver, and why.

Plan-review and the advisor gate fail when either decision is absent.

## Waiver rule (D-10)

Unhostable means all three hold: no official or community container image exists; no vendor-supplied emulator exists; no free sandbox tenancy is reachable from the test run. A stub without a waiver is not permitted. Record a WAIVER journal event with five fields: `dependency`, `failing_criterion` (which of the three above), `scope` (which tests the stub covers), `expiry_condition`, and `contract_test` (path to a test pinning the stub response shape to the real published API). Postgres, Redis, S3-compatible storage, Authgear, and Keycloak are always hostable; no waiver applies.

Completion: `node scripts/check-probe-conformance.mjs <repo>` prints one `PASS|FAIL|UNKNOWN <id> <reason>` line per check; exits 0 when no check returns FAIL; UNKNOWN is the legitimate result for unrecognized stacks.

Per-stack enforcer examples and a worked WAIVER: [`reference/stacks.md`](reference/stacks.md).
