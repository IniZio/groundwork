import process from 'node:process'
import { HOOKS } from '../../hook/index.js'
import type { GwEnvelope } from '../envelope.js'

export async function run(args: string[], _cwd: string): Promise<GwEnvelope> {
  const name = args[0] ?? ''
  const hookFn = HOOKS[name]
  if (!hookFn) {
    process.stderr.write(`gw hook: unknown hook "${name}"\n`)
    process.exit(1)
  }
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  let input: unknown = {}
  try {
    if (raw.trim()) input = JSON.parse(raw)
  } catch {
    /* keep {} */
  }
  const result = await hookFn(input, process.env as Record<string, string | undefined>)
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exit(result.exit)
}
