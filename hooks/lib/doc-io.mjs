/**
 * doc-io.mjs — I/O helpers for the doc CLI.
 *
 * READ-ONLY guarantee (AC 8): this module never opens any file for writing,
 * appending, or truncating. All fs calls use readFileSync / readdirSync / statSync.
 *
 * Token estimation (AC 2, 5): Math.ceil(byteLength / 3.5) — intentionally
 * duplicated from the approach in hooks/spec.mjs (byteSize / 3.5) rather than
 * imported from spec-io.mjs, because peer agents may be editing that file
 * concurrently (RFC-0001 T12/T5). Numbers produced here are therefore
 * comparable with spec show output.
 *
 * Doc-class table — budget provenance:
 *
 *   Class         Path pattern                                    Budget (tokens)  Source
 *   -----------   --------------------------------------------    ---------------  ------
 *   root-doc      {CLAUDE,AGENTS,README}.md at repo root          12 000           DERIVED
 *   skill         skills/** /SKILL.md                              6 000           DERIVED
 *   prd           docs/prds/** /*.md                                3 000           DERIVED
 *   plan          docs/plans/** /*.md                               2 000           DERIVED
 *   rfc-index     .groundwork/rfcs/** /rfc.md                      12 000           DERIVED (see note)
 *   rfc-section   .groundwork/rfcs/** /sections/** /*.md            6 000           DERIVED (see note)
 *   narrative     docs/*.md  (top-level only, no subdirs)          2 000           DERIVED
 *
 * ALL budgets are DERIVED (calibrated from observed file sizes or by analogy
 * with peer classes). NONE are quoted from a spec or formal decision record.
 * A reviewer who can source any of these from a real requirement should update
 * the source column and remove this notice for that row.
 *
 * Budget rationale (T20 additions):
 *   rfc-index (DERIVED): post-split rfc.md ≈ frontmatter (~9 841 tok measured)
 *   + manifest/abstract (~1 500 tok) ≈ 11 300 tok total. 12 000 is set by
 *   analogy with the root-doc class and gives ~6 % headroom. This budget WILL
 *   fire on the current un-split rfc.md (~53 427 tok) — that is intentional;
 *   the guard is supposed to deny wholesale reads of the monolith.
 *   rfc-section (DERIVED): largest measured RFC-0001 leaf section is ~4 351 tok
 *   (§8). 6 000 = the existing skill budget, leaves ~40 % headroom over the
 *   worst real section, and fires before a section becomes unreadable. Matches
 *   the skill class value by analogy; not spec-sourced.
 *
 * Anything that does not match any of the above is "unclassified" and is
 * excluded from linting (AC 9). The unclassified path is genuinely reachable
 * (e.g. doc/specs/README.md, any generated file, or a random .md in a plugin
 * directory) — it is not a catch-all that swallows everything.
 *
 * Summary-header block definition (AC 3): all content from the start of the
 * file up to (but not including) the first ## heading, with trailing blank
 * lines stripped. Typically this is the # title plus any introductory prose.
 * If no ## heading exists, the entire file is the summary header.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, basename, dirname } from 'node:path'

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/**
 * Estimate token cost of a string.
 * Uses Math.ceil(utf8-byte-length / 3.5) — same ratio as spec.mjs line ~421.
 */
export function estimateTokens(content) {
  return Math.ceil(Buffer.byteLength(content, 'utf8') / 3.5)
}

// ---------------------------------------------------------------------------
// Doc-class registry
// ---------------------------------------------------------------------------

export const DOC_CLASSES = [
  {
    name: 'root-doc',
    budget: 12000,
    match: (rel) => dirname(rel) === '.' && /^(CLAUDE|AGENTS|README)\.md$/.test(basename(rel)),
  },
  {
    name: 'skill',
    budget: 6000,
    match: (rel) => /^skills[/\\].*[/\\]SKILL\.md$/.test(rel),
  },
  {
    name: 'prd',
    budget: 3000,
    match: (rel) => /^docs[/\\]prds[/\\]/.test(rel) && rel.endsWith('.md'),
  },
  {
    name: 'plan',
    budget: 2000,
    match: (rel) => /^docs[/\\]plans[/\\]/.test(rel) && rel.endsWith('.md'),
  },
  {
    name: 'rfc-index',
    budget: 12000,
    match: (rel) => /^\.groundwork[/\\]rfcs[/\\][^/\\]+[/\\]rfc\.md$/.test(rel),
  },
  {
    name: 'rfc-section',
    budget: 6000,
    match: (rel) => /^\.groundwork[/\\]rfcs[/\\][^/\\]+[/\\]sections[/\\].+\.md$/.test(rel),
  },
  {
    name: 'narrative',
    budget: 2000,
    match: (rel) => /^docs[/\\][^/\\]+\.md$/.test(rel),
  },
]

/**
 * Classify an absolute path against the doc-class registry.
 * Returns { name, budget } or null if unclassified.
 * @param {string} absPath
 * @param {string} rootDir  — project root used to compute relative path
 */
export function classifyDoc(absPath, rootDir) {
  const rel = relative(rootDir, absPath).replace(/\\/g, '/')
  for (const cls of DOC_CLASSES) {
    if (cls.match(rel)) return { name: cls.name, budget: cls.budget }
  }
  return null
}

// ---------------------------------------------------------------------------
// Section parsing
// ---------------------------------------------------------------------------

/**
 * Convert a markdown heading text to a URL-style anchor slug.
 * Lowercases, strips non-word characters, collapses spaces to hyphens.
 */
export function headingToAnchor(heading) {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

/**
 * Parse a markdown file's sections.
 * Returns an array of:
 *   { anchor: string, heading: string, level: number, body: string, startLine: number }
 *
 * "body" is the text after the heading line and before the next same-or-higher heading.
 */
export function parseSections(content) {
  const lines = content.split('\n')
  const sections = []
  let current = null
  let bodyLines = []

  function flush() {
    if (current) {
      current.body = bodyLines.join('\n').trimEnd()
      sections.push(current)
    }
    bodyLines = []
  }

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+)$/)
    if (m) {
      flush()
      current = {
        anchor: headingToAnchor(m[2].trim()),
        heading: m[2].trim(),
        level: m[1].length,
        body: '',
        startLine: i + 1,
      }
    } else {
      bodyLines.push(lines[i])
    }
  }
  flush()
  return sections
}

/**
 * Extract the summary header block.
 * Definition: all content from the start of the file up to (but not including)
 * the first ## heading, with trailing blank lines stripped.
 * This typically encompasses the # title line plus any opening paragraphs.
 * Returns the block as a string (may be empty if the file starts with ##).
 */
export function extractSummaryHeader(content) {
  const lines = content.split('\n')
  const result = []
  for (const line of lines) {
    if (/^##\s/.test(line)) break
    result.push(line)
  }
  // Strip trailing blank lines
  while (result.length > 0 && result[result.length - 1].trim() === '') {
    result.pop()
  }
  return result.join('\n')
}

/**
 * Check structural elements of a document.
 * Returns:
 *   hasSummaryHeader  — true if there is non-empty content before the first ##
 *   hasSectionAnchor  — true if there is at least one ## (or deeper) heading
 */
export function checkStructure(content) {
  const summaryHeader = extractSummaryHeader(content)
  const sections = parseSections(content).filter((s) => s.level >= 2)
  return {
    hasSummaryHeader: summaryHeader.trim().length > 0,
    hasSectionAnchor: sections.length > 0,
  }
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

/**
 * Recursively collect all .md files under a directory.
 * Skips hidden directories (leading dot).
 */
export function walkMdFiles(dir) {
  const results = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return results
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      results.push(...walkMdFiles(full))
    } else if (e.isFile() && e.name.endsWith('.md')) {
      results.push(full)
    }
  }
  return results
}

/**
 * Discover all doc-class files in the repo.
 *
 * Searches:
 *   - root-level .md files (non-recursive, for root-doc class)
 *   - docs/ tree
 *   - skills/ tree
 *
 * Returns:
 *   classified:   [{ absPath, relPath, cls: { name, budget } }]
 *   unclassified: [absPath]
 *
 * Files in doc/specs/ are intentionally not classified (spec nodes are managed
 * by the spec CLI) — they will appear in unclassified if encountered.
 */
export function findDocFiles(rootDir) {
  const seen = new Set()
  const allPaths = []

  // Root-level .md files only (non-recursive scan)
  try {
    const entries = readdirSync(rootDir, { withFileTypes: true })
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.md')) {
        const full = join(rootDir, e.name)
        if (!seen.has(full)) { seen.add(full); allPaths.push(full) }
      }
    }
  } catch { /* ignore */ }

  // docs/ tree
  const docsDir = join(rootDir, 'docs')
  if (existsSync(docsDir)) {
    for (const p of walkMdFiles(docsDir)) {
      if (!seen.has(p)) { seen.add(p); allPaths.push(p) }
    }
  }

  // doc/ tree (spec files live under doc/specs/ and are intentionally unclassified)
  const docDir = join(rootDir, 'doc')
  if (existsSync(docDir)) {
    for (const p of walkMdFiles(docDir)) {
      if (!seen.has(p)) { seen.add(p); allPaths.push(p) }
    }
  }

  // skills/ tree
  const skillsDir = join(rootDir, 'skills')
  if (existsSync(skillsDir)) {
    for (const p of walkMdFiles(skillsDir)) {
      if (!seen.has(p)) { seen.add(p); allPaths.push(p) }
    }
  }

  // .groundwork/rfcs/ tree (explicit — walkMdFiles skips hidden dirs by default)
  const rfcsDir = join(rootDir, '.groundwork', 'rfcs')
  if (existsSync(rfcsDir)) {
    for (const p of walkMdFiles(rfcsDir)) {
      if (!seen.has(p)) { seen.add(p); allPaths.push(p) }
    }
  }

  const classified = []
  const unclassified = []
  for (const absPath of allPaths) {
    const cls = classifyDoc(absPath, rootDir)
    if (cls) {
      classified.push({
        absPath,
        relPath: relative(rootDir, absPath).replace(/\\/g, '/'),
        cls,
      })
    } else {
      unclassified.push(absPath)
    }
  }
  return { classified, unclassified }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Search doc-class files for a query string (case-insensitive).
 * Returns at most one match per file (the first matching line).
 * Result items: { relPath, cls, excerpt, lineNum }
 */
export function searchDocs(rootDir, query) {
  const { classified } = findDocFiles(rootDir)
  const lq = query.toLowerCase()
  const matches = []

  for (const { absPath, relPath, cls } of classified) {
    let content
    try {
      content = readFileSync(absPath, 'utf8')
    } catch { continue }

    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(lq)) {
        matches.push({
          relPath,
          cls: cls.name,
          excerpt: lines[i].trim().slice(0, 100),
          lineNum: i + 1,
        })
        break
      }
    }
  }
  return matches
}
