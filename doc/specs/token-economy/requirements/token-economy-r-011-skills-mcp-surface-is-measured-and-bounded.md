---
id: token-economy-r-011
type: requirement
concept: C-TOKEN-ECONOMY
title: "Skills/MCP surface is measured and the groundwork-controlled portion is bounded"
criticality: must
verification: automated
status: open
---

## TOKEN-ECONOMY-R-011 — Skills/MCP surface is measured and the groundwork-controlled portion is bounded {#token-economy-r-011}

Every Claude Code session's prompt prefix carries, beyond CLAUDE.md, a skills/MCP surface: the available-skills listing (name + description for every installed skill), MCP server tool-name catalogs, MCP server instruction blocks, and the agent-type roster. This requirement records the measured baseline, attributes ownership, and enforces a ceiling on the groundwork-controlled portion.

The groundwork-controlled portion **shall** remain below a token-estimated ceiling derived from the T34 baseline measurement (2026-09-08), enforced by an automated test on the authority source trees (`skills/groundwork/**/SKILL.md` and `agents-src/*.md`).

- **Why** — D-12 named three levers for session token reduction: (1) turn count, (2) CLAUDE.md/injection dedup, (3) the skills/MCP surface. Lever 1 confirmed (T32: cache-read is 55.4% volume-weighted). Lever 2 disproved (T28: zero removable CLAUDE.md duplication). Lever 3 (this requirement) produces an honest negative: the groundwork-controlled descriptions are already at minimum viable size. The ceiling test exists so the surface does not regress — bulk growth here is the risk, not a current saving opportunity.
- **Measured baseline (tiktoken cl100k_base, 2026-09-08, command `python3 -c "import tiktoken; enc=tiktoken.get_encoding('cl100k_base'); print(len(enc.encode(open('...').read())))"` per surface):**

  | Surface | Tokens | Owner |
  |---|---|---|
  | groundwork/* skills (24) | 805 | this repo — `skills/groundwork/` |
  | groundwork agents (12) | 511 | this repo — `agents-src/` |
  | **groundwork-controlled subtotal** | **1316** | **this repo** |
  | Other plugin skills (23) | 766 | external plugins |
  | MCP tool names (162 tools) | 1880 | external MCP servers |
  | MCP server instruction blocks | 1004 | external MCP servers |
  | **Total measured surface** | **~4972** | mixed |

- **D-14 claim check** — D-14 estimated the reducible in-repo prefix mass at ~750–950 tokens. The measured groundwork-controlled total is 1316 tokens; the reducible amount is **0**. Every description is at minimum viable size: "Triggers on:" suffixes carry routing keywords the model matches when loading a skill, and agent descriptions carry behavioral constraints. D-14's ~750–950 estimate is superseded by this measurement; the correct figure is 1316 total, 0 reducible.
- **Fit criterion** — `test/skills-agent-surface-ceiling.test.ts` reads all `skills/groundwork/**/SKILL.md` files (excluding `.codex-overlays/`) and all `agents-src/*.md` files, builds a `"- name: description\n"` listing, and asserts `estimateTokens(listing) <= 1810`. The ceiling 1810 is the `estimateTokens` snapshot value at 2026-09-08 with zero added slack, following T28's design. The test also asserts the skill glob returns ≥20 files and the agent glob returns ≥10 files as tamper guards.
- **Verification**: automated — `@verifies test/skills-agent-surface-ceiling.test.ts`.
- **Criticality**: must

## Lever-3 finding (TBD-N settled by T34) {#t34-finding}

The skills/MCP surface is real and measurable (~4972 tokens) but not reducible by this repo. The 73.5% not owned here (MCP tool names, MCP server instructions, other plugin skills) is the domain of those tools' authors. Groundwork's 26.5% (1316 tokens) is already tight. Charter-worthy recommendation: if session prefix cost is a priority lever, the highest-value reduction target is the Linear MCP plugin (73 tool names, 783 tokens) — negotiable only with that plugin's maintainer.
