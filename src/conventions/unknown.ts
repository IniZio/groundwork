/**
 * Appends a question to the unknowns register at .groundwork/unknowns.md.
 * Usage: bun src/conventions/unknown.ts <repo> --add "question text"
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function addUnknown(repo: string, question: string): string {
  const gw = path.join(path.resolve(repo), ".groundwork");
  mkdirSync(gw, { recursive: true });
  const p = path.join(gw, "unknowns.md");
  const existing = existsSync(p) ? readFileSync(p, "utf8") : "# Unknowns Register\n\n";
  writeFileSync(p, existing.trimEnd() + `\n- ${new Date().toISOString()}: ${question}\n`, "utf8");
  return p;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const repo = args.find(a => !a.startsWith("--")) ?? ".";
  const addIdx = args.indexOf("--add");
  if (addIdx < 0) { process.stderr.write("unknown: --add <question> required\n"); process.exit(1); }
  addUnknown(repo, args[addIdx + 1]);
}
