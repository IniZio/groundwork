import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registryManifestOptions } from "../src/cli/recipe.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  "plugins/house-rules/src/config/doc-registry.json",
  "hooks/lib/house-rules-config/doc-registry.json",
];

const content = JSON.stringify(registryManifestOptions(), null, 2) + "\n";
const check = process.argv.includes("--check");
const stale: string[] = [];

for (const rel of targets) {
  const path = join(root, rel);
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current === content) {
    console.log(`unchanged ${rel}`);
    continue;
  }
  if (check) {
    stale.push(rel);
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`updated ${rel}`);
}

if (stale.length > 0) {
  for (const rel of stale) console.error(`stale: ${rel}`);
  console.error("Fix: bun run sync:doc-registry");
  process.exit(1);
}
