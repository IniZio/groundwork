<!-- This file is generated. Do not edit manually. -->

# effect

Flags code that should use Effect idioms in added lines.

**Severity**: off | **Autofix**: no

**Edit-time check**: yes | **Languages**: typescript

## Allowed

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
