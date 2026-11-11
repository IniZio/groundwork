import { readFileSync } from "node:fs";
import { isConfig } from "./generated/config-validators.mjs";

export const RULE_IDS = Object.freeze([
  "commit-message",
  "comment-density",
  "artifact-structure",
  "type-escape-hatches",
  "no-module-mocking",
  "code-smells",
  "effect",
  "require-safety-comment-for-type-assertion",
  "require-readable-spacing",
  "silent-early-return-in-test",
  "pr-body",
]);
export const RULE_ALIASES = Object.freeze({ "stray-artifacts": "artifact-structure" });
export const SEVERITIES = Object.freeze(["error"]);
export const WARN_SEVERITIES = Object.freeze(["off", "warn"]);
export const OPT_IN_SEVERITIES = Object.freeze(["off", "error"]);
export const RULE_SEVERITIES = Object.freeze({
  "commit-message": OPT_IN_SEVERITIES,
  "comment-density": SEVERITIES,
  "artifact-structure": SEVERITIES,
  "type-escape-hatches": WARN_SEVERITIES,
  "no-module-mocking": WARN_SEVERITIES,
  "code-smells": WARN_SEVERITIES,
  "effect": WARN_SEVERITIES,
  "require-safety-comment-for-type-assertion": WARN_SEVERITIES,
  "require-readable-spacing": WARN_SEVERITIES,
  "silent-early-return-in-test": WARN_SEVERITIES,
  "pr-body": OPT_IN_SEVERITIES,
});
export const PRESETS = Object.freeze(["handbook", "conventional", "subject-only"]);
export const RULE_OPTION_KEYS = Object.freeze({
  "commit-message": Object.freeze(["preset"]),
  "comment-density": Object.freeze([]),
  "artifact-structure": Object.freeze(["govern", "types", "forbidden"]),
  "type-escape-hatches": Object.freeze(["allowInTypeGuards"]),
  "no-module-mocking": Object.freeze([]),
  "code-smells": Object.freeze([]),
  "effect": Object.freeze([]),
  "require-safety-comment-for-type-assertion": Object.freeze([]),
  "require-readable-spacing": Object.freeze([]),
  "silent-early-return-in-test": Object.freeze([]),
  "pr-body": Object.freeze([]),
});
export const TIERS = Object.freeze(["product", "working", "ephemeral"]);
export const TYPE_KEYS = Object.freeze([
  "tier",
  "generates",
  "description",
  "instruction",
  "template",
  "frontmatter",
  "headings",
  "headingsWhen",
]);
export const FORBIDDEN_KEYS = Object.freeze(["pattern", "redirect"]);
export const TOP_LEVEL_KEYS = Object.freeze(["$schema", "rules"]);

const RULE_VALUE_FORMS = Object.freeze(["severity string", "[severity]", "[severity, options]"]);

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
const isKnownRule = (id) => RULE_IDS.includes(RULE_ALIASES[id] ?? id);

let publishedSchema;

const decodeSegment = (seg) => seg.replaceAll("~1", "/").replaceAll("~0", "~");

/** The house-rules.schema.json node at an ajv schemaPath such as `#/properties/rules`. */
function schemaNode(pointer) {
  publishedSchema ??= JSON.parse(readFileSync(new URL("../../house-rules.schema.json", import.meta.url), "utf8"));
  return pointer
    .split("/")
    .slice(1)
    .map((seg) => decodeSegment(decodeURIComponent(seg)))
    .reduce((node, key) => node?.[key], publishedSchema);
}

/** Renders a JSON pointer into `root` as the config path users read, e.g. `rules["x"][1].types.t`. */
function configPath(root, instancePath) {
  if (instancePath === "") return "";
  let path = "";
  let data = root;
  instancePath
    .slice(1)
    .split("/")
    .map(decodeSegment)
    .forEach((seg, i, segs) => {
      if (Array.isArray(data)) path += `[${seg}]`;
      else if (i === 1 && segs[0] === "rules") path += `["${seg}"]`;
      else path += path === "" ? seg : `.${seg}`;
      data = data?.[seg];
    });
  return path;
}

const join = (path, key) => (path === "rules" ? `rules["${key}"]` : path === "" ? key : `${path}.${key}`);

/** What a value matching `node` looks like: the phrase after "must be" and the allowed shapes. */
function expected(node) {
  if (Array.isArray(node.type)) return [`a ${node.type.join(" or ")}`, node.type];
  if (node.type === "array" && node.items?.type === "string") {
    return [`${node.minItems > 0 ? "a non-empty array" : "an array"} of strings`, ["string[]"]];
  }
  if (node.type === "string" && node.minLength > 0) return ["a non-empty string", ["string"]];
  return [`${node.type === "object" || node.type === "array" ? "an" : "a"} ${node.type}`, [node.type]];
}

function legacyLayoutProblem(id, value) {
  const preset = isObject(value) && typeof value.preset === "string" ? value.preset : "<value>";
  const replacement =
    id === "commit-message"
      ? `{"rules":{"commit-message":["error",{"preset":"${preset}"}]}}`
      : `{"rules":{"${id}":"${RULE_SEVERITIES[RULE_ALIASES[id] ?? id].includes("warn") ? "warn" : "error"}"}}`;
  return `old config shape; move under "rules": ${replacement}`;
}

/** The ajv error to report: a rule value fails both oneOf branches, and only the branch whose JSON type it has names the problem. */
function pickError(root, errors) {
  const oneOf = errors.find((e) => e.keyword === "oneOf");
  if (!oneOf) return errors[0];
  const branch = ["0", "1"].find((b) => !errors.some((e) => e.schemaPath === `${oneOf.schemaPath}/${b}/type`));
  const inside = errors.find(
    (e) =>
      e.schemaPath.startsWith(`${oneOf.schemaPath}/${branch}/`) &&
      (e.instancePath !== oneOf.instancePath || e.keyword === "enum"),
  );
  if (!inside) throw new ConfigError(configPath(root, oneOf.instancePath), "invalid rule value", RULE_VALUE_FORMS);
  return inside;
}

function toConfigError(root, errors) {
  const error = pickError(root, errors);
  let instancePath = error.instancePath;
  let nodePath = error.schemaPath.slice(0, error.schemaPath.lastIndexOf("/"));
  if (nodePath.endsWith("/items") && schemaNode(nodePath).type !== "object") {
    instancePath = instancePath.slice(0, instancePath.lastIndexOf("/"));
    nodePath = nodePath.slice(0, -"/items".length);
  }
  const node = schemaNode(nodePath);
  const path = configPath(root, instancePath);

  switch (error.keyword) {
    case "additionalProperties": {
      const key = error.params.additionalProperty;
      if (path === "" && isKnownRule(key)) throw new ConfigError(key, legacyLayoutProblem(key, root[key]), TOP_LEVEL_KEYS);
      if (path === "rules") throw new ConfigError(join(path, key), "unknown rule", RULE_IDS);
      const problem = nodePath.endsWith("/prefixItems/1") ? "unknown option" : "unknown key";
      throw new ConfigError(join(path, key), problem, Object.keys(node.properties));
    }
    case "required": {
      const child = node.properties[error.params.missingProperty];
      const form = child.enum ? child.enum.join("|") : expected(child)[1].join("|");
      throw new ConfigError(join(path, error.params.missingProperty), "required", [form]);
    }
    case "enum": {
      const key = /\/oneOf\/0$|\/prefixItems\/0$/.test(nodePath) ? "severity" : instancePath.slice(instancePath.lastIndexOf("/") + 1);
      throw new ConfigError(path, `invalid ${key}`, node.enum);
    }
    default: {
      const [phrase, allowed] = expected(node);
      const subject =
        path === "" ? "config " : nodePath.endsWith("/prefixItems/1") ? "options " : nodePath.endsWith("/additionalProperties") ? "type " : "";
      throw new ConfigError(path, `${subject}must be ${phrase}`, allowed);
    }
  }
}

export function parseConfig(text) {
  let root;
  try {
    root = JSON.parse(text);
  } catch (err) {
    throw new ConfigError("", `invalid JSON (${err.message})`, ["valid JSON"]);
  }
  if (!isConfig(root)) toConfigError(root, isConfig.errors);

  const rules = {};
  for (const [id, value] of Object.entries(root.rules ?? {})) {
    const [severity, options = {}] = [value].flat();
    rules[id] = { severity, options: structuredClone(options) };
  }
  return { rules };
}
