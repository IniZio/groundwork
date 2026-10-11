<!-- This file is generated. Do not edit manually. -->

# effect

Flags code that should use Effect idioms in added lines.

**Severity**: off | **Autofix**: no

**Edit-time check**: yes | **Languages**: typescript

## Allowed

### [no-manual-effect-error-tag] tag comparison outside a handler

```
error._tag === "NotFound";

```

### [no-manual-effect-error-tag] catchTag call without a callback

```
Effect.catchTag("NotFound", recover);

```

### [no-manual-effect-error-tag] tag comparison inside a catchTag callback

```
Effect.catchTag("Wrapper", (error) => error.reason._tag === "Timeout" ? retry : fail);

```

### [no-manual-tag-comparison] Predicate.isTagged call

```
Predicate.isTagged("Ready")(value);

```

### [no-manual-tag-comparison] Match.tag pipeline

```
Match.value(value).pipe(Match.tag("Ready", handleReady));

```

### [no-manual-tag-comparison] non-tag property comparison

```
if (value.status === "Ready") handleReady(value);

```

### [no-manual-tag-comparison] tag comparison inside Effect.catch handler

```
Effect.catch((error) => error._tag === "NotFound" ? recover : fail);

```

### [no-service-constructor-imports] test file may import constructor

```ts
import { makeIssueService } from "./issue-service.ts";

```

### [no-service-constructor-imports] spec tsx file may import constructor

```tsx
import { makeIssueService } from "../issue-service.ts";

```

### [no-service-constructor-imports] package import is not project-local

```ts
import { makeExecutionMemo } from "alchemy/Runtime/ExecutionMemo";

```

### [no-service-constructor-imports] layer import and unrelated make call

```ts
import { issueServiceLayer } from "./issue-service.ts";
WorkspaceName.make("name");

```

### [no-service-constructor-imports] lowercase after make is not a constructor name

```ts
import { makeissueService } from "./issue-service.ts";

```

### [prefer-effect-match] single literal ternary

```
kind === "a" ? first : fallback;

```

### [prefer-effect-match] second arm compares a different value

```
kind === "a" ? first : other === "b" ? second : fallback;

```

### [prefer-effect-match] non-literal conditions

```
condition ? first : otherCondition ? second : fallback;

```

### [prefer-effect-match] non-equality comparison

```
kind < 1 ? first : kind < 2 ? second : fallback;

```

### [prefer-effect-match] template with substitution is not a literal

```
kind === `a${x}` ? first : kind === `b${x}` ? second : fallback;

```

### [prefer-effect-match] single literal ternary in a javascript file

```js
kind === "a" ? first : fallback;

```

## Flagged

### [no-manual-effect-error-tag] tag comparison in Effect.catch arrow

```
Effect.catch((error) => error._tag === "NotFound" ? recover : fail);

```

**Expected findings:**
- [no-manual-effect-error-tag] Use Effect.catchTag or Effect.catchTags instead of manually discriminating a tagged error in a broad Effect catch handler.

### [no-manual-effect-error-tag] reason tag comparison in Effect.catchAll function

```
Effect.catchAll(function (error) { return error.reason._tag === "Timeout" ? retry : fail; });

```

**Expected findings:**
- [no-manual-effect-error-tag] Use Effect.catchReason or Effect.catchReasons instead of manually discriminating a tagged `reason` in a broad Effect catch handler.

### [no-manual-effect-error-tag] tag switch in Effect.catchIf callback

```
Effect.catchIf(predicate, (error) => { switch (error._tag) { case "NotFound": return recover; } });

```

**Expected findings:**
- [no-manual-effect-error-tag] Use Effect.catchTag or Effect.catchTags instead of manually discriminating a tagged error in a broad Effect catch handler.

### [no-manual-tag-comparison] dot tag compared to literal

```
value._tag === "Ready";

```

**Expected findings:**
- [no-manual-tag-comparison] Use Match.tag/Match.tags for tagged-value branching, or Predicate.isTagged for a simple reusable predicate.

### [no-manual-tag-comparison] literal !== bracket tag

```
"Ready" !== value["_tag"];

```

**Expected findings:**
- [no-manual-tag-comparison] Use Match.tag/Match.tags for tagged-value branching, or Predicate.isTagged for a simple reusable predicate.

### [no-manual-tag-comparison] switch on tag

```
switch (value._tag) { case "Ready": handleReady(value); }

```

**Expected findings:**
- [no-manual-tag-comparison] Use Match.value(value).pipe(Match.tag/Match.tags/Match.tagsExhaustive) or the tagged enum `$match` helper instead of switching on `_tag`.

### [no-service-constructor-imports] local constructor import

```ts
import { makeIssueService } from "./issue-service.ts";

```

**Expected findings:**
- [no-service-constructor-imports] Do not import Effect service constructor "makeIssueService" into runtime code. Import the owning Layer, yield the contextual service, and allow its requirements to propagate to the composition root.

### [no-service-constructor-imports] aliased constructor import reports imported name

```ts
import { makeIssueService as createIssueService } from "../issue-service.ts";

```

**Expected findings:**
- [no-service-constructor-imports] Do not import Effect service constructor "makeIssueService" into runtime code. Import the owning Layer, yield the contextual service, and allow its requirements to propagate to the composition root.

### [prefer-effect-match] two string literal arms

```
kind === "a" ? first : kind === "b" ? second : fallback;

```

**Expected findings:**
- [prefer-effect-match] Use Match from Effect instead of a chained literal ternary.

### [prefer-effect-match] template literals with reversed operands

```
`a` !== kind ? first : `b` === kind ? second : fallback;

```

**Expected findings:**
- [prefer-effect-match] Use Match from Effect instead of a chained literal ternary.

### [prefer-effect-match] three-arm chain

```
kind === "a" ? 1 : kind === "b" ? 2 : kind === "c" ? 3 : 0;

```

**Expected findings:**
- [prefer-effect-match] Use Match from Effect instead of a chained literal ternary.

### [prefer-effect-match] number literals

```
code === 1 ? first : code === 2 ? second : fallback;

```

**Expected findings:**
- [prefer-effect-match] Use Match from Effect instead of a chained literal ternary.

### [prefer-effect-match] parenthesized test

```
(kind === "a") ? first : (kind === "b") ? second : fallback;

```

**Expected findings:**
- [prefer-effect-match] Use Match from Effect instead of a chained literal ternary.

### [prefer-effect-match] javascript file

```js
kind === "a" ? first : kind === "b" ? second : fallback;

```

**Expected findings:**
- [prefer-effect-match] Use Match from Effect instead of a chained literal ternary.
