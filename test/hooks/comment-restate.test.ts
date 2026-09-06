import { describe, expect, it } from 'vitest'
import {
	findAllRestatingComments,
	findMultiWordRestatingComments,
	findProseParaphraseComments,
	findRestatingComments,
	splitIdentifier,
} from '../../hooks/lib/comment-restate.mjs'

describe('splitIdentifier', () => {
	it('splits camelCase into lowercase tokens', () => {
		expect(splitIdentifier('fetchUserById')).toEqual(['fetch', 'user', 'by', 'id'])
	})

	it('splits snake_case into lowercase tokens', () => {
		expect(splitIdentifier('get_user_by_id')).toEqual(['get', 'user', 'by', 'id'])
	})
})

describe('findRestatingComments', () => {
	it('flags // counter immediately above const counter = 0', () => {
		const lines = ['// counter', 'const counter = 0']
		const findings = findRestatingComments(lines)
		expect(findings).toHaveLength(1)
		expect(findings[0].line).toBe(0)
		expect(findings[0].name).toBe('counter')
	})

	it('flags // fetchUser immediately above function fetchUser()', () => {
		const lines = ['// fetchUser', 'function fetchUser() {}']
		const findings = findRestatingComments(lines)
		expect(findings).toHaveLength(1)
		expect(findings[0].name).toBe('fetchUser')
	})

	it('does NOT flag // returns the count (multi-word — wrong function)', () => {
		// IDENT_COMMENT_RE requires a single bare identifier; spaces disqualify it.
		const lines = ['// returns the count', 'function returnsTheCount() {}']
		const findings = findRestatingComments(lines)
		expect(findings).toHaveLength(0)
	})
})

describe('findMultiWordRestatingComments', () => {
	it('flags // fetch the user above function fetchUser()', () => {
		// contentWords after stop-word removal: ["fetch", "user"] — both in identTokens
		const lines = ['// fetch the user', 'function fetchUser() {}']
		const findings = findMultiWordRestatingComments(lines)
		expect(findings).toHaveLength(1)
		expect(findings[0].identName).toBe('fetchUser')
		expect(findings[0].line).toBe(0)
	})

	it('does NOT flag // fetch the user with roles above function fetchUser()', () => {
		// contentWords: ["fetch", "user", "roles"] — "roles" absent from identTokens → skips
		const lines = ['// fetch the user with roles', 'function fetchUser() {}']
		const findings = findMultiWordRestatingComments(lines)
		expect(findings).toHaveLength(0)
	})
})

describe('findProseParaphraseComments', () => {
	it('flags // import helpers above an import statement (AC1)', () => {
		// IMPERATIVE_COMMENT_RE matches (first char lowercase 'i').
		// Code line is not a declaration, passes CODE_LINE_RE.
		// Both "import" and "helpers" appear as word-boundary matches in the code line.
		const lines = [
			'// import helpers',
			"import { helpers } from './helpers.mjs'",
		]
		const findings = findProseParaphraseComments(lines)
		expect(findings).toHaveLength(1)
		expect(findings[0].line).toBe(0)
		expect(findings[0].comment).toContain('import helpers')
	})

	it('flags // increment counter above increment_counter() (AC2)', () => {
		// codeIdentTokens from "increment_counter" → ["increment", "counter"] — both present
		const lines = ['// increment counter', 'increment_counter()']
		const findings = findProseParaphraseComments(lines)
		expect(findings).toHaveLength(1)
		expect(findings[0].line).toBe(0)
	})

	it('does NOT flag SQL comment starting with uppercase ON (AC3)', () => {
		// IMPERATIVE_COMMENT_RE requires first captured char to be [a-z].
		// "ON CONFLICT DO NOTHING..." starts with uppercase 'O' — no match.
		const lines = [
			'// ON CONFLICT DO NOTHING does not RETURN the existing row, so select after',
			'insertRow(table, data)',
		]
		const findings = findProseParaphraseComments(lines)
		expect(findings).toHaveLength(0)
	})
})

describe('findAllRestatingComments', () => {
	it('returns findings for known-bad input (single-identifier restating comment)', () => {
		const source = '// foo\nexport function foo() { return 1; }\n'
		const findings = findAllRestatingComments(source)
		expect(findings.length).toBeGreaterThan(0)
		expect(findings[0].reason).toMatch(/restating/)
	})

	it('returns [] for empty string', () => {
		expect(findAllRestatingComments('')).toEqual([])
	})
})
