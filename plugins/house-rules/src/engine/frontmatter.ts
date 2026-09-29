// Zero runtime imports beyond node builtins: must run from a copy with no node_modules.
export type FmSchema = Record<string, unknown>;

type ParseResult =
  | { ok: true; data: Record<string, unknown> | null; body: string }
  | { ok: false; error: string };

const BLOCK = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

// Bun.YAML turns bare dates into Date objects; validators must see the source strings.
function normaliseDates(v: unknown): unknown {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? v : v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map(normaliseDates);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = normaliseDates(x);
    return out;
  }
  return v;
}

export function parseFrontmatter(text: string): ParseResult {
  const m = BLOCK.exec(text);
  if (!m) return { ok: true, data: null, body: text };
  const yaml = (globalThis as { Bun?: { YAML?: { parse(s: string): unknown } } }).Bun?.YAML;
  if (!yaml?.parse) return { ok: false, error: "Bun.YAML is unavailable; cannot parse frontmatter" };
  let raw: unknown;
  try {
    raw = yaml.parse(m[1] ?? "");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const body = text.slice(m[0].length);
  if (raw === null || raw === undefined) return { ok: true, data: {}, body };
  const data = normaliseDates(raw);
  if (typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "frontmatter must be a YAML mapping" };
  }
  return { ok: true, data: data as Record<string, unknown>, body };
}

const ANNOTATIONS = new Set(["$schema", "description", "title"]);
const KNOWN = new Set([
  "type", "required", "properties", "enum", "const", "pattern", "format", "if", "then", "oneOf",
]);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

function isDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = +m[1]!, mo = +m[2]!, d = +m[3]!;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= days[mo - 1]!;
}

function typeOk(t: string, v: unknown): boolean {
  switch (t) {
    case "object": return isObj(v);
    case "array": return Array.isArray(v);
    case "string": return typeof v === "string";
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "integer": return typeof v === "number" && Number.isInteger(v);
    case "boolean": return typeof v === "boolean";
    case "null": return v === null;
    default: return false;
  }
}

function check(schema: unknown, value: unknown, path: string, errs: string[]): void {
  if (!isObj(schema)) {
    errs.push(`${path}: unsupported schema (expected an object schema)`);
    return;
  }
  for (const kw of Object.keys(schema)) {
    if (ANNOTATIONS.has(kw)) continue;
    if (!KNOWN.has(kw)) errs.push(`${path}: unsupported schema keyword "${kw}"`);
  }
  const fmt = schema.format;
  if (fmt !== undefined && fmt !== "date") errs.push(`${path}: unsupported schema keyword "format: ${String(fmt)}"`);

  const t = schema.type;
  if (t !== undefined) {
    const types = Array.isArray(t) ? t : [t];
    if (!types.some((x) => typeof x === "string" && typeOk(x, value))) {
      errs.push(`${path}: expected type ${types.join("|")}`);
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => deepEqual(e, value))) {
    errs.push(`${path}: must be one of ${JSON.stringify(schema.enum)}`);
  }
  if ("const" in schema && !deepEqual(schema.const, value)) {
    errs.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
  }
  if (typeof value === "string") {
    if (typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern, "u").test(value)) errs.push(`${path}: must match pattern ${schema.pattern}`);
      } catch {
        errs.push(`${path}: invalid pattern ${schema.pattern}`);
      }
    }
    if (fmt === "date" && !isDate(value)) errs.push(`${path}: must be a valid date (YYYY-MM-DD)`);
  }
  if (isObj(value)) {
    if (Array.isArray(schema.required)) {
      for (const k of schema.required) {
        if (!Object.hasOwn(value, String(k))) errs.push(`${path}: missing required key "${String(k)}"`);
      }
    }
    if (isObj(schema.properties)) {
      for (const [k, sub] of Object.entries(schema.properties)) {
        if (Object.hasOwn(value, k)) check(sub, value[k], path === "(root)" ? k : `${path}.${k}`, errs);
      }
    }
  }
  if (schema.if !== undefined && schema.then !== undefined) {
    const probe: string[] = [];
    check(schema.if, value, path, probe);
    if (probe.length === 0) check(schema.then, value, path, errs);
  } else if (schema.if !== undefined) {
    // Still surface unsupported keywords inside a lone `if`.
    check(schema.if, value, path, []);
  }
  if (Array.isArray(schema.oneOf)) {
    let matched = 0;
    const unsupported: string[] = [];
    for (const branch of schema.oneOf) {
      const sub: string[] = [];
      check(branch, value, path, sub);
      unsupported.push(...sub.filter((e) => e.includes("unsupported schema")));
      if (sub.length === 0) matched++;
    }
    errs.push(...unsupported);
    if (matched !== 1) errs.push(`${path}: must match exactly one oneOf branch (matched ${matched})`);
  }
}

export function validateFrontmatter(schema: FmSchema, value: unknown): string[] {
  const errs: string[] = [];
  check(schema, value, "(root)", errs);
  return [...new Set(errs)];
}

export function missingHeadings(body: string, headings: string[]): string[] {
  const found: string[] = [];
  let fence: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    const f = /^(`{3,}|~{3,})/.exec(t);
    if (f) {
      if (fence === null) fence = f[1]![0]!;
      else if (t.startsWith(fence.repeat(3))) fence = null;
      continue;
    }
    if (fence === null && /^#{1,6}\s/.test(t)) found.push(t.replace(/\s+#+$/, ""));
  }
  return headings.filter((h) => {
    const want = h.trim();
    if (want.startsWith("#")) return !found.includes(want);
    return !found.some((f) => f.replace(/^#{1,6}\s+/, "") === want);
  });
}
