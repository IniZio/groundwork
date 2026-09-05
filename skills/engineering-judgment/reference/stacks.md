# Per-Stack Enforcer Examples

| Stack | Toolchain enforcer | Boundary check | Build tag for integration |
|---|---|---|---|
| Node/TypeScript | NestJS `@Module` with explicit `imports`/`exports` | dependency-cruiser (`depcruise`) or eslint-plugin-boundaries | `jest --testPathPattern=acceptance` or Vitest workspace |
| Go | `internal/` packages (compiler-enforced import restriction) | `go vet` + `golang.org/x/tools/go/analysis` | `//go:build integration` — run with `go test -tags integration ./...` |
| Python | `src/` package layout with `__init__` gate | import-linter (`lint-imports`) or Flake8 plugin | pytest mark: `@pytest.mark.integration` + `pytest -m integration` |

## docker-compose hosting reference

All of these have official images; none qualifies for a WAIVER:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app

  redis:
    image: redis:7-alpine

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin

  authgear:
    image: quay.io/theauthgear/authgear-server:2026-08-26.0
    ports:
      - "3001:3001"
    volumes:
      - ./authgear.yaml:/app/authgear.yaml
```

## Worked WAIVER example

A third-party transactional-email provider (e.g. a SaaS API with no local emulator) that the acceptance suite would otherwise stub:

```bash
bin/journal append --motive <slug> --type WAIVER \
  --msg "Waive Postmark acceptance hosting — no emulator available" \
  --data '{
    "dependency": "Postmark transactional-email API",
    "failing_criterion": "no official or community container image exists and no vendor-supplied emulator exists",
    "scope": "acceptance tests that assert an email was dispatched after user registration",
    "expiry_condition": "Postmark ships a local sandbox image or a first-party fake, or a compatible OSS fake (e.g. mailpit) is confirmed equivalent",
    "contract_test": "test/contract/postmark-send-email.contract.test.ts"
  }'
```

The conformance checker reads WAIVER events from `.groundwork/journal/*.jsonl` (fallback `.groundwork/waivers/*.json`), matches by `dependency`, suppresses SC-B1 for that dependency and SC-B2 only when the dependency is the identity provider; SC-A4 has no waiver path.

`contract_test` must assert that the stub's request shape and response schema match the vendor's published API spec; it fails when the vendor changes a field name or status code.

## Worked decision pair

### Structure decision

```bash
bin/journal append --motive <slug> --type DECISION \
  --msg "NestJS @Module over bare Express" \
  --data '{
    "id": "D-struct-1",
    "decision": "Use NestJS with @Module declarations as the architecture enforcer; dependency-cruiser rules enforce no imports from auth/ into web/internal/.",
    "rationale": "NestJS @Module boundaries are enforced at build/lint time, not just by naming convention. Alternatives lacked toolchain enforcement.",
    "kind": "structure",
    "status": "accepted",
    "alternatives": [
      "bare Express with manual separation — rejected: no toolchain prevents cross-concern imports",
      "Fastify with plugins — rejected: no first-class DI or module boundary check"
    ]
  }'
```

### Test-strategy decision

```bash
bin/journal append --motive <slug> --type DECISION \
  --msg "BDD acceptance layer through production entrypoint against hosted Authgear" \
  --data '{
    "id": "D-test-strategy-1",
    "decision": "Acceptance layer boots the production NestFactory.create() entrypoint, obtains tokens via the real Authgear PKCE flow (docker-compose), and exercises every API route as the end user would.",
    "rationale": "Postgres, Redis, MinIO, and Authgear are all hostable via docker-compose; no stubs are permitted at the acceptance layer. Unit tests cover pure functions and domain logic only.",
    "kind": "test-strategy",
    "status": "accepted",
    "alternatives": [
      "mock the HTTP layer in unit tests — rejected: does not exercise the production entrypoint path",
      "stub all third-party dependencies — rejected: Postgres, Redis, Authgear are all hostable; no waiver justified"
    ]
  }'
```
