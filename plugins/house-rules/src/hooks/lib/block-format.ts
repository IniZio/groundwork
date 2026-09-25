export interface BlockSection {
  label?: string;
  lines: string[];
  footer: string;
}

export interface BlockInput {
  header: string;
  sections: BlockSection[];
  notices: string[];
  fixedFiles: string[];
  suffix: string | null;
}

// Trim items so sum(1 + item.length) for kept items + suffix ≤ budget.
// Reserves worst-case suffix space upfront to avoid digit-growth overflow.
function trimLineList(items: string[], budget: number): string[] {
  if (items.length === 0 || budget <= 0) return [];
  const worstSuffix = `  … ${items.length} more`;
  const worstSuffixCost = 1 + worstSuffix.length;
  let used = 0, kept = 0;
  for (let i = 0; i < items.length; i++) {
    const cost = 1 + items[i].length;
    const isLast = i === items.length - 1;
    if (used + cost + (isLast ? 0 : worstSuffixCost) <= budget) {
      used += cost; kept++;
    } else break;
  }
  if (kept === items.length) return items;
  const suffix = `  … ${items.length - kept} more`;
  if (1 + suffix.length > budget) return [];
  return [...items.slice(0, kept), suffix];
}

// Returns "auto-fixed in this run: a, b, … N more" trimmed so 1+note.length ≤ budget.
function trimFixedNote(files: string[], budget: number): string | null {
  if (files.length === 0 || budget <= 0) return null;
  const prefix = "auto-fixed in this run: ";
  const worstSuffix = `… ${files.length} more`;
  let result = prefix;
  let kept = 0;
  for (let i = 0; i < files.length; i++) {
    const add = i === 0 ? files[i] : ", " + files[i];
    const isLast = i === files.length - 1;
    if (isLast) {
      if (1 + result.length + add.length <= budget) { result += add; kept++; }
      break;
    } else {
      if (1 + result.length + add.length + (", " + worstSuffix).length <= budget) {
        result += add; kept++;
      } else break;
    }
  }
  if (kept === files.length) return result;
  const suffix = `… ${files.length - kept} more`;
  if (kept === 0) {
    const minimal = prefix + suffix;
    return 1 + minimal.length <= budget ? minimal : null;
  }
  return result + ", " + suffix;
}

function buildFull(
  header: string,
  sects: Array<{ label?: string; lines: string[]; footer: string }>,
  notices: string[],
  fixedFiles: string[],
): string {
  const parts: string[] = [header];
  for (let i = 0; i < sects.length; i++) {
    const s = sects[i];
    if (s.label) parts.push(s.label);
    parts.push(...s.lines);
    if (i === 0) {
      parts.push(...notices);
      if (fixedFiles.length > 0) {
        parts.push("auto-fixed in this run: " + fixedFiles.join(", "));
      }
    }
    parts.push(s.footer);
  }
  return parts.join("\n");
}

type GroupKind = "lines" | "notices" | "fixed";
interface Group { kind: GroupKind; sectionIdx: number; items: string[] }

function naturalCost(g: Group): number {
  if (g.kind === "fixed") {
    return 1 + ("auto-fixed in this run: " + g.items.join(", ")).length;
  }
  return g.items.reduce((s, item) => s + 1 + item.length, 0);
}

function minCost(g: Group): number {
  if (g.items.length === 0) return 0;
  if (g.kind === "fixed") {
    const prefix = "auto-fixed in this run: ";
    const suf = g.items.length > 1 ? `, … ${g.items.length} more` : "";
    return 1 + prefix.length + g.items[0].length + suf.length;
  }
  const suf = g.items.length > 1 ? `  … ${g.items.length} more` : "";
  return (1 + g.items[0].length) + (suf ? 1 + suf.length : 0);
}

export function formatBlock(input: BlockInput, limit = 2000): string {
  const { header, sections, notices, fixedFiles, suffix } = input;

  const sects = sections.map((s, i) => ({
    label: s.label,
    lines: s.lines,
    footer: i === sections.length - 1 ? s.footer + (suffix ?? "") : s.footer,
  }));

  const full = buildFull(header, sects, notices, fixedFiles);
  if (full.length <= limit) return full;

  // Mandatory cost: header + labels + footers (each after header costs 1 + len).
  let mandatoryCost = header.length;
  for (const s of sects) {
    if (s.label) mandatoryCost += 1 + s.label.length;
    mandatoryCost += 1 + s.footer.length;
  }
  const available = limit - mandatoryCost;

  // Variable groups in output order.
  const groups: Group[] = [];
  for (let i = 0; i < sects.length; i++) {
    if (sects[i].lines.length > 0) groups.push({ kind: "lines", sectionIdx: i, items: sects[i].lines });
    if (i === 0) {
      if (notices.length > 0) groups.push({ kind: "notices", sectionIdx: 0, items: notices });
      if (fixedFiles.length > 0) groups.push({ kind: "fixed", sectionIdx: 0, items: fixedFiles });
    }
  }

  const sumMin = groups.reduce((s, g) => s + minCost(g), 0);
  const canGuaranteeMin = available >= 0 && sumMin <= available;

  let budgetLeft = Math.max(0, available);
  let naturalLeft = groups.reduce((s, g) => s + naturalCost(g), 0);
  const trimResults: Array<string[] | string | null> = [];

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const nat = naturalCost(g);
    const prop = naturalLeft > 0 ? Math.floor(budgetLeft * nat / naturalLeft) : 0;
    const allotted = canGuaranteeMin ? Math.max(prop, minCost(g)) : prop;
    const capped = Math.min(allotted, budgetLeft);

    let result: string[] | string | null;
    let actualUsed: number;

    if (g.kind === "fixed") {
      const note = trimFixedNote(g.items, capped);
      result = note;
      actualUsed = note !== null ? 1 + note.length : 0;
    } else {
      const trimmed = trimLineList(g.items, capped);
      result = trimmed;
      actualUsed = trimmed.reduce((s, item) => s + 1 + item.length, 0);
    }

    trimResults.push(result);
    budgetLeft -= actualUsed;
    naturalLeft -= nat;
  }

  // Assemble trimmed output.
  const outputParts: string[] = [header];
  let gi = 0;
  for (let si = 0; si < sects.length; si++) {
    const s = sects[si];
    if (s.label) outputParts.push(s.label);
    if (gi < groups.length && groups[gi].kind === "lines" && groups[gi].sectionIdx === si) {
      outputParts.push(...(trimResults[gi] as string[]));
      gi++;
    }
    if (si === 0) {
      if (gi < groups.length && groups[gi].kind === "notices") {
        outputParts.push(...(trimResults[gi] as string[]));
        gi++;
      }
      if (gi < groups.length && groups[gi].kind === "fixed") {
        const note = trimResults[gi] as string | null;
        if (note !== null) outputParts.push(note);
        gi++;
      }
    }
    outputParts.push(s.footer);
  }

  const result = outputParts.join("\n");
  return result.length <= limit ? result : result.slice(0, limit);
}
