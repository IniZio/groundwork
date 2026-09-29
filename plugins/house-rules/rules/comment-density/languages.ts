/**
 * Per-language hook table for the comment-density rule.
 *
 * Justification for placement: behaviour a single rule needs for a single
 * language lives inside that rule (not in src/hooks/languages/, which is the
 * shared language-adapter layer). This file is the authoritative source for
 * Go-specific comment-removal semantics (grouping, protection, repair) and for
 * the fix-stability/applicability metadata that gate.ts reads via fixEntryFor.
 *
 * ESM cycle note: comment-density.ts imports COMMENT_DENSITY_LANGUAGE_HOOKS
 * from here, and we import isExemptProse/NOTE_MARKER_RE/URL_RE from
 * comment-density.ts. To avoid top-level initialisation ordering issues, those
 * imported bindings are only referenced INSIDE function bodies (never at module
 * top level). ESM live bindings are fully resolved by first call time.
 */

import type { Language } from "../../src/hooks/languages/registry.js";
import type { Comment, RowChange } from "../../src/hooks/lib/comment-density.js";
// Cycle-safe: only reference these inside function bodies, never at top level.
import { isExemptProse, NOTE_MARKER_RE } from "../../src/hooks/lib/comment-density.js";
import { commentInnerText as stripMarkers, isWholeLine } from "../../src/hooks/languages/comments.js";

export type FixStability = "preview" | "stable";
export type FixApplicability = "safe" | "unsafe";

export interface FixEntry {
  stability: FixStability;
  applicability: FixApplicability;
}

export interface RemovalGrouping {
  groups(comments: Comment[], groupOf: Map<number, number | null>, text: string): Comment[][];
  protectedCandidates(candidates: Comment[], groups: Comment[][], comments: Comment[], text: string): Set<number>;
  units(removable: Comment[], groups: Comment[][], text: string): Comment[][];
}

export interface CommentDensityLanguageHook {
  stability?: FixStability;          // absent => "preview"
  applicability?: FixApplicability;  // absent => "safe"
  removalGrouping?: RemovalGrouping; // absent => pipeline default grouping
  repairAfterStrip?(original: string, stripped: string, rowChanges: RowChange[]): string; // absent => identity
}

// ---------------------------------------------------------------------------
// Go helpers (moved from comment-density.ts)
// ---------------------------------------------------------------------------

function normalizeGoInlineArtifacts(fixed: string, rowChanges: RowChange[]): string {
  const modifiedRows = rowChanges.filter(rc => rc.kind === "modified");
  if (modifiedRows.length === 0) return fixed;

  const deletedOrigRows = rowChanges
    .filter(rc => rc.kind === "deleted")
    .map(rc => rc.origRow)
    .sort((a, b) => a - b);

  function deletedBefore(origRow: number): number {
    let lo = 0, hi = deletedOrigRows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (deletedOrigRows[mid] < origRow) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function repairLine(orig: string, fix: string): string {
    const out: string[] = [];
    let oi = 0, fi = 0;
    while (fi < fix.length) {
      if (oi < orig.length && orig[oi] === fix[fi]) {
        out.push(fix[fi]); oi++; fi++; continue;
      }
      if (oi >= orig.length) { out.push(fix[fi]); fi++; continue; }

      // At a divergence: only advance orig past whitespace or comment spans.
      if (orig[oi] === " " || orig[oi] === "\t") { oi++; continue; }

      if (orig[oi] === "/" && oi + 1 < orig.length && orig[oi + 1] === "*") {
        oi += 2;
        while (oi + 1 < orig.length && !(orig[oi] === "*" && orig[oi + 1] === "/")) oi++;
        oi = Math.min(oi + 2, orig.length);
        let peek = fi;
        while (peek < fix.length && (fix[peek] === " " || fix[peek] === "\t")) peek++;
        const nxt = peek < fix.length ? fix[peek] : "";
        if (nxt === "," || nxt === ")") {
          fi = peek;
          while (out.length > 0 && out[out.length - 1] === " ") out.pop();
        } else if (nxt === "}") {
          let k = out.length - 1;
          while (k >= 0 && out[k] === " ") k--;
          if (k >= 0 && out[k] === "{") { out.splice(k + 1); fi = peek; }
        }
        continue;
      }

      if (orig[oi] === "/" && oi + 1 < orig.length && orig[oi + 1] === "/") {
        oi = orig.length; continue;
      }

      return fix.replace(/\s+$/, "");
    }
    return out.join("").replace(/\s+$/, "");
  }

  const lines = fixed.split("\n");
  for (const rc of modifiedRows) {
    const newIdx = rc.origRow - deletedBefore(rc.origRow);
    if (newIdx < 0 || newIdx >= lines.length) continue;
    lines[newIdx] = repairLine(rc.origText ?? "", lines[newIdx]);
  }

  return lines.join("\n");
}

function normalizeGoRemovalWhitespace(
  origText: string,
  fixed: string,
  rowChanges: RowChange[],
): string {
  const deletedOrigRows = rowChanges
    .filter(rc => rc.kind === "deleted")
    .map(rc => rc.origRow)
    .sort((a, b) => a - b);
  if (deletedOrigRows.length === 0) return fixed;

  const origLines = origText.split("\n");
  const isBlank = (s: string | undefined) => (s ?? "").trim() === "";

  function deletedBefore(origRow: number): number {
    let lo = 0, hi = deletedOrigRows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (deletedOrigRows[mid] < origRow) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  const collapseSites = new Set<number>();

  let i = 0;
  while (i < deletedOrigRows.length) {
    const lo = deletedOrigRows[i];
    let hi = lo;
    while (i + 1 < deletedOrigRows.length && deletedOrigRows[i + 1] === hi + 1) {
      i++;
      hi = deletedOrigRows[i];
    }
    const beforeBlank = lo > 0 && isBlank(origLines[lo - 1]);
    const afterBlank = isBlank(origLines[hi + 1]);
    if (beforeBlank && afterBlank) {
      const db = deletedBefore(lo);
      const clusterSize = hi - lo + 1;
      const finalAfter = hi + 1 - (db + clusterSize);
      collapseSites.add(finalAfter);
    }
    i++;
  }

  if (collapseSites.size === 0) return fixed;

  const fixedLines = fixed.split("\n");
  const result: string[] = [];
  for (let j = 0; j < fixedLines.length; j++) {
    const blank = fixedLines[j].trim() === "";
    const prevBlank = result.length > 0 && result[result.length - 1].trim() === "";
    if (blank && prevBlank && collapseSites.has(j)) continue;
    result.push(fixedLines[j]);
  }
  return result.join("\n");
}

// ---------------------------------------------------------------------------
// Go removal grouping
// ---------------------------------------------------------------------------

const goRemovalGrouping: RemovalGrouping = {
  groups(comments, groupOf, _text): Comment[][] {
    const withGroup = comments
      .filter(c => (groupOf.get(c.startIndex) ?? null) !== null)
      .sort((a, b) => a.startRow - b.startRow);
    const groups: Comment[][] = [];
    let cur: Comment[] = [];
    let curGroupId: number | null = null;
    for (const c of withGroup) {
      const gid = groupOf.get(c.startIndex) ?? null;
      const prev = cur.length > 0 ? cur[cur.length - 1] : null;
      if (cur.length === 0 || gid !== curGroupId || (prev !== null && c.startRow !== prev.endRow + 1)) {
        if (cur.length > 0) groups.push(cur);
        cur = [c];
        curGroupId = gid;
      } else {
        cur.push(c);
      }
    }
    if (cur.length > 0) groups.push(cur);
    return groups;
  },

  protectedCandidates(candidates, groups, _comments, _text): Set<number> {
    // isExemptProse and NOTE_MARKER_RE are referenced here (function body),
    // not at module top level — cycle-safe per ESM live-binding semantics.
    const candIndices = new Set(candidates.map(c => c.startIndex));
    const result = new Set<number>();

    // Group-based exempt-prose protection (Go variant of paragraphProtectedSet).
    for (const group of groups) {
      if (!group.some(c => isExemptProse(c))) continue;
      for (const c of group) {
        if (candIndices.has(c.startIndex)) result.add(c.startIndex);
      }
    }

    // Note-marker continuation protection (goNoteContSet semantics).
    const candSet = new Set(candidates.map(c => c.startIndex));
    for (const group of groups) {
      let inNote = false;
      for (const c of group) {
        if (c.exempt && NOTE_MARKER_RE.test(stripMarkers(c.text))) {
          inNote = true;
          continue;
        }
        if (c.exempt) {
          if (c.exemptReason !== "divider" && c.exemptReason !== "spacer") inNote = false;
          continue;
        }
        if (inNote && candSet.has(c.startIndex)) {
          result.add(c.startIndex);
        }
      }
    }

    return result;
  },

  units(removable, groups, _text): Comment[][] {
    const removableSet = new Set(removable.map(c => c.startIndex));
    const inGoGroup = new Set<number>();
    const orderedUnits: Array<{ startRow: number; comments: Comment[] }> = [];
    for (const group of groups) {
      const groupCands = group.filter(c => removableSet.has(c.startIndex));
      if (groupCands.length > 0) {
        orderedUnits.push({ startRow: groupCands[0].startRow, comments: groupCands });
        for (const c of groupCands) inGoGroup.add(c.startIndex);
      }
    }
    for (const c of removable) {
      if (!inGoGroup.has(c.startIndex)) {
        orderedUnits.push({ startRow: c.startRow, comments: [c] });
      }
    }
    orderedUnits.sort((a, b) => a.startRow - b.startRow);
    return orderedUnits.map(u => u.comments);
  },
};


// ---------------------------------------------------------------------------
// TypeScript removal grouping (pins pre-ticket-12 behaviour)
// ---------------------------------------------------------------------------

const typescriptRemovalGrouping: RemovalGrouping = {
  groups(comments, _groupOf, text): Comment[][] {
    // isWholeLine is from src/hooks/languages/comments.ts — referenced inside
    // function body (cycle-safe per ESM live-binding semantics).
    const wholeLine: Comment[] = [];
    for (const c of comments) {
      if (isWholeLine(text, c.startIndex)) wholeLine.push(c);
    }
    wholeLine.sort((a, b) => a.startRow - b.startRow);
    const groups: Comment[][] = [];
    let cur: Comment[] = [];
    for (const c of wholeLine) {
      if (cur.length === 0 || c.startRow !== cur[cur.length - 1].endRow + 1) {
        if (cur.length > 0) groups.push(cur);
        cur = [c];
      } else {
        cur.push(c);
      }
    }
    if (cur.length > 0) groups.push(cur);
    return groups;
  },

  protectedCandidates(candidates, _groups, comments, text): Set<number> {
    // isExemptProse referenced inside function body — cycle-safe.
    const candIndices = new Set(candidates.map(c => c.startIndex));
    const result = new Set<number>();

    const allSlash: Comment[] = [];
    for (const c of comments) {
      if (!c.text.startsWith("//") || c.startRow !== c.endRow) continue;
      const ls = text.lastIndexOf("\n", c.startIndex - 1) + 1;
      if (text.slice(ls, c.startIndex).trim()) continue;
      allSlash.push(c);
    }
    allSlash.sort((a, b) => a.startRow - b.startRow);

    const paragraphs: Comment[][] = [];
    let cur: Comment[] = [];
    let prevRow = -2;
    for (const c of allSlash) {
      const decoration = c.exemptReason === "divider" || c.exemptReason === "spacer";
      if (c.exempt && !isExemptProse(c) && !decoration) {
        if (cur.length > 0) { paragraphs.push(cur); cur = []; }
        prevRow = -2;
        continue;
      }
      if (c.startRow === prevRow + 1) {
        cur.push(c);
      } else {
        if (cur.length > 0) paragraphs.push(cur);
        cur = [c];
      }
      prevRow = c.startRow;
    }
    if (cur.length > 0) paragraphs.push(cur);

    for (const para of paragraphs) {
      if (!para.some(c => isExemptProse(c))) continue;
      for (const c of para) {
        if (candIndices.has(c.startIndex)) result.add(c.startIndex);
      }
    }
    return result;
  },

  units(removable, _groups, text): Comment[][] {
    const units: Comment[][] = [];
    const wholeLineHeads = new Set<Comment>();
    for (const c of removable) {
      const lineStart = text.lastIndexOf("\n", c.startIndex - 1) + 1;
      const isWL = !text.slice(lineStart, c.startIndex).trim();
      if (isWL && c.text.startsWith("//") && c.startRow === c.endRow) {
        const last = units[units.length - 1];
        if (last && wholeLineHeads.has(last[0]) && c.startRow === last[last.length - 1].endRow + 1) {
          last.push(c);
          continue;
        }
        wholeLineHeads.add(c);
      }
      units.push([c]);
    }
    return units;
  },
};

export const COMMENT_DENSITY_LANGUAGE_HOOKS: Partial<Record<Language, CommentDensityLanguageHook>> = {
  typescript: { stability: "stable", removalGrouping: typescriptRemovalGrouping },
  swift: { stability: "stable", removalGrouping: typescriptRemovalGrouping },
  go: {
    stability: "stable",
    removalGrouping: goRemovalGrouping,
    repairAfterStrip(original, stripped, rowChanges): string {
      return normalizeGoRemovalWhitespace(original, normalizeGoInlineArtifacts(stripped, rowChanges), rowChanges);
    },
  },
  kotlin: { stability: "stable", removalGrouping: typescriptRemovalGrouping },
  java: { stability: "stable", removalGrouping: typescriptRemovalGrouping },
  python: { stability: "stable" },
  make: { stability: "stable" },
  sql: { stability: "stable" },
};

/** Look up the hook entry at call time (never cached). */
export function languageHookFor(lang: Language): CommentDensityLanguageHook {
  return COMMENT_DENSITY_LANGUAGE_HOOKS[lang] ?? {};
}

/** Merge hook fields with defaults. */
export function fixEntryFor(lang: Language): FixEntry {
  const hook = languageHookFor(lang);
  return {
    stability: hook.stability ?? "preview",
    applicability: hook.applicability ?? "safe",
  };
}
