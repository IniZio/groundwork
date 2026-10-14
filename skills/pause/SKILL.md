---
name: pause
description: Capture session state so a successor session can resume exactly where this one stopped.
---

<!-- token-target: ≤235 -->

## Steps

1. Run `$GW compile` — capture objective, open slices, gate state.
2. Run `$GW event append --type PAUSE --msg "Pausing: <reason>" --token T`
3. No active motive: select one, never create `work/default/`.
   Write `.groundwork/work/<slug>/handoff.md` from `templates/doc-types/handoff.md`, headings `## Done`, `## Next`:
   - frontmatter: title, session_id, transcript_path (from SessionStart)
   - Done: open slice ids, statuses, finished work
   - Next: successor's action
   - **never record the write token** — successor gets it via `$GW init`

4. Tell user: "Paused. Successor: `/continue`, read `.groundwork/work/<slug>/handoff.md`."

## After pausing

Stop-gate armed while slices open. Successor must call `$GW slice complete`, `$GW gate approve` to release.
