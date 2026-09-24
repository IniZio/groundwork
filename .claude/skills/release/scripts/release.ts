#!/usr/bin/env bun
/**
 * Version helper for the groundwork plugin release skill. Run from the repo root.
 *
 *   bun release.ts check [--plugin <name>]               all version fields agree? prints the version
 *   bun release.ts suggest [--plugin <name>]              commits since last release + proposed bump level
 *   bun release.ts bump <level|X.Y.Z> [--plugin <name>]  rewrite every version field for that plugin
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

type PluginName = "groundwork" | "house-rules";

interface FieldDef {
  /** Path relative to repo root. */
  file: string;
  /** Extract the version string from a parsed JSON object. */
  read: (json: any) => string;
  /** Write the new version into a parsed JSON object (mutates in place). */
  write: (json: any, version: string) => void;
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const KNOWN_PLUGINS: PluginName[] = ["groundwork", "house-rules"];

function die(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Return the field definitions for a plugin. Each file may appear more than once
 *  (once per logical version slot), but write operations are deduplicated by file below. */
function getFields(plugin: PluginName): FieldDef[] {
  if (plugin === "groundwork") {
    return [
      {
        file: "package.json",
        read: j => j.version,
        write: (j, v) => { j.version = v; },
      },
      {
        file: ".claude-plugin/plugin.json",
        read: j => j.version,
        write: (j, v) => { j.version = v; },
      },
      {
        file: ".claude-plugin/marketplace.json",
        read: j => j.metadata.version,
        write: (j, v) => { j.metadata.version = v; },
      },
      {
        file: ".claude-plugin/marketplace.json",
        read: j => {
          const p = j.plugins.find((p: any) => p.name === "groundwork");
          if (!p) die("marketplace.json: no entry for 'groundwork' in plugins[]");
          return p.version;
        },
        write: (j, v) => {
          const p = j.plugins.find((p: any) => p.name === "groundwork");
          if (!p) die("marketplace.json: no entry for 'groundwork' in plugins[]");
          p.version = v;
        },
      },
    ];
  } else {
    // house-rules
    return [
      {
        file: "plugins/house-rules/.claude-plugin/plugin.json",
        read: j => j.version,
        write: (j, v) => { j.version = v; },
      },
      {
        file: ".claude-plugin/marketplace.json",
        read: j => {
          const p = j.plugins.find((p: any) => p.name === "house-rules");
          if (!p) die("marketplace.json: no entry for 'house-rules' in plugins[]");
          return p.version;
        },
        write: (j, v) => {
          const p = j.plugins.find((p: any) => p.name === "house-rules");
          if (!p) die("marketplace.json: no entry for 'house-rules' in plugins[]");
          p.version = v;
        },
      },
    ];
  }
}

function readFileMap(fields: FieldDef[]): Map<string, any> {
  const map = new Map<string, any>();
  for (const f of fields) {
    if (!map.has(f.file)) {
      map.set(f.file, JSON.parse(readFileSync(f.file, "utf8")));
    }
  }
  return map;
}

function currentVersionFor(plugin: PluginName): string {
  const fields = getFields(plugin);
  const fileMap = readFileMap(fields);
  const seen = fields.map(f => ({ file: f.file, v: f.read(fileMap.get(f.file)) }));
  const distinct = new Set(seen.map(s => s.v));
  if (distinct.size !== 1) {
    const rows = seen.map(s => `  ${s.file}: ${s.v}`).join("\n");
    die(`${plugin} version fields disagree:\n${rows}`);
  }
  const [v] = distinct;
  if (!SEMVER.test(v)) die(`current ${plugin} version '${v}' is not X.Y.Z`);
  return v;
}

/** Verify groundwork's declared house-rules dependency range is satisfied. No-op if no range declared. */
function checkDependencies(): void {
  const gwPlugin = JSON.parse(readFileSync(".claude-plugin/plugin.json", "utf8"));
  const deps: Array<{ name: string; version?: string }> = gwPlugin.dependencies ?? [];
  const hrDep = deps.find(d => d.name === "house-rules");
  if (!hrDep?.version) return;
  const hrVersion = currentVersionFor("house-rules");
  if (!satisfiesRange(hrVersion, hrDep.version)) {
    die(
      `house-rules version ${hrVersion} does not satisfy groundwork's declared range '${hrDep.version}'`
    );
  }
}

/** Check whether version satisfies range. Supports exact, ~X.Y.Z, ^X.Y.Z. */
function satisfiesRange(version: string, range: string): boolean {
  // Try Bun.semver if available
  if (typeof (globalThis as any).Bun?.semver?.satisfies === "function") {
    return (globalThis as any).Bun.semver.satisfies(version, range);
  }
  // Manual fallback
  if (SEMVER.test(range)) return version === range;

  const tilde = range.match(/^~(\d+)\.(\d+)\.(\d+)$/);
  if (tilde) {
    const [maj, min, pat] = tilde.slice(1).map(Number);
    const m = version.match(SEMVER);
    if (!m) return false;
    const [vmaj, vmin, vpat] = m.slice(1).map(Number);
    return vmaj === maj && vmin === min && vpat >= pat;
  }

  const caret = range.match(/^\^(\d+)\.(\d+)\.(\d+)$/);
  if (caret) {
    const [maj, min, pat] = caret.slice(1).map(Number);
    const m = version.match(SEMVER);
    if (!m) return false;
    const [vmaj, vmin, vpat] = m.slice(1).map(Number);
    if (maj > 0) return vmaj === maj && (vmin > min || (vmin === min && vpat >= pat));
    if (min > 0) return vmaj === 0 && vmin === min && vpat >= pat;
    return vmaj === 0 && vmin === 0 && vpat >= pat;
  }

  die(`unsupported semver range syntax: '${range}'`);
}

function nextVersion(cur: string, arg: string): string {
  if (SEMVER.test(arg)) return arg;
  const [maj, min, pat] = cur.match(SEMVER)!.slice(1).map(Number);
  if (arg === "major") return `${maj + 1}.0.0`;
  if (arg === "minor") return `${maj}.${min + 1}.0`;
  if (arg === "patch") return `${maj}.${min}.${pat + 1}`;
  die(`bump needs patch|minor|major|X.Y.Z, got '${arg}'`);
}

interface PluginMeta {
  tagPattern: string;
  tagExclude?: string;
  pathFilter: string[];
  fallbackFile: string;
}

function getPluginMeta(plugin: PluginName): PluginMeta {
  if (plugin === "groundwork") {
    return {
      tagPattern: "v[0-9]*.[0-9]*.[0-9]*",
      tagExclude: "house-rules-v*",
      /** Everything except the house-rules subtree */
      pathFilter: [".", ":(exclude)plugins/house-rules"],
      fallbackFile: ".claude-plugin/plugin.json",
    };
  } else {
    return {
      tagPattern: "house-rules-v[0-9]*.[0-9]*.[0-9]*",
      tagExclude: undefined,
      pathFilter: ["plugins/house-rules"],
      fallbackFile: "plugins/house-rules/.claude-plugin/plugin.json",
    };
  }
}

function lastReleaseFor(plugin: PluginName): { ref: string; how: string } {
  const { tagPattern, tagExclude, fallbackFile } = getPluginMeta(plugin);
  const args = ["describe", "--tags", "--abbrev=0", "--match", tagPattern];
  if (tagExclude) args.push(`--exclude=${tagExclude}`);
  try {
    return { ref: git(...args), how: "tag" };
  } catch {
    const sha = git("log", "-1", "--format=%H", "-G", '"version"', "--", fallbackFile);
    if (!sha) {
      const tagDesc = plugin === "house-rules" ? "house-rules-v*" : "v*";
      die(`no ${tagDesc} tag and no version change in ${fallbackFile} history`);
    }
    return { ref: sha.slice(0, 7), how: "last version-field change" };
  }
}

interface Commit {
  hash: string;
  subject: string;
  body: string;
}

function commitsForPlugin(plugin: PluginName, since: string): Commit[] {
  const { pathFilter } = getPluginMeta(plugin);
  const log = git(
    "log", "--format=%h%x09%s%x09%b%x1e", `${since}..HEAD`, "--",
    ...pathFilter
  );
  return log.split("\x1e")
    .map(s => s.trim())
    .filter(Boolean)
    .map(c => {
      const parts = c.split("\t");
      return { hash: parts[0] ?? "", subject: parts[1] ?? "", body: parts[2] ?? "" };
    });
}

function determineLevel(commits: Commit[]): "major" | "minor" | "patch" {
  const breaking = commits.some(
    c => /^\w+(\(.+\))?!:/.test(c.subject) || /BREAKING CHANGE/.test(c.body)
  );
  const feat = commits.some(c => /^feat(\(.+\))?:/.test(c.subject));
  return breaking ? "major" : feat ? "minor" : "patch";
}

function suggest(plugin?: PluginName): void {
  const plugins: PluginName[] = plugin ? [plugin] : KNOWN_PLUGINS;
  let anyCommits = false;

  for (const p of plugins) {
    const cur = currentVersionFor(p);
    const { ref, how } = lastReleaseFor(p);
    const commits = commitsForPlugin(p, ref);

    // In multi-plugin mode (no --plugin), skip plugins with no commits.
    if (!plugin && commits.length === 0) continue;

    console.log(`\n[${p}]`);
    console.log(`current: ${cur}`);
    console.log(`since:   ${ref} (${how})`);
    console.log(`commits: ${commits.length}`);
    for (const c of commits) console.log(`  ${c.hash} ${c.subject}`);

    if (commits.length === 0) {
      console.log("suggest: nothing to release");
    } else {
      const level = determineLevel(commits);
      console.log(`suggest: ${level} -> ${nextVersion(cur, level)}`);
      anyCommits = true;
    }
  }

  if (!plugin && !anyCommits) {
    console.log("suggest: nothing to release");
  }
}

function bump(arg: string | undefined, plugin: PluginName): void {
  if (!arg) die("usage: bun release.ts bump <patch|minor|major|X.Y.Z> [--plugin <name>]");
  const cur = currentVersionFor(plugin);
  const next = nextVersion(cur, arg);
  if (next === cur) die(`new version equals current (${cur})`);

  const fields = getFields(plugin);
  // Parse each file once
  const fileMap = readFileMap(fields);
  // Apply all writes to their in-memory JSON objects
  for (const f of fields) {
    f.write(fileMap.get(f.file)!, next);
  }
  // Serialize back: 2-space indent + trailing newline
  for (const [file, json] of fileMap) {
    writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  }

  const after = currentVersionFor(plugin);
  if (after !== next) die(`post-write check read ${after}, expected ${next}`);
  console.log(`${cur} -> ${next}`);
  for (const file of [...new Set(fields.map(f => f.file))]) console.log(`  ${file}`);
}

function parsePlugin(args: string[]): PluginName {
  const idx = args.indexOf("--plugin");
  if (idx === -1) return "groundwork";
  const name = args[idx + 1];
  if (!name || !KNOWN_PLUGINS.includes(name as PluginName)) {
    die(`--plugin must be one of: ${KNOWN_PLUGINS.join(", ")}`);
  }
  return name as PluginName;
}

// ---- dispatch ----------------------------------------------------------------

const rawArgs = process.argv.slice(2);
const [cmd, ...rest] = rawArgs;

if (cmd === "check") {
  const plugin = parsePlugin(rest);
  console.log(currentVersionFor(plugin));
  if (plugin === "groundwork") checkDependencies();
} else if (cmd === "suggest") {
  const pluginIdx = rest.indexOf("--plugin");
  let plugin: PluginName | undefined;
  if (pluginIdx !== -1) {
    const name = rest[pluginIdx + 1];
    if (!name || !KNOWN_PLUGINS.includes(name as PluginName)) {
      die(`--plugin must be one of: ${KNOWN_PLUGINS.join(", ")}`);
    }
    plugin = name as PluginName;
  }
  suggest(plugin);
} else if (cmd === "bump") {
  // Extract --plugin value; treat remaining positional as bump level
  const pluginIdx = rest.indexOf("--plugin");
  const plugin = pluginIdx !== -1 ? (rest[pluginIdx + 1] as PluginName) : "groundwork";
  if (!KNOWN_PLUGINS.includes(plugin)) die(`--plugin must be one of: ${KNOWN_PLUGINS.join(", ")}`);
  const nonFlags: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--plugin") { i++; continue; }
    if (!rest[i].startsWith("--")) nonFlags.push(rest[i]);
  }
  bump(nonFlags[0], plugin);
} else {
  die("usage: bun release.ts check [--plugin <name>] | suggest [--plugin <name>] | bump <patch|minor|major|X.Y.Z> [--plugin <name>]");
}
