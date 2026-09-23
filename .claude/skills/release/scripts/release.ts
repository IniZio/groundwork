#!/usr/bin/env bun
/**
 * Version helper for the groundwork plugin release skill. Run from the repo root.
 *
 *   bun release.ts check              all version fields agree? prints the version
 *   bun release.ts suggest            commits since last release + proposed bump level
 *   bun release.ts bump <level|X.Y.Z> rewrite every version field (level: patch|minor|major)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

type Field = { file: string; count: number; read: (json: any) => string };

/** Every published version field; `count` = expected `"version": "<v>"` literals per file. */
const FIELDS: Field[] = [
  { file: "package.json", count: 1, read: j => j.version },
  { file: ".claude-plugin/plugin.json", count: 1, read: j => j.version },
  { file: ".claude-plugin/marketplace.json", count: 2, read: j => j.metadata.version },
  { file: ".claude-plugin/marketplace.json", count: 2, read: j => j.plugins.find((p: any) => p.name === "groundwork").version },
];

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function die(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function currentVersion(): string {
  const seen = FIELDS.map(f => ({ f, v: f.read(JSON.parse(readFileSync(f.file, "utf8"))) }));
  const distinct = new Set(seen.map(s => s.v));
  if (distinct.size !== 1) {
    const rows = seen.map(s => `  ${s.f.file}: ${s.v}`).join("\n");
    die(`version fields disagree:\n${rows}`);
  }
  const [v] = distinct;
  if (!SEMVER.test(v)) die(`current version '${v}' is not X.Y.Z`);
  return v;
}

function nextVersion(cur: string, arg: string): string {
  if (SEMVER.test(arg)) return arg;
  const [maj, min, pat] = cur.match(SEMVER)!.slice(1).map(Number);
  if (arg === "major") return `${maj + 1}.0.0`;
  if (arg === "minor") return `${maj}.${min + 1}.0`;
  if (arg === "patch") return `${maj}.${min}.${pat + 1}`;
  die(`bump needs patch|minor|major|X.Y.Z, got '${arg}'`);
}

/** Newest vX.Y.Z tag reachable from HEAD, else the last commit that changed plugin.json's version. */
function lastRelease(): { ref: string; how: string } {
  try {
    return { ref: git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*.[0-9]*.[0-9]*"), how: "tag" };
  } catch {
    const sha = git("log", "-1", "--format=%H", "-G", '"version"', "--", ".claude-plugin/plugin.json");
    if (!sha) die("no v* tag and no version change in .claude-plugin/plugin.json history");
    return { ref: sha.slice(0, 7), how: "last version-field change" };
  }
}

function suggest(): void {
  const cur = currentVersion();
  const { ref, how } = lastRelease();
  const log = git("log", "--format=%h%x09%s%x09%b%x1e", `${ref}..HEAD`);
  const commits = log.split("\x1e").map(s => s.trim()).filter(Boolean);
  const subjects = commits.map(c => c.split("\t"));

  const breaking = subjects.some(([, s, b]) => /^\w+(\(.+\))?!:/.test(s) || /BREAKING CHANGE/.test(b ?? ""));
  const feat = subjects.some(([, s]) => /^feat(\(.+\))?:/.test(s));
  const level = breaking ? "major" : feat ? "minor" : "patch";

  console.log(`current: ${cur}`);
  console.log(`since:   ${ref} (${how})`);
  console.log(`commits: ${commits.length}`);
  for (const [h, s] of subjects) console.log(`  ${h} ${s}`);
  if (commits.length === 0) {
    console.log("suggest: nothing to release");
    return;
  }
  console.log(`suggest: ${level} -> ${nextVersion(cur, level)}`);
}

function bump(arg: string | undefined): void {
  if (!arg) die("usage: bun release.ts bump <patch|minor|major|X.Y.Z>");
  const cur = currentVersion();
  const next = nextVersion(cur, arg);
  if (next === cur) die(`new version equals current (${cur})`);

  const literal = `"version": "${cur}"`;
  for (const file of new Set(FIELDS.map(f => f.file))) {
    const text = readFileSync(file, "utf8");
    const expected = FIELDS.find(f => f.file === file)!.count;
    const found = text.split(literal).length - 1;
    if (found !== expected) die(`${file}: expected ${expected} × ${literal}, found ${found}`);
    writeFileSync(file, text.replaceAll(literal, `"version": "${next}"`));
  }

  const after = currentVersion();
  if (after !== next) die(`post-write check read ${after}, expected ${next}`);
  console.log(`${cur} -> ${next}`);
  for (const file of new Set(FIELDS.map(f => f.file))) console.log(`  ${file}`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "check") console.log(currentVersion());
else if (cmd === "suggest") suggest();
else if (cmd === "bump") bump(arg);
else die("usage: bun release.ts check | suggest | bump <patch|minor|major|X.Y.Z>");
