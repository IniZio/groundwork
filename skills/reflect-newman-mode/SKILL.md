---
name: reflect-newman-mode
description: Run pstack's reflect over this session, but route every learning into the newman-mode skill in the groundwork source checkout. Use for /reflect-newman-mode, "reflect into newman-mode", or "update newman-mode from this session".
disable-model-invocation: true
---

# Reflect into newman-mode

This is `/pstack:reflect` with one target. Reflect routes learnings to any skill. This skill routes them only to `newman-mode`, edits the groundwork source checkout and never the plugin cache.

## 1. Find both trees

- pstack: the highest version in `~/.claude/plugins/cache/groundwork/pstack/` (`ls -v | tail -1`). Older copies under other marketplaces are stale. Read its `docs/harness/claude-code.md` and `skills/reflect/SKILL.md`.
- groundwork source: `jq -r '.groundwork.source.path // .groundwork.installLocation' ~/.claude/plugins/known_marketplaces.json`. The target is `<groundwork>/skills/newman-mode/` (`SKILL.md` and `references/*.md`). Stop and ask for the path if that folder is missing or under `plugins/cache/`.
- `command git -C <groundwork> status --porcelain -- skills/newman-mode`. If it is dirty, stop and ask: the edits would mix with someone else's.

## 2. Review and synthesize

Follow reflect's steps 1 to 4 as written (transcript, three reviewers, synthesizer, structural check), with the adapter mapping. Pass each reviewer template verbatim and append this block to every reviewer and the synthesizer prompt:

> Routing override: the only valid routing is a section of `<groundwork>/skills/newman-mode/SKILL.md` or one of its `references/*.md` files. Read them first. A learning that is about a convention for how Newman wants agents to work (asking, autonomy, design, code, verification, incidents, subagents, process, prose, proof, briefs) routes there even if the session never opened newman-mode. Route a learning that belongs to another skill or tool as `out of scope: <skill path>`. Route a learning that a hook, lint or script in groundwork or house-rules could enforce as Backlog.

## 3. Present

Show the synthesizer's Accepted / Rejected / Backlog output, then the out-of-scope rows as a separate list. For each Accepted row, show the exact text you would add or replace and its file and section. Ask the user to approve by row number. Do not edit before approval.

## 4. Apply

Edit only approved rows, in `<groundwork>/skills/newman-mode/`. Match the skill's voice:

- One bullet per rule, in the section the routing names. Imperative, short sentences, the reason in the same bullet.
- Tighten or replace an existing bullet before adding a new one. A new bullet that restates an old one is a duplicate.
- A rule only one trigger needs goes in the matching `references/` file, not `SKILL.md`. A new reference file also gets a row in the trigger table.
- When a learning disproves an existing bullet's reason, retire or re-justify that bullet in the same edit.
- Keep the description unchanged unless a row says `tune description`.

Then `git -C <groundwork> diff -- skills/newman-mode` and show it.

## 5. Hand off

Out-of-scope rows and Backlog are not filed for you. List them and offer to file each with `groundwork:tracker` or send it to the owning session.

Installs keep the cached copy until a release. Offer once: "commit and release groundwork so sessions pick this up?" On yes, commit only `skills/newman-mode` with a subject-only conventional commit (`docs(newman-mode): <what changed>`), then run the release skill from the groundwork checkout. On no, leave the diff uncommitted.

## 6. Summarize

- Edits applied: `<file>#<section>`. One line each.
- Rejected: one line each with the synthesizer's reason.
- Out of scope and Backlog: one line each, with where it should go.
