import { matchPath, renderPath, words } from "./manifest.mjs";

const STOP = new Set(["about", "the", "a", "an", "of", "for", "on", "to", "and", "in", "is", "md"]);

// Crude plural fold so "notes" matches "note".
const stem = (w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
const terms = (s) => words(s ?? "").filter((w) => !STOP.has(w)).map(stem);

const typeEntries = (manifest) => Object.entries(manifest?.types ?? {});

export function renderStructure(manifest, { maxLines } = {}) {
  const types = typeEntries(manifest);
  if (!types.length) return ["artifact-structure: legacy (no types)"];
  const lines = [];
  for (const [id, def] of types) {
    lines.push(`${id} (${def.tier}): ${def.generates}${def.description ? ` — ${def.description}` : ""}`);
  }
  for (const f of manifest.forbidden ?? []) lines.push(`forbidden: ${f.pattern} → ${f.redirect}`);
  if (maxLines === undefined || lines.length <= maxLines) return lines;
  if (maxLines <= 0) return [];
  const keep = maxLines - 1;
  return [...lines.slice(0, keep), `… ${lines.length - keep} more; run \`house-rules structure\` for all`];
}

const HIGH = 3;
const LOW = 1;

export function rankTypes(query, manifest) {
  const q = new Set(terms(query));
  const out = [];
  for (const [type, def] of typeEntries(manifest)) {
    const literals = def.generates.replace(/\{\w+(?::\w+)?\}/g, "/").split("/").map((seg) => {
      const dot = seg.lastIndexOf(".");
      return dot > 0 ? seg.slice(0, dot) : seg;
    });
    const high = new Set([...terms(type), ...literals.flatMap(terms)]);
    const low = new Set([...terms(def.description), ...terms(def.instruction)]);
    let score = 0;
    for (const w of q) score += high.has(w) ? HIGH : low.has(w) ? LOW : 0;
    if (score > 0) out.push({ type, score });
  }
  out.sort((a, b) => b.score - a.score || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
  return out;
}

export function resolveWhere(query, manifest) {
  const types = manifest?.types ?? {};
  const ids = Object.keys(types);
  if (Object.hasOwn(types, query)) {
    const d = types[query];
    return { kind: "type", type: query, generates: d.generates, instruction: d.instruction ?? "", description: d.description ?? "" };
  }
  if (!/\s/.test(query)) return { kind: "unknown", types: ids };
  const ranked = rankTypes(query, manifest).slice(0, 3).map(({ type, score }) => ({
    type,
    generates: types[type].generates,
    instruction: types[type].instruction ?? "",
    score,
  }));
  return ranked.length ? { kind: "ranked", ranked } : { kind: "unknown", types: ids };
}

export function fillBody(template, params, today) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => {
    const v = params[key];
    if (v !== undefined) return v;
    if (key === "created") return today;
    throw new Error(`missing body param "${key}"`);
  });
}

export function scaffold(typeId, params, manifest, today) {
  const def = manifest?.types?.[typeId];
  if (!def) throw new Error(`unknown type "${typeId}"`);
  const p = { ...params };
  if (p.title === undefined && p.name !== undefined) p.title = p.name;
  const path = renderPath(def.generates, p);
  const content = fillBody(def.template ?? "", p, today);
  if (matchPath(path, manifest)?.type !== typeId) {
    throw new Error(`rendered path "${path}" does not match type "${typeId}"`);
  }
  return { path, content };
}
