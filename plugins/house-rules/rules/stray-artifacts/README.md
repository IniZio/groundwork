<!-- This file is generated. Do not edit manually. -->

# stray-artifacts

Flags repo-shape bloat: coexisting synonym directory pairs, symmetric duplicate dirs, and root scratch files.

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

### docs/ alone produces no finding; synonym rule requires sibling canonical dir

**Files:**
- `docs/readme.md`: 

### tests/ alone produces no finding; synonym rule requires sibling canonical dir

**Files:**
- `tests/helper.ts`: 

### untracked and not session-created root tmp-notes.md produces no finding

**Files:**
- `tmp-notes.md`: 

## Flagged

### docs/ and doc/ coexist; both dirs have tracked files, both flagged

**Files:**
- `doc/guide.md`: 
- `docs/readme.md`: 

**Expected findings:**
- doc/ and docs/ coexist under root; merge doc/ into docs/
- docs/ and doc/ coexist under root; merge docs/ into doc/

### tests/ and test/ coexist; both dirs have tracked files, both flagged

**Files:**
- `test/unit.ts`: 
- `tests/helper.ts`: 

**Expected findings:**
- test/ and tests/ coexist under root; merge test/ into tests/
- tests/ and test/ coexist under root; merge tests/ into test/

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

### doc/ file in-scope while untracked docs/ sibling exists; reverse direction

**Files:**
- `docs/readme.md`: 
- `doc/guide.md`: 

**Expected findings:**
- doc/ and docs/ coexist under root; merge doc/ into docs/

### test/ file in-scope while untracked tests/ sibling exists; reverse direction

**Files:**
- `tests/helper.ts`: 
- `test/unit.ts`: 

**Expected findings:**
- test/ and tests/ coexist under root; merge test/ into tests/

### session-created root tmp-notes.md matches scratch prefix

**Files:**
- `tmp-notes.md`: 

**Expected findings:**
- root scratch file: tmp-notes.md
