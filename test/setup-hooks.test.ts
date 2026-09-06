import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = resolve(repoRoot, 'scripts', 'setup-hooks.mjs');
const expectedHooksPath = resolve(repoRoot, 'hooks');

function gitConfig(...args: string[]) {
	return spawnSync('git', ['-C', repoRoot, 'config', ...args], { encoding: 'utf8' });
}

function readHooksPath(): string | null {
	const result = gitConfig('--local', 'core.hooksPath');
	if (result.status !== 0) return null;
	return (result.stdout || '').trim() || null;
}

function runScript() {
	return spawnSync('node', [scriptPath], { encoding: 'utf8', cwd: repoRoot });
}

let originalHooksPath: string | null;

beforeAll(() => {
	originalHooksPath = readHooksPath();
});

afterAll(() => {
	if (originalHooksPath === null) {
		gitConfig('--local', '--unset', 'core.hooksPath');
	} else {
		gitConfig('--local', 'core.hooksPath', originalHooksPath);
	}
});

describe('setup-hooks.mjs', () => {
	it('sets core.hooksPath to <repoRoot>/hooks', () => {
		const result = runScript();
		expect(result.status, `script stderr: ${result.stderr}`).toBe(0);
		expect(readHooksPath()).toBe(expectedHooksPath);
	});

	it('is idempotent — second run exits 0 with the same value', () => {
		runScript();
		const before = readHooksPath();
		const result = runScript();
		const after = readHooksPath();

		expect(result.status, `script stderr: ${result.stderr}`).toBe(0);
		expect(after).toBe(expectedHooksPath);
		expect(after).toBe(before);
	});
});

describe('host-repo isolation guard', () => {
	let hostRepoDir: string;
	let fakeGwDir: string;
	let fakeScriptPath: string;

	beforeAll(() => {
		hostRepoDir = mkdtempSync(join(tmpdir(), 'setup-hooks-host-'));
		spawnSync('git', ['init', hostRepoDir], { encoding: 'utf8' });
		spawnSync('git', ['-C', hostRepoDir, 'config', 'user.email', 'test@test.com'], { encoding: 'utf8' });
		spawnSync('git', ['-C', hostRepoDir, 'config', 'user.name', 'Test'], { encoding: 'utf8' });

		fakeGwDir = join(hostRepoDir, 'groundwork-dir');
		mkdirSync(join(fakeGwDir, 'scripts'), { recursive: true });
		mkdirSync(join(fakeGwDir, 'hooks'), { recursive: true });

		fakeScriptPath = join(fakeGwDir, 'scripts', 'setup-hooks.mjs');
		copyFileSync(scriptPath, fakeScriptPath);
	});

	afterAll(() => {
		rmSync(hostRepoDir, { recursive: true, force: true });
	});

	it('does not set core.hooksPath on the host repo when groundwork dir is nested inside it', () => {
		function readHostHooksPath(): string | null {
			const r = spawnSync('git', ['-C', hostRepoDir, 'config', '--local', 'core.hooksPath'], { encoding: 'utf8' });
			if (r.status !== 0) return null;
			return (r.stdout || '').trim() || null;
		}

		spawnSync('git', ['-C', hostRepoDir, 'config', '--local', 'core.hooksPath', '/sentinel/value'], { encoding: 'utf8' });
		expect(readHostHooksPath(), 'positive control: harness must be able to observe a SET value').toBe('/sentinel/value');
		spawnSync('git', ['-C', hostRepoDir, 'config', '--local', '--unset', 'core.hooksPath'], { encoding: 'utf8' });
		expect(readHostHooksPath()).toBeNull();

		const result = spawnSync('node', [fakeScriptPath], { encoding: 'utf8', cwd: fakeGwDir });
		expect(result.status, `script stderr: ${result.stderr}`).toBe(0);

		expect(readHostHooksPath(), 'host repo core.hooksPath must remain unset').toBeNull();
	});
});
