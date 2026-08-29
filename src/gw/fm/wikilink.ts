const EXT_RE = /\.(md|txt)$/i

function stripExt(s: string): string {
  return s.replace(EXT_RE, '')
}

export function escapeTarget(s: string): string {
  return s
    .replace(/\^/g, '%5E')
    .replace(/\[/g, '%5B')
    .replace(/\]/g, '%5D')
}

export function escapeAlias(s: string): string {
  return s
    .replace(/#/g, '%23')
    .replace(/\|/g, '%7C')
    .replace(/\^/g, '%5E')
    .replace(/\[/g, '%5B')
    .replace(/\]/g, '%5D')
}

/**
 * Format a string as an Obsidian wikilink.
 * - Strips .md and .txt extensions from `target`
 * - Escapes ^ [ ] in target; # | ^ [ ] in alias
 * @param target  Link destination (file path relative to vault root, no extension needed)
 * @param alias   Optional display text
 */
export function wikilink(target: string, alias?: string): string {
  const t = escapeTarget(stripExt(target))
  if (alias === undefined) return `[[${t}]]`
  return `[[${t}|${escapeAlias(alias)}]]`
}
