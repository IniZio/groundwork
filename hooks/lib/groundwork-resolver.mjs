/**
 * groundwork-resolver — answers "where is this groundwork installation?"
 *
 * For use by T32 (auto-install) and T33 (`gw hooks` CLI) at install time.
 * Import from any code running within the groundwork tree to obtain the
 * absolute path to groundwork's hooks/lib directory before writing a host
 * repo's commit-msg hook.
 *
 * Works regardless of install method (clone, marketplace, symlink) —
 * import.meta.url always resolves to the real on-disk file, not any symlink.
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const _thisFile = fileURLToPath(import.meta.url)
const _thisDir = dirname(_thisFile)

// This file lives at <groundwork-root>/hooks/lib/groundwork-resolver.mjs
// Two levels up: lib/ → hooks/ → <root>

/**
 * Returns the absolute path to groundwork's hooks/lib directory.
 * Pass this value to renderCommitMsgHook() as `hooksLibPath`.
 */
export function getHooksLibPath() {
  return _thisDir
}

/**
 * Returns the absolute path to the groundwork root (the repo/plugin directory).
 * The root contains hooks/, src/, agents/, etc.
 */
export function getGroundworkRoot() {
  return resolve(_thisDir, '..', '..')
}
