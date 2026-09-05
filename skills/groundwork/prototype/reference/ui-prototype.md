# UI Prototype — Process

When exploring visual design, layout, or interaction patterns.

## Sub-shapes

**Prefer sub-shape A**: adjustment to an existing page — add variants behind a `?variant=` URL param on a route that already exists. Existing data fetching stays untouched.

**Sub-shape B** (last resort): a new page — only when the question cannot be answered on an existing route.

## Process

1. **Default to 3 variants** — structurally different layouts, NOT just color changes. Cap at 5.
2. **Wire with `?variant=A|B|C`** — switcher component on existing page. Existing data fetching stays.
3. **Float a variant bar** — left/right arrows cycling variants, hidden in production.
4. **Capture the answer** — delete losers, fold winner into codebase properly (rewrite, don't promote prototype directly).

## Anti-patterns

- Variants differing only in color or spacing (not structurally different)
- Sharing too much code between variants (defeats the point of comparison)
- Wiring to real mutations or write operations
- Promoting prototype code directly into production without a rewrite
- Spending more than one hour — if the question takes longer, split it
