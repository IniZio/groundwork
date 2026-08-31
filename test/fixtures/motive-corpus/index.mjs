/**
 * index.mjs — motive-corpus fixture loader
 *
 * Exports the fixture directory and its known slug set so test files can
 * switch between fixture (default) and live corpus (USE_LIVE_CORPUS=1).
 *
 * The fixture is a self-contained project dir: it has .groundwork/journal/
 * and .groundwork/motives/<slug>/ exactly as a live project would. Pass
 * FIXTURE_DIR as projectDir to assembleMotiveGraph() and readCharter(),
 * FIXTURE_JOURNAL_DIR to readOrderedEvents() and assertFoldCompileParity().
 *
 * FIXTURE_SLUGS is the canonical, exact slug set for the committed snapshot.
 * Tests use this instead of a dynamic readdirSync() glob so the harness
 * remains deterministic even as the live motive directory changes.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const FIXTURE_DIR = __dirname
export const FIXTURE_JOURNAL_DIR = path.join(__dirname, '.groundwork', 'journal')
export const FIXTURE_MOTIVES_DIR = path.join(__dirname, '.groundwork', 'motives')
export const FIXTURE_SLUGS = [
  'groundwork-development',
  'obsidian-native-groundwork',
]
