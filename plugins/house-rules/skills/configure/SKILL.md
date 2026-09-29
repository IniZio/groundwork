---
name: configure
description: Reads and changes house-rules config so a rejected commit passes the right way. Triggers on: commit message rejected, commit style, conventional commits, handbook, .house-rules.json, comment density cap, house-rules config.
---

## Process

### 1. Read the active config

Run `house-rules config` (add `--repo <dir>` for another checkout, `--format json` for machine output). It prints each rule's active severity and options, the source of every value (`explicit`, `gitmessage`, `commitlint`, `history`, `default`), and `change with:` lines. Invalid config exits 2 with the key path and allowed values; fix that key first.

### 2. Read the pointer

A rejected commit message ends with a pointer such as:

`Commit style is set by .house-rules.json: rules["commit-message"].preset (active: handbook, source: default)`

Take the rule, the active value, and the source from it. Step 1's output confirms them.

### 3. Decide: rewrite or pin

Presets:
- `handbook`: subject starts with Add, Fix, Remove, Update, Refactor or Test; at most 50 chars.
- `conventional`: `type(scope)!: subject`; at most 72 chars; types feat fix docs style refactor perf test build ci chore revert.
- `subject-only`: subject format unchecked; no body.

Source precedence: explicit config, then `.gitmessage` (subject-only), then commitlint config (conventional), then git history (at least 50% of the last 20 commits conventional), then the handbook default.

- Repo's real convention matches the active preset: rewrite the commit message to it.
- Repo's real convention differs (history is conventional, active preset is the default): pin the matching preset.
- Want a tighter rule (lower `max_per_100`, `warn` to `error`): edit it in.
- Want a looser rule (off, warn from error, higher `max_per_100`, a preset that history and config do not show, removing rules or the file): stop and ask the user. This is a human decision, and the config guard denies the edit.

### 4. Edit `.house-rules.json`

File lives at the repo root. Keep `$schema` so editors validate it:

```json
{
  "$schema": "https://raw.githubusercontent.com/IniZio/groundwork/main/plugins/house-rules/house-rules.schema.json",
  "rules": {
    "commit-message": ["error", { "preset": "conventional" }],
    "comment-density": ["error", { "max_per_100": 5 }],
    "stray-artifacts": "error"
  }
}
```

Rules:
- `commit-message`: severity `error` only; option `preset` = `handbook` | `conventional` | `subject-only`.
- `comment-density`: `off` | `warn` | `error`; option `max_per_100` integer 0 to 100.
- `stray-artifacts`: `off` | `warn` | `error`; no options.

Unknown keys and values are errors. Change only the key at hand.

### 5. Verify

Run `house-rules config` again. Done when the rule shows the intended value with source `explicit` and the command exits 0. Then retry the commit.
