# groundwork

Workflow plugin for OpenCode and Cursor providing structured development practices.

## Features

- **Skills**: PRD-driven development, advisor gates, BDD implementation, context management
- **Commands**: 9 workflow commands exposed in Cursor
- **Hooks**: Session bootstrap with workflow rule reinforcement

## Installation

### OpenCode

Add to `opencode.json`:

```json
{
  "plugin": [
    "opencode-pty",
    "groundwork@git+https://github.com/IniZio/groundwork.git"
  ]
}
```

Restart OpenCode. Skills are auto-discovered.

### Cursor

Local install (for development/testing):

```bash
# Clone the repo
git clone https://github.com/IniZio/groundwork.git

# Copy to Cursor's local plugins directory (symlinks don't work due to Cursor bug #35)
cp -R groundwork ~/.cursor/plugins/local/groundwork

# Restart Cursor or run "Developer: Reload Window"
```

Verify in Cursor: Settings > Plugins > Groundwork Workflow.

**Note:** The plugin is not yet published to the Cursor marketplace. The local install method is the only way to use it currently.

## Available Commands

| Command | Description |
|---------|-------------|
| `create-prd` | Create master PRD for features |
| `advisor-gate` | Completion gate and uncertainty escalation |
| `bdd-implement` | BDD-first implementation |
| `nested-prd` | Handle scope changes with child PRDs |
| `consolidate-docs` | Merge PRDs into time-neutral docs |
| `session-continue` | Handoff and context management |
| `commit` | Git commit with consistent style |
| `using-workflow` | Bootstrap workflow rules |
| `opencode-acp` | Cross-instance control protocol |

## Workflow Rules

1. PRD-first for non-trivial features (≥1 day)
2. Advisor gate before declaring done
3. Background tasks for parallel work
4. No PRD commits to git
5. No worktrees
6. PTY tools for long-running commands

## Updates

Auto-updates on OpenCode restart (unpinned git URL).
