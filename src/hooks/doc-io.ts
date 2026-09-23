/**
 * Shared doc-classification and structure utilities for doc-read-guard and doc-size-guard.
 *
 * Token estimation: Math.ceil(utf8-byte-length / 3.5) — same ratio as v1 hooks/lib/doc-io.mjs.
 *
 * Doc-class table:
 *   root-doc    {CLAUDE,AGENTS,README}.md at repo root   budget 12 000
 *   skill       skills/ ** /SKILL.md                       budget  6 000
 *   plan        .groundwork/plans/ ** /*.md                budget  3 000
 *   rfc-index   .groundwork/rfcs/ ** /rfc.md               budget 12 000
 *   rfc-section .groundwork/rfcs/ ** /sections/ ** /*.md    budget  6 000
 *   narrative   doc/*.md  (top-level only)                budget  2 000
 */

import { relative, dirname, basename } from "node:path";

export interface DocClass { name: string; budget: number }

type Matcher = (rel: string) => boolean;

const CLASSES: Array<DocClass & { match: Matcher }> = [
  {
    name: "root-doc",
    budget: 12000,
    match: (rel) => dirname(rel) === "." && /^(CLAUDE|AGENTS|README)\.md$/.test(basename(rel)),
  },
  {
    name: "skill",
    budget: 6000,
    match: (rel) => /^skills[/\\].*[/\\]SKILL\.md$/.test(rel),
  },
  {
    name: "plan",
    budget: 3000,
    match: (rel) => /^\.groundwork[/\\]plans[/\\]/.test(rel) && rel.endsWith(".md"),
  },
  {
    name: "rfc-index",
    budget: 12000,
    match: (rel) => /^\.groundwork[/\\]rfcs[/\\][^/\\]+[/\\]rfc\.md$/.test(rel),
  },
  {
    name: "rfc-section",
    budget: 6000,
    match: (rel) => /^\.groundwork[/\\]rfcs[/\\][^/\\]+[/\\]sections[/\\].+\.md$/.test(rel),
  },
  {
    name: "narrative",
    budget: 2000,
    match: (rel) => /^doc[/\\][^/\\]+\.md$/.test(rel),
  },
];

export { CLASSES as DOC_CLASSES };

/** Classify an absolute path. Returns { name, budget } or null if unclassified. */
export function classifyDoc(absPath: string, rootDir: string): DocClass | null {
  const rel = relative(rootDir, absPath).replace(/\\/g, "/");
  for (const cls of CLASSES) {
    if (cls.match(rel)) return { name: cls.name, budget: cls.budget };
  }
  return null;
}

/** Estimate tokens: ceil(utf8-byte-length / 3.5). */
export function estimateTokens(content: string): number {
  if (!content) return 0;
  return Math.ceil(Buffer.byteLength(content, "utf8") / 3.5);
}

/** Check structural completeness of doc content. */
export function checkStructure(content: string): { hasSummaryHeader: boolean; hasSectionAnchor: boolean } {
  const lines = content.split(/\r?\n/);
  // hasSummaryHeader: content before the first ## heading is non-empty
  const firstH2 = lines.findIndex((l) => /^##/.test(l));
  const pre = firstH2 < 0 ? content : lines.slice(0, firstH2).join("\n");
  const hasSummaryHeader = pre.trim().length > 0;
  // hasSectionAnchor: at least one ## heading exists
  const hasSectionAnchor = lines.some((l) => /^##/.test(l));
  return { hasSummaryHeader, hasSectionAnchor };
}
