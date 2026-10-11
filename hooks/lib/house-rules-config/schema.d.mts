export type RuleId =
  | "commit-message"
  | "comment-density"
  | "artifact-structure"
  | "type-escape-hatches"
  | "no-module-mocking"
  | "code-smells"
  | "effect"
  | "require-safety-comment-for-type-assertion";
export type RuleAlias = "stray-artifacts";
export type Severity = "off" | "warn" | "error";
export type Preset = "handbook" | "conventional" | "subject-only";

export const RULE_IDS: readonly [
  "commit-message",
  "comment-density",
  "artifact-structure",
  "type-escape-hatches",
  "no-module-mocking",
  "code-smells",
  "effect",
  "require-safety-comment-for-type-assertion",
];
export const RULE_ALIASES: { readonly "stray-artifacts": "artifact-structure" };
export const SEVERITIES: readonly ["error"];
export const WARN_SEVERITIES: readonly ["off", "warn"];
export const RULE_SEVERITIES: {
  readonly "commit-message": readonly ["error"];
  readonly "comment-density": readonly ["error"];
  readonly "artifact-structure": readonly ["error"];
  readonly "type-escape-hatches": readonly ["off", "warn"];
  readonly "no-module-mocking": readonly ["off", "warn"];
  readonly "code-smells": readonly ["off", "warn"];
  readonly "effect": readonly ["off", "warn"];
  readonly "require-safety-comment-for-type-assertion": readonly ["off", "warn"];
};
export const PRESETS: readonly ["handbook", "conventional", "subject-only"];
export const RULE_OPTION_KEYS: {
  readonly "commit-message": readonly ["preset"];
  readonly "comment-density": readonly [];
  readonly "artifact-structure": readonly ["govern", "types", "forbidden"];
  readonly "type-escape-hatches": readonly [];
  readonly "no-module-mocking": readonly [];
  readonly "code-smells": readonly [];
  readonly "effect": readonly [];
  readonly "require-safety-comment-for-type-assertion": readonly [];
};
export type Tier = "product" | "working" | "ephemeral";
export const TIERS: readonly ["product", "working", "ephemeral"];
export const TYPE_KEYS: readonly [
  "tier",
  "generates",
  "description",
  "instruction",
  "template",
  "frontmatter",
  "headings",
];
export const FORBIDDEN_KEYS: readonly ["pattern", "redirect"];

export interface ManifestType {
  tier: Tier;
  generates: string;
  description?: string;
  instruction?: string;
  template?: string | null;
  frontmatter?: Record<string, unknown>;
  headings?: string[];
}

export interface ManifestForbidden {
  pattern: string;
  redirect: string;
}

export interface ManifestOptions {
  govern?: string[];
  types?: { [typeId: string]: ManifestType };
  forbidden?: ManifestForbidden[];
}
export const TOP_LEVEL_KEYS: readonly ["$schema", "rules"];

export class ConfigError extends Error {
  constructor(path: string, problem: string, allowed: readonly string[]);
  path: string;
  file?: string;
  allowed: readonly string[];
}

export interface ParsedRule {
  severity: Severity;
  options: Record<string, unknown>;
}

export interface ParsedConfig {
  rules: { [id in RuleId | RuleAlias]?: ParsedRule };
}

export function parseConfig(text: string): ParsedConfig;
