# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.groundwork/work/<slug>/`. The legacy `.scratch/` directory is superseded; `$GW migrate` moves it into `.groundwork/work/`.

## Conventions

- One unit of work per directory: `.groundwork/work/<slug>/`
- The spec is `.groundwork/work/<slug>/spec.md`
- Implementation issues are one file per ticket at `.groundwork/work/<slug>/tickets/<NN>-<slug>.md`, numbered from `01` — never a single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.groundwork/work/<slug>/` (creating the directory if needed). Never write to `.scratch/`; the placement guard denies it and names `.groundwork/work/<slug>/` instead.

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.groundwork/work/<slug>/map.md` — the Notes / Decisions-so-far / Fog body.
- **Child ticket**: `.groundwork/work/<slug>/tickets/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.groundwork/work/<slug>/tickets/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.

## Parent and blocking

`to-tickets` 1.3 makes tickets sub-issues of a parent and drops "Blocked by" when the tracker has native blocking. The local markdown tracker has neither, so keep the `Blocked by:` line and record the parent in a `## Parent` section in each ticket file, as upstream `to-tickets` does.
