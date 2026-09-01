---
id: token-economy-r-008
type: requirement
concept: C-TOKEN-ECONOMY
title: "No implementation slice assumes a clean working tree"
criticality: must
verification: manual
status: open
---

## TOKEN-ECONOMY-R-008 — No implementation slice assumes a clean working tree {#token-economy-r-008}

Every implementation slice in this motive **shall** stage or commit changes by explicit file path rather than using `git add .`, `git add -A`, or any command that stages all modified and untracked files.

- **Why** — The working tree carried approximately thirty uncommitted entries at planning time. A slice that runs `git add .` risks staging or committing files it does not own, corrupting the change attribution of other slices and polluting commits with unrelated modifications.
- **Fit criterion** — Every `git add` invocation in the session transcript for this motive names explicit paths; no invocation uses `.`, `-A`, or `--all`. `git status` after each commit shows only intentional changes were staged.
- **Verification**: manual — reviewer reads the session transcript for any `git add` invocations, confirms explicit paths, and checks `git status` output after each commit.

  1. Open the session transcript for any slice in this motive that made commits.
  2. Search for `git add` invocations. Confirm each names explicit file paths.
  3. Check `git status` output immediately after each commit to confirm no unintended files were staged.
  4. If all `git add` calls use explicit paths, the requirement is satisfied.

- **Criticality**: must
