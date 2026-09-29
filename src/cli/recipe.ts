import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WORKING_TYPES, FORBIDDEN, type DocType, type ForbiddenPattern } from "../hooks/doc-registry.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

type RecipeType = Omit<DocType, "template"> & { template?: string };

export interface Recipe {
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
