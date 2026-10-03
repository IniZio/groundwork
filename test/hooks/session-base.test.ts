import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { sessionBase } from '../../src/hooks/lib/session-base.js'
import { sessionBase as ref } from '../../plugins/house-rules/src/hooks/lib/work-scope.js'

const ROOT = resolve(import.meta.dir, '../..')
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const T = (s: number) => new Date(s * 1000).toISOString()

let tmp: string, repo: string, shas: string[] = [], head: string

function commit(n: number, epoch: number) {
  const env = { ...process.env, GIT_AUTHOR_DATE: `${epoch} +0000`, GIT_COMMITTER_DATE: `${epoch} +0000`,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
  writeFileSync(join(repo, 'f'), String(n))
  execFileSync('git', ['-C', repo, 'add', 'f'], { env })
  execFileSync('git', ['-C', repo, 'commit', '-qm', `c${n}`, '--no-verify'], { env })
  shas.push(execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim())
}
const tr = (name: string, body: string) => { const p = join(tmp, name); writeFileSync(p, body); return p }

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sb-'))
  repo = join(tmp, 'repo'); mkdirSync(repo)
  execFileSync('git', ['-C', repo, 'init', '-q'])
  commit(1, 1_700_000_000); commit(2, 1_700_001_000); commit(3, 1_700_002_000)
  head = shas[2]
})
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('sessionBase parity with house-rules', () => {
  const cases: Array<[string, () => string, string]> = [
    ['between commits', () => tr('a', JSON.stringify({ timestamp: T(1_700_001_500) }) + '\n'), 'c2'],
    ['leading non-timestamped lines', () => tr('b', 'garbage\n{"type":"x"}\n\n' + JSON.stringify({ timestamp: T(1_700_001_500) }) + '\n'), 'c2'],
    ['ts equal to commit time is strict', () => tr('c', JSON.stringify({ timestamp: T(1_700_001_000) }) + '\n'), 'c1'],
    ['after all commits', () => tr('d', JSON.stringify({ timestamp: T(1_800_000_000) }) + '\n'), 'c3'],
    ['before all commits', () => tr('e', JSON.stringify({ timestamp: T(1_600_000_000) }) + '\n'), 'empty'],
  ]
  for (const [name, mk, want] of cases) {
    it(name, () => {
      const p = mk()
      const got = sessionBase(p, repo)
      expect(got).toBe(ref(p, repo))
      expect(got).toBe(want === 'empty' ? EMPTY_TREE : shas[Number(want[1]) - 1])
    })
  }

  it('empty transcript: documented fallback HEAD (house-rules: EMPTY_TREE)', () => {
    const p = tr('empty', '')
    expect(ref(p, repo)).toBe(EMPTY_TREE)
    expect(sessionBase(p, repo)).toBe(head)
  })
  it('missing transcript: documented fallback HEAD (house-rules: EMPTY_TREE)', () => {
    const p = join(tmp, 'nope')
    expect(ref(p, repo)).toBe(EMPTY_TREE)
    expect(sessionBase(p, repo)).toBe(head)
    expect(sessionBase(undefined, repo)).toBe(head)
  })
})

describe('sessionBase — installed-cache layout (no plugins/, no package.json)', () => {
  it('resolves by deployed path', () => {
    const cache = join(tmp, 'cache')
    mkdirSync(join(cache, 'src/hooks/lib'), { recursive: true })
    cpSync(join(ROOT, 'src/hooks/lib/session-base.ts'), join(cache, 'src/hooks/lib/session-base.ts'))
    const p = tr('cachets', JSON.stringify({ timestamp: T(1_700_001_500) }) + '\n')
    const out = execFileSync(process.execPath, ['-e',
      `import { sessionBase } from ${JSON.stringify(join(cache, 'src/hooks/lib/session-base.js'))}; console.log(sessionBase(${JSON.stringify(p)}, ${JSON.stringify(repo)}))`],
      { encoding: 'utf8', cwd: cache }).trim()
    expect(out).toBe(shas[1])
  })
})
