# spec skill

Manage requirement specifications under `docs/spec/` using the `spec` CLI.

## CLI quick reference

```
spec init                        Create docs/spec/README.md with a root concept node
spec build                       Build docs/spec/_generated/{index.md,index.json,coverage.json}
spec req new <concept> <name>    Create a new requirement file
spec show <id> [--full]          Show a spec node (≤8 lines without --full)
spec search <q> [--limit N]      Search nodes (default limit 8)
spec tree [--depth N]            Show concept tree (default depth 2)
spec deps <id>                   Show inbound/outbound references from the index
```

## Requirement file schema

Each requirement lives at `docs/spec/**/requirements/<kebab>.md`:

```yaml
---
id: CONCEPT-R-xxxx         # 4 random base32 chars, locally unique
concept: C-CONCEPT         # owning concept node id
ears: "When X, the system shall Y."
pattern: event             # ubiquitous|event|state|option|unwanted
verify: "Observe Y in output."  # prose only — NO file paths
verification: automated    # automated|manual|hybrid
criticality: must          # must|should (default must)
origin_rfc: RFC-0001
superseded_by: null
status: active             # active|superseded|withdrawn
---
```

Body is commentary only. Manual requirements must include a `## Manual procedure` section.

## EARS patterns

| Pattern | Template |
|---|---|
| ubiquitous | The `<system>` shall `<response>`. |
| event | When `<trigger>`, the `<system>` shall `<response>`. |
| state | While `<state>`, the `<system>` shall `<response>`. |
| option | Where `<feature>`, the `<system>` shall `<response>`. |
| unwanted | If `<condition>`, then the `<system>` shall `<response>`. |

## Index staleness

Read commands (`show`, `search`, `tree`, `deps`) automatically rebuild `_generated/index.json`
when any spec file is newer than the index. Run `spec build` explicitly after large edits.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | operational failure (build error, file not found, …) |
| 2 | usage error |
| 127 | delegated subcommand script not installed |
