export const words = (s) =>
  String(s).split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean).map((w) => w.toLowerCase());

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

const CASES = {
  kebab: (v) => words(v).join("-"),
  camel: (v) => words(v).map((w, i) => (i ? cap(w) : w)).join(""),
  pascal: (v) => words(v).map(cap).join(""),
};

const CASE_RE = {
  kebab: "[a-z0-9]+(?:-[a-z0-9]+)*",
  camel: "[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)*",
  pascal: "(?:[A-Z][a-z0-9]*)+",
};

const PLACEHOLDER = /\{(\w+)(?::(\w+))?\}/g;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function renderPath(template, params) {
  return template.replace(PLACEHOLDER, (_m, key, kase) => {
    const v = params[key];
    if (v === undefined) throw new Error(`renderPath: missing param "${key}"`);
    if (!kase) return v;
    const fn = CASES[kase];
    if (!fn) throw new Error(`renderPath: unknown case "${kase}"`);
    return fn(v);
  });
}

export function compileGenerates(template) {
  const params = [];
  let src = "";
  let last = 0;
  for (const m of template.matchAll(PLACEHOLDER)) {
    const [whole, name, kase] = m;
    if (kase && !CASE_RE[kase]) throw new Error(`compileGenerates: unknown case "${kase}"`);
    src += escapeRe(template.slice(last, m.index)) + `(${kase ? CASE_RE[kase] : "[^/]+"})`;
    params.push({ name, kase: kase ?? null });
    last = m.index + whole.length;
  }
  src += escapeRe(template.slice(last));
  const re = new RegExp(`^${src}$`);
  return {
    template,
    params,
    match(path) {
      const hit = re.exec(path);
      if (!hit) return null;
      const out = {};
      for (let i = 0; i < params.length; i++) {
        const { name } = params[i];
        if (name in out && out[name] !== hit[i + 1]) return null;
        out[name] = hit[i + 1];
      }
      try {
        return renderPath(template, out) === path ? out : null;
      } catch {
        return null;
      }
    },
  };
}

const typesOf = (manifest) => Object.entries(manifest?.types ?? {});

export function matchPath(path, manifest) {
  for (const [type, def] of typesOf(manifest)) {
    const params = compileGenerates(def.generates).match(path);
    if (params) return { type, params };
  }
  return null;
}

export function renderType(typeId, params, manifest) {
  const def = manifest?.types?.[typeId];
  if (!def) throw new Error(`renderType: unknown type "${typeId}"`);
  return renderPath(def.generates, params);
}

const extOf = (p) => {
  const b = p.slice(p.lastIndexOf("/") + 1);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i) : "";
};

export function nearestTypes(path, manifest, n) {
  const norm = normalise(path);
  const base = norm.slice(norm.lastIndexOf("/") + 1);
  const stem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  const dirs = norm.includes("/") ? norm.slice(0, norm.lastIndexOf("/")).split("/") : [];
  const pathTokens = new Set([...words(stem), ...dirs.flatMap(words)]);
  const baseWords = words(stem);
  const scored = typesOf(manifest).map(([type, def]) => {
    const literals = def.generates.replace(PLACEHOLDER, "/").split("/").map((seg) => {
      const dot = seg.lastIndexOf(".");
      return dot > 0 ? seg.slice(0, dot) : seg;
    });
    const typeTokens = new Set([...words(type), ...literals.flatMap(words)]);
    let inter = 0;
    for (const t of pathTokens) if (typeTokens.has(t)) inter++;
    const union = new Set([...pathTokens, ...typeTokens]).size;
    let score = union ? inter / union : 0;
    const ext = extOf(def.generates);
    if (ext && ext === extOf(norm)) score += 0.05;
    score = Math.min(1, score);
    let suggestion = def.generates;
    try {
      if (baseWords.length) {
        const p = {};
        for (const { name } of compileGenerates(def.generates).params) p[name] = baseWords.join("-");
        suggestion = renderPath(def.generates, p);
      }
    } catch {
      suggestion = def.generates;
    }
    return { type, score, suggestion };
  });
  scored.sort((a, b) => b.score - a.score || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
  return scored.slice(0, Math.max(0, n));
}

const normalise = (p) => p.replace(/\\/g, "/").replace(/^(\.\/)+/, "");

const globCache = new Map();
function globToRe(glob) {
  let re = globCache.get(glob);
  if (re) return re;
  let s = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          s += "(?:.*/)?";
        } else s += ".*";
      } else s += "[^/]*";
    } else if (c === "?") s += "[^/]";
    else s += escapeRe(c);
  }
  re = new RegExp(`^${s}$`);
  globCache.set(glob, re);
  return re;
}

export function inTypedArea(path, manifest) {
  const norm = normalise(path);
  for (const def of Object.values(manifest?.types ?? {})) {
    const cut = def.generates.indexOf("{");
    const literal = cut === -1 ? def.generates : def.generates.slice(0, cut);
    const area = literal.slice(0, literal.lastIndexOf("/") + 1);
    if (area !== "" && norm.startsWith(area)) return true;
  }
  return false;
}

export function forbiddenRedirect(path, manifest) {
  const norm = normalise(path);
  for (const e of manifest?.forbidden ?? []) {
    if (globToRe(normalise(e.pattern)).test(norm)) return e.redirect;
  }
  return null;
}
