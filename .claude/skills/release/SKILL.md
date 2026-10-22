---
name: release
description: Bump the groundwork or house-rules plugin version, tag it and push it so installs pick up the latest changes. Use whenever the user wants to release, publish, ship, cut a version, bump the version, or "push the latest changes for the plugin" in this repo, even if they only say "push it" after plugin work, because pushing without a bump leaves every install on the old cached copy.
model: haiku
---

# Release the groundwork plugin

Claude Code caches an installed plugin in a folder named by its version
(`~/.claude/plugins/cache/groundwork/groundwork/<version>/`). A push that keeps the
same version is invisible to every install. A release is therefore: bump every version
field together, prove the tree is healthy, commit, tag, push. Release directly after
the work lands on `main`. There is no soak period.

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

groundwork's `.claude-plugin/plugin.json` declares a house-rules range (`~X.Y.Z`). A
house-rules minor or major bump falls outside it, so raise the range in the same
groundwork release. `$REL check` fails until the range is satisfied.

When both plugins release in one push, tag and commit house-rules first, then groundwork.

## 1. Preflight

1. `command git status --porcelain`. Uncommitted changes to tracked files: stop and
   ask whether they belong in this release. Untracked files are fine to leave.
2. `git fetch origin && git status -sb`. The branch must be `main` and not behind
   `origin/main`. If behind, stop and report. Never rebase or merge on your own.
3. `$REL check`. All version fields must agree and the house-rules range must be
   satisfied. On failure, show the rows and stop.

## 2. Choose the version

Run `$REL suggest` (or `$REL suggest --plugin house-rules`). It lists commits since
the last tag for that plugin and proposes a level:

- any `type!:` subject or `BREAKING CHANGE` body → major
- any `feat:` → minor
- otherwise → patch

Use the level the user named. Otherwise take the proposal for patch and minor and
proceed. For a major, show the commit list and wait for the user to confirm. If
`suggest` says "nothing to release", tell the user and stop.

## 3. Verify before touching versions

Run `bun run typecheck` and `bun run test`. Both must pass. Check each command's own
exit status; piping into `tail` hides it. On failure, show the failing output and
stop. Never bump or push a red tree.

## 4. Bump, commit, tag, push

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

Stage files by path only, never `git add -A`, so stray untracked files don't ride
along. If the commit hook rejects the message, fix the message; never `--no-verify`.
If a push is rejected, stop and report; never force-push.

## 5. Report

Tell the user: old → new version, the commit SHA, the tag, and that both pushes
succeeded (quote the push output lines). Their install updates once they run
`/plugin` (or `claude plugin update groundwork@groundwork`).
