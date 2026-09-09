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

## Module design language

When reviewing or proposing structure, use these terms — each carries a verdict, not just a label.

**Depth** (Ousterhout, *A Philosophy of Software Design*; vocabulary ported from Pocock, *codebase-design*): behaviour per unit of interface. A module is **deep** when large behaviour sits behind a small interface; **shallow** when a caller must learn as much about the module's internals as they gain in capability from using it. The cross-concern handler failure above produces a shallow module: a caller of `router.ts` cannot add an auth rule without reasoning across session, rendering, and audit — every concern leaks into every path. Reject a proposed abstraction layer that is itself shallow — it is a pass-through, not an abstraction.

_Deletion test_: imagine deleting the module. Complexity vanishes → it was a pass-through. Complexity scatters back across every caller → it was earning its keep. Apply this before building an abstraction to confirm it has real depth.

**Interface**: what a caller must account for to use a module correctly — not just the type signature but also runtime constraints the type cannot enforce: ordering dependencies, required collaborators, and failure modes the compiler does not see. The optional-wiring failure above is interface underspecification: `auditRecord` was a required collaborator the interface did not require. Reject a design whose interface omits constraints callers will discover at runtime.

**Seam** (Feathers, *Working Effectively with Legacy Code*): the cut point where a module's responsibilities end and callers' begin — the surface acceptance tests should cross. The stub-built app failure above is a seam placement failure: the test assembled its own app instance instead of crossing the production seam, so wiring regressions never reached it. Reject a test that reconstructs the module differently than production callers do — it is not testing the module that ships.

_Adapter count heuristic_: one concrete adapter at a seam means the variation is hypothetical. Two adapters means it is real. Reject a seam introduction until a second adapter exists or is concretely planned; a seam with one adapter is premature structure.

## Decisions the planner records

Before cutting any slice, record two journal decisions:

**Structure decision** — which toolchain enforcer was chosen, alternatives considered (e.g. NestJS `@Module` over bare Express; Go `internal/` over naming conventions; dependency-cruiser over manual review), and why.

**Test-strategy decision** — which layer is the acceptance layer, which dependencies are hosted for real, which are stubbed under a waiver, and why.

Plan-review and the advisor gate fail when either decision is absent.

## Waiver rule (D-10)

Unhostable means all three hold: no official or community container image exists; no vendor-supplied emulator exists; no free sandbox tenancy is reachable from the test run. A stub without a waiver is not permitted. Record a WAIVER journal event with five fields: `dependency`, `failing_criterion` (which of the three above), `scope` (which tests the stub covers), `expiry_condition`, and `contract_test` (path to a test pinning the stub response shape to the real published API). Postgres, Redis, S3-compatible storage, Authgear, and Keycloak are always hostable; no waiver applies.

Completion: `node scripts/check-probe-conformance.mjs <repo>` prints one `PASS|FAIL|UNKNOWN <id> <reason>` line per check; exits 0 when no check returns FAIL; UNKNOWN is the legitimate result for unrecognized stacks.

Per-stack enforcer examples and a worked WAIVER: [`reference/stacks.md`](reference/stacks.md).
