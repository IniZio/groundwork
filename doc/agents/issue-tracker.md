# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.groundwork/work/<slug>/`. The legacy `.scratch/` directory is superseded; `$GW migrate` moves it into `.groundwork/work/`.

## Conventions

- One unit of work per directory: `.groundwork/work/<slug>/`
- The spec is `.groundwork/work/<slug>/spec.md`
- Implementation issues are one file per ticket at `.groundwork/work/<slug>/tickets/<NN>-<slug>.md`, numbered from `01` — never a single combined tickets file
- New issues start from `templates/doc-types/issue.md` (Obsidian Markdown, Linear-style)
- State lives in frontmatter properties, not body lines:
  - `title`
  - `status`: `triage` | `needs-info` | `todo` | `in-progress` | `done` | `canceled`
  - `assignee`: `agent` | `human`
  - `priority`: `urgent` | `high` | `medium` | `low` | `none`
  - `tags`: category (such as `bug`, `enhancement`) plus area tags
  - `parent`, `blocked_by`: wikilinks, e.g. `"[[04-pr-body-link-rendering]]"`
  - `source`, `created`
- Role-to-property mapping (triage roles → `status`/`assignee`) is in `triage-labels.md`
- Body has no H1: description, then `## Acceptance criteria` (checkbox list; required once `status` is `todo`, `in-progress` or `done`), then `## Comments`
- Comments and conversation history append to the bottom under `## Comments` as dated entries; the AI-generated disclaimer is a `> [!ai]` callout

## When a skill says "publish to the issue tracker"

Create a new file under `.groundwork/work/<slug>/` (creating the directory if needed) from `templates/doc-types/issue.md`. Never write to `.scratch/`. `.scratch/**` is in `FORBIDDEN` in `src/hooks/doc-registry.ts` with the redirect "Use `.groundwork/work/{slug}/`". The house-rules artifact-structure rule flags a new file under `.scratch/` with that redirect only when `.house-rules.json` configures it in the artifact-structure `forbidden` option (`$GW recipe` prints that block); findings use the configured severity (error).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.groundwork/work/<slug>/map.md` — the Notes / Decisions-so-far / Fog body.
- **Child ticket**: `.groundwork/work/<slug>/tickets/NN-<slug>.md`, numbered from `01`, in the issue format, with the question in the body. The ticket type (`research`/`prototype`/`grilling`/`task`) is a tag.
- **Blocking**: the `blocked_by` property, wikilinks to ticket files. A ticket is unblocked when every linked issue has `status: done`.
- **Frontier**: scan `.groundwork/work/<slug>/tickets/` for files with `status: todo`, unblocked, and not `in-progress`; first by number wins.
- **Claim**: set `status: in-progress` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `status: done`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.

## Hierarchy and blocking

`to-tickets` 1.3 makes tickets sub-issues of a parent and drops "Blocked by" when the tracker has native blocking. The local markdown tracker records the parent in the `parent` property and blocking in `blocked_by`, both as wikilinks. These replace upstream `to-tickets`' "Blocked by" line and `## Parent` section; do not write either.
