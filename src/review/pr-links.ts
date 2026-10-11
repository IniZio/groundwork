import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const file = process.argv[2];
const repo = arg("--repo");
const pr = arg("--pr");
if (!file || file.startsWith("--") || !repo || !/^[^/\s]+\/[^/\s]+$/.test(repo) || !pr || !/^\d+$/.test(pr)) {
  console.error("usage: pr-links.ts <file> --repo <owner/name> --pr <N> [--sha <sha>]");
  process.exit(2);
}
const sha = arg("--sha");

const repoRe = repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const BLOB = new RegExp(
  `\\[([^\\]]*)\\]\\((https://github\\.com/${repoRe}/blob/([^/\\s)#?]+)/([^\\s)#?]+)(#[^\\s)]*)?)\\)`,
  "gi",
);
const ANCHOR_BASE = `https://github.com/${repo}/pull/${pr}/files#diff-`;
const FOLLOW = ` ([diff](${ANCHOR_BASE}`;

const text = readFileSync(file, "utf8");
let added = 0;
const out = text.replace(BLOB, (m, _label, _url, blobSha: string, p: string, _frag, offset: number) => {
  if (sha && blobSha !== sha) return m;
  if (text.startsWith(FOLLOW, offset + m.length)) return m;
  const hash = createHash("sha256").update(decodeURIComponent(p)).digest("hex");
  added++;
  return `${m}${FOLLOW}${hash}))`;
});

const PATHREF = /(?<![\w/.@-])((?:[\w.-]+\/)+[\w.-]+|[\w-]+\.\w+)(?:@[0-9a-f]{7,40})?:\d+/;
const bad: string[] = [];
text.split("\n").forEach((line, i) => {
  const masked = line.replace(/\[[^\]]*\]\([^)]*\)/g, (s) => " ".repeat(s.length)).replace(/https?:\/\/\S+/g, (s) => " ".repeat(s.length));
  let hit = PATHREF.test(masked);
  if (!hit) {
    for (const m of masked.matchAll(/`([^`\s]+)`/g)) {
      const p = path.resolve(m[1]);
      if (existsSync(p) && statSync(p).isFile()) hit = true;
    }
  }
  if (hit) bad.push(`${i + 1}: ${line}`);
});

if (bad.length) {
  console.error("pr-links: bare repo path references must be links first:");
  for (const b of bad) console.error(b);
  process.exit(1);
}

if (out !== text) writeFileSync(file, out);
console.log(`pr-links: ${added} anchors added`);
