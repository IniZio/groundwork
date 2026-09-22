/**
 * Family 4: Prose quality — aggregated advisory hook (four rules in one file).
 * Design level: declarative rule table; each rule is a detect-function + label.
 * Advisory by design (D-13): warns, never blocks. Failure mode is gradient text quality,
 * categorically unlike the binary-correctness failures the other four families catch.
 * D-11 reuse: v1 prose-negation-guard, prose-modality-guard, prose-abbreviation-guard, deslop-guard
 *   (741 lines combined) distilled into one file; sentence-matcher inlined; comment-restate detection dropped.
 */
import { readFileSync } from "node:fs";

export interface HookResult { stdout: string; stderr: string; exit: number }

const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

function advise(r: string): HookResult {
  return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: r } }) + "\n", stderr: "", exit: 0 };
}
function allow(): HookResult { return { stdout: "", stderr: "", exit: 0 }; }

function isProse(fp: string): boolean {
  return fp.endsWith(".md") || /\/(agents|agents-src|skills)\//.test(fp);
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?\n])\s+/).filter(s => s.trim().length > 0);
}

function sigWords(s: string): string[] {
  return s.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [];
}

function matchSentence(old: string, newSents: string[]): string | null {
  const ow = sigWords(old);
  if (ow.length < 3) return null;
  let best = 0, bestSent = "";
  for (const ns of newSents) {
    const shared = ow.filter(w => ns.toLowerCase().includes(w)).length;
    if (shared > best) { best = shared; bestSent = ns; }
  }
  return best / ow.length >= 0.4 ? bestSent : null;
}

function negationLoss(oldStr: string, newStr: string): string[] {
  const news = splitSentences(newStr);
  const lost = new Set<string>();
  for (const os of splitSentences(oldStr)) {
    const match = matchSentence(os, news);
    if (!match) continue;
    for (const w of ["not", "never", "no", "only", "except"]) {
      const re = new RegExp("\\b" + w + "\\b", "i");
      if (re.test(os) && !re.test(match)) lost.add(w);
    }
  }
  return [...lost];
}

const HEDGES = ["may", "could", "sometimes", "might", "appears to", "is likely to"];
const STRONG = ["will", "does", "always"];
function present(term: string, text: string): boolean {
  return term.includes(" ") ? text.toLowerCase().includes(term) : new RegExp("\\b" + term + "\\b", "i").test(text);
}
function hedgeUpgrade(oldStr: string, newStr: string): { lost: string[]; gained: string[] } {
  const news = splitSentences(newStr);
  const lost = new Set<string>(), gained = new Set<string>();
  for (const os of splitSentences(oldStr)) {
    const match = matchSentence(os, news);
    if (!match) continue;
    for (const h of HEDGES) {
      if (!present(h, os) || present(h, match)) continue;
      for (const a of STRONG) {
        if (!present(a, os) && present(a, match)) { lost.add(h); gained.add(a); }
      }
    }
  }
  return { lost: [...lost], gained: [...gained] };
}

const ABBREV = [
  { re: /\bcfg\b/, label: "cfg", full: "configuration" },
  { re: /\bfn\b/, label: "fn", full: "function" },
  { re: /\breq\b/, label: "req", full: "requirement" },
];
const DOMAIN = [
  { label: "AC",   short: /\bAC\b/,   full: /\bacceptance[\s-]+criteri(?:on|a)\b/i },
  { label: "TBD",  short: /\bTBD\b/,  full: /\bto[\s-]+be[\s-]+determined\b/i },
  { label: "TBR",  short: /\bTBR\b/,  full: /\bto[\s-]+be[\s-]+reviewed\b/i },
  { label: "impl", short: /\bimpl\b/, full: /\bimplementation\b/i },
];
function stripCode(t: string): string { return t.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]+`/g, " "); }
function abbrevViolations(oldStr: string, newStr: string): string[] {
  const on = stripCode(oldStr), nn = stripCode(newStr);
  const hits: string[] = [];
  for (const { re, label, full } of ABBREV) {
    if (!re.test(on) && re.test(nn)) hits.push(`\`${label}\` (abbrev for ${full})`);
  }
  for (const { label, short, full } of DOMAIN) {
    if (short.test(on) && full.test(nn) && !short.test(nn)) hits.push(`\`${label}\` expanded`);
  }
  return hits;
}

const SLOP_RE = /^\s*\/\/\s*(let's|let us|now we|here we|next we|now i|i'll|i will|step\s+\d+|phase\s+\d+|firstly|secondly|finally,?|just\s|simply\s|note:\s)/i;
function slopLines(content: string): string[] {
  return content.split(/\r?\n/).filter(l => SLOP_RE.test(l)).map(l => l.trim().slice(0, 80));
}

function extractContent(tool: string, ti: Record<string, unknown>): string {
  if (tool === "Write") return typeof ti.content === "string" ? ti.content : "";
  if (tool === "Edit") return typeof ti.new_string === "string" ? ti.new_string : "";
  if (tool === "MultiEdit") return (Array.isArray(ti.edits) ? ti.edits : []).map((e: unknown) => typeof (e as Record<string,unknown>)?.new_string === "string" ? (e as Record<string,unknown>).new_string : "").join("\n");
  return "";
}
function extractOld(tool: string, ti: Record<string, unknown>, fp: string): string {
  if (tool === "Edit") return typeof ti.old_string === "string" ? ti.old_string : "";
  if (tool === "Write") { try { return readFileSync(fp, "utf8"); } catch { return ""; } }
  if (tool === "MultiEdit") return (Array.isArray(ti.edits) ? ti.edits : []).map((e: unknown) => typeof (e as Record<string,unknown>)?.old_string === "string" ? (e as Record<string,unknown>).old_string : "").join("\n");
  return "";
}

export function check(input: unknown): HookResult {
  try {
    const inp = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const tool = typeof inp.tool_name === "string" ? inp.tool_name : "";
    if (!WRITE_TOOLS.has(tool)) return allow();
    const ti = (inp.tool_input && typeof inp.tool_input === "object" ? inp.tool_input : {}) as Record<string, unknown>;
    const fp = typeof ti.file_path === "string" ? ti.file_path : "";
    const newContent = extractContent(tool, ti);
    const oldContent = extractOld(tool, ti, fp);
    const findings: string[] = [];
    if (isProse(fp)) {
      const neg = negationLoss(oldContent, newContent);
      if (neg.length) findings.push(`negation-loss: removed [${neg.join(", ")}] from surviving sentence (R-004)`);
      const { lost, gained } = hedgeUpgrade(oldContent, newContent);
      if (lost.length) findings.push(`hedge-upgrade: removed [${lost.join(", ")}] gained [${gained.join(", ")}] (R-005)`);
      const abbrev = abbrevViolations(oldContent, newContent);
      if (abbrev.length) findings.push(`abbreviation: ${abbrev.join("; ")} (R-006)`);
    }
    const slop = slopLines(newContent);
    if (slop.length) findings.push(`slop: ${slop.length} AI-fingerprint comment(s): ${slop[0]}…`);
    if (!findings.length) return allow();
    return advise("prose-quality-guard [advisory]: " + findings.join(" | "));
  } catch { return allow(); }
}

if (import.meta.main) {
  const raw = await Bun.stdin.text();
  let input: unknown = {};
  try { input = JSON.parse(raw); } catch { /* fail-open */ }
  const result = check(input);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.exit);
}
