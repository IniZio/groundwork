/** Finds pstack's poteto-mode SKILL.md from groundwork's plugin root: the newest sibling pstack in the same marketplace cache, else a pstack@* installPath in installed_plugins.json. Node builtins only, since installed plugins have no node_modules. */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const SKILL = join("skills", "poteto-mode", "SKILL.md");

function semver(v: string): number[] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function newestFirst(a: string, b: string): number {
  const [x, y] = [semver(a) ?? [-1, -1, -1], semver(b) ?? [-1, -1, -1]];
  return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
}

export function searchedPlaces(pluginRoot: string) {
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  return { sibling: resolve(pluginRoot, "..", "..", "pstack"), installed: join(configDir, "plugins", "installed_plugins.json") };
}

function fromSibling(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const versions = readdirSync(dir).filter((v) => semver(v)).sort(newestFirst);
  for (const v of versions) {
    const file = join(dir, v, SKILL);
    if (existsSync(file)) return file;
  }
  return null;
}

interface Install { installPath: string; version: string }

function parseInstalls(text: string): Install[] {
  const plugins = (JSON.parse(text) as { plugins?: Record<string, Partial<Install>[]> }).plugins ?? {};
  return Object.entries(plugins)
    .filter(([key, list]) => key.startsWith("pstack@") && Array.isArray(list))
    .flatMap(([, list]) => list)
    .filter((i) => i && String(i.installPath ?? "") !== "")
    .map((i) => ({ installPath: String(i.installPath), version: String(i.version ?? "") }));
}

function fromInstalled(file: string): string | null {
  if (!existsSync(file)) return null;
  let installs: Install[] = [];
  try {
    installs = parseInstalls(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  for (const i of installs.sort((a, b) => newestFirst(a.version, b.version))) {
    const skill = join(i.installPath, SKILL);
    if (existsSync(skill)) return resolve(skill);
  }
  return null;
}

export function findPotetoMode(pluginRoot: string): string | null {
  const where = searchedPlaces(pluginRoot);
  return fromSibling(where.sibling) ?? fromInstalled(where.installed);
}

export function notFoundLine(pluginRoot: string): string {
  const where = searchedPlaces(pluginRoot);
  return `POTETO-MODE NOT FOUND: no skills/poteto-mode/SKILL.md under ${where.sibling}/<version> or any pstack@* installPath in ${where.installed}. Tell the user pstack is missing; do not continue as if poteto-mode were loaded.`;
}

function stripFrontmatter(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/^\n+/, "");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const pathOnly = args.includes("--path");
  const pluginRoot = resolve(args.find((a) => a !== "--path") ?? join(import.meta.dir, ".."));
  const file = findPotetoMode(pluginRoot);
  if (!file) process.stdout.write(notFoundLine(pluginRoot) + "\n");
  else if (pathOnly) process.stdout.write(file + "\n");
  else {
    const body = stripFrontmatter(readFileSync(file, "utf8"));
    process.stdout.write(`poteto-mode SKILL.md lives in ${dirname(file)}; resolve its relative links from that directory.\n\n${body}`);
  }
}
