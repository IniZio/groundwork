/**
 * Bun test preload — isolates the autofix ledger from the user's real ledger.
 *
 * Sets HOUSE_RULES_AUTOFIX_LEDGER_DIR to a fresh temp directory so no test
 * appends to the production ledger at os.tmpdir()/house-rules-autofix-ledger-<uid>/.
 *
 * Loaded automatically via bunfig.toml [test] preload.
 */
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(os.tmpdir(), "hr-test-ledger-"));
process.env.HOUSE_RULES_AUTOFIX_LEDGER_DIR = dir;
