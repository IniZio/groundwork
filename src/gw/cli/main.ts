#!/usr/bin/env bun
import process from 'node:process'
import { dispatch, helpText } from './router.js'
import { type GwEnvelope } from './envelope.js'

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2)

  // Strip --json flag wherever it appears
  const jsonIdx = rawArgs.indexOf('--json')
  const useJson = jsonIdx !== -1
  if (useJson) rawArgs.splice(jsonIdx, 1)

  // Help shortcut
  if (rawArgs.length === 0 || rawArgs[0] === '--help' || rawArgs[0] === '-h' || rawArgs[0] === 'help') {
    process.stdout.write(helpText() + '\n')
    process.exit(0)
  }

  const [command, ...args] = rawArgs
  const cwd = process.cwd()

  let envelope: GwEnvelope
  try {
    envelope = await dispatch(command, args, cwd)
  } catch (e) {
    envelope = {
      ok: false,
      command: command ?? 'unknown',
      error: {
        code: 'INTERNAL_ERROR',
        message: e instanceof Error ? e.message : String(e),
      },
      exit: 1,
    }
  }

  if (useJson) {
    process.stdout.write(JSON.stringify(envelope) + '\n')
  } else {
    if (envelope.ok) {
      const data = envelope.data
      if (typeof data === 'object' && data !== null && 'content' in data) {
        process.stdout.write(String((data as Record<string, unknown>).content) + '\n')
      } else if (typeof data === 'object' && data !== null && 'path' in data) {
        process.stdout.write(String((data as Record<string, unknown>).path) + '\n')
      } else {
        process.stdout.write(JSON.stringify(data, null, 2) + '\n')
      }
    } else {
      process.stderr.write(`gw ${command}: ${envelope.error.message}\n`)
    }
  }

  process.exit(envelope.exit)
}

main().catch(e => {
  process.stderr.write(`gw: unexpected error: ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
