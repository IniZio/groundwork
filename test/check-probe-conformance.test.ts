/**
 * Tests for scripts/check-probe-conformance.mjs (SC-A1..SC-B2 checks).
 *
 * Each test builds a minimal fixture tree in a temp directory, runs the CLI via
 * spawnSync, and asserts on the printed PASS|FAIL|UNKNOWN lines and exit code.
 * Internal predicates are never tested directly — only the emitted output.
 *
 * Fixture trees are created fresh per test in beforeEach and removed in afterEach.
 * No fixtures live under gitignored paths in the project tree.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const CHECKER = path.resolve(__dirname, '..', 'scripts', 'check-probe-conformance.mjs')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `probe-conformance-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeFixture(dir: string, relPath: string, content: string): void {
  const full = path.join(dir, relPath)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, content, 'utf8')
}

interface RunResult { status: number; stdout: string }

function runChecker(repoPath: string): RunResult {
  const result = spawnSync('node', [CHECKER, repoPath], { encoding: 'utf8' })
  return { status: result.status ?? 1, stdout: result.stdout ?? '' }
}

function lineFor(stdout: string, id: string): string {
  const re = new RegExp(`^(?:PASS|FAIL|UNKNOWN) ${id} `)
  const line = stdout.split('\n').find(l => re.test(l))
  return line ?? ''
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(() => { tmpDir = makeTempDir() })
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

// ===========================================================================
// SC-A1: Toolchain-enforced module boundaries
// ===========================================================================

describe('SC-A1', () => {
  test('FAIL — recognized Node stack (package.json) with no enforcer', () => {
    writeFixture(tmpDir, 'package.json', JSON.stringify({ name: 'my-app', dependencies: { express: '^4' } }))
    writeFixture(tmpDir, 'src/index.ts', 'export const x = 1')
    const { stdout, status } = runChecker(tmpDir)
    expect(lineFor(stdout, 'SC-A1')).toMatch(/^FAIL SC-A1/)
    expect(status).toBe(1)
  })

  test('PASS — dep-cruiser config present', () => {
    writeFixture(tmpDir, 'package.json', JSON.stringify({ name: 'my-app', dependencies: { express: '^4' } }))
    writeFixture(tmpDir, '.dependency-cruiser.json', JSON.stringify({ forbidden: [] }))
    const { stdout } = runChecker(tmpDir)
    expect(lineFor(stdout, 'SC-A1')).toMatch(/^PASS SC-A1/)
    // other checks may fail on this minimal fixture; only SC-A1 line is asserted
  })

  test('PASS (NestJS) — @Module decorators present in src/', () => {
    writeFixture(tmpDir, 'package.json', JSON.stringify({
      name: 'nestjs-app',
      dependencies: { '@nestjs/core': '^10', '@nestjs/common': '^10' },
    }))
    writeFixture(tmpDir, 'src/app.module.ts', `
import { Module } from '@nestjs/common'
@Module({ imports: [] })
export class AppModule {}
`)
    const { stdout } = runChecker(tmpDir)
    expect(lineFor(stdout, 'SC-A1')).toMatch(/^PASS SC-A1/)
    expect(lineFor(stdout, 'SC-A1')).toContain('NestJS')
  })

  test('PASS (Go) — go.mod + internal/ directory present', () => {
    writeFixture(tmpDir, 'go.mod', 'module example.com/myapp\n\ngo 1.22\n')
    writeFixture(tmpDir, 'internal/auth/auth.go', 'package auth\n')
    const { stdout } = runChecker(tmpDir)
    expect(lineFor(stdout, 'SC-A1')).toMatch(/^PASS SC-A1/)
    expect(lineFor(stdout, 'SC-A1')).toContain('internal/')
  })

  test('UNKNOWN — no package.json or go.mod (unrecognized stack)', () => {
    writeFixture(tmpDir, 'main.py', 'print("hello")')
    const { stdout } = runChecker(tmpDir)
    expect(lineFor(stdout, 'SC-A1')).toMatch(/^UNKNOWN SC-A1/)
    expect(lineFor(stdout, 'SC-A1')).not.toMatch(/^FAIL/)
  })
})

// ===========================================================================
// SC-A2: No route/controller handler importing ≥3 distinct concern namespaces
// ===========================================================================

describe('SC-A2', () => {
  test('FAIL — controller imports 3 distinct concern namespaces', () => {
    writeFixture(tmpDir, 'src/controllers/items.controller.ts', `
import { AuthService } from '../auth/auth.service'
import { AuditService } from '../audit/audit.service'
import { StorageService } from '../storage/storage.service'
export class ItemsController {}
`)
    const { stdout, status } = runChecker(tmpDir)
    expect(lineFor(stdout, 'SC-A2')).toMatch(/^FAIL SC-A2/)
    expect(status).toBe(1)
  })

  test('PASS — controller imports only 2 concern namespaces', () => {
    writeFixture(tmpDir, 'src/controllers/items.controller.ts', `
import { AuthService } from '../auth/auth.service'
import { ItemsService } from '../items/items.service'
export class ItemsController {}
`)
    const { stdout } = runChecker(tmpDir)
    expect(lineFor(stdout, 'SC-A2')).toMatch(/^PASS SC-A2/)
  })
})

// ===========================================================================
// SC-A3: No optional fields on Options/Config/Deps types
// ===========================================================================

describe('SC-A3', () => {
  test('FAIL — Options type has two optional non-primitive collaborator fields, both reported', () => {
    // Both auditRecord?: AuditRecorder and authVerifier?: AuthVerifier are services;
    // the single FAIL line must list both instances.
    writeFixture(tmpDir, 'src/server.ts', `
export interface WebOptions {
  port: number
  auditRecord?: AuditRecorder
  authVerifier?: AuthVerifier
}
`)
    const { stdout, status } = runChecker(tmpDir)
    const line = lineFor(stdout, 'SC-A3')
    expect(line).toMatch(/^FAIL SC-A3/)
    expect(line).toContain('auditRecord?')
    expect(line).toContain('authVerifier?')
    expect(line).toContain('verify the absent-case default')
    expect(status).toBe(1)
  })

  test('PASS — Options interface has no optional fields', () => {
    writeFixture(tmpDir, 'src/server.ts', `
export interface ServerOptions {
  port: number
  authVerifier: AuthVerifier
  logger: Logger
}
`)
    const { stdout } = runChecker(tmpDir)
    expect(lineFor(stdout, 'SC-A3')).toMatch(/^PASS SC-A3/)
  })

  test('PASS — optional primitive flag in Config type is allowed', () => {
    // debug?: boolean has a sensible default; it does not silently disable a collaborator.
    writeFixture(tmpDir, 'src/db.ts', `
export interface DatabaseConfig {
  url: string
  debug?: boolean
  logLevel?: 'info' | 'debug' | 'warn'
}
`)
    const { stdout } = runChecker(tmpDir)
    expect(lineFor(stdout, 'SC-A3')).toMatch(/^PASS SC-A3/)
  })
})

// ===========================================================================
// SC-A4: Acceptance/e2e tests import production entrypoint
// ===========================================================================

describe('SC-A4', () => {
  test('FAIL — acceptance test builds app from stub module without production import', () => {
    // An isolated controller unit spec is FINE; this is an acceptance-layer test
    // that assembles its own stub app — a genuine violation.
    writeFixture(tmpDir, 'e2e/items.e2e.test.ts', `
import { Test } from '@nestjs/testing'
import { ItemsModule } from '../src/items/items.module'

describe('items e2e', () => {
  it('returns list', async () => {
    const app = await Test.createTestingModule({ imports: [ItemsModule] }).compile()
  })
})
`)
    const { stdout, status } = runChecker(tmpDir)
    expect(lineFor(stdout, 'SC-A4')).toMatch(/^FAIL SC-A4/)
    expect(status).toBe(1)
  })

  test('PASS — at least one acceptance test imports the production AppModule', () => {
    writeFixture(tmpDir, 'e2e/app.e2e.test.ts', `
import { Test } from '@nestjs/testing'
import { AppModule } from '../src/app.module'

describe('app e2e', () => {
  it('boots', async () => {
    const app = await Test.createTestingModule({ imports: [AppModule] }).compile()
  })
})
`)
    const { stdout } = runChecker(tmpDir)
    expect(lineFor(stdout, 'SC-A4')).toMatch(/^PASS SC-A4/)
  })

  test('UNKNOWN — no acceptance/e2e/feature test files at all', () => {
    // Only unit specs exist; SC-A4 defers to SC-B1 in this case.
    writeFixture(tmpDir, 'src/items/items.service.spec.ts', `
describe('ItemsService', () => { it('works', () => {}) })
`)
    const { stdout } = runChecker(tmpDir)
    expect(lineFor(stdout, 'SC-A4')).toMatch(/^UNKNOWN SC-A4/)
    expect(lineFor(stdout, 'SC-A4')).not.toMatch(/^FAIL/)
  })
})

// ===========================================================================
// SC-B1: docker-compose exists AND acceptance tests reference it
// ===========================================================================

describe('SC-B1', () => {
  test('FAIL — no docker-compose.yml', () => {
    writeFixture(tmpDir, 'package.json', JSON.stringify({ name: 'app' }))
    const { stdout, status } = runChecker(tmpDir)
    expect(lineFor(stdout, 'SC-B1')).toMatch(/^FAIL SC-B1/)
    expect(status).toBe(1)
  })

  test('PASS — docker-compose.yml present and e2e test references a service hostname', () => {
    writeFixture(tmpDir, 'docker-compose.yml', `
services:
  db:
    image: postgres:16
  authgear:
    image: authgear/authgear-server:latest
`)
    writeFixture(tmpDir, 'e2e/login.e2e.test.ts', `
const AUTHGEAR_URL = 'http://authgear:3000'
describe('login', () => { it('redirects', () => {}) })
`)
    const { stdout } = runChecker(tmpDir)
    expect(lineFor(stdout, 'SC-B1')).toMatch(/^PASS SC-B1/)
  })

  test('PASS (WAIVER) — service not referenced by tests but covered by per-dependency waiver', () => {
    // Only one service in docker-compose; no e2e test references it.
    // A waiver exists for that specific dependency → PASS.
    writeFixture(tmpDir, 'docker-compose.yml', `
services:
  stripe-api:
    image: stripe/stripe-mock:latest
`)
    writeFixture(tmpDir, 'e2e/payment.e2e.test.ts', `
// This test does not reference the stripe-api hostname directly
describe('payment', () => { it('exists', () => {}) })
`)
    writeFixture(
      tmpDir,
      '.groundwork/waivers/stripe.json',
      JSON.stringify({
        dependency: 'stripe-api',
        criterion: 'SC-B1',
        scope: 'acceptance tests — Stripe has no self-hostable container',
        expiry: '2027-01-01',
        contract_test: 'test/contract/stripe-webhook.test.ts',
      }),
    )
    const { stdout } = runChecker(tmpDir)
    expect(lineFor(stdout, 'SC-B1')).toMatch(/^PASS SC-B1/)
    expect(lineFor(stdout, 'SC-B1')).toContain('stripe-api')
  })
})

// ===========================================================================
// SC-B2: Auth in acceptance tests is the real service (no synthetic JWT)
// ===========================================================================

describe('SC-B2', () => {
  test('FAIL — e2e test signs its own JWT with a test secret', () => {
    writeFixture(tmpDir, 'docker-compose.yml', `
services:
  db:
    image: postgres:16
`)
    writeFixture(tmpDir, 'e2e/auth.e2e.test.ts', `
import jwt from 'jsonwebtoken'
const token = jwt.sign({ sub: 'user-1' }, 'test-secret', { expiresIn: '1h' })
describe('auth', () => { it('returns 200', async () => {}) })
`)
    const { stdout, status } = runChecker(tmpDir)
    expect(lineFor(stdout, 'SC-B2')).toMatch(/^FAIL SC-B2/)
    expect(status).toBe(1)
  })

  test('PASS — e2e test obtains token from real auth service (no jwt.sign)', () => {
    writeFixture(tmpDir, 'docker-compose.yml', `
services:
  authgear:
    image: authgear/authgear-server:latest
`)
    writeFixture(tmpDir, 'e2e/auth.e2e.test.ts', `
import { getToken } from './helpers/real-auth'
describe('auth', () => {
  it('fetches resource with real token', async () => {
    const token = await getToken('user@example.com', 'password')
  })
})
`)
    const { stdout } = runChecker(tmpDir)
    expect(lineFor(stdout, 'SC-B2')).toMatch(/^PASS SC-B2/)
  })
})
