/**
 * test/gw/parity/corpus-loader.ts
 *
 * Loads all parity-corpus JSON fixtures from test/fixtures/parity-corpus/.
 * The corpus is the immutable ground-truth (legacy) baseline captured before the
 * hook shim conversion.  AC-3: parity suite feeds every scenario to the gw path
 * and asserts decisions match.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const REPO_ROOT = path.resolve(__dirname, '../../..')
export const CORPUS_DIR = path.join(REPO_ROOT, 'test/fixtures/parity-corpus')

/** A disk_state_setup entry — either a shell command (string) or a file-write spec. */
export type DiskSetupEntry =
  | string
  | { path: string; content_summary?: string; content: unknown }

/** Standard single-invocation fixture (PreToolUse, PostToolUse, Stop, SessionStart). */
export interface SingleFixture {
  hook: string
  hook_path: string
  event_type: 'PreToolUse' | 'PostToolUse' | 'Stop' | 'SessionStart'
  scenario_name: string
  description: string
  env: Record<string, string>
  disk_state_setup: DiskSetupEntry[]
  stdin_payload: unknown
  stdout: string
  stderr: string
  exit_code: number
  decision: string
  injected_model?: string | null
}

/** One call in a multi-invocation fixture (struggle-detector). */
export interface Invocation {
  stdin_payload: unknown
  stdout: string
  stderr: string
  exit_code: number
}

/** Multi-invocation fixture — struggle-detector runs the same hook N times on shared disk state. */
export interface MultiFixture
  extends Omit<SingleFixture, 'stdin_payload' | 'stdout' | 'stderr' | 'exit_code'> {
  invocations: Invocation[]
  signal_emitted?: boolean
  signal_kind?: string
  final_detector_state?: unknown
  expected_journal_events?: Array<{
    type: string
    source: string
    msg_contains: string
    data: { kind: string; fingerprint: string }
  }>
}

export type ParityFixture = SingleFixture | MultiFixture

export function isMultiFixture(f: ParityFixture): f is MultiFixture {
  return 'invocations' in f && Array.isArray((f as MultiFixture).invocations)
}

export interface LoadedScenario {
  hookName: string   // directory name, e.g. 'agent-model-guard'
  fixture: ParityFixture
  filePath: string   // absolute path to the .json file
}

/**
 * Load every *.json fixture from all hook sub-directories of the corpus.
 * Returns scenarios sorted by hookName then scenario_name for deterministic ordering.
 */
export function loadCorpus(): LoadedScenario[] {
  const scenarios: LoadedScenario[] = []

  const hookDirs = readdirSync(CORPUS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort()

  for (const hookDir of hookDirs) {
    const dirPath = path.join(CORPUS_DIR, hookDir)
    const files = readdirSync(dirPath)
      .filter(f => f.endsWith('.json'))
      .sort()

    for (const file of files) {
      const filePath = path.join(dirPath, file)
      const fixture = JSON.parse(readFileSync(filePath, 'utf8')) as ParityFixture
      scenarios.push({ hookName: hookDir, fixture, filePath })
    }
  }

  return scenarios
}
