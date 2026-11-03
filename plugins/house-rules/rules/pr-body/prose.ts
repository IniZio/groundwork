export interface Finding { quote: string; reason: string }
export interface ProseOptions { pr: boolean }

export const MAX_WORDS = 25;
export const NO_MARKDOWN_NOTICE = "house-rules pr-body: check skipped, this bun has no Bun.markdown (needs bun >= 1.3.14)";

type RenderCallbacks = Record<string, (content: string, meta?: { href?: string; level?: number }) => string>;
export type MarkdownHost = { Bun?: { markdown?: { render?: (s: string, cb: RenderCallbacks) => string } } };

/** `host` is a seam so a test can present a bun without Bun.markdown. */
export function markdownAvailable(host: MarkdownHost = globalThis): boolean {
  return host.Bun?.markdown?.render !== undefined;
}
export const PR_HEADINGS = ["Why", "What changed", "Scope", "Tradeoffs", "Blast Radius", "Verification", "Review tier"];
const REQUIRED_HEADINGS = ["Why", "Scope"];

const CODE_OPEN = "\u0001";
const CODE_CLOSE = "\u0002";
const LABEL_OPEN = "\u0003";
const LABEL_CLOSE = "\u0004";
const CODE_SPAN = /\u0001([^\u0002]*)\u0002/g;
const LABEL = /\u0003[^\u0004]*\u0004/g;

const SOURCE_EXT = "rs|ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|swift|rb|c|h|cpp|cs|php|md|json|yaml|yml|toml|sh|sql|html|css|lock";
const PATH_LINE = new RegExp(`(?<![\\w/.-])[\\w./-]*[\\w-]\\.(?:${SOURCE_EXT})(?:@[0-9a-f]{7,40})?:\\d+(?:-\\d+)?`, "i");
const CODE_PATH = new RegExp(`^(?:[\\w.@~-]+(?:/[\\w.@~-]+)+/?|[\\w-]+\\.(?:${SOURCE_EXT}))$`, "i");
const GITHUB_BLOB = /https?:\/\/github\.com\/[^/\s)]+\/[^/\s)]+\/blob\/([^/\s?#)]+)/g;
const SHA = /^[0-9a-f]{7,40}$/i;
const BASELINE_COMMAND = /\b(?:make (?:lint|test|check|ci)|cargo (?:test|clippy|fmt|check|nextest)|bun test|bun run typecheck|tsc|(?:npm|pnpm|yarn) (?:run )?(?:test|lint)|go (?:test|vet)|pytest|ruff|eslint)\b/;
const PASS_WORD = /\b(?:pass|passes|passed|green|clean|ok)\b|\u2705/i;

interface Unit { kind: "prose" | "heading"; text: string; level: number }

const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });

function collect(markdown: string): { units: Unit[]; hrefs: string[] } | null {
  const render = (globalThis as MarkdownHost).Bun?.markdown?.render;
  if (render === undefined) return null;
  const units: Unit[] = [];
  const hrefs: string[] = [];
  const push = (kind: Unit["kind"], text: string, level = 0) => {
    const flat = text.replace(/\s+/g, " ").trim();
    if (flat !== "") units.push({ kind, text: flat, level });
  };
  const children = (c: string) => c;
  const drop = () => "";
  render(markdown, {
    text: (c: string) => c.replace(/[\u0001-\u0004]/g, ""),
    codespan: (c: string) => CODE_OPEN + c + CODE_CLOSE,
    link: (c: string, meta?: { href?: string }) => {
      if (meta?.href) hrefs.push(meta.href);
      return LABEL_OPEN + c + LABEL_CLOSE;
    },
    image: drop,
    html: drop,
    code: drop,
    table: drop,
    hr: drop,
    paragraph: (c: string) => (push("prose", c), ""),
    heading: (c: string, meta?: { level?: number }) => (push("heading", c, meta?.level ?? 0), ""),
    listItem: (c: string) => (push("prose", c), ""),
    strong: children,
    emphasis: children,
    strikethrough: children,
    blockquote: children,
    list: children,
  });
  return { units, hrefs };
}

const restore = (s: string) =>
  s.replace(CODE_SPAN, "`$1`").replace(/[\u0001-\u0004]/g, (ch) => (ch === LABEL_OPEN || ch === LABEL_CLOSE ? "" : "`"));

const wordCount = (s: string) =>
  s.replace(CODE_SPAN, "x").replace(/[\u0001-\u0004]/g, "").split(/\s+/).filter(Boolean).length;

/** The segmenter sees visible stand-ins for the markers, one character each, so offsets map back onto the marked text. An opening marker reads as an uppercase letter so a sentence can start with a code span. */
function sentences(text: string): string[] {
  const visible = text.replace(/[\u0001\u0003]/g, "A").replace(/[\u0002\u0004]/g, "a");
  return [...segmenter.segment(visible)].map(({ index, segment }) => text.slice(index, index + segment.length));
}

function sentenceFindings(sentence: string, pr: boolean): Finding[] {
  const out: Finding[] = [];
  const quote = restore(sentence).trim();
  const noCode = sentence.replace(CODE_SPAN, "x");
  const words = wordCount(sentence);
  if (words > MAX_WORDS) out.push({ quote, reason: `sentence has ${words} words; the limit is ${MAX_WORDS} (ASD-STE100)` });
  if (noCode.includes(";")) out.push({ quote, reason: "a semicolon joins clauses; split it into two sentences" });
  if (/:\s+\S/.test(noCode)) out.push({ quote, reason: "a colon joins clauses mid-sentence; split it into two sentences" });

  if (pr) {
    const plain = restore(sentence);
    if (BASELINE_COMMAND.test(plain) && PASS_WORD.test(plain)) {
      out.push({ quote, reason: "reports a baseline check as passing; CI already shows baseline checks, so Verification names only runs CI does not show" });
    }
  }

  const linkless = sentence.replace(LABEL, "");
  const visible = linkless.replace(/[\u0001\u0002]/g, "");
  const pathLine = PATH_LINE.exec(visible);
  if (pathLine) out.push({ quote: pathLine[0], reason: "bare path:line; link it as [`file`](https://github.com/<owner>/<repo>/blob/<sha>/<file>#L<n>)" });
  for (const m of linkless.matchAll(CODE_SPAN)) {
    if (CODE_PATH.test(m[1] ?? "")) out.push({ quote: `\`${m[1]}\``, reason: "backticked path outside a link label; put it in the label of a commit-sha link" });
  }
  return out;
}

function blobFindings(texts: string[], hrefs: string[]): Finding[] {
  const out: Finding[] = [];
  for (const source of [...hrefs, ...texts]) {
    for (const m of source.matchAll(GITHUB_BLOB)) {
      if (!SHA.test(m[1] ?? "")) out.push({ quote: m[0], reason: `blob link ref "${m[1]}" is not a commit sha (7-40 hex digits)` });
    }
  }
  return out;
}

function headingFindings(units: Unit[]): Finding[] {
  const titles = units.flatMap((u) => (u.kind === "heading" && u.level === 2 ? [restore(u.text)] : []));
  const allowed = new Set(PR_HEADINGS.map((h) => h.toLowerCase()));
  const present = new Set(titles.map((t) => t.toLowerCase()));
  const out: Finding[] = [];
  for (const name of REQUIRED_HEADINGS) {
    if (!present.has(name.toLowerCase())) out.push({ quote: `## ${name}`, reason: `PR body has no "## ${name}" heading` });
  }
  for (const t of titles) {
    if (!allowed.has(t.toLowerCase())) out.push({ quote: `## ${t}`, reason: `heading is not allowed; use one of ${PR_HEADINGS.join(", ")}` });
  }
  return out;
}

/** Parse failures and a missing Bun.markdown return no findings, so a hook that calls this fails open. */
export function checkProse(markdown: string, opts: ProseOptions): Finding[] {
  let parsed: ReturnType<typeof collect>;
  try {
    parsed = collect(markdown);
  } catch {
    return [];
  }
  if (!parsed) return [];
  const findings: Finding[] = [];
  for (const unit of parsed.units) {
    if (unit.kind !== "prose") continue;
    for (const sentence of sentences(unit.text)) findings.push(...sentenceFindings(sentence, opts.pr));
  }
  findings.push(...blobFindings(parsed.units.filter((u) => u.kind === "prose").map((u) => restore(u.text)), parsed.hrefs));
  if (opts.pr) findings.push(...headingFindings(parsed.units));

  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.quote}\u0000${f.reason}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
}

export function formatFindings(findings: Finding[]): string[] {
  return findings.map((f) => `- "${f.quote}" — ${f.reason}`);
}
