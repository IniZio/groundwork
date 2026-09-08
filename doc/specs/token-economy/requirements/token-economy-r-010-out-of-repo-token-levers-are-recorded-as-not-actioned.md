---
id: token-economy-r-010
type: requirement
concept: C-TOKEN-ECONOMY
title: "Out-of-repo token levers are recorded as evaluated and not actioned"
criticality: must
verification: manual
status: open
---

## TOKEN-ECONOMY-R-010 — Out-of-repo token levers are recorded as evaluated and not actioned {#token-economy-r-010}

This motive **shall** document the token-cost levers that lie outside this repository — in the operator's MCP server configurations, cloud-side Connections, and other installed plugins — as explicitly evaluated and deliberately not actioned, with measured or estimated figures and a stated rationale for each.

- **Why** — D-14 concluded that the bulk of the reducible per-session prompt mass lives outside this repository. The four out-of-repo surfaces identified during T17 bottom-up measurement sum to approximately 3,000–3,800 tokens (estimated; see lever table below), several times the entire in-repo ceiling of ~750–950 tokens. Without an explicit not-actioned record, these figures look identical to an oversight when re-read in six months, and risk being treated as an open work list by a later agent editing operator settings files it has no mandate to touch. Cache-read is 55.4% of spend volume-weighted across 266 real sessions (median 46.9% per session — R-009); because the prefix is re-read on effectively every turn, these surfaces are re-billed continuously, which is why they matter despite being unactionable here.

- **Fit criterion** — The motive charter at `.groundwork/motives/token-economy/motive.md` and this requirement together document each out-of-repo lever with: (a) a measured or estimated size in tokens with the measurement method stated; (b) the owner of that surface; (c) an explicit not-actioned verdict with a substantive reason; and (d) where the lever is partly actionable by groundwork, a note that it is available future work. The five levers below satisfy that contract. The requirement is NOT satisfied if any lever's reason is "we did not get to it" without that label — that label is distinct from "not ours to edit."

- **Lever table** (T17 bottom-up measurement, 2026-09-08 session):

  | Surface | Estimated size | Owner | Verdict | Reason |
  |---|---|---|---|---|
  | fff MCP instruction block | ~1,338 tokens (measured) | Operator config `~/.claude.json` | **Not actioned** | Disabling fff contradicts the global `CLAUDE.md` instruction to prefer fff tools for file search; both would need to change together under an operator-level decision outside this motive's scope. Partly actionable: removing the fff preference from the global `CLAUDE.md` and the `~/.claude.json` entry in tandem is a coherent future lever for an operator-level change. |
  | codegraph MCP instruction block | ~900 tokens (measured) | Operator config `~/.claude.json` | **Not actioned** | The instruction block is authored by the codegraph plugin; this repository contains no file that controls it. Groundwork cannot edit a third-party plugin's self-description. |
  | Figma claude.ai Connection | ~500–1,300 tokens (estimated range; width reflects variable tool-schema payload) | Cloud-side claude.ai Connections panel, per-user account | **Not actioned** | Configured at claude.ai by the operator; no file in this repository controls it. |
  | Linear claude.ai Connection | ~265 tokens (measured) | Cloud-side claude.ai Connections panel, per-user account | **Not actioned** | Same ownership as Figma. |
  | Other installed plugins' skill listings | Not individually measured | Each plugin's own directory, outside this repo | **Not actioned** | Each plugin authors its own skill content; groundwork has no mandate to edit another plugin's skill files. Groundwork's own skill surface is measured and partially reduced by sibling slice T34 — that is the in-repo portion of this lever. |

- **Surfaces evaluated and found to be in-repo (addressed by other slices, not recorded here as out-of-repo):**

  The following were evaluated as candidates but are groundwork's own files and are therefore handled by other slices in this motive, not by this requirement:

  - **Groundwork SessionStart injection** (`hooks/session-reminder.mjs`) — ~1,867 tokens (measured). In-repo; D-12 lever 2 (deduplication with `CLAUDE.md`) is the actionable path. Not out-of-repo.
  - **`CLAUDE.md` system-prompt injection** — in-repo authority file; D-12 lever 3 (pruning the skills and MCP instruction surface) addresses this. Sibling slice T34 owns the measurement.
  - **Agent-type roster** (`agents-src/*.md`) — in-repo; prose compression slices address these.

- **Verification**: manual — a reviewer reads this requirement and the AC-16 block in the motive charter, confirms that each named lever has all four fields (size, owner, verdict, reason), confirms the reason is substantive, and confirms no operator config file (`~/.claude.json`, `~/.claude/settings.json`, cloud Connection) was edited by any slice in this motive. The automated test suite cannot verify this requirement because the surfaces live outside the repository.

- **Criticality**: must
