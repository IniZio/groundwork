---
name: release
description: Bump the groundwork or house-rules plugin version and push it so installs pick up the latest changes. Use whenever the user wants to release, publish, ship, cut a version, bump the version, or "push the latest changes for the plugin" in this repo — even if they only say "push it" after plugin work, because pushing without a bump leaves every install on the old cached copy.
---

# Release the groundwork plugin

Claude Code caches an installed plugin in a folder named by its version
(`~/.claude/plugins/cache/groundwork/groundwork/<version>/`). A push that keeps the
same version is invisible to every install. A release is therefore: bump every version
field together, prove the tree is healthy, commit, tag, push.

All commands run from the repo root. The helper is
`bun .claude/skills/release/scripts/release.ts`; call it `$REL` below.

## Plugins and versioning

The monorepo publishes two plugins with independent semver:

| Plugin | Tag format | Version fields |
|---|---|---|
| groundwork (default) | `vX.Y.Z` | `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (metadata + groundwork entry) |
| house-rules | `house-rules-vX.Y.Z` | `plugins/house-rules/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (house-rules entry) |

Pass `--plugin house-rules` to every `$REL` command when releasing house-rules.
Omitting `--plugin` always operates on groundwork.

When both plugins release in one push, tag and commit house-rules first, then groundwork.

## 1. Preflight

1. `git status --porcelain` (use `command git` if output looks filtered). Uncommitted
   changes to tracked files: stop and ask whether they belong in this release. Only
   untracked scratch like `.groundwork/` is fine to leave.
2. `git fetch origin && git status -sb`. The branch must be `main` and not behind
   `origin/main`. If behind, stop and report — never rebase or merge on your own.
3. `$REL check` — all groundwork version fields must agree, and if groundwork declares
   a house-rules dependency range it must be satisfied. If it reports disagreement or
   an unsatisfied range, show the rows and stop; a mismatched tree means a previous
   release went wrong.

## 2. Choose the version

Run `$REL suggest` (or `$REL suggest --plugin house-rules`). It lists commits since
the last tag for that plugin, filtered to paths that plugin owns:

- house-rules path: `plugins/house-rules/**`
- groundwork paths: everything else

Level heuristic:

- any `type!:` subject or `BREAKING CHANGE` body → major
- any `feat:` → minor
- otherwise → patch

Show the user the commit list and the proposal, and wait for them to accept it or
name a different level/version. The rules are a heuristic over commit messages, so
the user has the final say. If `suggest` says "nothing to release", tell the user and stop.

## 3. Verify before touching versions

Run `bun run typecheck` and `bun run test` (the package scripts are the repo's
canonical check definitions). Both must pass. Check each command's own exit
status — piping into `tail` hides it. On failure, show the failing output and stop;
do not bump or push a red tree.

## 4. Bump, commit, tag, push

```bash
$REL bump <level-or-X.Y.Z> [--plugin <name>]   # rewrites only that plugin's fields
$REL check [--plugin <name>]                     # must print the new version
```

### Releasing groundwork

```bash
$REL bump <level-or-X.Y.Z>
$REL check
git add package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "chore(release): bump version to X.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

### Releasing house-rules

```bash
$REL bump <level-or-X.Y.Z> --plugin house-rules
$REL check --plugin house-rules
git add plugins/house-rules/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "chore(release): bump house-rules to X.Y.Z"
git tag -a house-rules-vX.Y.Z -m "house-rules-vX.Y.Z"
git push origin main
git push origin house-rules-vX.Y.Z
```

Stage files by path only — never `git add -A` — so stray untracked files don't ride
along. If the commit hook rejects the message, fix the message; never `--no-verify`.
If a push is rejected, stop and report; never force-push.

## 5. Report

Tell the user: old → new version, the commit SHA, the tag, and that both pushes
succeeded (quote the push output lines). Mention that their own install updates
once they run `/plugin` (or `claude plugin update groundwork@groundwork`).
