# Housekeep — UI/design reviewer checklist

Load this file only when the deslop target has a rendered UI/CLI surface. The shared posture and completion gate in `SKILL.md` apply.

Use these as review prompts, not absolute bans. Keep intentional brand, accessibility, product-density, or design-system choices when they have a clear rationale.

- **Shadow restraint:** question box shadows on every surface, logo, background, card, or icon; keep shadows only where they clarify elevation or interaction.
- **Content hierarchy:** remove repetitive eyebrow/title/description/extra `<p>` stuffing when the title already carries the message; avoid generic emoji badges unless they are part of the product voice.
- **Palette rationale:** challenge default AI blue/purple palettes, especially Tailwind-like `#3B82F6`, when no brand or system rationale exists.
- **Layout rhythm:** avoid overly perfect uniform grids when the product context benefits from rhythm, emphasis, asymmetry, carousel/bento treatment, or varied card weights.
- **Gradient restraint:** tone down extreme gradients unless the brand deliberately owns that visual language.
