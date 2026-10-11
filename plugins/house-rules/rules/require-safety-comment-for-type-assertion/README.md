<!-- This file is generated. Do not edit manually. -->

# require-safety-comment-for-type-assertion

Type assertions (as / <T>x, not as const) must be preceded by a SAFETY: comment stating the checked invariant.

**Severity**: off | **Autofix**: no

**Edit-time check**: yes | **Languages**: typescript

## Allowed

### [require-safety-comment-for-type-assertion] const assertion on array is exempt

```
const values = [1, 2] as const;

```

### [require-safety-comment-for-type-assertion] angle-bracket const assertion is exempt

```
const value = <const>{ id: 'one' };

```

### [require-safety-comment-for-type-assertion] SAFETY line comment before statement

```
// SAFETY: The parser established the UserId invariant.
const id = value as UserId;

```

### [require-safety-comment-for-type-assertion] SAFETY comment before return statement

```
function parse(): UserId {
// SAFETY: Validation above established the UserId invariant.
return value as UserId;
}

```

### [require-safety-comment-for-type-assertion] inline SAFETY block comment before assertion

```
const id = /* SAFETY: Validation established the invariant. */ value as UserId;

```

### [require-safety-comment-for-type-assertion] SAFETY comment before exported declaration

```
// SAFETY: The parser established the exported UserId invariant.
export const id = value as UserId;

```

### [require-safety-comment-for-type-assertion] multi-line SAFETY block before exported declaration

```
/* SAFETY:
 * The parser established the exported UserId invariant.
 */
export const id = value as UserId;

```

## Flagged

### [require-safety-comment-for-type-assertion] bare as assertion

```
const id = value as UserId;

```

**Expected findings:**
- [require-safety-comment-for-type-assertion] This type assertion has no `SAFETY:` justification. State the checked invariant immediately before the assertion or its containing statement.

### [require-safety-comment-for-type-assertion] bare angle-bracket assertion

```
const id = <UserId>value;

```

**Expected findings:**
- [require-safety-comment-for-type-assertion] This type assertion has no `SAFETY:` justification. State the checked invariant immediately before the assertion or its containing statement.

### [require-safety-comment-for-type-assertion] trailing SAFETY comment is too late

```
const id = value as UserId; // SAFETY: Too late.

```

**Expected findings:**
- [require-safety-comment-for-type-assertion] This type assertion has no `SAFETY:` justification. State the checked invariant immediately before the assertion or its containing statement.

### [require-safety-comment-for-type-assertion] unrelated preceding comment

```
// This cast seems fine.
const id = value as UserId;

```

**Expected findings:**
- [require-safety-comment-for-type-assertion] This type assertion has no `SAFETY:` justification. State the checked invariant immediately before the assertion or its containing statement.

### [require-safety-comment-for-type-assertion] empty SAFETY comment

```
// SAFETY:
const id = value as UserId;

```

**Expected findings:**
- [require-safety-comment-for-type-assertion] This type assertion has no `SAFETY:` justification. State the checked invariant immediately before the assertion or its containing statement.

### [require-safety-comment-for-type-assertion] whitespace-only SAFETY comment

```
// SAFETY:   
const id = value as UserId;

```

**Expected findings:**
- [require-safety-comment-for-type-assertion] This type assertion has no `SAFETY:` justification. State the checked invariant immediately before the assertion or its containing statement.

### [require-safety-comment-for-type-assertion] empty inline SAFETY block

```
const id = /* SAFETY: */ value as UserId;

```

**Expected findings:**
- [require-safety-comment-for-type-assertion] This type assertion has no `SAFETY:` justification. State the checked invariant immediately before the assertion or its containing statement.

### [require-safety-comment-for-type-assertion] bare exported assertion

```
export const id = value as UserId;

```

**Expected findings:**
- [require-safety-comment-for-type-assertion] This type assertion has no `SAFETY:` justification. State the checked invariant immediately before the assertion or its containing statement.

### [require-safety-comment-for-type-assertion] non-safety comment before exported assertion

```
// This is not a safety justification.
export const id = value as UserId;

```

**Expected findings:**
- [require-safety-comment-for-type-assertion] This type assertion has no `SAFETY:` justification. State the checked invariant immediately before the assertion or its containing statement.
