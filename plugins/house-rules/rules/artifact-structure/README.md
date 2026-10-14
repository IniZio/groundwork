<!-- This file is generated. Do not edit manually. -->

# artifact-structure

Flags repo-shape bloat: coexisting synonym directory pairs, symmetric duplicate dirs, and root scratch files.

**Severity**: error | **Autofix**: no

**Edit-time check**: yes | **Languages**: none

## Allowed

### content: frontmatter satisfies schema and required heading present

**Files:**
- `.house-rules.json`: {"rules":{"artifact-structure":["error",{"govern":["notes/**"],"types":{"research":{"tier":"working","generates":".groundwork/work/{slug}/research/{name:kebab}.md","frontmatter":{"type":"object","required":["status"],"properties":{"status":{"type":"string"}}},"headings":["## Decisions"]}}}]}}
- `.groundwork/work/a/research/x.md`: ---
status: open
---

## Decisions

none


### no types configured: notes/x.md is not flagged (legacy behaviour)

**Files:**
- `notes/x.md`: 

### manifest: conforming path is clean

**Files:**
- `.house-rules.json`: {"rules":{"artifact-structure":["error",{"govern":["notes/**"],"types":{"research":{"tier":"working","description":"Research notes","generates":".groundwork/work/{slug}/research/{name:kebab}.md"}}}]}}
- `.groundwork/work/a/research/x.md`: 

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

### node_modules synonym dirs (doc/docs) never produce a finding even with a tracked file inside

**Files:**
- `node_modules/pkg/doc/a.ts`: 
- `node_modules/pkg/docs/b.ts`: 

### tests/ alone produces no finding; synonym rule requires sibling canonical dir

**Files:**
- `tests/helper.ts`: 

### untracked and not session-created root tmp-notes.md produces no finding

**Files:**
- `tmp-notes.md`: 

### registry source: an issue whose status is triage needs no Acceptance criteria heading

**Files:**
- `.groundwork/.keep`: 
- `.groundwork/work/x/tickets/01-y.md`: ---
title: Y
status: triage
---

## Summary


### registry source: without a .groundwork/ directory and without config, lessons/x.md is not flagged

**Files:**
- `lessons/x.md`: 

### config source: headingsWhen does not demand its heading when the status does not match

**Files:**
- `.house-rules.json`: {"rules":{"artifact-structure":["error",{"govern":["notes/**"],"types":{"research":{"tier":"working","generates":".groundwork/work/{slug}/research/{name:kebab}.md","headingsWhen":[{"property":"status","in":["done"],"headings":["Risks"]}]}}}]}}
- `.groundwork/work/a/research/x.md`: ---
status: open
---

## Notes


## Flagged

### registry source: with a .groundwork/ directory and no configured types, the shipped registry applies; a todo issue without an Acceptance criteria heading is flagged as a warning

**Files:**
- `.groundwork/.keep`: 
- `.groundwork/work/x/tickets/01-y.md`: ---
title: Y
status: todo
---

## Summary


**Expected findings:**
- artifact-structure: .groundwork/work/x/tickets/01-y.md is missing required heading "Acceptance criteria" (type "issue")

### registry source: with a .groundwork/ directory and no configured types, a file under the registry-forbidden lessons/ is flagged as a warning

**Files:**
- `.groundwork/.keep`: 
- `lessons/x.md`: 

### config source: headingsWhen on a configured type demands its heading; the finding carries no severity tag

**Files:**
- `.house-rules.json`: {"rules":{"artifact-structure":["error",{"govern":["notes/**"],"types":{"research":{"tier":"working","generates":".groundwork/work/{slug}/research/{name:kebab}.md","headingsWhen":[{"property":"status","in":["done"],"headings":["Risks"]}]}}}]}}
- `.groundwork/work/a/research/x.md`: ---
status: done
---

## Notes


**Expected findings:**
- artifact-structure: .groundwork/work/a/research/x.md is missing required heading "Risks" (type "research")

### content: missing required frontmatter key is flagged

**Files:**
- `.house-rules.json`: {"rules":{"artifact-structure":["error",{"govern":["notes/**"],"types":{"research":{"tier":"working","generates":".groundwork/work/{slug}/research/{name:kebab}.md","frontmatter":{"type":"object","required":["status"],"properties":{"status":{"type":"string"}}},"headings":["## Decisions"]}}}]}}
- `.groundwork/work/a/research/x.md`: ---
title: x
---

## Decisions


**Expected findings:**
- artifact-structure: .groundwork/work/a/research/x.md frontmatter invalid for type research: (root): missing required key "status"

### content: missing required heading is flagged

**Files:**
- `.house-rules.json`: {"rules":{"artifact-structure":["error",{"govern":["notes/**"],"types":{"research":{"tier":"working","generates":".groundwork/work/{slug}/research/{name:kebab}.md","frontmatter":{"type":"object","required":["status"],"properties":{"status":{"type":"string"}}},"headings":["## Decisions"]}}}]}}
- `.groundwork/work/a/research/x.md`: ---
status: open
---

## Notes


**Expected findings:**
- artifact-structure: .groundwork/work/a/research/x.md is missing required heading "## Decisions" (type "research")

### content: unsupported schema keyword surfaces as a finding, not a silent pass

**Files:**
- `.house-rules.json`: {"rules":{"artifact-structure":["error",{"govern":["notes/**"],"types":{"research":{"tier":"working","generates":".groundwork/work/{slug}/research/{name:kebab}.md","frontmatter":{"type":"object","patternProperties":{}},"headings":["## Decisions"]}}}]}}
- `.groundwork/work/a/research/x.md`: ---
status: open
---

## Decisions


**Expected findings:**
- artifact-structure: .groundwork/work/a/research/x.md frontmatter invalid for type research: (root): unsupported schema keyword "patternProperties"

### manifest: new governed md outside every doc type is flagged with nearest type

**Files:**
- `.house-rules.json`: {"rules":{"artifact-structure":["error",{"govern":["notes/**"],"types":{"research":{"tier":"working","description":"Research notes","generates":".groundwork/work/{slug}/research/{name:kebab}.md"}}}]}}
- `notes/research-notes.md`: 

**Expected findings:**
- artifact-structure: notes/research-notes.md is outside every doc type path. Nearest types:
- research: Research notes -> .groundwork/work/<slug>/research/research-notes.md

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
