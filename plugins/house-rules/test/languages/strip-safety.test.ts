import { describe, it, expect, afterAll } from "bun:test";
import path from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { LANGUAGES, LANGUAGE_ADAPTERS, languageForPath } from "../../src/hooks/languages/registry.js";
import type { Language } from "../../src/hooks/languages/registry.js";
import { createSourceFiles } from "../../src/engine/source-file.js";
import { getParser } from "../../src/hooks/lib/tree-sitter-loader.js";
import { autoFix, findComments, collectCodeText } from "../../src/hooks/lib/comment-density.js";
import { COMMENT_DENSITY_LANGUAGE_HOOKS, fixEntryFor } from "../../rules/comment-density/languages.js";

const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures/strip-safety");
const HEADER_RE = /strip-safety: removed=(\d+)/;

const sf = createSourceFiles(getParser);

afterAll(() => sf.dispose());

// Returns the wasm names the language uses (one today; may grow post-merge).
function grammarsFor(lang: Language): string[] {
  return [LANGUAGE_ADAPTERS[lang].grammar.wasm];
}

// Returns the wasm that parses this fixture.
function grammarOfFixture(fixturePath: string): string {
  const lang = languageForPath(fixturePath)!;
  return LANGUAGE_ADAPTERS[lang].grammar.wasm;
}

interface Fixture {
  fixturePath: string;
  lang: Language;
  wasm: string;
  stemOk: boolean;
}

function loadFixtures(): Fixture[] {
  let entries: string[] = [];
  try { entries = readdirSync(FIXTURES_DIR); } catch { return []; }
  const result: Fixture[] = [];
  for (const e of entries) {
    const fixturePath = path.join(FIXTURES_DIR, e);
    const ext = path.extname(e);
    const stem = ext ? e.slice(0, -ext.length) : e;
    const lang = languageForPath(fixturePath) as Language | null;
    if (!lang) continue;
    const wasm = LANGUAGE_ADAPTERS[lang].grammar.wasm;
    result.push({ fixturePath, lang, wasm, stemOk: stem === lang });
  }
  return result;
}

const allFixtures = loadFixtures();

function fixturesForLang(lang: Language): string[] {
  return allFixtures.filter((f) => f.lang === lang).map((f) => f.fixturePath);
}

type WalkNode = {
  type: string; isNamed: boolean; startIndex: number; endIndex: number;
  childCount: number; child(i: number): WalkNode | null;
};

function namedNonCommentTypes(node: WalkNode, commentKeys: Set<string>): string[] {
  const result: string[] = [];
  function walk(n: WalkNode): void {
    if (commentKeys.has(`${n.startIndex}:${n.endIndex}`) || n.type.includes("comment")) return;
    if (n.isNamed) result.push(n.type);
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i);
      if (child) walk(child);
    }
  }
  walk(node);
  return result;
}

interface CheckResult { ok: boolean; reason?: string }

interface LangCheckResults {
  a: CheckResult;
  b: CheckResult;
  c: CheckResult;
  d: CheckResult;
}

async function runChecks(fixturePath: string, lang: Language): Promise<LangCheckResults> {
  const text = readFileSync(fixturePath, "utf8");
  const allMatches = [...text.matchAll(new RegExp(HEADER_RE.source, "g"))];
  if (allMatches.length !== 1) {
    const err = `expected exactly 1 header match, found ${allMatches.length}`;
    return { a: { ok: false, reason: err }, b: { ok: false, reason: err }, c: { ok: false, reason: err }, d: { ok: false, reason: err } };
  }
  const headerN = parseInt(allMatches[0][1], 10);

  const rows = new Set(text.split("\n").map((_, i) => i));
  const [preResult, ar, fc] = await Promise.all([
    sf.get(lang, text),
    autoFix(text, lang, rows, undefined, rows),
    findComments(text, lang),
  ]);

  const postResult = ar.ok ? await sf.get(lang, ar.fixed) : null;

  const a: CheckResult = (() => {
    if (!preResult.ok) return { ok: false, reason: `pre parse failed: ${preResult.reason}` };
    if (preResult.source.errorRows.size > 0)
      return { ok: false, reason: `pre parse has errorRows: ${[...preResult.source.errorRows].join(", ")}` };
    if (!ar.ok) return { ok: false, reason: `autoFix failed: ${ar.reason}` };
    if (!postResult?.ok) return { ok: false, reason: `post parse failed: ${postResult?.reason}` };
    const newErrors = [...postResult.source.errorRows].filter(r => !preResult.source.errorRows.has(r));
    if (newErrors.length > 0) return { ok: false, reason: `post introduced errorRows: ${newErrors.join(", ")}` };
    return { ok: true };
  })();

  const b: CheckResult = (() => {
    if (!preResult.ok) return { ok: false, reason: "pre parse failed" };
    if (!ar.ok || !postResult?.ok) return { ok: false, reason: "autoFix or post parse failed" };
    const preKeys = new Set(preResult.source.comments.map(c => `${c.startIndex}:${c.endIndex}`));
    const postKeys = new Set(postResult.source.comments.map(c => `${c.startIndex}:${c.endIndex}`));
    const preTypes = namedNonCommentTypes(preResult.source.tree.rootNode as WalkNode, preKeys);
    const postTypes = namedNonCommentTypes(postResult.source.tree.rootNode as WalkNode, postKeys);
    if (JSON.stringify(preTypes) !== JSON.stringify(postTypes))
      return { ok: false, reason: `named non-comment node types differ (pre ${preTypes.length} vs post ${postTypes.length})` };
    const preCode = collectCodeText(preResult.source.tree.rootNode, text, lang);
    const postCode = collectCodeText(postResult.source.tree.rootNode, ar.fixed, lang);
    if (preCode !== postCode) return { ok: false, reason: "collectCodeText changed after strip" };
    return { ok: true };
  })();

  const c: CheckResult = (() => {
    if (!preResult.ok || !ar.ok || !postResult?.ok) return { ok: false, reason: "pre/fix/post parse failed" };
    const keptByIndex = new Map<number, string>();
    for (const cm of preResult.source.comments) {
      if (cm.directive) keptByIndex.set(cm.startIndex, cm.text);
    }
    if (fc.ok) {
      for (const cm of fc.comments) {
        if (cm.exempt) keptByIndex.set(cm.startIndex, cm.text);
      }
    }
    if (keptByIndex.size === 0)
      return { ok: false, reason: "kept set is empty (AC1: fixture must contain directive/kept comments)" };
    const keptMap = new Map<string, number>();
    for (const t of keptByIndex.values()) keptMap.set(t, (keptMap.get(t) ?? 0) + 1);
    const postMap = new Map<string, number>();
    for (const cm of postResult.source.comments) postMap.set(cm.text, (postMap.get(cm.text) ?? 0) + 1);
    for (const [t, count] of keptMap) {
      if ((postMap.get(t) ?? 0) < count)
        return { ok: false, reason: `kept comment missing post-strip: "${t.slice(0, 60)}"` };
    }
    return { ok: true };
  })();

  const d: CheckResult = (() => {
    if (headerN < 1) return { ok: false, reason: `header N must be >= 1, got ${headerN}` };
    if (!ar.ok) return { ok: false, reason: `autoFix failed: ${ar.reason}` };
    if (ar.removed !== headerN) return { ok: false, reason: `ar.removed (${ar.removed}) !== header N (${headerN})` };
    if (!preResult.ok || !postResult?.ok) return { ok: false, reason: "pre/post parse failed" };
    const pre = preResult.source.comments.length;
    const post = postResult.source.comments.length;
    if (post !== pre - ar.removed)
      return { ok: false, reason: `post comment count ${post} !== pre ${pre} - removed ${ar.removed}` };
    return { ok: true };
  })();

  return { a, b, c, d };
}

function isStable(lang: Language): boolean {
  const e = fixEntryFor(lang);
  return e.stability === "stable" && e.applicability === "safe";
}

const allResults = new Map<string, LangCheckResults>();
for (const f of allFixtures) {
  allResults.set(f.fixturePath, await runChecks(f.fixturePath, f.lang));
}

const CHECKS: Array<["a" | "b" | "c" | "d", string]> = [
  ["a", "parse"],
  ["b", "code"],
  ["c", "kept"],
  ["d", "removed"],
];

describe("strip-safety", () => {
  for (const f of allFixtures) {
    if (!f.stemOk) {
      const base = path.basename(f.fixturePath);
      it(`strip-safety: fixture ${base} stem must equal language id`, () => {
        throw new Error(`stem of "${base}" does not equal detected language "${f.lang}"`);
      });
    }
  }

  for (const f of allFixtures.filter((f) => isStable(f.lang))) {
    for (const [key, name] of CHECKS) {
      const title = `strip-safety: ${f.lang} [${f.wasm}] (${key}) ${name}`;
      it(title, () => {
        const r = allResults.get(f.fixturePath)!;
        const check = r[key];
        expect(check.ok, check.reason ?? title).toBe(true);
      });
    }
  }
});

describe("strip-safety (preview, report-only)", () => {
  for (const f of allFixtures.filter((f) => !isStable(f.lang))) {
    const r = allResults.get(f.fixturePath)!;
    for (const [key, name] of CHECKS) {
      const title = `strip-safety: ${f.lang} [${f.wasm}] (${key}) ${name}`;
      const check = r[key];
      if (check.ok) {
        it(title, () => { expect(check.ok).toBe(true); });
      } else {
        it.todo(`${title} — PREVIEW FAIL: ${check.reason}`, () => {});
      }
    }
  }
});

describe("strip-safety parity", () => {
  const stableHookLangs = (Object.keys(COMMENT_DENSITY_LANGUAGE_HOOKS) as Language[])
    .filter((lang) => {
      const e = fixEntryFor(lang);
      return e.stability === "stable" && e.applicability === "safe";
    });

  it("positive control: typescript grammar covered, nope grammar not covered", () => {
    const tsWasm = "tree-sitter-typescript.wasm";
    const nopeWasm = "tree-sitter-nope.wasm";
    const tsCovered = allFixtures.some((f) => f.lang === "typescript" && grammarOfFixture(f.fixturePath) === tsWasm);
    expect(tsCovered, `${tsWasm} must be covered for typescript`).toBe(true);
    const nopeCovered = allFixtures.some((f) => grammarOfFixture(f.fixturePath) === nopeWasm);
    expect(nopeCovered, `${nopeWasm} must not be covered`).toBe(false);
  });

  it("stable set is non-empty and includes typescript and go", () => {
    expect(stableHookLangs.length, "stable hook set must be non-empty").toBeGreaterThan(0);
    expect(stableHookLangs, "stable set must include typescript").toContain("typescript");
    expect(stableHookLangs, "stable set must include go").toContain("go");
  });

  for (const lang of stableHookLangs) {
    for (const g of grammarsFor(lang)) {
      it(`parity: stable hook "${lang}" [${g}] has a strip-safety fixture`, () => {
        const covered = allFixtures.some((f) => f.lang === lang && grammarOfFixture(f.fixturePath) === g);
        expect(covered, `no strip-safety fixture for language "${lang}" grammar "${g}"`).toBe(true);
      });
    }
  }

  for (const lang of stableHookLangs) {
    it(`parity: stable hook "${lang}" has a strip-safety fixture`, () => {
      expect(fixturesForLang(lang).length, `no strip-safety fixture for stable language "${lang}"`).toBeGreaterThan(0);
    });
  }

  for (const lang of LANGUAGES) {
    it(`parity: language "${lang}" has a strip-safety fixture`, () => {
      expect(fixturesForLang(lang).length, `no strip-safety fixture for language "${lang}"`).toBeGreaterThan(0);
    });
  }
});
