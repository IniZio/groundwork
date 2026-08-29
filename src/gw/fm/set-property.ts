import { readFileSync, writeFileSync } from 'node:fs'

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function serializeScalar(s: unknown): string {
  if (typeof s !== 'string') return String(s)
  if (s.startsWith('[[') || /^[\-{}\[\]#&*?|><!=,%@`]/.test(s) || s.includes(': ') || s.includes('\n')) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return s
}

function serializeValue(value: unknown): string {
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number') return String(value)
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return '\n' + (value as unknown[]).map(item => `  - ${serializeScalar(item)}`).join('\n')
  }
  if (typeof value === 'string') return serializeScalar(value)
  return JSON.stringify(value)
}

/**
 * Pure version of setProperty — operates on string content.
 * Returns the modified content string.
 */
export function setPropertyInContent(content: string, key: string, value: unknown): string {
  const lines = content.split('\n')

  // Find frontmatter block
  if (lines[0] !== '---') {
    // No frontmatter — if adding, prepend a new block
    if (value === undefined) return content  // delete on absent key: no-op
    const block = `---\n${key}: ${serializeValue(value)}\n---\n`
    return block + content
  }

  const fmEnd = lines.indexOf('---', 1)
  if (fmEnd === -1) return content  // malformed frontmatter

  // Find the key's line range within the frontmatter [1, fmEnd)
  const keyRe = new RegExp(`^${escapeRegex(key)}:( |$)`)

  let keyLineIndex = -1
  for (let i = 1; i < fmEnd; i++) {
    if (keyRe.test(lines[i])) {
      keyLineIndex = i
      break
    }
  }

  // Find end of key's value range (continuation lines are indented)
  function findRangeEnd(startIdx: number): number {
    let end = startIdx + 1
    while (end < fmEnd && /^[ \t]/.test(lines[end])) {
      end++
    }
    return end
  }

  if (value === undefined) {
    // Delete
    if (keyLineIndex === -1) return content  // key absent — no-op
    const rangeEnd = findRangeEnd(keyLineIndex)
    lines.splice(keyLineIndex, rangeEnd - keyLineIndex)
    return lines.join('\n')
  }

  const serialized = `${key}: ${serializeValue(value)}`
  const newLines = serialized.split('\n')

  if (keyLineIndex === -1) {
    // Add new key before the closing ---
    lines.splice(fmEnd, 0, ...newLines)
    return lines.join('\n')
  }

  // Replace existing key's range
  const rangeEnd = findRangeEnd(keyLineIndex)
  lines.splice(keyLineIndex, rangeEnd - keyLineIndex, ...newLines)
  return lines.join('\n')
}

/**
 * Surgical frontmatter property write.
 *
 * Finds the key in the YAML frontmatter block and:
 * - Replaces its value (and any continuation lines) if found
 * - Inserts the key before the closing --- if not found
 * - Removes the key if value is undefined
 *
 * All lines NOT in the target key's range are byte-identical to the original.
 *
 * @param filePath  Absolute path to the Markdown file
 * @param key       YAML key to set/add/delete
 * @param value     New value; pass undefined to delete the key
 */
export function setProperty(filePath: string, key: string, value: unknown): void {
  const src = readFileSync(filePath, 'utf8')
  const result = setPropertyInContent(src, key, value)
  writeFileSync(filePath, result, 'utf8')
}
