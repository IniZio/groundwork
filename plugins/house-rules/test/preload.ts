/**
 * Bun test preload — isolates the autofix ledger from the user's real ledger.
 *
 * Points TMPDIR at a fresh temp directory, so os.tmpdir() (and any child
 * process inheriting process.env) resolves the ledger dir under it instead of
 * the production os.tmpdir()/house-rules-autofix-ledger-<uid>/.
 *
 * Loaded automatically via bunfig.toml [test] preload.
 */
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TMPDIR = mkdtempSync(path.join(os.tmpdir(), "hr-test-tmp-"));
