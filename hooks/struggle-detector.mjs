#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

// Re-export processPayload so test consumers can import this shim directly.
// Vitest/Bun transforms .ts imports; this export is a no-op when run as a CLI script.
export { processPayload } from '../src/gw/hook/struggle-detector.ts'

const d = dirname(new URL(import.meta.url).pathname)
const g = resolve(d, '../dist/gw')
const [b, ...a] = existsSync(g) ? [g] : ['bun', resolve(d, '../src/gw/cli/main.ts')]

// Entry guard: only spawn the CLI process when executed directly, not when imported.
if (new URL(import.meta.url).pathname === process.argv[1]) {
  process.exit(spawnSync(b, [...a, 'hook', 'struggle-detector'], { stdio: 'inherit' }).status ?? 0)
}
