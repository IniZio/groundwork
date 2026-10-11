import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WORKING_TYPES, FORBIDDEN, type DocType, type ForbiddenPattern } from "../hooks/doc-registry.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

type RecipeType = Omit<DocType, "template"> & { template?: string };

export const HOUSE_RULES_SCHEMA_URL =
  "https://raw.githubusercontent.com/IniZio/groundwork/main/plugins/house-rules/house-rules.schema.json";

export interface Recipe {
  $schema: string;
  rules: {
    "artifact-structure": ["error", { govern: string[]; types: Record<string, RecipeType>; forbidden: ForbiddenPattern[] }];
  };
}

export function buildRecipe(): Recipe {
  const types: Record<string, RecipeType> = {};
  for (const [id, t] of Object.entries(WORKING_TYPES)) {
    const { template, ...rest } = t;
    // A null registry template (evidence) omits the key entirely.
    types[id] = template === null ? rest : { ...rest, template: readFileSync(path.join(REPO_ROOT, template), "utf8") };
  }
  return {
    $schema: HOUSE_RULES_SCHEMA_URL,
    rules: {
      "artifact-structure": [
        "error",
        {
          // Narrow: host product docs (README.md etc.) stay ungoverned; forbidden patterns apply repo-wide regardless.
          govern: [".groundwork/**/*.md"],
          types,
          forbidden: FORBIDDEN.map((f) => ({ pattern: f.pattern, redirect: f.redirect })),
        },
      ],
    },
  };
}

export function renderRecipe(): string {
  return JSON.stringify(buildRecipe(), null, 2) + "\n";
}

export function runRecipeCommand(args: string[], root: string): void {
  const unknown = args.filter((a) => a !== "--merge");
  if (unknown.length > 0) {
    process.stderr.write(`recipe: unknown argument: ${unknown[0]}\nusage: gw recipe [--merge]\n`);
    process.exit(1);
  }
  if (!args.includes("--merge")) {
    process.stdout.write(renderRecipe());
    return;
  }
  const file = path.join(root, ".house-rules.json");
  if (!existsSync(file)) {
    process.stdout.write(renderRecipe());
    return;
  }
  let existing: unknown;
  try {
    existing = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    process.stderr.write(`recipe --merge: cannot parse ${file}: ${(e as Error).message}\n`);
    process.exit(1);
  }
  if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
    process.stderr.write(`recipe --merge: ${file} is not a JSON object\n`);
    process.exit(1);
  }
  const recipe = buildRecipe();
  const merged = existing as Record<string, unknown>;
  const rules = merged.rules;
  const rulesObj: Record<string, unknown> =
    typeof rules === "object" && rules !== null && !Array.isArray(rules) ? (rules as Record<string, unknown>) : {};
  rulesObj["artifact-structure"] = recipe.rules["artifact-structure"];
  merged.rules = rulesObj;
  if (!("$schema" in merged)) merged.$schema = recipe.$schema;
  process.stdout.write(JSON.stringify(merged, null, 2) + "\n");
}
