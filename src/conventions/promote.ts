/**
 * Promotes a skill to .groundwork/skills/<name>/SKILL.md in mattpocock SKILL.md format.
 * Usage: bun src/conventions/promote.ts <repo> --name <kebab-name> --description "..." [--body-file <f>]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const KEBAB_RE = /^[a-z][a-z0-9-]*$/;

export interface PromoteOptions {
  name: string;
  description: string;
  bodyFile?: string;
}

export function promote(repo: string, opts: PromoteOptions): string {
  if (!KEBAB_RE.test(opts.name)) {
    throw new Error(`promote: name "${opts.name}" must be kebab-case`);
  }
  const skillDir = path.join(path.resolve(repo), ".groundwork", "skills", opts.name);
  mkdirSync(skillDir, { recursive: true });
  const body = opts.bodyFile ? readFileSync(opts.bodyFile, "utf8") : "";
  const quoted = `"${opts.description.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const content = `---\nname: ${opts.name}\ndescription: ${quoted}\n---\n${body}`;
  const dest = path.join(skillDir, "SKILL.md");
  writeFileSync(dest, content, "utf8");
  return dest;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const repo = args.find(a => !a.startsWith("--")) ?? ".";
  const nameIdx = args.indexOf("--name");
  const descIdx = args.indexOf("--description");
  const bodyIdx = args.indexOf("--body-file");
  if (nameIdx < 0 || descIdx < 0) {
    process.stderr.write("promote: --name and --description are required\n");
    process.exit(1);
  }
  try {
    const dest = promote(repo, {
      name: args[nameIdx + 1],
      description: args[descIdx + 1],
      bodyFile: bodyIdx >= 0 ? args[bodyIdx + 1] : undefined,
    });
    process.stdout.write(`promote: wrote ${dest}\n`);
  } catch (e) {
    process.stderr.write((e as Error).message + "\n");
    process.exit(1);
  }
}
