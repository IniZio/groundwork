export const RULE_IDS = Object.freeze(["commit-message", "comment-density", "stray-artifacts"]);
export const SEVERITIES = Object.freeze(["error"]);
export const RULE_SEVERITIES = Object.freeze({
  "commit-message": SEVERITIES,
  "comment-density": SEVERITIES,
  "stray-artifacts": SEVERITIES,
});
export const PRESETS = Object.freeze(["handbook", "conventional", "subject-only"]);
export const RULE_OPTION_KEYS = Object.freeze({
  "commit-message": Object.freeze(["preset"]),
  "comment-density": Object.freeze([]),
  "stray-artifacts": Object.freeze([]),
});
export const TOP_LEVEL_KEYS = Object.freeze(["$schema", "rules"]);

const SHAPES = Object.freeze(["severity string", "[severity]", "[severity, options]"]);

export class ConfigError extends Error {
  constructor(path, problem, allowed) {
    const allowedText = allowed.length === 0 ? "no options" : allowed.join(", ");
    super(`${path || "config"}: ${problem}; allowed: ${allowedText}`);
    this.name = "ConfigError";
    this.path = path;
    this.allowed = allowed;
  }
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function oldShapeProblem(id, value) {
  const preset = isObject(value) && typeof value.preset === "string" ? value.preset : "<value>";
  const replacement =
    id === "commit-message"
      ? `{"rules":{"commit-message":["error",{"preset":"${preset}"}]}}`
      : `{"rules":{"${id}":"error"}}`;
  return `old config shape; move under "rules": ${replacement}`;
}

function checkSeverity(id, value, path) {
  const allowed = RULE_SEVERITIES[id];
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new ConfigError(path, "invalid severity", allowed);
  }
  return value;
}

function checkOptions(id, options, path) {
  if (!isObject(options)) throw new ConfigError(path, "options must be an object", ["object"]);
  const known = RULE_OPTION_KEYS[id];
  for (const key of Object.keys(options)) {
    if (!known.includes(key)) throw new ConfigError(`${path}.${key}`, "unknown option", known);
  }
  if (Object.hasOwn(options, "preset") && !PRESETS.includes(options.preset)) {
    throw new ConfigError(`${path}.preset`, "invalid preset", PRESETS);
  }
  return { ...options };
}

function parseRule(id, value) {
  const path = `rules["${id}"]`;
  if (typeof value === "string") {
    return { severity: checkSeverity(id, value, path), options: {} };
  }
  if (Array.isArray(value) && (value.length === 1 || value.length === 2)) {
    const severity = checkSeverity(id, value[0], `${path}[0]`);
    const options = value.length === 2 ? checkOptions(id, value[1], `${path}[1]`) : {};
    return { severity, options };
  }
  throw new ConfigError(path, "invalid rule value", SHAPES);
}

export function parseConfig(text) {
  let root;
  try {
    root = JSON.parse(text);
  } catch (err) {
    throw new ConfigError("", `invalid JSON (${err.message})`, ["valid JSON"]);
  }
  if (!isObject(root)) throw new ConfigError("", "config must be an object", ["object"]);

  for (const key of Object.keys(root)) {
    if (RULE_IDS.includes(key)) {
      throw new ConfigError(key, oldShapeProblem(key, root[key]), TOP_LEVEL_KEYS);
    }
    if (!TOP_LEVEL_KEYS.includes(key)) throw new ConfigError(key, "unknown key", TOP_LEVEL_KEYS);
  }
  if (Object.hasOwn(root, "$schema") && typeof root.$schema !== "string") {
    throw new ConfigError("$schema", "must be a string", ["string"]);
  }

  const rules = {};
  if (Object.hasOwn(root, "rules")) {
    if (!isObject(root.rules)) throw new ConfigError("rules", "must be an object", ["object"]);
    for (const id of Object.keys(root.rules)) {
      if (!RULE_IDS.includes(id)) {
        throw new ConfigError(`rules["${id}"]`, "unknown rule", RULE_IDS);
      }
      rules[id] = parseRule(id, root.rules[id]);
    }
  }
  return { rules };
}
