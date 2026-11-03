import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { renderModules, staleIn, type ValidatorModule } from "../plugins/house-rules/scripts/gen-validators.js";
import { prListSchema } from "../src/monitors/pr-schemas.js";

const ROOT = path.resolve(import.meta.dir, "..");
const SELF = "scripts/gen-validators.ts";

const MODULES: ValidatorModule[] = [
  {
    out: "src/monitors/generated/pr-validators",
    typesFrom: "src/monitors/pr-schemas.ts",
    validators: [{ name: "isPrList", schema: prListSchema, type: "Pr[]" }],
  },
];

/** Every generated file, keyed by repo-relative path. */
export function renderAll(): Map<string, string> {
  return renderModules(MODULES, SELF);
}

/** Repo-relative paths under `root` whose content differs from a fresh render. */
export function staleFiles(root: string): string[] {
  return staleIn(root, renderAll());
}

if (import.meta.main) {
  if (process.argv.includes("--check")) {
    const stale = staleFiles(ROOT);
    for (const rel of stale) console.error(`stale: ${rel} (run bun ${SELF})`);
    if (stale.length > 0) process.exit(1);
    console.log(`validators checked: ${renderAll().size}`);
  } else {
    for (const [rel, text] of renderAll()) {
      const file = path.join(ROOT, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      console.log(`wrote ${rel}`);
    }
  }
}
