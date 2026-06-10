// ─── robust_read Tool ──────────────────────────────────────────────────────
// A read tool that never fails in background tasks.
// Uses direct fs with retry + backoff, falls back to `cat` via child_process.
// Upgraded version of the built-in read tool with reliability improvements.

import { tool } from '@opencode-ai/plugin'
import { z } from 'zod'
import { readFile, stat, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve, isAbsolute, basename } from 'node:path'
import type { ToolDeps } from './deps.js'

const MAX_RETRIES = 3
const BASE_DELAY_MS = 100
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const CHUNK_SIZE = 1000 // lines per chunk for large files
const PREVIEW_LINES = 50 // lines to show for very large files

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function isBinaryContent(buffer: Buffer): boolean {
  // Check for null bytes or high concentration of non-printable characters
  const sampleSize = Math.min(buffer.length, 8000)
  let nonPrintable = 0
  for (let i = 0; i < sampleSize; i++) {
    const byte = buffer[i]
    if (byte === 0) return true // Null byte = binary
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      nonPrintable++
    }
  }
  return nonPrintable / sampleSize > 0.3
}

async function robustReadFile(filePath: string, encoding?: string): Promise<{ 
  success: true; 
  content: string; 
  size: number; 
  strategy: string;
  isBinary: boolean;
} | { 
  success: false; 
  error: string; 
  strategies: string[] 
}> {
  const strategies: string[] = []
  const targetEncoding = encoding || 'utf8'

  // Strategy 1: Direct fs.readFile with retries
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const stats = await stat(filePath)
      if (!stats.isFile()) {
        return { success: false, error: `Not a file: ${filePath}`, strategies: [`fs.stat (attempt ${attempt})`] }
      }
      if (stats.size > MAX_FILE_SIZE) {
        return { success: false, error: `File too large: ${stats.size} bytes (max ${MAX_FILE_SIZE})`, strategies: ['fs.stat'] }
      }
      
      // Read as buffer first to detect binary
      const buffer = await readFile(filePath)
      const isBinary = isBinaryContent(buffer)
      
      let content: string
      if (isBinary) {
        // For binary files, provide hex dump of first 1KB
        content = buffer.slice(0, 1024).toString('hex').match(/.{1,64}/g)?.join('\n') || ''
        return { success: true, content, size: stats.size, strategy: `fs.readFile (binary, attempt ${attempt})`, isBinary }
      }
      
      content = buffer.toString(targetEncoding as BufferEncoding)
      return { success: true, content, size: stats.size, strategy: `fs.readFile (attempt ${attempt})`, isBinary }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      strategies.push(`fs.readFile attempt ${attempt}: ${msg}`)
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt - 1))
      }
    }
  }

  // Strategy 2: cat via child_process
  try {
    const content = execSync(`cat ${JSON.stringify(filePath)}`, {
      encoding: targetEncoding as BufferEncoding,
      maxBuffer: MAX_FILE_SIZE,
      timeout: 5000,
    })
    const buffer = Buffer.from(content)
    const isBinary = isBinaryContent(buffer)
    return { success: true, content, size: Buffer.byteLength(content), strategy: 'execSync(cat)', isBinary }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    strategies.push(`execSync(cat): ${msg}`)
  }

  // Strategy 3: Try with Bun.file if available
  try {
    // @ts-ignore - Bun global
    if (typeof Bun !== 'undefined') {
      // @ts-ignore
      const file = Bun.file(filePath)
      const buffer = await file.arrayBuffer()
      const isBinary = isBinaryContent(Buffer.from(buffer))
      const content = new TextDecoder(targetEncoding).decode(buffer)
      return { success: true, content, size: buffer.byteLength, strategy: 'Bun.file', isBinary }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    strategies.push(`Bun.file: ${msg}`)
  }

  return { success: false, error: `All read strategies failed for ${filePath}`, strategies }
}

function formatContent(content: string, offset?: number, limit?: number): { lines: string[]; totalLines: number; truncated: boolean } {
  const allLines = content.split('\n')
  const totalLines = allLines.length
  
  const start = offset ?? 0
  let end = limit !== undefined ? start + limit : totalLines
  
  // If file is very large, show preview instead
  if (totalLines > CHUNK_SIZE && limit === undefined) {
    end = start + PREVIEW_LINES
  }
  
  const truncated = end < totalLines
  const lines = allLines.slice(start, end)
  
  return { lines, totalLines, truncated }
}

export function createRobustReadTool(_deps: ToolDeps) {
  return tool({
    description: `Read a file with maximum reliability. Uses direct filesystem access with retry+backoff, falls back to shell commands. Supports line-based chunking, binary detection, and encoding. Designed to never fail in background tasks.`,
    args: {
      path: z.string().describe('Path to the file to read (absolute or relative to workspace)'),
      encoding: z.string().optional().describe('Encoding (default: utf8, options: utf8, utf16le, latin1, ascii)'),
      offset: z.number().optional().describe('Line number to start reading from (0-based)'),
      limit: z.number().optional().describe('Maximum number of lines to read'),
      chunk: z.number().optional().describe('Read a specific chunk of lines (each chunk is 1000 lines, 0-based)'),
    },
    async execute(args: any, _toolContext: any) {
      const filePath = isAbsolute(args.path) ? args.path : resolve(_deps.directory, args.path)

      // Check if path exists
      if (!existsSync(filePath)) {
        return `Error: File not found: ${filePath}`
      }

      // Check if it's a directory BEFORE calling robustReadFile
      const pathStats = await stat(filePath).catch(() => null)
      if (pathStats?.isDirectory()) {
        try {
          const entries = await readdir(filePath, { withFileTypes: true })
          const files = entries.map(e => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`).join('\n')
          return `Directory: ${filePath}\n${files}`
        } catch (err) {
          return `Error: Cannot read directory ${filePath}: ${err instanceof Error ? err.message : String(err)}`
        }
      }

      const result = await robustReadFile(filePath, args.encoding)

      if (!result.success && result.error.includes('Not a file')) {
        // It might be a directory that we couldn't stat, try listing it
        try {
          const entries = await readdir(filePath, { withFileTypes: true })
          const files = entries.map(e => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`).join('\n')
          return `Directory: ${filePath}\n${files}`
        } catch {
          // If readdir also fails, return the original error
        }
      }

      if (!result.success) {
        return `Error: ${result.error}\n\nStrategies attempted:\n${result.strategies.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
      }

      let content = result.content
      let offset = args.offset
      let limit = args.limit

      // Handle chunk parameter
      if (args.chunk !== undefined) {
        offset = args.chunk * CHUNK_SIZE
        limit = CHUNK_SIZE
      }

      const { lines, totalLines, truncated } = formatContent(content, offset, limit)

      // Build output
      let output = `File: ${filePath} (${result.size} bytes, ${totalLines} lines, read via ${result.strategy})`
      
      if (result.isBinary) {
        output += '\n[Binary file detected - showing hex dump of first 1KB]'
      }

      if (truncated && args.chunk === undefined && limit === undefined) {
        output += `\n[File truncated - showing lines ${offset || 0}-${(offset || 0) + lines.length} of ${totalLines}. Use offset/limit or chunk parameter to read more]`
      }

      output += '\n'

      // Add line numbers
      const startLine = offset ?? 0
      const numbered = lines.map((line, i) => `${startLine + i + 1}: ${line}`).join('\n')
      output += numbered

      if (truncated && args.chunk !== undefined) {
        const nextChunk = args.chunk + 1
        const totalChunks = Math.ceil(totalLines / CHUNK_SIZE)
        output += `\n\n[Chunk ${args.chunk + 1}/${totalChunks}. Use chunk=${nextChunk} to read next chunk]`
      }

      return output
    },
  })
}
