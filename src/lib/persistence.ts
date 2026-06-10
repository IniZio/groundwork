import { promises as fsPromises } from 'node:fs'
import path from 'node:path'

const PERSISTENCE_DIR = '.opencode/background-tasks'

export class PersistenceLayer {
  constructor() {}

  artifactPath(taskId: string, parentSessionID: string, directory: string): string {
    return path.join(directory, PERSISTENCE_DIR, parentSessionID, `${taskId}.md`)
  }

  artifactDir(taskId: string, parentSessionID: string, directory: string): string {
    return path.dirname(this.artifactPath(taskId, parentSessionID, directory))
  }

  async write(
    taskId: string,
    parentSessionID: string,
    directory: string,
    content: string,
    metadata: Record<string, any>
  ): Promise<string> {
    const dir = this.artifactDir(taskId, parentSessionID, directory)
    await fsPromises.mkdir(dir, { recursive: true })
    const frontmatter = Object.entries(metadata)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
    const md = `---\n${frontmatter}\n---\n\n${content}`
    await fsPromises.writeFile(this.artifactPath(taskId, parentSessionID, directory), md, 'utf8')
    return this.artifactPath(taskId, parentSessionID, directory)
  }

  async read(taskId: string, parentSessionID: string, directory: string): Promise<string | null> {
    try {
      return await fsPromises.readFile(this.artifactPath(taskId, parentSessionID, directory), 'utf8')
    } catch {
      return null
    }
  }

  async remove(taskId: string, parentSessionID: string, directory: string): Promise<void> {
    try {
      await fsPromises.unlink(this.artifactPath(taskId, parentSessionID, directory))
    } catch {}
  }

  async listForSession(parentSessionID: string, directory: string): Promise<Array<Record<string, any>>> {
    const sessionDir = path.join(directory, PERSISTENCE_DIR, parentSessionID)
    try {
      const entries = await fsPromises.readdir(sessionDir)
      const results: Array<Record<string, any>> = []
      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue
        const content = await fsPromises.readFile(path.join(sessionDir, entry), 'utf8')
        const meta = this.parseFrontmatter(content)
        results.push({ id: entry.replace('.md', ''), ...meta })
      }
      return results
    } catch {
      return []
    }
  }

  /** Read just the frontmatter metadata for a task (searches all session dirs) */
  async readMeta(taskId: string, directory: string): Promise<Record<string, any> | null> {
    const baseDir = path.join(directory, PERSISTENCE_DIR)
    try {
      const sessions = await fsPromises.readdir(baseDir)
      for (const session of sessions) {
        const filePath = path.join(baseDir, session, `${taskId}.md`)
        try {
          const content = await fsPromises.readFile(filePath, 'utf8')
          return { id: taskId, ...this.parseFrontmatter(content) }
        } catch { continue }
      }
    } catch {}
    return null
  }

  /** Parse YAML frontmatter from persisted content */
  private parseFrontmatter(content: string): Record<string, string> {
    const match = content.match(/^---\n([\s\S]*?)\n---\n/)
    if (!match) return {}
    const meta: Record<string, string> = {}
    for (const line of match[1].split('\n')) {
      const colonIdx = line.indexOf(':')
      if (colonIdx > 0) meta[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim()
    }
    return meta
  }
}
