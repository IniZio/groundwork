import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Walk up from `start` until a `.git` directory is found.
 * Returns the directory containing `.git`, or null if not found.
 */
export function findGitRoot(start: string): string | null {
  let current = path.resolve(start)
  while (true) {
    if (existsSync(path.join(current, '.git'))) return current
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}
