import { readFileSync } from 'node:fs'
import path from 'node:path'
import { type GwEnvelope, okEnvelope, errEnvelope } from '../envelope.js'

export async function run(args: string[], cwd: string): Promise<GwEnvelope> {
  if (args.length === 0) {
    return errEnvelope('cat', 'USAGE_ERROR', 'Usage: gw cat <path>', 2)
  }
  const filePath = path.resolve(cwd, args[0])
  try {
    const content = readFileSync(filePath, 'utf8')
    return okEnvelope('cat', { path: filePath, content })
  } catch {
    return errEnvelope('cat', 'READ_ERROR', `Cannot read file: ${filePath}`, 1)
  }
}
