import path from 'node:path'
import { type GwEnvelope, okEnvelope, errEnvelope } from '../envelope.js'
import { setProperty } from '../../../gw/fm/index.js'

type ValueType = 'string' | 'number' | 'boolean' | 'list'

function coerce(raw: string, type: ValueType): unknown {
  switch (type) {
    case 'number': {
      const n = Number(raw)
      if (isNaN(n)) throw new Error(`Cannot coerce "${raw}" to number`)
      return n
    }
    case 'boolean':
      if (raw === 'true') return true
      if (raw === 'false') return false
      throw new Error(`Cannot coerce "${raw}" to boolean — use "true" or "false"`)
    case 'list':
      return raw.split(',').map(s => s.trim()).filter(Boolean)
    case 'string':
    default:
      return raw
  }
}

export async function run(args: string[], cwd: string): Promise<GwEnvelope> {
  // Strip --type flag
  let type: ValueType = 'string'
  const remaining: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--type' && i + 1 < args.length) {
      const t = args[++i]
      if (t !== 'string' && t !== 'number' && t !== 'boolean' && t !== 'list') {
        return errEnvelope(
          'set-property',
          'USAGE_ERROR',
          `--type must be one of: string, number, boolean, list`,
          2,
        )
      }
      type = t as ValueType
    } else {
      remaining.push(args[i])
    }
  }

  if (remaining.length < 3) {
    return errEnvelope(
      'set-property',
      'USAGE_ERROR',
      'Usage: gw set-property <path> <key> <value> [--type string|number|boolean|list]',
      2,
    )
  }

  const filePath = path.resolve(cwd, remaining[0])
  const key = remaining[1]
  const rawValue = remaining[2]

  let value: unknown
  try {
    value = coerce(rawValue, type)
  } catch (e) {
    return errEnvelope('set-property', 'COERCE_ERROR', String(e instanceof Error ? e.message : e), 1)
  }

  try {
    setProperty(filePath, key, value)
    return okEnvelope('set-property', { path: filePath, key, value })
  } catch {
    return errEnvelope('set-property', 'WRITE_ERROR', `Cannot write file: ${filePath}`, 1)
  }
}
