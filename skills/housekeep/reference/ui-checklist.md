# UI/Design Defaults Checklist

Load this checklist only when the target has a rendered UI or CLI surface. Skip it for backend-only cleanups.

1. Replace any unstyled or browser-default color palette with explicit design tokens or a coherent color scheme — no bare `blue`, `gray`, or `red` without a semantic name or variable backing them.
2. Add missing loading, empty, and error states to every data-dependent surface — a component that silently shows nothing when data is absent or a fetch fails is incomplete.
3. Remove or replace all placeholder copy: "Lorem ipsum", "TODO", "Test", "Sample", "Untitled", hardcoded dummy names/emails, and any text that was never meant to ship.
4. Consolidate duplicate layout patterns — if the same card, row, or container structure appears three or more times with only content varying, it belongs in a shared component or template.
5. Add at minimum keyboard focus styles and ARIA labels for interactive controls (buttons, links, form fields) that are missing them — a control that cannot be reached or identified by assistive technology is a defect, not a preference.
