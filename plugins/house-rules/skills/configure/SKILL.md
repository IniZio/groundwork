---
name: configure
description: Reads and changes house-rules config so a rejected commit passes the right way. Triggers on: commit message rejected, commit style, conventional commits, handbook, .house-rules.json, house-rules config.
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
- `handbook`: subject starts with Add, Fix, Remove, Update, Refactor or Test; at most 50 chars; no body.
- `conventional`: `type(scope)!: subject`; at most 72 chars; types feat fix docs style refactor perf test build ci chore revert.
- `subject-only`: subject format unchecked; no body.

Source precedence: explicit config, then `.gitmessage` (subject-only), then commitlint config (conventional), then git history (at least 50% of the last 20 commits conventional), then the handbook default.

- Repo's real convention matches the active preset: rewrite the commit message to it.
- Repo's real convention differs (history is conventional, active preset is the default): pin the matching preset.
- Want a preset that history and config do not show, or to remove rules or the file: stop and ask the user. This is a human decision, and the config guard denies the edit.
- The comment-density cap (5 per 100 added lines) is fixed, not configurable. Trim the comments instead.

### 4. Edit `.house-rules.json`

File lives at the repo root. Keep `$schema` so editors validate it:

```json
{
  "$schema": "https://raw.githubusercontent.com/IniZio/groundwork/main/plugins/house-rules/house-rules.schema.json",
  "rules": {
    "commit-message": ["error", { "preset": "conventional" }],
    "comment-density": "error",
    "artifact-structure": "error"
  }
}
```

Rules:
- `commit-message`: severity `error` only; option `preset` = `handbook` | `conventional` | `subject-only`.
- `comment-density`: `"error"` only; no options; not configurable.
- `artifact-structure`: `"error"` only; options `govern` (globs), `types` (doc types, each with `tier` and `generates`, optional `description`, `instruction`, `template`, `frontmatter`, `headings`) and `forbidden` (`{pattern, redirect}` entries). Without `types` and `forbidden` only the built-in synonym-directory and root-scratch checks run.
- The former id `stray-artifacts` remains accepted as a config alias for `artifact-structure`.

Unknown keys and values are errors. Change only the key at hand.

Example `artifact-structure` manifest (`{slug:kebab}` is a path placeholder; `{{title}}` is a template body placeholder):

```json
{
  "rules": {
    "artifact-structure": ["error", {
      "govern": ["doc/**"],
      "types": {
        "decision": {
          "tier": "product",
          "generates": "doc/decisions/{slug:kebab}.md",
          "template": "# {{title}}\n"
        }
      },
      "forbidden": [{"pattern": "docs/**", "redirect": "Documents live under doc/."}]
    }]
  }
}
```

Read the manifest with `house-rules structure`, `house-rules where <type|text>` and `house-rules new <type> key=value...`. Frontmatter and heading content is checked at Stop; a file written mid-session is a draft. Forbidden patterns and type-matched paths are enforced even when gitignored; only an unmatched governed path is exempt when ignored. See the plugin README for the full schema.

### 5. Verify

Run `house-rules config` again. Done when the rule shows the intended value with source `explicit` and the command exits 0. Then retry the commit.
