import { readFileSync } from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { type GwEnvelope, okEnvelope, errEnvelope } from '../envelope.js'
import { setProperty, wikilink } from '../../../gw/fm/index.js'

/**
 * Append a wikilink to a list-property in a markdown file's frontmatter.
 * Uses setProperty (surgical write). If the property already contains the link,
 * it is not duplicated.
 */
function appendWikilink(filePath: string, key: string, targetPath: string): void {
  const src = readFileSync(filePath, 'utf8')
  const { data } = matter(src)
  const link = wikilink(path.basename(targetPath, '.md'))

  let list: string[]
  const current = data[key]
  if (Array.isArray(current)) {
    list = current as string[]
  } else if (typeof current === 'string' && current.length > 0) {
    list = [current]
  } else {
    list = []
  }

  if (!list.includes(link)) {
    list.push(link)
  }

  setProperty(filePath, key, list.length === 1 ? list[0] : list)
}

export async function run(args: string[], cwd: string): Promise<GwEnvelope> {
  if (args.length < 3) {
    return errEnvelope(
      'link',
      'USAGE_ERROR',
      'Usage: gw link <src-path> <type> <dst-path>',
      2,
    )
  }
  const srcPath = path.resolve(cwd, args[0])
  const type = args[1]
  const dstPath = path.resolve(cwd, args[2])

  try {
    appendWikilink(srcPath, type, dstPath)
  } catch {
    return errEnvelope('link', 'WRITE_ERROR', `Cannot write to src file: ${srcPath}`, 1)
  }
  try {
    appendWikilink(dstPath, type, srcPath)
  } catch {
    return errEnvelope('link', 'WRITE_ERROR', `Cannot write to dst file: ${dstPath}`, 1)
  }

  return okEnvelope('link', {
    src: srcPath,
    dst: dstPath,
    type,
    srcLink: wikilink(path.basename(dstPath, '.md')),
    dstLink: wikilink(path.basename(srcPath, '.md')),
  })
}
