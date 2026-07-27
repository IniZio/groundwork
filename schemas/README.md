# schemas/

JSON Schema files (draft 2020-12) for groundwork's frontmatter and runtime
data structures. All files in this directory are consumed by
`hooks/lib/schema-io.mjs` via `loadSchema(name)`.

## Naming convention

Each file is named `<name>.schema.json` where `<name>` is a stable identifier
passed to `loadSchema`. The `$id` field inside each schema MUST match the
filename:

```json
{ "$id": "rfc-frontmatter.schema.json", "$schema": "https://json-schema.org/draft/2020-12/schema" }
```

## Schemas

| File | Content | Loaded by (line) | Violation effect |
|---|---|---|---|
| `spec-concept.schema.json` | Spec concept node frontmatter | `hooks/spec-lint.mjs:219` | **ADVISORY under bare `spec lint`** — violations printed to stdout as `LINT_DRIFT` lines, exit 0 always; **HARD under `spec lint --rfc <uid>`** — exit 1 if any violation, exit 0 if clean, but only for nodes named in that RFC's `spec_delta`; nodes outside the delta are not examined and cannot cause exit 1. `additionalProperties` violations (unknown frontmatter keys) are reported as `unknown-field:` lines by `schemaErrorsToViolations` (`spec-lint.mjs:186`). |
| `spec-requirement.schema.json` | Spec requirement node frontmatter | `hooks/spec-lint.mjs:219` | **ADVISORY under bare `spec lint`** — violations printed to stdout as `LINT_DRIFT` lines, exit 0 always; **HARD under `spec lint --rfc <uid>`** — exit 1 if any violation, exit 0 if clean, but only for nodes named in that RFC's `spec_delta`; nodes outside the delta are not examined and cannot cause exit 1. `additionalProperties` violations (unknown frontmatter keys) are reported as `unknown-field:` lines by `schemaErrorsToViolations` (`spec-lint.mjs:186`). |
| `rfc-frontmatter.schema.json` | RFC YAML frontmatter | `hooks/rfc.mjs:143` (inside `validateFrontmatter()`) | **HARD** — violations push into the `errors` array; any non-empty `errors` causes `process.exit(1)` at `rfc validate` time |
| `run-ledger.schema.json` | Run ledger data structure | `hooks/ledger.mjs:149` | **HARD at `init`** (via `checkLedgerStrict` — schema violations are hard errors because "never write new corruption"); **ADVISORY for all other mutations** (`complete`, `gate`, `set`, `add`) — schema violations surface as `warnings` (stderr, exit 0). The four hand-written HARD checks (exit 1) apply to all write commands: duplicate slice id, dangling `blocked_by`, empty `acceptance` array, empty acceptance string. Read-only commands (`view`, `status`) do not run these checks and exit 0. |
| `journal-event.schema.json` | Journal event payload | not yet wired — `hooks/lib/journal-io.mjs` does not call `loadSchema` | **INERT** — schema exists and compiles correctly (ajv-formats registered in `schema-io.mjs`), but has no production call sites |

> **Enforcement key:** HARD = violation causes exit 1. ADVISORY = violation surfaces as a warning but the command continues. INERT = schema file exists but no production code loads it yet.

## Loader API

```js
import { loadSchema, ajvErrorsToLines } from '../hooks/lib/schema-io.mjs'

// Load (and cache) a compiled validator
const validate = loadSchema('rfc-frontmatter')

if (!validate(data)) {
  // Convert Ajv errors to the "field: problem" line style used by all runners
  const lines = ajvErrorsToLines(validate.errors, 'rfc')
  for (const line of lines) process.stderr.write(`rfc: validate: ${line}\n`)
  process.exit(1)
}
```

`ajvErrorsToLines` output matches the existing `<field>: <problem>` format
emitted by `hooks/spec-lint.mjs` and `hooks/rfc.mjs`. No changes to those
runners' output format are needed.

## Guidelines

- Schemas are compiled once per process and cached. Do not add schemas at
  runtime; list them here and in the table above.
- Use `strict: true` — extra properties not in the schema must be declared or
  the Ajv compile will throw.
- `allErrors: true` is set globally so a single validation run reports every
  violation, not just the first.
- Do not import Ajv directly in hook files; always go through `schema-io.mjs`.
