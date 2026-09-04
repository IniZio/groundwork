#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const d = dirname(new URL(import.meta.url).pathname)
const g = resolve(d, '../dist/gw')
const [b, ...a] = existsSync(g) ? [g] : ['bun', resolve(d, '../src/gw/cli/main.ts')]

// Runtime wrapper for test consumers — resolves processPayload via a dynamic import so
// the hooks/ layer has no compile-time (module-parse-time) coupling into src/ internals.
export async function processPayload(...args) {
  const { processPayload: pp } = await import('../src/gw/hook/struggle-detector.ts')
  return pp(...args)
}

// Entry guard: only spawn the CLI process when executed directly, not when imported.
if (new URL(import.meta.url).pathname === process.argv[1]) {
  process.exit(spawnSync(b, [...a, 'hook', 'struggle-detector'], { stdio: 'inherit' }).status ?? 0)
}
