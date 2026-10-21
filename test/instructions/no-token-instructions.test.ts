import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");

const PATTERNS: RegExp[] = [
  /--token/,
  /\$GW token/,
  /token T/,
  /approve charter/,
  /approve spec/,
  /intent gate/i,
  /H1 charter/,
  /H2 spec/,
];

const SCAN_DIRS = ["skills", "agents", "rules", "doc", "templates"];
const SCAN_FILES = [
  "src/hooks/session-start.ts",
  "src/hooks/doc-registry.ts",
];

// agents/researcher.md carries uncommitted user edits outside the
// drop-token-and-intent-gates motive; it is not scrubbed here.
const EXCLUDED = new Set(["agents/researcher.md"]);

// Lines that only state `--token` is ignored / no longer used.
// Each entry needs a reason; the "no stale entries" test keeps this honest.
const ALLOWLIST: { file: string; substring: string; reason: string }[] = [];

export function findTokenInstructionHits(text: string, file: string): string[] {
  const hits: string[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    if (PATTERNS.some(p => p.test(line))) hits.push(`${file}:${i + 1}: ${line}`);
  }
  return hits;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!statSync(dir, { throwIfNoEntry: false })) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

function isText(buf: Buffer): boolean {
  return !buf.subarray(0, 4096).includes(0);
}

function scannedFiles(): string[] {
  const files = [
    ...SCAN_DIRS.flatMap(d => walk(path.join(ROOT, d))),
    ...SCAN_FILES.map(f => path.join(ROOT, f)),
  ];
  return files
    .map(f => path.relative(ROOT, f))
    .filter(rel => !EXCLUDED.has(rel) && statSync(path.join(ROOT, rel), { throwIfNoEntry: false }));
}

function isAllowed(hit: string): boolean {
  return ALLOWLIST.some(a => hit.startsWith(`${a.file}:`) && hit.includes(a.substring));
}

describe("token-instruction scanner — positive controls", () => {
  const planted: [string, string][] = [
    ["--token", "run `$GW slice add S1 --token T`"],
    ["$GW token", "get one with $GW token"],
    ["token T", "pass token T to the CLI"],
    ["approve charter", "ask human: gw approve charter now"],
    ["approve spec", "then gw approve spec"],
    ["intent gate", "the Intent Gate blocks dispatch"],
    ["H1 charter", "H1 charter approved"],
    ["H2 spec", "H2 spec approved"],
  ];

  for (const [name, line] of planted) {
    it(`flags ${name} with the right line number`, () => {
      const hits = findTokenInstructionHits(`clean\nclean\n${line}\nclean`, "x.md");
      expect(hits).toEqual([`x.md:3: ${line}`]);
    });
  }

  it("yields no hit for clean text", () => {
    expect(findTokenInstructionHits("run `$GW slice add S1`\nnothing here", "x.md")).toEqual([]);
  });
});

describe("token-instruction guard — shipped files", () => {
  const files = scannedFiles();

  it("walker visits files (not vacuous)", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain("skills/implement/SKILL.md");
    expect(files).not.toContain("agents/researcher.md");
  });

  it("no file instructs token / approve / intent-gate use", () => {
    const hits: string[] = [];
    for (const rel of files) {
      const buf = readFileSync(path.join(ROOT, rel));
      if (!isText(buf)) continue;
      hits.push(...findTokenInstructionHits(buf.toString("utf8"), rel).filter(h => !isAllowed(h)));
    }
    expect(hits).toEqual([]);
  });

  it("every allowlist entry still matches a real line", () => {
    for (const a of ALLOWLIST) {
      const full = path.join(ROOT, a.file);
      const text = statSync(full, { throwIfNoEntry: false }) ? readFileSync(full, "utf8") : "";
      const hit = findTokenInstructionHits(text, a.file).some(h => h.includes(a.substring));
      expect(hit, `stale allowlist entry: ${a.file} / ${a.substring}`).toBe(true);
    }
  });
});
