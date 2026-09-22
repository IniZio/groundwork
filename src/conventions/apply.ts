/**
 * Convention applier — writes accepted findings' proposed_write to allowed paths only.
 * Usage: bun src/conventions/apply.ts <repo> --accept <id,id,...> [--findings <file>] [--handbook <path>]
 * Reads findings JSON from stdin unless --findings <file> is given.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Finding } from "./detect.js";

const ALLOWED_PATHS = [".gitmessage", ".github/pull_request_template.md", "Makefile"];

function resolveAllowed(repoAbs: string, rel: string, fallback: boolean, handbookAbs?: string): "allowed" | "forbidden" | "denied" {
  const target = path.resolve(repoAbs, rel);
  const gwDb = path.join(repoAbs, ".groundwork.db");
  const gwDir = path.join(repoAbs, ".groundwork") + path.sep;
  if (target === gwDb || target.startsWith(gwDir)) return "forbidden";
  if (handbookAbs && target.startsWith(handbookAbs + path.sep)) return "allowed";
  if (path.isAbsolute(rel) || rel.split(/[\\/]/).some(seg => seg === "..")) return "denied";
  for (const p of ALLOWED_PATHS) {
    if (target === path.join(repoAbs, p)) return "allowed";
  }
  if (fallback) {
    if (target === path.join(repoAbs, "CLAUDE.md")) return "allowed";
    if (target.startsWith(path.join(repoAbs, ".claude", "rules") + path.sep)) return "allowed";
  }
  return "denied";
}

export interface ApplyResult { written: string[]; refused: string[]; skipped: string[] }

export function apply(repo: string, findings: Finding[], accept: Set<string>, handbookPath?: string): ApplyResult {
  const repoAbs = path.resolve(repo);
  const handbookAbs = handbookPath ? path.resolve(handbookPath) : undefined;
  const written: string[] = [];
  const refused: string[] = [];
  const skipped: string[] = [];

  for (const f of findings) {
    if (!accept.has(f.id)) { skipped.push(f.id); continue; }
    if (!f.proposed_write) { skipped.push(f.id); continue; }
    const rel = f.proposed_write.path;
    const verdict = resolveAllowed(repoAbs, rel, f.fallback === true, handbookAbs);
    if (verdict === "forbidden") {
      refused.push(`${f.id}: path "${rel}" is a private store — FORBIDDEN`);
      continue;
    }
    if (verdict === "denied") {
      refused.push(`${f.id}: path "${rel}" not in allowed set`);
      continue;
    }
    const target = path.resolve(repoAbs, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, f.proposed_write.content, "utf8");
    written.push(rel);
  }
  return { written, refused, skipped };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const repo = args.find(a => !a.startsWith("--")) ?? ".";
  const acceptIdx = args.indexOf("--accept");
  const acceptStr = acceptIdx >= 0 ? args[acceptIdx + 1] ?? "" : "";
  const accept = new Set(acceptStr.split(",").map(s => s.trim()).filter(Boolean));
  const findingsIdx = args.indexOf("--findings");
  const handbookIdx = args.indexOf("--handbook");
  const handbookPath = handbookIdx >= 0 ? args[handbookIdx + 1] : undefined;
  let raw = "";
  if (findingsIdx >= 0) {
    raw = readFileSync(args[findingsIdx + 1], "utf8");
  } else {
    raw = await Bun.stdin.text();
  }
  let findings: Finding[] = [];
  try { findings = JSON.parse(raw); } catch { process.stderr.write("apply: invalid JSON on stdin\n"); process.exit(1); }
  const result = apply(repo, findings, accept, handbookPath);
  if (result.refused.length) {
    for (const r of result.refused) process.stderr.write(`REFUSED: ${r}\n`);
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(result) + "\n");
}
