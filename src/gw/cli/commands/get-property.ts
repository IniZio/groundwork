import { readFileSync } from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { type GwEnvelope, okEnvelope, errEnvelope } from '../envelope.js'

export async function run(args: string[], cwd: string): Promise<GwEnvelope> {
  if (args.length < 2) {
    return errEnvelope('get-property', 'USAGE_ERROR', 'Usage: gw get-property <path> <key>', 2)
  }
  const filePath = path.resolve(cwd, args[0])
  const key = args[1]
  try {
    const src = readFileSync(filePath, 'utf8')
    const { data } = matter(src)
    const value = Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null
    return okEnvelope('get-property', { path: filePath, key, value })
  } catch {
    return errEnvelope('get-property', 'READ_ERROR', `Cannot read file: ${filePath}`, 1)
  }
}
