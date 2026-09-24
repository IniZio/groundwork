# house-rules

Code-quality rule engine for Claude Code. Developers guard codebase health against vibe-coded bloat by registering per-file and per-pattern rules that run as hooks.

## Install

Add the groundwork marketplace to Claude Code, then install the `house-rules` plugin:

```
/plugin marketplace add IniZio/groundwork
/plugin install house-rules@groundwork
```

Requires Claude Code v2.1.193 or later (plugin dependencies); older versions silently lose enforcement.

## Rules

Per-rule READMEs are generated under `rules/<id>/`.
