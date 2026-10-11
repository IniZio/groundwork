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
  let section = "";
  let afterHeading = false;
  const visual = (q: string) => out.push({ quote: q, reason: "pr-body: add a lead sentence before this visual" });
  for (const line of stripFrontmatter(text.split(/\r?\n/))) {
    const open = line.match(/^\s*(```|~~~)\s*(\S*)/);
    if (open) {
      if (isPrBody && fence === null && afterHeading) visual(line.trim());
      afterHeading = false;
      fence = fence === null ? open[2].toLowerCase() || "code" : null;
      continue;
    }
    const t = line.trim();
    const isHeading = /^#{1,6}\s/.test(line);
    if (isPrBody && fence === null && t) {
      if (/^##\s/.test(line)) section = t.slice(2).trim();
      const bulletSection = section === "Why" || section === "Impact";
      if (t.startsWith("|") && afterHeading) visual(t);
      if (!isHeading && !t.startsWith("|") && (section === "Why" || section === "Changes" || section === "Impact")) {
        prose++;
        if (prose === PR_BODY_MAX_PROSE + 1) overflowQuote = t;
      }
      if (!isHeading && bulletSection) {
        const where = `pr-body ${section}`;
        // ignores inline code, URLs and a leading **Label:** prefix
        const rest = t.replace(/`[^`]*`/g, "").replace(/\S+:\/\/\S*/g, "").replace(/^-\s+\*\*[^*]+:\*\*/, "-");
        if (!t.startsWith("- ")) out.push({ quote: t, reason: `${where}: use one bullet per claim` });
        else if (/;|:(\s|$)/.test(rest)) out.push({ quote: t, reason: `${where}: split ':'/';' joined clauses into separate bullets` });
      }
      afterHeading = isHeading;
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
    out.push({ quote: overflowQuote, reason: `pr-body prose ${prose} lines > ${PR_BODY_MAX_PROSE} (Why, Changes, Impact; headings, fenced blocks and tables excluded)` });
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
