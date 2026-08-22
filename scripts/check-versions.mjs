#!/usr/bin/env node
/**
 * check-versions.mjs
 * Asserts that all plugin version manifests agree with package.json.
 * Run via: pnpm run check:versions
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(rel) {
  return JSON.parse(readFileSync(resolve(root, rel), 'utf8'));
}

const pkg = readJson('package.json');
const canonical = pkg.version;

const surfaces = [
  { label: 'package.json', version: canonical },
  { label: 'plugin.json', version: readJson('plugin.json').version },
  { label: '.claude-plugin/plugin.json', version: readJson('.claude-plugin/plugin.json').version },
  {
    label: '.claude-plugin/marketplace.json (metadata.version)',
    version: readJson('.claude-plugin/marketplace.json').metadata.version,
  },
  {
    label: '.claude-plugin/marketplace.json (plugins[0].version)',
    version: readJson('.claude-plugin/marketplace.json').plugins[0].version,
  },
];

let failed = false;
for (const { label, version } of surfaces) {
  if (version !== canonical) {
    console.error(`  FAIL  ${label}: ${version} (expected ${canonical})`);
    failed = true;
  } else {
    console.log(`  OK    ${label}: ${version}`);
  }
}

if (failed) {
  console.error('\nVersion mismatch — run the bump across all manifests before releasing.');
}

// Guard $schema consistency across both plugin manifests.
const EXPECTED_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const schemaManifests = [
  { label: 'plugin.json ($schema)', schema: readJson('plugin.json').$schema },
  { label: '.claude-plugin/plugin.json ($schema)', schema: readJson('.claude-plugin/plugin.json').$schema },
];

console.log('');
for (const { label, schema } of schemaManifests) {
  if (schema !== EXPECTED_SCHEMA) {
    console.error(`  FAIL  ${label}: ${schema ?? '(missing)'} (expected ${EXPECTED_SCHEMA})`);
    failed = true;
  } else {
    console.log(`  OK    ${label}`);
  }
}

if (failed) {
  console.error('\nCheck failed — fix the mismatches above before releasing.');
  process.exit(1);
} else {
  console.log('\nAll version and schema surfaces agree.');
}
