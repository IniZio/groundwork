import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MigrateResult } from "./migrate.js";

// Old ticket status -> new issue status (+ assignee for the two ready-for-* values).
const STATUS_MAP: Record<string, { status: string; assignee?: string }> = {
  "needs-triage": { status: "triage" },
  "needs-info": { status: "needs-info" },
  "ready-for-agent": { status: "todo", assignee: "agent" },
  "ready-for-human": { status: "todo", assignee: "human" },
  wontfix: { status: "canceled" },
  claimed: { status: "in-progress" },
  resolved: { status: "done" },
};
const ISSUE_STATUSES = new Set(["triage", "needs-info", "todo", "in-progress", "done", "canceled"]);
const TYPE_TAGS: Record<string, string> = { bug: "bug", task: "enhancement", research: "research", prototype: "prototype", grilling: "grilling" };
const MANAGED = new Set(["title", "status", "assignee", "priority", "tags", "parent", "blocked_by", "source", "created"]);

type Conversion = { rel: string; abs: string; text: string; notes: string[]; warnings: string[]; normalise?: boolean };

const CHECKBOX = /^- \[[ xX]\]/;

// Collapses extra blank lines after the frontmatter, and adds an acceptance-criteria heading above a checkbox list
// that follows the description directly. A "# Title" line is not a section heading, so it does not block the insert;
// any "##" or deeper heading before the list (e.g. "## Parent") means the list belongs to that section and is left alone.
function normalise(lines: string[], end: number): { lines: string[]; notes: string[] } {
  const notes: string[] = [];
  let out = lines;
  let blanks = 0;
  while (out[end + blanks]?.trim() === "") blanks++;
  if (blanks > 1) {
    out = [...out.slice(0, end + 1), ...out.slice(end + blanks)];
    notes.push("collapsed blank lines after frontmatter");
  }
  const body = out.slice(end);
  if (!body.some(l => /^##\s+Acceptance criteria\s*$/i.test(l.replace(/\r$/, "")))) {
    const box = body.findIndex(l => CHECKBOX.test(l));
    if (box !== -1 && !body.slice(0, box).some(l => /^#{2,6}\s/.test(l))) {
      out = [...out.slice(0, end + box), "## Acceptance criteria", "", ...out.slice(end + box)];
      notes.push("added ## Acceptance criteria heading");
    }
  }
  return { lines: out, notes };
}

function parseFm(lines: string[]): { fm: Map<string, string>; raw: Map<string, string>; end: number } {
  const fm = new Map<string, string>();
  const raw = new Map<string, string>();
  if (lines[0]?.replace(/\r$/, "") !== "---") return { fm, raw, end: 0 };
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i].replace(/\r$/, "");
    if (l === "---") return { fm, raw, end: i + 1 };
    const kv = /^([A-Za-z_][\w-]*):\s*(.*?)\s*$/.exec(l);
    if (kv) {
      fm.set(kv[1], kv[2].replace(/^(["'])(.*)\1$/, "$2"));
      raw.set(kv[1], lines[i]);
    }
  }
  return { fm: new Map(), raw: new Map(), end: 0 };
}

function headerValue(line: string, key: string): string | undefined {
  const m = new RegExp(`^(?:\\*\\*${key}:\\*\\*|${key}:)\\s*(.*?)\\s*$`).exec(line.replace(/\r$/, ""));
  return m ? m[1] : undefined;
}

const q = (s: string): string => JSON.stringify(s);
const tag = (s: string): string => (/^[A-Za-z][\w-]*$/.test(s) ? s : q(s));
const ymd = (d: Date): string => d.toISOString().slice(0, 10);

function resolveParent(root: string, motive: string, siblings: string[], content: string): string | undefined {
  if (!content || /\s/.test(content.replace(/^\[\[(.*)\]\]$/s, "$1").trim())) return undefined;
  let ref = content.replace(/^\[\[(.*)\]\]$/s, "$1").replace(/[|#].*$/s, "").replace(/^`(.*)`$/, "$1");
  const m = /^(?:\.\/)?\.groundwork\/work\/([^/]+)/.exec(ref);
  if (m) ref = m[1];
  ref = ref.replace(/\/$/, "").replace(/\.md$/, "");
  if (!ref || ref.includes("/")) return undefined;
  const stems = siblings.map(s => s.replace(/\.md$/, ""));
  const num = /^\d{1,2}$/.test(ref) ? ref.padStart(2, "0") : undefined;
  const sib = stems.find(s => s === ref || (num !== undefined && s.startsWith(`${num}-`)));
  if (sib) return sib;
  const work = path.join(root, ".groundwork", "work", ref);
  if (ref === motive || (existsSync(work) && statSync(work).isDirectory())) return ref;
  return undefined;
}

function convert(root: string, abs: string, motive: string, siblings: string[]): Conversion | { skip: string; warn?: boolean } {
  const rel = path.relative(root, abs);
  const text = readFileSync(abs, "utf8");
  const lines = text.split("\n");
  const { fm, raw, end } = parseFm(lines);
  if (fm.has("status") && ISSUE_STATUSES.has(fm.get("status")!)) {
    const n = normalise(lines, end);
    if (n.notes.length === 0) return { skip: "already converted" };
    return { rel, abs, text: n.lines.join("\n"), notes: n.notes, warnings: [], normalise: true };
  }

  let body = lines.slice(end);
  const warnings: string[] = [];

  // H1 and header region (H1 .. first H2).
  let h1: string | undefined;
  let regionStart = 0;
  const firstH2 = body.findIndex(l => /^## /.test(l));
  const regionEnd = firstH2 === -1 ? body.length : firstH2;
  const h1Idx = body.findIndex((l, i) => i < regionEnd && /^# /.test(l));
  const drop = new Set<number>();
  if (h1Idx !== -1) {
    h1 = body[h1Idx].replace(/^# /, "").replace(/\r$/, "").trim();
    drop.add(h1Idx);
    regionStart = h1Idx + 1;
  }
  let statusRaw: string | undefined;
  let typeRaw: string | undefined;
  let source: string | undefined;
  let blockedRaw: string | undefined;
  for (let i = regionStart; i < regionEnd; i++) {
    const l = body[i];
    let v: string | undefined;
    if ((v = headerValue(l, "Status")) !== undefined) statusRaw = v;
    else if ((v = headerValue(l, "Type")) !== undefined) typeRaw = v;
    else if ((v = headerValue(l, "Source")) !== undefined) source = v;
    else if ((v = headerValue(l, "Blocked by")) !== undefined) blockedRaw = v;
    else continue;
    drop.add(i);
  }

  // Parent section.
  let parent = `[[${motive}]]`;
  const pIdx = body.findIndex(l => /^## Parent\s*$/.test(l.replace(/\r$/, "")));
  if (pIdx !== -1) {
    // Only the first paragraph under the heading is the parent; later lines (e.g. criteria) stay in the body.
    let pEnd = body.findIndex((l, i) => i > pIdx && /^## /.test(l));
    if (pEnd === -1) pEnd = body.length;
    let first = pIdx + 1;
    while (first < pEnd && body[first].trim() === "") first++;
    let last = first;
    while (last < pEnd && body[last].trim() !== "") last++;
    const content = body.slice(first, last).join("\n").trim();
    // The section is removed only when its first paragraph is nothing but a resolvable reference; prose stays verbatim.
    const target = resolveParent(root, motive, siblings, content);
    if (target) {
      parent = `[[${target}]]`;
      for (let i = pIdx; i < last; i++) drop.add(i);
    }
  }
  body = body.filter((_, i) => !drop.has(i));

  // Status.
  const oldStatus = statusRaw ?? fm.get("status") ?? "(none)";
  let mapped = { status: "triage" } as { status: string; assignee?: string };
  if (statusRaw !== undefined || fm.has("status")) {
    const m = STATUS_MAP[oldStatus];
    if (!m) return { skip: `unknown Status "${oldStatus}"`, warn: true };
    mapped = m;
  }

  // Type -> tags.
  const tags: string[] = [];
  if (typeRaw) {
    const t = TYPE_TAGS[typeRaw.toLowerCase()];
    if (t) tags.push(t);
    else warnings.push(`unknown Type "${typeRaw}" dropped`);
  }

  // Blocked by.
  const blocked: string[] = [];
  if (blockedRaw && !/^none\b/i.test(blockedRaw)) {
    const list = /^\d{1,2}(?:\s*(?:,|&|and)\s*\d{1,2})*/.exec(blockedRaw)?.[0] ?? "";
    for (const n of list.match(/\d{1,2}/g) ?? []) {
      const nn = n.padStart(2, "0");
      const sib = siblings.find(s => s.startsWith(`${nn}-`));
      if (sib) blocked.push(`[[${sib.replace(/\.md$/, "")}]]`);
      else {
        blocked.push(`[[${nn}]]`);
        warnings.push(`blocked by ${nn}: no sibling ticket, kept as [[${nn}]]`);
      }
    }
  }

  const title = fm.get("title") ?? (h1 ?? path.basename(abs, ".md")).replace(/^\d{2}\s*(?::|—|-)\s*/, "");
  const created = fm.get("created") ?? ymd(statSync(abs).mtime);
  const extras = [...raw.keys()].filter(k => !MANAGED.has(k));

  const out: string[] = ["---", `title: ${q(title)}`, `status: ${mapped.status}`];
  if (mapped.assignee) out.push(`assignee: ${mapped.assignee}`);
  out.push(
    "priority: none",
    `tags: [${tags.map(tag).join(", ")}]`,
    `parent: ${q(parent)}`,
    `blocked_by: [${blocked.map(q).join(", ")}]`,
    `source: ${q(source ?? "")}`,
    `created: ${created}`,
  );
  for (const k of extras) out.push(raw.get(k)!);
  out.push("---");

  const notes = [`status ${oldStatus} -> ${mapped.status}`, `tags [${tags.join(", ")}]`, `blocked_by [${blocked.join(", ")}]`, `parent ${parent}`];
  if (extras.length) notes.push(`extra frontmatter kept: ${extras.join(", ")}`);
  const norm = normalise([...out, ...body], out.length);
  return { rel, abs, text: norm.lines.join("\n"), notes: [...notes, ...norm.notes], warnings };
}

export function runMigrateIssues(root: string, apply: boolean): MigrateResult {
  const lines: string[] = [];
  const work = path.join(root, ".groundwork", "work");
  const todo: Conversion[] = [];
  const norms: string[] = [];
  let skipped = 0;
  let warnings = 0;

  const motives = existsSync(work) ? readdirSync(work).sort() : [];
  for (const motive of motives) {
    const dir = path.join(work, motive, "tickets");
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    const names = readdirSync(dir).sort().filter(n => statSync(path.join(dir, n)).isFile());
    const siblings = names.filter(n => /^\d{2}-.+\.md$/.test(n));
    for (const name of names) {
      const abs = path.join(dir, name);
      const rel = path.relative(root, abs);
      if (!siblings.includes(name)) {
        lines.push(`skip ${rel}: not a numbered ticket`);
        skipped++;
        continue;
      }
      const r = convert(root, abs, motive, siblings);
      if ("skip" in r) {
        if (r.warn) {
          lines.push(`warning ${rel}: ${r.skip}, file skipped`);
          warnings++;
        } else lines.push(`skip ${rel}: ${r.skip}`);
        skipped++;
        continue;
      }
      todo.push(r);
      if (r.normalise) {
        norms.push(r.rel);
        lines.push(`${apply ? "normalise" : "would normalise"} ${r.rel}: ${r.notes.join("; ")}`);
        continue;
      }
      lines.push(`${apply ? "convert" : "would convert"} ${r.rel}: ${r.notes.join("; ")}`);
      for (const w of r.warnings) {
        lines.push(`warning ${r.rel}: ${w}`);
        warnings++;
      }
    }
  }

  if (norms.length > 0) lines.push(`normalise: ${norms.length} file(s): ${norms.join(", ")}`);
  if (apply && todo.length === 0) lines.push("nothing to convert, no backup made");
  if (apply && todo.length > 0) {
    const dir = path.join(root, ".groundwork", "backup");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/\.\d+Z$/, "Z").replace(/[-:]/g, "");
    const archive = path.join(dir, `migrate-issues-${stamp}.tar.gz`);
    const r = Bun.spawnSync(["tar", "-czf", archive, "-C", root, ...todo.map(t => t.rel)]);
    if (r.exitCode !== 0) {
      lines.push(`error: backup failed (tar exit ${r.exitCode}): ${r.stderr.toString().trim()}; nothing written`);
      return { lines, code: 1 };
    }
    lines.push(`backup: ${path.resolve(archive)}`);
    for (const t of todo) writeFileSync(t.abs, t.text);
  }
  lines.push(`summary: ${todo.length - norms.length} converted, ${norms.length} normalised, ${skipped} skipped, ${warnings} warnings${apply ? "" : " (dry run, nothing written)"}`);
  return { lines, code: 0 };
}
