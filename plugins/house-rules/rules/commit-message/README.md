<!-- This file is generated. Do not edit manually. -->

# commit-message

Enforces commit-message style. Default preset: handbook (imperative verb ≤50 chars). Configure via .house-rules.json: { "commit-message": { "preset": "conventional" } }.

> Not in policy.

**Vehicles**: 

## Allowed

### handbook preset: imperative verb ≤50 chars

```
Add user login validation
```

### handbook preset: fix verb with short subject

```
Fix null-pointer in token refresh
```

### conventional preset: type(scope): description

```
fix(auth): correct token expiry check
```

### conventional preset: type without scope

```
feat: add login flow
```

## Flagged

### handbook preset: conventional-style type prefix not an imperative verb

```
feat(auth): add login
```

**Expected findings:**
- subject must start with an imperative verb

### handbook preset: subject exceeds 50 characters

```
Add a very long subject line that clearly exceeds fifty characters
```

**Expected findings:**
- subject exceeds 50 characters

### conventional preset: no type prefix

```
Add user login
```

**Expected findings:**
- subject must match conventional format

### conventional preset: unrecognised commit type

```
typo(auth): fix spelling
```

**Expected findings:**
- not one of the allowed types
