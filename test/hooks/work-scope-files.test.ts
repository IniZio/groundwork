import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, cpSync, symlinkSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path, { join, resolve } from 'node:path'
import { sessionTouchedFiles } from '../../src/hooks/lib/work-scope-files.js'
import { touchedFiles } from '../../plugins/house-rules/src/hooks/lib/work-scope.js'

const ROOT = resolve(import.meta.dir, '../..')
const REPO = '/work/repo'
let tmp: string

const bash = (command: string, extra: Record<string, unknown> = {}) => entry('Bash', { command }, extra)
function entry(name: string, input: unknown, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ type: 'assistant', cwd: REPO, ...extra,
    message: { role: 'assistant', content: [{ type: 'text', text: 'x' }, { type: 'tool_use', id: 't', name, input }] } })
}
const main = [
  entry('Edit', { file_path: `${REPO}/src/edit.ts`, old_string: 'a', new_string: 'b' }),
  entry('Write', { file_path: `${REPO}/src/write.ts`, content: 'x' }),
  entry('MultiEdit', { file_path: `${REPO}/src/multi.ts`, edits: [] }),
  bash(`printf 'x' >> README.md`),
  bash(`cat > a.ts <<'EOF'\nhi\nEOF`),
  bash(`echo hi | tee out/tee.txt`),
  bash(`sed -i 's/a/b/' sed.ts`),
  bash(`cp one.ts copy.ts`),
  bash(`mv old.ts moved.ts`),
  bash(`echo x > $HOME/var.txt`),
  bash(`echo x > /tmp/scratch.txt`),
  bash(`python3 -c "open('py.txt','w').write('x')"`),
  JSON.stringify({ type: 'user', message: { content: 'hi' } }),
  'not json',
]
const sidechain = bash(`echo x > side.txt`, { isSidechain: true })
const EXPECTED = ['src/edit.ts', 'src/write.ts', 'src/multi.ts', 'README.md', 'a.ts', 'out/tee.txt', 'sed.ts', 'copy.ts', 'moved.ts'].sort()

const tr = (name: string, lines: string[]) => { const p = join(tmp, name); writeFileSync(p, lines.join('\n') + '\n'); return p }
const ref = (p: string) =>
  touchedFiles({ event: 'SubagentStop', transcriptPath: p, sessionId: '' })
    .map(f => path.relative(REPO, f)).filter(r => !r.startsWith('..')).sort()

beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'wsf-')) })
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('sessionTouchedFiles', () => {
  it('matches house-rules extraction on the same transcript', () => {
    const p = tr('parity.jsonl', main)
    const got = [...sessionTouchedFiles(p, REPO)].sort()
    expect(got).toEqual(ref(p))
    expect(got).toEqual(EXPECTED)
    for (const absent of ['var.txt', 'scratch.txt', 'py.txt']) expect(got.join()).not.toContain(absent)
  })

  it('matches house-rules extraction when the repo root is under tmpdir and /dev/shm', () => {
    for (const base of [tmpdir(), '/dev/shm']) {
      if (!existsSync(base)) continue
      const root = mkdtempSync(join(base, 'wsf-par-'))
      const out = mkdtempSync(join(base, 'wsf-parout-'))
      try {
        const p = tr('par-tmp.jsonl', [
          entry('Bash', { command: `echo x > ${root}/in.txt` }, { cwd: root }),
          entry('Bash', { command: `echo x > rel.txt` }, { cwd: root }),
          entry('Bash', { command: `echo x > ${out}/scratch.txt` }, { cwd: root }),
        ])
        const got = [...sessionTouchedFiles(p, root)].sort()
        const refGot = touchedFiles({ event: 'SubagentStop', transcriptPath: p, sessionId: '' })
          .map(f => path.relative(root, f)).filter(r => !r.startsWith('..')).sort()
        expect(got).toEqual(['in.txt', 'rel.txt'])
        expect(refGot).toEqual(got)
      } finally { rmSync(root, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }) }
    }
  })

  it('excludes sidechain entries (reference does not filter them)', () => {
    const p = tr('side.jsonl', [...main, sidechain])
    expect([...sessionTouchedFiles(p, REPO)].sort()).toEqual(EXPECTED)
    expect(ref(p)).toContain('side.txt')
  })

  it('returns empty set for unreadable transcript', () => {
    expect(sessionTouchedFiles(join(tmp, 'missing.jsonl'), REPO).size).toBe(0)
  })

  it('runs from a cache-like layout without plugins/ or package.json', () => {
    const dir = join(tmp, 'cache'); mkdirSync(dir)
    cpSync(join(ROOT, 'src/hooks/lib/work-scope-files.ts'), join(dir, 'work-scope-files.ts'))
    const p = tr('cache.jsonl', main)
    writeFileSync(join(dir, 'run.ts'),
      `import { sessionTouchedFiles } from './work-scope-files.ts'\n` +
      `console.log(JSON.stringify([...sessionTouchedFiles(process.argv[2], process.argv[3])].sort()))\n`)
    const r = spawnSync(process.execPath, [join(dir, 'run.ts'), p, REPO], { encoding: 'utf8', cwd: dir })
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual(EXPECTED)
  })

  it('attributes Bash writes inside a repo rooted under the tmp dir; not /tmp paths outside it', () => {
    const root = mkdtempSync(join(tmpdir(), 'wsf-root-'))
    const outside = mkdtempSync(join(tmpdir(), 'wsf-out-'))
    try {
      const p = tr('tmproot.jsonl', [
        entry('Bash', { command: `echo x > ${root}/inside.txt` }, { cwd: root }),
        entry('Bash', { command: `echo x > rel.txt` }, { cwd: root }),
        entry('Bash', { command: `echo x > ${outside}/scratch.txt` }, { cwd: root }),
      ])
      expect([...sessionTouchedFiles(p, root)].sort()).toEqual(['inside.txt', 'rel.txt'])
    } finally {
      rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true })
    }
  })

  it('attributes files across a symlinked checkout path (either direction)', () => {
    const real = join(realpathSync(tmp), 'realrepo'); mkdirSync(join(real, 'src'), { recursive: true })
    writeFileSync(join(real, 'src/a.ts'), 'x')
    const link = join(tmp, 'linkrepo'); symlinkSync(real, link)
    const mk = (base: string) => tr('sym.jsonl', [
      entry('Edit', { file_path: `${base}/src/a.ts` }, { cwd: base }),
      entry('Write', { file_path: `${base}/src/gone/deleted.ts` }, { cwd: base }),
    ])
    const want = ['src/a.ts', 'src/gone/deleted.ts']
    expect([...sessionTouchedFiles(mk(link), real)].sort()).toEqual(want)
    expect([...sessionTouchedFiles(mk(real), link)].sort()).toEqual(want)
  })
})
