/**
 * Suite-level guard: every bare-path hook registered in hooks.json must be
 * executable so the shell can invoke it directly (mode 0xxx with exec bits).
 *
 * Background: hooks/hooks.json registers commands as bare paths
 * (`${CLAUDE_PLUGIN_ROOT}/hooks/<name>.mjs`). The Claude Code harness
 * exec()s these directly — it does NOT prepend `node`. A file at mode 0664
 * gets exit 126 (Permission denied) and the hook silently never fires.
 *
 * The 25 tests for each individual hook avoid this because they call
 * `execFileSync("node", [HOOK], …)`, bypassing the exec bit entirely.
 * This test closes that gap.
 */

import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')
const HOOKS_JSON = resolve(REPO_ROOT, 'hooks', 'hooks.json')

// Known interpreter prefixes — if the first token of a command is one of
// these, the file does NOT need to be executable itself.
const INTERPRETERS = new Set(['node', 'bash', 'sh', 'python', 'python3', 'bun'])

interface RegisteredHook {
  /** Raw command string from hooks.json */
  command: string
  /** True if the command IS the executable (no interpreter prefix) */
  isBare: boolean
  /** Resolved absolute path to the hook file */
  resolvedPath: string
}

function parseRegisteredHooks(): RegisteredHook[] {
  const json = JSON.parse(readFileSync(HOOKS_JSON, 'utf8')) as {
    hooks: Record<string, Array<{ hooks?: Array<{ command: string }> }>>
  }
  const results: RegisteredHook[] = []
  for (const hookList of Object.values(json.hooks)) {
    for (const group of hookList) {
      for (const entry of group.hooks ?? []) {
        const cmd = entry.command
        const tokens = cmd.split(/\s+/)
        const firstToken = tokens[0]
        const isBare = !INTERPRETERS.has(firstToken)

        // Resolve ${CLAUDE_PLUGIN_ROOT} → REPO_ROOT, then pick the path token.
        // Bare:        "${CLAUDE_PLUGIN_ROOT}/hooks/foo.mjs"  → tokens[0] is the path
        // Interpreter: "node ${CLAUDE_PLUGIN_ROOT}/hooks/foo.mjs" → tokens[1] is the path
        const expanded = cmd.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, REPO_ROOT)
        const expandedTokens = expanded.split(/\s+/)
        const resolvedPath = isBare ? expandedTokens[0] : expandedTokens[1]

        results.push({ command: cmd, isBare, resolvedPath })
      }
    }
  }
  return results
}

const EXEC_BIT = 0o111 // any exec bit (owner | group | other)

function isExecutable(filePath: string): boolean {
  try {
    return (statSync(filePath).mode & EXEC_BIT) !== 0
  } catch {
    return false
  }
}

function firstLine(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8').split('\n')[0] ?? ''
  } catch {
    return ''
  }
}

const allHooks = parseRegisteredHooks()
const bareHooks = allHooks.filter(h => h.isBare)

describe('hooks-registration — exec bit sweep', () => {
  it('has at least one registered bare-path hook (sanity)', () => {
    expect(bareHooks.length).toBeGreaterThan(0)
  })

  it('every bare-path hook file is executable (no mode-0664 hooks)', () => {
    const broken = bareHooks.filter(h => !isExecutable(h.resolvedPath))
    const report = broken.map(h => `  ${h.resolvedPath}  (command: ${h.command})`).join('\n')
    expect(broken, `Non-executable bare-path hooks — add chmod +x:\n${report}`).toHaveLength(0)
  })

  it('every bare-path .mjs hook has #!/usr/bin/env node shebang', () => {
    const mjsHooks = bareHooks.filter(h => h.resolvedPath.endsWith('.mjs'))
    const badShebang = mjsHooks.filter(h => firstLine(h.resolvedPath) !== '#!/usr/bin/env node')
    const report = badShebang
      .map(h => `  ${h.resolvedPath}  got: ${JSON.stringify(firstLine(h.resolvedPath))}`)
      .join('\n')
    expect(badShebang, `Bare-path .mjs hooks with wrong/missing shebang:\n${report}`).toHaveLength(0)
  })
})
