/**
 * Open-item seam-parity test.
 *
 * Guards the contract "statement = short handle, body = detail" for the parser
 * (hooks/lib/motive-charter.mjs).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-ignore
import { readCharter } from '../../hooks/lib/motive-charter.mjs'

const HANDLE = 'SEAMHANDLE_marker'
const BODY   = 'SEAMBODY_detail_marker'
const ITEM_ID = 'TBD-SEAM'

const CHARTER_MD = `# motive: seam-test

## Objective

Test the seam contract.

## Open items

- ${ITEM_ID}: ${HANDLE}
  ${BODY}

## Out of scope

<!-- none -->
`

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'seam-parity-'))
}

function makeCharter(dir: string, motive: string): void {
  const motiveDir = join(dir, '.groundwork', 'motives', motive)
  mkdirSync(motiveDir, { recursive: true })
  writeFileSync(join(motiveDir, 'motive.md'), CHARTER_MD, 'utf8')
}

describe('open-item seam parity — handle/body contract', () => {
  const MOTIVE = 'seam-test'
  let dir: string

  beforeEach(() => {
    dir = tmp()
    makeCharter(dir, MOTIVE)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  describe('parser (motive-charter.mjs)', () => {
    it('item.statement contains HANDLE and NOT BODY', () => {
      const charter = readCharter({ projectDir: dir, motive: MOTIVE })!
      const item = charter.open_items.find((i: any) => i.id === ITEM_ID)
      expect(item, `${ITEM_ID} not found in parsed open_items`).toBeTruthy()
      expect(item!.statement).toContain(HANDLE)
      expect(item!.statement).not.toContain(BODY)
    })

    it('item.body contains BODY token', () => {
      const charter = readCharter({ projectDir: dir, motive: MOTIVE })!
      const item = charter.open_items.find((i: any) => i.id === ITEM_ID)!
      expect(item.body).toContain(BODY)
    })
  })
})
