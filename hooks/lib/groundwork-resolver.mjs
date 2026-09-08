/**
 * Works regardless of install method (clone, marketplace, symlink) —
 * import.meta.url always resolves to the real on-disk file, not any symlink.
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const _thisFile = fileURLToPath(import.meta.url)
const _thisDir = dirname(_thisFile)

// This file lives at <groundwork-root>/hooks/lib/groundwork-resolver.mjs
// Two levels up: lib/ → hooks/ → <root>

export function getHooksLibPath() {
  return _thisDir
}

export function getGroundworkRoot() {
  return resolve(_thisDir, '..', '..')
}
