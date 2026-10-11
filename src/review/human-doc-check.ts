import { readFileSync } from "node:fs";
import path from "node:path";

export interface Finding {
  quote: string;
  reason: string;
}

const AGENT_HEADINGS = ["Acceptance criteria", "Files", "Commands", "Ledger", "Requirements", "Execution notes"];
const HEADING_RE = new RegExp(`^#{2,}\\s+(${AGENT_HEADINGS.join("|")})\\s*$`, "i");
const BASELINE_RE =
  /\b(lint|typecheck|type-check|tsc|tests?|build|ci)\b[^.!?]*\b(pass(?:es|ed)?|green|succe(?:ed|eds|eded)|clean)\b/i;
const EXT_RE = /\.(ts|tsx|js|jsx|mjs|json|md|yml|yaml|toml|sh|py|css|html)$/i;
const PATH_REASON = "code-blocked path; use a commit-pinned GitHub permalink";
const AGENT_REASON = "agent-only content";

function looksLikePath(s: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /\s/.test(s)) return false;
  return s.includes("/") || EXT_RE.test(s);
}

function stripFrontmatter(lines: string[]): string[] {
  if (lines[0]?.trim() !== "---") return lines;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  return end < 0 ? lines : lines.slice(end + 1);
}

const PR_BODY_MAX_PROSE = 12;

export function checkHumanDoc(text: string, fileName?: string): Finding[] {
  const out: Finding[] = [];
  let fence: string | null = null;
  const isPrBody = fileName !== undefined && path.basename(fileName) === "pr-body.md";
  let prose = 0;
  let overflowQuote = "";
  for (const line of stripFrontmatter(text.split(/\r?\n/))) {
    const open = line.match(/^\s*(```|~~~)\s*(\S*)/);
    if (open) {
      fence = fence === null ? open[2].toLowerCase() || "code" : null;
      continue;
    }
    const t = line.trim();
    if (isPrBody && fence === null && t && !t.startsWith("|")) {
      prose++;
      if (prose === PR_BODY_MAX_PROSE + 1) overflowQuote = t;
    }
    if (fence !== null) {
      if (fence !== "mermaid" && t && looksLikePath(t)) out.push({ quote: t, reason: PATH_REASON });
      continue;
    }
    if (HEADING_RE.test(line) || /^\$GW\b/.test(t)) {
      out.push({ quote: t, reason: AGENT_REASON });
      continue;
    }
    if (/^#{1,6}\s/.test(line)) continue;
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      if (looksLikePath(m[1])) out.push({ quote: m[1], reason: PATH_REASON });
    }
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      if (BASELINE_RE.test(sentence)) out.push({ quote: sentence.trim(), reason: "states the CI baseline" });
    }
  }
  if (prose > PR_BODY_MAX_PROSE) {
    out.push({ quote: overflowQuote, reason: `pr-body prose ${prose} lines > ${PR_BODY_MAX_PROSE} (fenced blocks and tables excluded)` });
  }
  return out;
}

if (import.meta.main) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: bun src/review/human-doc-check.ts <file.md>");
    process.exit(2);
  }
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    console.error(`cannot read ${file}: ${(e as Error).message}`);
    process.exit(2);
  }
  const findings = checkHumanDoc(text, file);
  if (findings.length === 0) {
    console.log("PASS");
  } else {
    for (const f of findings) console.log(`- "${f.quote}" — ${f.reason}`);
    process.exit(1);
  }
}
