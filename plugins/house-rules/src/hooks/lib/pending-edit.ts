/**
 * Guard-side reconstruction of the post-edit text.
 * Copied verbatim from src/hooks/lib/comment-density.ts (lines ~197-296).
 * De-duplication is a recorded follow-up.
 */

export interface EditInput {
  file_path?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
  content?: string;
  edits?: Array<{ old_string: string; new_string: string; replace_all?: boolean }>;
}

function applyOneEdit(
  text: string,
  oldStr: string,
  newStr: string,
  replaceAll: boolean,
): { post: string; rowRanges: Array<[number, number]> } | null {
  if (!text.includes(oldStr)) return null;

  const rowRanges: Array<[number, number]> = [];

  if (replaceAll) {
    let result = "";
    let searchFrom = 0;
    let lineOffset = 0;
    const oldLines = oldStr.split("\n").length;
    const newLines = newStr.split("\n").length;

    while (true) {
      const idx = text.indexOf(oldStr, searchFrom);
      if (idx === -1) { result += text.slice(searchFrom); break; }
      result += text.slice(searchFrom, idx);
      const rowsBefore = text.slice(0, idx).split("\n").length - 1;
      const startRow = rowsBefore + lineOffset;
      rowRanges.push([startRow, startRow + newLines - 1]);
      lineOffset += newLines - oldLines;
      result += newStr;
      searchFrom = idx + oldStr.length;
    }
    return { post: result, rowRanges };
  } else {
    const idx = text.indexOf(oldStr);
    const rowsBefore = text.slice(0, idx).split("\n").length - 1;
    const newLines = newStr.split("\n").length;
    rowRanges.push([rowsBefore, rowsBefore + newLines - 1]);
    const post = text.slice(0, idx) + newStr + text.slice(idx + oldStr.length);
    return { post, rowRanges };
  }
}

export function reconstructPostEdit(
  tool: string,
  toolInput: EditInput,
  currentFileText: string | null,
): { post: string; changedRows: Set<number> } | null {
  const norm = tool.toLowerCase().replace(/^fast_/, "");

  if (norm === "write") {
    const content = toolInput.content ?? "";
    const changedRows = new Set<number>();
    const postLines = content.split("\n");
    if (currentFileText === null) {
      postLines.forEach((_, i) => changedRows.add(i));
    } else {
      const preLines = currentFileText.split("\n");
      for (let i = 0; i < postLines.length; i++) {
        if (postLines[i] !== preLines[i]) changedRows.add(i);
      }
    }
    return { post: content, changedRows };
  }

  if (norm === "edit") {
    const oldStr = toolInput.old_string ?? "";
    const newStr = toolInput.new_string ?? "";
    const text = currentFileText ?? "";
    const r = applyOneEdit(text, oldStr, newStr, !!toolInput.replace_all);
    if (!r) return null;
    const changedRows = new Set<number>();
    for (const [lo, hi] of r.rowRanges) {
      for (let i = lo; i <= hi; i++) changedRows.add(i);
    }
    return { post: r.post, changedRows };
  }

  if (norm === "multiedit") {
    const edits = toolInput.edits ?? [];
    let text = currentFileText ?? "";
    const changedRows = new Set<number>();
    for (const e of edits) {
      const r = applyOneEdit(text, e.old_string, e.new_string, !!e.replace_all);
      if (!r) return null;
      for (const [lo, hi] of r.rowRanges) {
        for (let i = lo; i <= hi; i++) changedRows.add(i);
      }
      text = r.post;
    }
    return { post: text, changedRows };
  }

  return null;
}
