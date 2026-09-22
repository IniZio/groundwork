/**
 * D-4 artifacts: per-repo profile, skills directory, unknowns register.
 * All written to .groundwork/ inside the target repo.
 * Usage: bun src/conventions/known.ts <repo>
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function initKnown(repo: string): void {
  const abs = path.resolve(repo);
  const gw = path.join(abs, ".groundwork");
  mkdirSync(gw, { recursive: true });
  mkdirSync(path.join(gw, "skills"), { recursive: true });

  const profilePath = path.join(gw, "profile.md");
  if (!existsSync(profilePath)) {
    writeFileSync(profilePath, `# Groundwork Profile\n\nConventions are in the repo's own files: .gitmessage, Makefile, .github/pull_request_template.md.\nThis file accretes run metadata only — it is NOT the convention source of truth.\n\n## Runs\n\n- ${new Date().toISOString()}: init\n`, "utf8");
  } else {
    const existing = readFileSync(profilePath, "utf8");
    writeFileSync(profilePath, existing.trimEnd() + `\n- ${new Date().toISOString()}: run\n`, "utf8");
  }

  const unknownsPath = path.join(gw, "unknowns.md");
  if (!existsSync(unknownsPath)) {
    writeFileSync(unknownsPath, "# Unknowns Register\n\n", "utf8");
  }
}

if (import.meta.main) {
  const repo = process.argv[2] ?? ".";
  initKnown(repo);
  process.stdout.write("known: initialized .groundwork/ artifacts\n");
}
