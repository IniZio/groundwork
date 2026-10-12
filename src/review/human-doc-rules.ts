import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface Finding {
  quote: string;
  reason: string;
}

const EXT_RE = /\.(ts|tsx|js|jsx|mjs|json|md|yml|yaml|toml|sh|py|css|html)$/i;
const FENCE_RE = /^\s*(```|~~~)/;
const HEADING_RE = /^#{1,6}\s/;
const FILE_REF_REASON = "pr-body: file reference must be a rendered link";
const TOKEN_RE = /(?<![\w/.-])((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9]+(?:@[0-9a-f]{7,40})?:\d+(?:-\d+)?)(?![\w])/g;
const NOT_SLICE = new Set(["SHA", "UTF", "ISO", "RFC", "CVE", "HTTP"]);
const VOCAB_RES = [
  /\bDECISION events?\b/g,
  /\bmotives?\b/gi,
  /\bledger\b/gi,
  /\bH[12]\b/g,
  /\b(?:stop-gate|gate approve|gw gate)\b/gi,
];
const SLICE_RE = /\b([A-Z]{2,4})-\d{1,3}\b/g;

function looksLikePath(s: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /\s/.test(s)) return false;
  return s.includes("/") || EXT_RE.test(s);
}

export function isPrBodyPath(file: string): boolean {
  if (path.basename(file) === "pr-body.md") return true;
  return path.dirname(file).split(/[\\/]/).includes("pr");
}

function checkOpening(lines: string[]): Finding[] {
  let fence = false;
  let at = -1;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) fence = !fence;
    else if (!fence && HEADING_RE.test(lines[i])) {
      at = i;
      break;
    }
  }
  const heading = at < 0 ? "" : lines[at].trim();
  if (heading !== "## Summary") return [{ quote: heading, reason: "pr-body: start with ## Summary" }];
  const body: string[] = [];
  fence = false;
  for (const l of lines.slice(at + 1)) {
    if (FENCE_RE.test(l)) fence = !fence;
    else if (fence) continue;
    else if (HEADING_RE.test(l)) break;
    else if (l.trim()) body.push(l.trim());
  }
  const joined = body.join(" ");
  const n = joined.split(/(?<=[.!?])\s+/).filter((s) => s.trim()).length;
  return n === 0 || n > 3 ? [{ quote: joined.trim(), reason: "pr-body Summary: 1-3 sentences" }] : [];
}

function checkFileRefs(line: string): Finding[] {
  const bare = line.replace(/\[[^\]]*\]\([^)]*\)/g, "").replace(/\S+:\/\/\S*/g, "");
  const quotes = [...bare.matchAll(TOKEN_RE)].map((m) => m[1]);
  for (const m of bare.matchAll(/`([^`\n]+)`/g)) {
    if (looksLikePath(m[1]) && !quotes.includes(m[1])) quotes.push(m[1]);
  }
  return quotes.map((quote) => ({ quote, reason: FILE_REF_REASON }));
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/s$/, "");
}

/** Nearest ancestor directory of `file` holding a `.git` entry, or null. */
export function gitRoot(file: string): string | null {
  let dir = path.dirname(path.resolve(file));
  while (!existsSync(path.join(dir, ".git"))) {
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return dir;
}

/** Terms defined as `**Term**:` in the GLOSSARY.md at the git root enclosing `file`. */
export function glossaryTerms(file: string): Set<string> {
  const terms = new Set<string>();
  const dir = gitRoot(file);
  if (dir === null) return terms;
  const glossary = path.join(dir, "GLOSSARY.md");
  if (!existsSync(glossary)) return terms;
  for (const line of readFileSync(glossary, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\*\*([^*]+)\*\*:/);
    if (m) terms.add(normalize(m[1]));
  }
  return terms;
}

function checkVocab(line: string, terms: Set<string>): Finding[] {
  const hits: { at: number; text: string }[] = [];
  if (!line.trim().startsWith("|")) {
    const bare = line.replace(/`[^`\n]+`/g, (s) => " ".repeat(s.length));
    for (const re of VOCAB_RES) {
      for (const m of bare.matchAll(re)) if (!terms.has(normalize(m[0]))) hits.push({ at: m.index ?? 0, text: m[0] });
    }
  }
  for (const m of line.matchAll(SLICE_RE)) if (!NOT_SLICE.has(m[1])) hits.push({ at: m.index ?? 0, text: m[0] });
  return hits
    .sort((a, b) => a.at - b.at)
    .map((h) => ({ quote: h.text, reason: `groundwork vocabulary "${h.text}": write from the reviewer's view of the repo` }));
}

function groundworkLinkTargets(line: string): string[] {
  const targets = [...line.matchAll(/\[[^\]]*\]\(\s*<?([^)\s>]+)/g)].map((m) => m[1]);
  const def = line.match(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?\s*$/);
  if (def) targets.push(def[1]);
  return targets.filter((t) => /^(\.\/)?\.groundwork\//.test(t) || t.includes("/.groundwork/"));
}

function checkGroundworkLinks(line: string): Finding[] {
  return groundworkLinkTargets(line).map((quote) => ({ quote, reason: "link into .groundwork/: state the constraint in one line instead" }));
}

/** Link targets pointing into .groundwork/, outside fenced blocks. Single source for the checker and the doc-size-guard hook. */
export function findGroundworkLinks(text: string): string[] {
  const out: string[] = [];
  let fence = false;
  for (const line of text.split(/\r?\n/)) {
    if (FENCE_RE.test(line)) {
      fence = !fence;
      continue;
    }
    if (!fence) out.push(...groundworkLinkTargets(line));
  }
  return out;
}

export function checkRules(lines: string[], isPrBody: boolean, terms: Set<string> = new Set()): Finding[] {
  const out: Finding[] = isPrBody ? checkOpening(lines) : [];
  let fence = false;
  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    if (isPrBody) out.push(...checkFileRefs(line));
    out.push(...checkVocab(line, terms),...checkGroundworkLinks(line));
  }
  return out;
}
