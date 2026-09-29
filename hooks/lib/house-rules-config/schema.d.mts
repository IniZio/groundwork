export type RuleId = "commit-message" | "comment-density" | "stray-artifacts";
export type Severity = "error";
export type Preset = "handbook" | "conventional" | "subject-only";

export const RULE_IDS: readonly ["commit-message", "comment-density", "stray-artifacts"];
export const SEVERITIES: readonly ["error"];
export const RULE_SEVERITIES: {
  readonly "commit-message": readonly ["error"];
  readonly "comment-density": readonly ["error"];
  readonly "stray-artifacts": readonly ["error"];
};
export const PRESETS: readonly ["handbook", "conventional", "subject-only"];
export const RULE_OPTION_KEYS: {
  readonly "commit-message": readonly ["preset"];
  readonly "comment-density": readonly [];
  readonly "stray-artifacts": readonly [];
};
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
  rules: { [id in RuleId]?: ParsedRule };
}

export function parseConfig(text: string): ParsedConfig;
