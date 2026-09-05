# HTML Report Format

## Temp directory resolution

| Platform | Path |
|---|---|
| Linux / macOS | `$TMPDIR` → `/tmp` |
| Windows | `%TEMP%` |

Filename: `arch-review-<timestamp>.html`

Open command: `xdg-open` (Linux), `open` (macOS), `start` (Windows)

## CDN dependencies

- **Layout**: Tailwind CSS via CDN
- **Diagrams**: Mermaid via CDN (for call graphs, dependency graphs)

## Candidate card fields

Each candidate renders as a card:

| Field | Content |
|---|---|
| **Files** | Which files/modules are involved (with paths) |
| **Problem** | Why this causes friction — use Glossary terms |
| **Solution** | What deepening would look like |
| **Benefit** | Locality gained, leverage gained, testability improvement |
| **Before/After diagram** | Side-by-side — Mermaid for call graphs; hand-crafted divs for depth/mass |
| **Strength badge** | `Strong` · `Worth exploring` · `Speculative` |

Do not propose concrete interfaces or implementation details in the report.

## Top recommendation section

End the report with a **Top recommendation** section: which candidate to tackle first and why.

## Compact summary (≤12 lines total)

Present this after writing the report:

```
Architecture review complete. Found N candidates:

1. [Title] — [one-line problem] (Strong)
2. [Title] — [one-line problem] (Worth exploring)
...

Report: /tmp/arch-review-<timestamp>.html
Which would you like to explore?
```
