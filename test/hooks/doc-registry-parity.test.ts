/**
 * The committed doc-registry snapshot that house-rules ships must equal the
 * live registry projection. Regenerate with `bun run sync:doc-registry`.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { registryManifestOptions } from '../../src/cli/recipe.js'

const ROOT = resolve(import.meta.dir, '../..')
const SNAPSHOT_PATH = join(ROOT, 'plugins/house-rules/src/config/doc-registry.json')
const HINT = 'Run: bun run sync:doc-registry'

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function snapshotDrift(snapshot: unknown, live: unknown): string[] {
  const out: string[] = []
  const walk = (a: unknown, b: unknown, path: string): void => {
    if (Array.isArray(a) && Array.isArray(b)) {
      const n = Math.max(a.length, b.length)
      for (let i = 0; i < n; i++) {
        const p = `${path}[${i}]`
        if (i >= a.length || i >= b.length) out.push(p)
        else walk(a[i], b[i], p)
      }
      return
    }
    if (isObj(a) && isObj(b)) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)])
      for (const k of keys) {
        const p = path ? `${path}.${k}` : k
        if (!(k in a) || !(k in b)) out.push(p)
        else walk(a[k], b[k], p)
      }
      return
    }
    if (!Object.is(a, b)) out.push(path)
  }
  walk(snapshot, live, '')
  return out
}

function findEnumPath(v: unknown, path: string): string | null {
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const r = findEnumPath(v[i], `${path}[${i}]`)
      if (r) return r
    }
    return null
  }
  if (isObj(v)) {
    if (Array.isArray(v.enum) && v.enum.length > 0 && typeof v.enum[0] === 'string') {
      return `${path}.enum[0]`
    }
    for (const [k, c] of Object.entries(v)) {
      const r = findEnumPath(c, path ? `${path}.${k}` : k)
      if (r) return r
    }
  }
  return null
}

function getAt(root: any, path: string): any {
  const toks = path.match(/[^.[\]]+/g) ?? []
  return toks.reduce((o, t) => o[t], root)
}

function setAt(root: any, path: string, value: unknown): void {
  const toks = path.match(/[^.[\]]+/g) ?? []
  const last = toks.pop() as string
  toks.reduce((o, t) => o[t], root)[last] = value
}

const live = (): any => registryManifestOptions()

describe('doc-registry snapshot parity', () => {
  it('committed snapshot equals the live registry projection', () => {
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
    const drift = snapshotDrift(snapshot, live())
    if (drift.length > 0) {
      throw new Error(`doc-registry.json drifted at: ${drift.join(', ')}\n${HINT}`)
    }
    expect(snapshot).toEqual(live())
    expect(drift).toEqual([])
  })

  it('live projection contains the issue type with required frontmatter and a type with headings', () => {
    const types = live().types
    expect(types.issue).toBeDefined()
    expect(types.issue.frontmatter.required.length).toBeGreaterThan(0)
    expect(types.motive.headings.length).toBeGreaterThan(0)
  })

  it('the committed snapshot carries the issue conditional headings', () => {
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
    expect(snapshot.types.issue.headingsWhen).toEqual([
      { property: 'status', in: ['todo', 'in-progress', 'done'], headings: ['Acceptance criteria'] },
    ])
  })

  it('a changed heading string is reported at exactly that heading path', () => {
    const base = live()
    const mutated = structuredClone(base)
    mutated.types.motive.headings[0] = `${mutated.types.motive.headings[0]}-changed`
    expect(snapshotDrift(mutated, base)).toEqual(['types.motive.headings[0]'])
    expect(() => expect(mutated).toEqual(base)).toThrow()
  })

  it('a changed frontmatter enum value is reported at exactly that enum path', () => {
    const base = live()
    let found: string | null = null
    for (const [name, t] of Object.entries(base.types ?? {})) {
      found = findEnumPath(t, `types.${name}`)
      if (found) break
    }
    if (!found) throw new Error('no type in the live registry has a frontmatter enum')
    const mutated = structuredClone(base)
    setAt(mutated, found, `${getAt(mutated, found)}-changed`)
    expect(snapshotDrift(mutated, base)).toEqual([found])
    expect(() => expect(mutated).toEqual(base)).toThrow()
  })
})
