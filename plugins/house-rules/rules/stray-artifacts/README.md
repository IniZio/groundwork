<!-- This file is generated. Do not edit manually. -->

# stray-artifacts

Flags repo-shape bloat: non-canonical directory names, symmetric duplicate dirs, and root scratch files.

**Severity**: error | **Autofix**: no

**Vehicles**: tree

## Allowed

### doc/ is canonical; no finding

**Files:**
- `doc/guide.md`: 

### test-foo.ts nested under test/ is valid; root-scratch rule does not apply

**Files:**
- `test/test-foo.ts`: 

### untracked root test-*.mjs produces no finding

**Files:**
- `test-local.mjs`: 

### lib/ alone produces no finding; symmetric rule requires both siblings

**Files:**
- `lib/index.ts`: 

### untracked and not session-created root tmp-notes.md produces no finding

**Files:**
- `tmp-notes.md`: 

## Flagged

### docs/ is non-canonical; doc/ is canonical

**Files:**
- `docs/readme.md`: 

**Expected findings:**
- use doc/ (canonical) instead of docs/

### tracked root test-agent-config.mjs matches root-scratch pattern

**Files:**
- `test-agent-config.mjs`: 

**Expected findings:**
- root scratch file: test-agent-config.mjs

### util/ and utils/ coexist; symmetric pair must consolidate

**Files:**
- `util/helpers.ts`: 
- `utils/tools.ts`: 

**Expected findings:**
- both util/ and utils/ exist under root; consolidate
- both util/ and utils/ exist under root; consolidate

### session-created root tmp-notes.md matches scratch prefix

**Files:**
- `tmp-notes.md`: 

**Expected findings:**
- root scratch file: tmp-notes.md
