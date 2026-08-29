import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { type GwEnvelope, okEnvelope, errEnvelope } from '../envelope.js'

export async function run(args: string[], cwd: string): Promise<GwEnvelope> {
  if (args.length < 2) {
    return errEnvelope('append', 'USAGE_ERROR', 'Usage: gw append <path> <text>', 2)
  }
  const filePath = path.resolve(cwd, args[0])
  const text = args.slice(1).join(' ')
  try {
    const existing = readFileSync(filePath, 'utf8')
    const separator = existing.endsWith('\n') ? '' : '\n'
    writeFileSync(filePath, existing + separator + text + '\n', 'utf8')
    return okEnvelope('append', { path: filePath, appended: text })
  } catch {
    return errEnvelope('append', 'WRITE_ERROR', `Cannot append to file: ${filePath}`, 1)
  }
}
