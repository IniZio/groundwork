---
tags: [recipe, how-to, orchestration, slice]
---

# How to add a slice with acceptance criteria

> **How-to guide.** Follow these steps to register a new vertical slice with observable acceptance criteria and link it to a ticket and decision. For a conceptual explanation of what a slice is, see [[../concepts/vertical-slice]].

---

## Goal

Register a new implementation slice in the active run ledger so it is tracked by the stop-gate, linked to a ticket document, and carries acceptance criteria that the advisor can verify.

---

## Before you start

- An active ledger must exist (`ledger view` shows a non-abandoned run)
- You have the slice id you want to use (e.g. `S3`)
- You know which wave it belongs to (or leave `--wave` off and set it later)
- The ticket document exists under `.groundwork/motives/<slug>/tickets/` (or create it first)

---

## Steps

**1. Add the slice**

```
bin/ledger add S3 \
  --desc "Wire auth middleware to API routes" \
  --wave 2
```

Expected output:
```
✓ slice S3 added (pending, wave 2)
```

---

**2. Attach acceptance criteria**

Acceptance criteria are observable outcomes — what a reviewer can confirm without reading implementation code.

```
bin/ledger set S3 \
  --acceptance "401 returned when Authorization header is missing; 403 returned when token is expired; valid token passes through to handler"
```

Multiple criteria are separated by semicolons. The ledger stores them as a `string[]`.

Expected output:
```
✓ slice S3 updated
```

---

**3. Link to a ticket (optional but recommended)**

```
bin/ledger set S3 --ticket auth-middleware
```

The ticket id is the bare filename without path or `.md` suffix. The corresponding file must exist at `.groundwork/motives/<slug>/tickets/auth-middleware.md`.

Expected output:
```
✓ slice S3 updated
```

---

**4. Record which acceptance-criteria labels it covers (optional)**

If the motive charter defines numbered acceptance criteria (`AC1`, `AC2`, …):

```
bin/ledger set S3 --covers-ac "AC1,AC3"
```

Expected output:
```
✓ slice S3 updated
```

---

**5. Declare any blocking dependencies (optional)**

If S3 cannot start until S1 and S2 are complete:

```
bin/ledger set S3 --blocked-by "S1,S2"
```

---

**6. Verify the slice was registered**

```
bin/ledger show S3
```

Expected output includes:
```
id:         S3
status:     pending
kind:       impl
wave:       2
desc:       Wire auth middleware to API routes
acceptance: ["401 returned…", "403 returned…", "valid token…"]
ticket:     auth-middleware
covers_ac:  ["AC1","AC3"]
blocked_by: ["S1","S2"]
```

---

## Fog slice variant

If the slice represents an open question rather than implementation work:

```
bin/ledger fog Q1 \
  --desc "Retry policy for stop-gate hook" \
  --question "What retry interval and backoff strategy suits the hook under normal load?"
```

Fog slices have no acceptance criteria and do not appear in `ledger frontier`. See [[../concepts/vertical-slice#Fog slices]] for when to use them.

---

## Related notes

- [[../concepts/vertical-slice]] — what a slice is
- [[../components/run-ledger-slice]] — full field specs
- [[../flows/slice-lifecycle]] — state machine
- [[release-stop-gate-after-advisor-approve]] — what to do after all slices complete
- [[../reference/ledger-cli-reference]] — all commands at a glance
