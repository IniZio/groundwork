import { type GwEnvelope, errEnvelope } from './envelope.js'
import { LEDGER_SUBCOMMANDS } from './commands/ledger.js'
import { JOURNAL_SUBCOMMANDS } from './commands/journal.js'
import { COMMENT_DENSITY_SUBCOMMANDS } from './commands/comment-density.js'

/**
 * Routing convention:
 *   gw ledger <subcmd>   — namespaced, mirrors bin/ledger vocabulary
 *   gw journal <subcmd>  — namespaced, mirrors bin/journal vocabulary
 * All other commands are flat (gw cat, gw locate, …).
 */

// Command metadata for --help display
export const COMMANDS: Record<string, { summary: string }> = {
  cat: { summary: "Print a file's content" },
  locate: { summary: 'Resolve a groundwork ID to an on-disk path' },
  'get-property': { summary: 'Read a frontmatter property from a Markdown file' },
  'set-property': { summary: 'Write a frontmatter property to a Markdown file' },
  append: { summary: 'Append text to a file' },
  link: { summary: 'Write bidirectional wikilink properties between two files' },
  hook: { summary: '(S3) Run a named hook' },
  migrate: { summary: '(future) Migrate groundwork artefacts' },
  ledger: { summary: 'Ledger subcommands (see below)' },
  journal: { summary: 'Journal subcommands (see below)' },
  'comment-density': { summary: 'Comment-density report and remediation plan' },
}

export function helpText(): string {
  const lines = ['gw — groundwork CLI', '', 'Usage: gw <command> [args] [--json]', '', 'Commands:']
  for (const [name, { summary }] of Object.entries(COMMANDS)) {
    lines.push(`  ${name.padEnd(18)} ${summary}`)
  }
  lines.push('')
  lines.push('Ledger subcommands (via gw ledger <subcmd>):')
  lines.push(`  ${LEDGER_SUBCOMMANDS.join(', ')}`)
  lines.push('')
  lines.push('Journal subcommands (via gw journal <subcmd>):')
  lines.push(`  ${JOURNAL_SUBCOMMANDS.join(', ')}`)
  lines.push('')
  lines.push('Comment-density subcommands (via gw comment-density <subcmd>):')
  lines.push(`  ${COMMENT_DENSITY_SUBCOMMANDS.join(', ')}`)
  lines.push('')
  lines.push('Flags:')
  lines.push('  --json     Emit machine-parseable JSON envelope on stdout')
  lines.push('  --help, -h Show this help')
  return lines.join('\n')
}

type CommandRunner = (args: string[], cwd: string) => Promise<GwEnvelope>

// Lazy-load commands so the router compiles without all handlers present
const loaders: Record<string, () => Promise<{ run: CommandRunner }>> = {
  cat: () => import('./commands/cat.js'),
  locate: () => import('./commands/locate.js'),
  'get-property': () => import('./commands/get-property.js'),
  'set-property': () => import('./commands/set-property.js'),
  append: () => import('./commands/append.js'),
  link: () => import('./commands/link.js'),
  hook: () => import('./commands/hook.js'),
  migrate: () => import('./commands/migrate.js'),
  ledger: () => import('./commands/ledger.js'),
  journal: () => import('./commands/journal.js'),
  'comment-density': () => import('./commands/comment-density.js'),
}

export async function dispatch(command: string, args: string[], cwd: string): Promise<GwEnvelope> {
  const loader = loaders[command]
  if (!loader) {
    return errEnvelope(
      command,
      'UNKNOWN_COMMAND',
      `Unknown command: "${command}". Run "gw --help" for usage.`,
      2,
    )
  }
  const mod = await loader()
  return mod.run(args, cwd)
}
