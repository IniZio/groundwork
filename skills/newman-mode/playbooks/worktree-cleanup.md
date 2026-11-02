### Worktree cleanup

**Keep disk bounded without asking.** This layers on pstack poteto-mode's `playbooks/worktree-cleanup.md` and reuses its `scripts/worktree-audit.sh`. Where they differ, this page wins: a worktree that passes every gate below is pruned with no confirmation. Run it after every stack merge and whenever `df -h /` shows more than 80% used.

1. Record `df -h /`. Run `timeout 600 <poteto-mode dir>/scripts/worktree-audit.sh -b origin/<default branch> <repo>`. It reads paths from `git worktree list`, so worktrees outside `.worktrees/` show up too.
2. A worktree is prunable only when all of these hold:
   - Its PR is `MERGED` or `CLOSED`: `gh pr list --head <branch> --state all --json state`. Never decide from `git merge-base`, because a squash merge reads as not merged.
   - `git -C <path> status --porcelain --untracked-files=no` is empty.
   - Untracked files that are not ignored are absent, or are sandbox state you can name (logs, scratch output). List them in the reply.
   - No process runs inside it: `pgrep -f "<path>/"` prints nothing.
   - The audit bucket is not `hold-wip`, `hold-open-pr` or `verify-recent-chat`.
3. For each prunable worktree, delete its build output first (`target/`, `node_modules/`, `dist/`), then `git worktree remove --force <path>`. After the loop, run `git worktree prune`. Keep the branches, since they hold the commits.
4. `git worktree remove --force` may raise a permission prompt. Wait for the answer. Never route around a denial with `rm -rf` on the worktree or a different command.
5. Run every loop under `timeout`.

**Reply:** `df -h /` before and after with the space freed, the worktrees pruned, and each one held back with the gate it failed.
