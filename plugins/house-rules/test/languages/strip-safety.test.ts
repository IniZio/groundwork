import { describe, it, expect, afterAll } from "bun:test";
import path from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { LANGUAGES, languageForPath, grammarsOf, grammarFor, grammarVariantForPath } from "../../src/hooks/languages/registry.js";
import type { Language } from "../../src/hooks/languages/registry.js";
import { createSourceFiles } from "../../src/engine/source-file.js";
import { getParser } from "../../src/hooks/lib/tree-sitter-loader.js";
import { autoFix, findComments, collectCodeText } from "../../src/hooks/lib/comment-density.js";
import { parserForPath } from "../../src/hooks/languages/parse.js";
import { COMMENT_DENSITY_LANGUAGE_HOOKS, fixEntryFor } from "../../rules/comment-density/languages.js";
import { TYPESCRIPT_TOOL_MARKERS, KOTLIN_TOOL_MARKERS, SWIFT_TOOL_MARKERS, JAVA_TOOL_MARKERS, PYTHON_TOOL_MARKERS, PEP263_CODING_RE } from "../../src/hooks/languages/tool-markers.js";
import { commentInnerText } from "../../src/hooks/languages/comments.js";

const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures/strip-safety");
const HEADER_RE = /strip-safety: removed=(\d+)/;

const sf = createSourceFiles(getParser);

afterAll(() => sf.dispose());

// Returns the wasm names for all grammars a language uses (default + variants).
function grammarsFor(lang: Language): string[] {
  return grammarsOf(lang).map(g => g.wasm);
}

// Returns the wasm that parses this specific fixture (variant-aware).
function grammarOfFixture(fixturePath: string): string {
  const lang = languageForPath(fixturePath)!;
  const variant = grammarVariantForPath(lang, fixturePath);
  return grammarFor(lang, variant).wasm;
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
    const variant = grammarVariantForPath(lang, fixturePath);
    const wasm = grammarFor(lang, variant).wasm;
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

// Independent of the classifier under test, so dropping a marker turns (c) red.
const MUST_KEEP: Partial<Record<Language, readonly RegExp[]>> = {
  typescript: [
    /^\/\/\s*eslint-(?:disable|enable)/, /^\/\*\s*eslint-(?:disable|enable)/, /^\{?\/\*\s*eslint-disable/,
    /^\/\/\s*@ts-(?:ignore|expect-error|nocheck|check)\b/, /__PURE__/, /^\/\*!/, /@license\b/, /@preserve\b/,
    /^#!/, /(?:istanbul|c8) ignore/, /prettier-ignore/, /webpackChunkName/,
    /webpack(?:Prefetch|Preload|Mode|Ignore|Exports)\b/,
    /^\/\/[#@]\s*source(?:Mapping)?URL=/,
    /^\/\*\*\s*@jsx(?:ImportSource)?\b/,
    /^\/\/\s*biome-ignore\b/,
    /^\/\/\/\s*<reference\b/,
    /\/\*\s*@vite-ignore\b/,
    /#__NO_SIDE_EFFECTS__/,
  ],
  go: [
    /^\/\/go:/, /^\/\/\s*\+build\b/, /^\/\/nolint\b/, /^\/\/export\b/,
  ],
  kotlin: [
    /^\/\/\s*noinspection\b/,
    /^\/\/\s*<\/?editor-fold\b/,
    /^\/\/\s*language=\S/,
    /^\/\/\s*spotless:(?:off|on)\b/,
    /^\/\/\s*ktlint-(?:disable|enable)\b/,
  ],
  swift: [
    /^\/\/\s*swift-tools-version\s*:/i,
    /^\/\/\s*MARK:/,
    /^\/\/\s*swiftlint:(?:disable|enable)\b/,
    /^\/\/\s*swift-format-ignore\b/,
    /^\/\/\s*swiftformat:(?:disable|enable|options|sort)\b/,
    /^\/\/\s*periphery:ignore\b/,
    /^\/\/\s*sourcery:/,
    /^\/\/\//,
    /^\/\*\*/,
  ],
  java: [
    /^\/\/\s*NOSONAR\b/,
    /^\/\/\s*NOPMD\b/,
    /^\/\/\s*CHECKSTYLE(?::(?:OFF|ON)\b|\.(?:OFF|ON):)/,
    /^\/\/\s*@formatter:(?:off|on)\b/,
    /^\/\/\s*noinspection\b/,
    /^\/\/\s*\$NON-NLS-\d+\$/,
    /^\/\/\s*spotless:(?:off|on)\b/,
    /^\/\/\s*CPD-(?:OFF|ON)\b/,
    /^\/\/\s*(?:file )?deepcode ignore\b/,
    /^\/\/\s*nosemgrep\b/,
    /^\/\/\s*falls?[ -]?thr(?:u|ough)\b/,
  ],
  python: [
    /#\s*noqa\b/i,
    /#\s*type:/,
    /coding[:=]\s*[-\w.]+/,
    /#\s*nosec\b/,
    /^#\s*fmt:\s*(?:off|on|skip)\b/,
    /^#\s*isort:\s*(?:skip(?:_file)?|off|on)\b/,
    /^#\s*mypy:/,
    /#\s*pyright:/,
    /^#\s*flake8:\s*noqa\b/,
    /^#\s*ruff:\s*noqa\b/,
    /^#\s*pyre-(?:ignore|fixme|strict)\b/,
    /#\s*pylint:/,
    /#\s*pragma:/i,
  ],
};

async function runChecks(fixturePath: string, lang: Language): Promise<LangCheckResults> {
  const text = readFileSync(fixturePath, "utf8");
  const allMatches = [...text.matchAll(new RegExp(HEADER_RE.source, "g"))];
  if (allMatches.length !== 1) {
    const err = `expected exactly 1 header match, found ${allMatches.length}`;
    return { a: { ok: false, reason: err }, b: { ok: false, reason: err }, c: { ok: false, reason: err }, d: { ok: false, reason: err } };
  }
  const headerN = parseInt(allMatches[0][1], 10);

  const rows = new Set(text.split("\n").map((_, i) => i));
  const pfp = parserForPath(getParser, fixturePath);
  const [preResult, ar, fc] = await Promise.all([
    sf.get(lang, text, fixturePath),
    autoFix(text, lang, rows, pfp, rows),
    findComments(text, lang, pfp),
  ]);

  const postResult = ar.ok ? await sf.get(lang, ar.fixed, fixturePath) : null;
  const postFc = ar.ok ? await findComments(ar.fixed, lang, pfp) : null;

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
    const preKeys = new Set([
      ...preResult.source.comments.map(c => `${c.startIndex}:${c.endIndex}`),
      ...(fc.ok ? fc.comments.map(c => `${c.startIndex}:${c.endIndex}`) : []),
    ]);
    const postKeys = new Set([
      ...postResult.source.comments.map(c => `${c.startIndex}:${c.endIndex}`),
      ...(postFc?.ok ? postFc.comments.map(c => `${c.startIndex}:${c.endIndex}`) : []),
    ]);
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
    const keptByIndex = new Map<string, string>();
    for (const cm of preResult.source.comments) {
      if (cm.directive) keptByIndex.set(`${cm.startRow}:${cm.text}`, cm.text);
    }
    if (fc.ok) {
      for (const cm of fc.comments) {
        if (cm.exempt) keptByIndex.set(`${cm.startRow}:${cm.text}`, cm.text);
      }
    }
    for (const cm of preResult.source.comments) {
      if ((MUST_KEEP[lang] ?? []).some((re) => re.test(cm.text))) keptByIndex.set(`${cm.startRow}:${cm.text}`, cm.text);
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

// Raw comment texts extracted from typescript fixtures for marker↔MUST_KEEP parity.
function extractRawComments(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\/\/[^\n]*/g)) out.push(m[0]);
  for (const m of src.matchAll(/\/\*[\s\S]*?\*\//g)) out.push(m[0]);
  return out;
}

const allTsRawComments: string[] = [];
for (const f of allFixtures.filter((f) => f.lang === "typescript")) {
  allTsRawComments.push(...extractRawComments(readFileSync(f.fixturePath, "utf8")));
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
      const title = `strip-safety: ${f.lang} [${f.wasm}] ${path.basename(f.fixturePath)} (${key}) ${name}`;
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
      const title = `strip-safety: ${f.lang} [${f.wasm}] ${path.basename(f.fixturePath)} (${key}) ${name}`;
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

describe("strip-safety marker↔MUST_KEEP parity (typescript)", () => {
  const mustKeepTs = MUST_KEEP.typescript ?? [];

  it("positive control: eslint-disable covered, NONEXISTENT_MARKER_XYZ not covered", () => {
    const eslintRe = /^eslint-(?:disable|enable)/;
    const eslintCovered = allTsRawComments.some(
      (raw) => eslintRe.test(commentInnerText(raw)) && mustKeepTs.some((re) => re.test(raw)),
    );
    expect(eslintCovered, "eslint-disable marker must be covered by a MUST_KEEP pattern").toBe(true);

    const fakeRe = /^NONEXISTENT_MARKER_XYZ_FAKE_12345/;
    const fakeCovered = allTsRawComments.some(
      (raw) => fakeRe.test(commentInnerText(raw)) && mustKeepTs.some((re) => re.test(raw)),
    );
    expect(fakeCovered, "NONEXISTENT_MARKER must NOT be covered (verifying the test can detect a miss)").toBe(false);
  });

  for (const markerRe of TYPESCRIPT_TOOL_MARKERS) {
    it(`marker↔MUST_KEEP: ${markerRe} covered by fixture+MUST_KEEP`, () => {
      const covered = allTsRawComments.some((raw) => {
        const inner = commentInnerText(raw);
        return markerRe.test(inner) && mustKeepTs.some((re) => re.test(raw));
      });
      expect(covered, `no typescript fixture comment covers TYPESCRIPT_TOOL_MARKERS ${markerRe}`).toBe(true);
    });
  }

  for (const keepRe of mustKeepTs) {
    const matchingRaws = allTsRawComments.filter((raw) => keepRe.test(raw));
    const toolMarkerRaws = matchingRaws.filter((raw) => {
      const t = raw.trimStart();
      return !raw.startsWith("#!") && !t.startsWith("/**") && !t.startsWith("/*!");
    });
    if (toolMarkerRaws.length === 0) continue;
    it(`MUST_KEEP ${keepRe} → TYPESCRIPT_TOOL_MARKERS covers its fixture comments`, () => {
      const covered = toolMarkerRaws.some((raw) =>
        TYPESCRIPT_TOOL_MARKERS.some((markerRe) => markerRe.test(commentInnerText(raw))),
      );
      expect(covered, `MUST_KEEP ${keepRe}: no TYPESCRIPT_TOOL_MARKERS regex matches fixture comments (marker deleted?)`).toBe(true);
    });
  }
});

const allKtRawComments: string[] = [];
for (const f of allFixtures.filter((f) => f.lang === "kotlin")) {
  allKtRawComments.push(...extractRawComments(readFileSync(f.fixturePath, "utf8")));
}

describe("strip-safety marker↔MUST_KEEP parity (kotlin)", () => {
  const mustKeepKt = MUST_KEEP.kotlin ?? [];

  it("kotlin fixture list is non-empty", () => {
    expect(allKtRawComments.length, "kotlin fixture must contain at least one raw comment").toBeGreaterThan(0);
  });

  it("positive control: noinspection covered, NONEXISTENT_KOTLIN_MARKER_XYZ not covered", () => {
    const noinspRe = /^noinspection\b/;
    const noinspCovered = allKtRawComments.some(
      (raw) => noinspRe.test(commentInnerText(raw)) && mustKeepKt.some((re) => re.test(raw)),
    );
    expect(noinspCovered, "noinspection marker must be covered by a MUST_KEEP.kotlin pattern").toBe(true);

    const fakeRe = /^NONEXISTENT_KOTLIN_MARKER_XYZ_FAKE_99999/;
    const fakeCovered = allKtRawComments.some(
      (raw) => fakeRe.test(commentInnerText(raw)) && mustKeepKt.some((re) => re.test(raw)),
    );
    expect(fakeCovered, "NONEXISTENT_KOTLIN_MARKER must NOT be covered (verifying the test can detect a miss)").toBe(false);
  });

  for (const markerRe of KOTLIN_TOOL_MARKERS) {
    it(`marker↔MUST_KEEP: ${markerRe} covered by fixture+MUST_KEEP`, () => {
      const covered = allKtRawComments.some((raw) => {
        const inner = commentInnerText(raw);
        return markerRe.test(inner) && mustKeepKt.some((re) => re.test(raw));
      });
      expect(covered, `no kotlin fixture comment covers KOTLIN_TOOL_MARKERS ${markerRe}`).toBe(true);
    });
  }

  for (const keepRe of mustKeepKt) {
    const matchingRaws = allKtRawComments.filter((raw) => keepRe.test(raw));
    if (matchingRaws.length === 0) continue;
    it(`MUST_KEEP ${keepRe} → KOTLIN_TOOL_MARKERS covers its fixture comments`, () => {
      const covered = matchingRaws.some((raw) =>
        KOTLIN_TOOL_MARKERS.some((markerRe) => markerRe.test(commentInnerText(raw))),
      );
      expect(covered, `MUST_KEEP ${keepRe}: no KOTLIN_TOOL_MARKERS regex matches fixture comments (marker deleted?)`).toBe(true);
    });
  }
});

describe("strip-safety marker↔MUST_KEEP parity (swift)", () => {
  const mustKeepSwift = MUST_KEEP.swift ?? [];

  const allSwiftRawComments: string[] = [];
  for (const f of allFixtures.filter((f) => f.lang === "swift")) {
    const src = readFileSync(f.fixturePath, "utf8");
    for (const m of src.matchAll(/\/\/[^\n]*/g)) allSwiftRawComments.push(m[0]);
    for (const m of src.matchAll(/\/\*[\s\S]*?\*\//g)) allSwiftRawComments.push(m[0]);
  }

  it("positive control: swift-tools-version covered, NONEXISTENT_SWIFT_MARKER_XYZ not covered", () => {
    const toolsRe = /swift-tools-version/i;
    const toolsCovered = allSwiftRawComments.some(
      (raw) => toolsRe.test(commentInnerText(raw)) && mustKeepSwift.some((re) => re.test(raw)),
    );
    expect(toolsCovered, "swift-tools-version must be covered by a MUST_KEEP pattern").toBe(true);

    const fakeRe = /^NONEXISTENT_SWIFT_MARKER_XYZ_FAKE/;
    const fakeCovered = allSwiftRawComments.some(
      (raw) => fakeRe.test(commentInnerText(raw)) && mustKeepSwift.some((re) => re.test(raw)),
    );
    expect(fakeCovered, "NONEXISTENT_SWIFT_MARKER must NOT be covered (verifying the test can detect a miss)").toBe(false);
  });

  for (const markerRe of SWIFT_TOOL_MARKERS) {
    it(`marker↔MUST_KEEP: ${markerRe} covered by fixture+MUST_KEEP`, () => {
      const covered = allSwiftRawComments.some((raw) => {
        const inner = commentInnerText(raw);
        return markerRe.test(inner) && mustKeepSwift.some((re) => re.test(raw));
      });
      expect(covered, `no swift fixture comment covers SWIFT_TOOL_MARKERS ${markerRe}`).toBe(true);
    });
  }

  for (const keepRe of mustKeepSwift) {
    const matchingRaws = allSwiftRawComments.filter((raw) => keepRe.test(raw));
    const toolMarkerRaws = matchingRaws.filter((raw) => {
      const t = raw.trimStart();
      return !t.startsWith("/**") && !t.startsWith("///");
    });
    if (toolMarkerRaws.length === 0) continue;
    it(`MUST_KEEP ${keepRe} → SWIFT_TOOL_MARKERS covers its fixture comments`, () => {
      const covered = toolMarkerRaws.some((raw) =>
        SWIFT_TOOL_MARKERS.some((markerRe) => markerRe.test(commentInnerText(raw))),
      );
      expect(covered, `MUST_KEEP ${keepRe}: no SWIFT_TOOL_MARKERS regex matches fixture comments (marker deleted?)`).toBe(true);
    });
  }
});

const allJavaRawComments: string[] = [];
for (const f of allFixtures.filter((f) => f.lang === "java")) {
  allJavaRawComments.push(...extractRawComments(readFileSync(f.fixturePath, "utf8")));
}

describe("strip-safety marker↔MUST_KEEP parity (java)", () => {
  const mustKeepJava = MUST_KEEP.java ?? [];

  it("java fixture list is non-empty", () => {
    expect(allJavaRawComments.length, "java fixture must contain at least one raw comment").toBeGreaterThan(0);
  });

  it("positive control: NOSONAR covered, NONEXISTENT_JAVA_MARKER_XYZ not covered", () => {
    const nosonarRe = /^NOSONAR\b/;
    const nosonarCovered = allJavaRawComments.some(
      (raw) => nosonarRe.test(commentInnerText(raw)) && mustKeepJava.some((re) => re.test(raw)),
    );
    expect(nosonarCovered, "NOSONAR marker must be covered by a MUST_KEEP.java pattern").toBe(true);

    const fakeRe = /^NONEXISTENT_JAVA_MARKER_XYZ_FAKE_99999/;
    const fakeCovered = allJavaRawComments.some(
      (raw) => fakeRe.test(commentInnerText(raw)) && mustKeepJava.some((re) => re.test(raw)),
    );
    expect(fakeCovered, "NONEXISTENT_JAVA_MARKER must NOT be covered (verifying the test can detect a miss)").toBe(false);
  });

  for (const markerRe of JAVA_TOOL_MARKERS) {
    it(`marker↔MUST_KEEP: ${markerRe} covered by fixture+MUST_KEEP`, () => {
      const covered = allJavaRawComments.some((raw) => {
        const inner = commentInnerText(raw);
        return markerRe.test(inner) && mustKeepJava.some((re) => re.test(raw));
      });
      expect(covered, `no java fixture comment covers JAVA_TOOL_MARKERS ${markerRe}`).toBe(true);
    });
  }

  for (const keepRe of mustKeepJava) {
    const matchingRaws = allJavaRawComments.filter((raw) => keepRe.test(raw));
    if (matchingRaws.length === 0) continue;
    it(`MUST_KEEP ${keepRe} → JAVA_TOOL_MARKERS covers its fixture comments`, () => {
      const covered = matchingRaws.some((raw) =>
        JAVA_TOOL_MARKERS.some((markerRe) => markerRe.test(commentInnerText(raw))),
      );
      expect(covered, `MUST_KEEP ${keepRe}: no JAVA_TOOL_MARKERS regex matches fixture comments (marker deleted?)`).toBe(true);
    });
  }
});

describe("strip-safety identity (java)", () => {
  const javaFixtures = allFixtures.filter((f) => f.lang === "java");

  for (const f of javaFixtures) {
    const base = path.basename(f.fixturePath);

    it(`identity: ${base} Javadoc and tool-marker comments survive strip`, async () => {
      const text = readFileSync(f.fixturePath, "utf8");
      const lang = "java" as Language;
      const rows = new Set(text.split("\n").map((_, i) => i));
      const pfp = parserForPath(getParser, f.fixturePath);
      const ar = await autoFix(text, lang, rows, pfp, rows);
      expect(ar.ok, `autoFix failed: ${!ar.ok ? (ar as { reason: string }).reason : ""}`).toBe(true);
      if (!ar.ok) return;
      const fixed = ar.fixed;

      // Javadoc block must survive byte-identical.
      for (const m of text.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
        expect(fixed, `Javadoc block missing after strip: "${m[0].slice(0, 60)}"`).toContain(m[0]);
      }

      // License header block must survive byte-identical.
      const headerMatch = text.match(/^\/\*[\s\S]*?\*\//);
      if (headerMatch) {
        expect(fixed, "license header block missing after strip").toContain(headerMatch[0]);
      }

      // Every tool-marker comment must survive by exact text.
      const toolMarkerTexts: string[] = [];
      for (const raw of extractRawComments(text)) {
        if ((MUST_KEEP.java ?? []).some((re) => re.test(raw))) {
          toolMarkerTexts.push(raw);
        }
      }
      for (const marker of toolMarkerTexts) {
        expect(fixed, `tool-marker comment missing after strip: "${marker}"`).toContain(marker);
      }
    });

    it(`identity: ${base} text block and string literals survive strip unchanged`, async () => {
      const text = readFileSync(f.fixturePath, "utf8");
      const lang = "java" as Language;
      const rows = new Set(text.split("\n").map((_, i) => i));
      const pfp = parserForPath(getParser, f.fixturePath);
      const ar = await autoFix(text, lang, rows, pfp, rows);
      expect(ar.ok, `autoFix failed: ${!ar.ok ? (ar as { reason: string }).reason : ""}`).toBe(true);
      if (!ar.ok) return;
      const fixed = ar.fixed;

      // Text blocks must survive byte-identical.
      for (const m of text.matchAll(/"""[\s\S]*?"""/g)) {
        expect(fixed, `text block changed or missing after strip: "${m[0].slice(0, 60)}"`).toContain(m[0]);
      }

      // String literals with comment-like content must survive.
      const commentLikeStrings = ['"// not a comment"'];
      for (const s of commentLikeStrings) {
        if (text.includes(s)) {
          expect(fixed, `string literal missing after strip: ${s}`).toContain(s);
        }
      }
    });
  }
});

// Extracts raw Python #-style comments (may include false positives from inside strings;
// MUST_KEEP patterns are specific enough that those do not trigger parity failures).
function extractPyRawComments(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/#[^\n]*/g)) out.push(m[0]);
  return out;
}

const allPyRawComments: string[] = [];
for (const f of allFixtures.filter((f) => f.lang === "python")) {
  allPyRawComments.push(...extractPyRawComments(readFileSync(f.fixturePath, "utf8")));
}

describe("strip-safety marker↔MUST_KEEP parity (python)", () => {
  const mustKeepPy = MUST_KEEP.python ?? [];

  it("python fixture list is non-empty", () => {
    expect(allPyRawComments.length, "python fixture must contain at least one raw comment").toBeGreaterThan(0);
  });

  it("positive control: nosec covered, NONEXISTENT_PYTHON_MARKER_XYZ not covered", () => {
    const nosecRe = /^nosec\b/;
    const nosecCovered = allPyRawComments.some(
      (raw) => nosecRe.test(commentInnerText(raw)) && mustKeepPy.some((re) => re.test(raw)),
    );
    expect(nosecCovered, "nosec marker must be covered by a MUST_KEEP.python pattern").toBe(true);

    const fakeRe = /^NONEXISTENT_PYTHON_MARKER_XYZ_FAKE_99999/;
    const fakeCovered = allPyRawComments.some(
      (raw) => fakeRe.test(commentInnerText(raw)) && mustKeepPy.some((re) => re.test(raw)),
    );
    expect(fakeCovered, "NONEXISTENT_PYTHON_MARKER must NOT be covered (verifying the test can detect a miss)").toBe(false);
  });

  for (const markerRe of PYTHON_TOOL_MARKERS) {
    it(`marker↔MUST_KEEP: ${markerRe} covered by fixture+MUST_KEEP`, () => {
      const covered = allPyRawComments.some((raw) => {
        const inner = commentInnerText(raw);
        return markerRe.test(inner) && mustKeepPy.some((re) => re.test(raw));
      });
      expect(covered, `no python fixture comment covers PYTHON_TOOL_MARKERS ${markerRe}`).toBe(true);
    });
  }

  for (const keepRe of mustKeepPy) {
    const matchingRaws = allPyRawComments.filter((raw) => keepRe.test(raw));
    if (matchingRaws.length === 0) continue;
    it(`MUST_KEEP ${keepRe} → PYTHON_TOOL_MARKERS covers its fixture comments`, () => {
      const covered = matchingRaws.some((raw) => {
        const inner = commentInnerText(raw);
        return PYTHON_TOOL_MARKERS.some((re) => re.test(inner)) || PEP263_CODING_RE.test(inner);
      });
      expect(covered, `MUST_KEEP ${keepRe}: no PYTHON_TOOL_MARKERS regex matches fixture comments (marker deleted?)`).toBe(true);
    });
  }
});

describe("strip-safety identity (python)", () => {
  const pythonFixtures = allFixtures.filter((f) => f.lang === "python");

  for (const f of pythonFixtures) {
    const base = path.basename(f.fixturePath);

    it(`identity: ${base} docstrings and tool-marker comments survive strip`, async () => {
      const text = readFileSync(f.fixturePath, "utf8");
      const lang = "python" as Language;
      const rows = new Set(text.split("\n").map((_, i) => i));
      const pfp = parserForPath(getParser, f.fixturePath);
      const ar = await autoFix(text, lang, rows, pfp, rows);
      expect(ar.ok, `autoFix failed: ${!ar.ok ? (ar as { reason: string }).reason : ""}`).toBe(true);
      if (!ar.ok) return;
      const fixed = ar.fixed;

      // Every tool-marker comment must survive by exact text.
      const toolMarkerTexts: string[] = [];
      for (const raw of extractPyRawComments(text)) {
        if ((MUST_KEEP.python ?? []).some((re) => re.test(raw))) {
          toolMarkerTexts.push(raw);
        }
      }
      for (const marker of toolMarkerTexts) {
        expect(fixed, `tool-marker comment missing after strip: "${marker}"`).toContain(marker);
      }
    });

    it(`identity: ${base} strings containing # survive strip unchanged`, async () => {
      const text = readFileSync(f.fixturePath, "utf8");
      const lang = "python" as Language;
      const rows = new Set(text.split("\n").map((_, i) => i));
      const pfp = parserForPath(getParser, f.fixturePath);
      const ar = await autoFix(text, lang, rows, pfp, rows);
      expect(ar.ok, `autoFix failed: ${!ar.ok ? (ar as { reason: string }).reason : ""}`).toBe(true);
      if (!ar.ok) return;
      const fixed = ar.fixed;

      // String literals with comment-like content must survive.
      const commentLikeStrings = ['"items: # not a comment here"', '"total=2 # still not a real comment"'];
      for (const s of commentLikeStrings) {
        if (text.includes(s)) {
          expect(fixed, `string literal missing after strip: ${s}`).toContain(s);
        }
      }
    });
  }
});

describe("strip-safety JSX expression container cleanup", () => {
  const tsxGrammarFixtures = allFixtures.filter(
    (f) => f.lang === "typescript" && f.wasm === "tree-sitter-tsx.wasm",
  );

  for (const f of tsxGrammarFixtures) {
    const base = path.basename(f.fixturePath);
    it(`strip-safety: ${base} [tree-sitter-tsx.wasm] (AC5) no empty {} after strip, no new errorRows`, async () => {
      const text = readFileSync(f.fixturePath, "utf8");
      const lang = "typescript" as Language;
      const rows = new Set(text.split("\n").map((_, i) => i));
      const pfp = parserForPath(getParser, f.fixturePath);
      const ar = await autoFix(text, lang, rows, pfp, rows);
      expect(ar.ok, `autoFix failed: ${!ar.ok ? (ar as { reason: string }).reason : ""}`).toBe(true);
      if (!ar.ok) return;
      expect(ar.fixed, "empty {} container remaining after strip").not.toMatch(/\{\s*\}/);
      const preResult = await sf.get(lang, text, f.fixturePath);
      const postResult = await sf.get(lang, ar.fixed, f.fixturePath);
      expect(postResult.ok, "post-strip parse failed").toBe(true);
      if (postResult.ok && preResult.ok) {
        const newErrors = [...postResult.source.errorRows].filter(r => !preResult.source.errorRows.has(r));
        expect(newErrors, "errorRows introduced by strip").toHaveLength(0);
      }
    });
  }
});
