# HTML Report Format — Housekeep

Single self-contained HTML file written to OS temp dir. Tailwind via CDN only; no Mermaid required. Static, no app code.

## Scaffold

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Housekeep — {{repo name}}</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="bg-stone-50 text-slate-900 font-sans">
    <main class="max-w-5xl mx-auto px-6 py-12 space-y-12">
      <header><!-- repo, date, scope, chips, legend --></header>
      <section id="top-recommendations"><!-- 3-card row --></section>
      <section id="fix-now" class="space-y-6"><!-- articles --></section>
      <section id="worth-doing" class="space-y-6"><!-- articles --></section>
      <section id="optional" class="space-y-6"><!-- articles --></section>
      <footer><!-- reply prompt + id list --></footer>
    </main>
  </body>
</html>
```

## Header

Repo name, date, scope line. Count chips per tier (Fix now / Worth doing / Optional) and per lens. One line for skipped lenses ("skipped: no dep manifest") and one line for unchosen lenses ("not scanned: not selected"). Badge legend: tier colour swatches + quick win.

## Top recommendations card

The 3 findings to do first. Each: title, one-sentence why, anchor link (`#F<n>`). Render as a 3-column row of cards.

## Tier sections

Three `<section>` elements, in order: Fix now (rose), Worth doing (amber), Optional (slate). Section heading carries the tier colour.

Each finding is one `<article id="F3">` card:
- **Title** — short, names the issue
- **Badge row** — tier badge, lens badge, severity badge, effort badge, `auto-fix` badge (emerald, only when yes), `quick win` badge (emerald, only when applicable)
- **Location** — `font-mono text-sm`
- **Problem** — one sentence
- **Fix** — one sentence
- **Risk** — one line
- Optional: tiny before/after code snippet (≤8 lines each) in `<pre class="text-xs font-mono bg-slate-100 rounded p-2">` when it clarifies

## Badge colours

- Fix now: `bg-rose-100 text-rose-800`
- Worth doing: `bg-amber-100 text-amber-800`
- Optional: `bg-slate-100 text-slate-700`
- Quick win: `bg-emerald-100 text-emerald-700`
- Auto-fix: `bg-emerald-50 text-emerald-600`
- Lens: `bg-indigo-50 text-indigo-700`
- Severity: SEV1 `bg-red-100 text-red-700`, SEV2 `bg-orange-100 text-orange-700`, SEV3 `bg-yellow-50 text-yellow-700`, SEV4 `bg-slate-50 text-slate-500`

## Footer

One line: "Reply with ids (F1, F4), a tier (e.g. `fix now`), or `quick wins`." followed by a plain-text list of every id (one per line, for easy copy-paste).

## Style guidance

Editorial, sparse colour. Generous whitespace. No paragraphs of explanation. If a finding needs a paragraph, it should be two findings. Keep cards scannable — Problem and Fix in one sentence each. Tier headings use `text-xl font-semibold` with the tier colour as a left border accent.
