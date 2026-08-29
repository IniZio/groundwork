# How ledger validates AC and decision references

This recipe explains the validation path for `covers_ac` and `decisions` fields on a ledger slice, as specified by R-008.

---

## When validation fires

Validation runs on every `ledger set <slice-id> --covers-ac "..."` or `ledger set <slice-id> --decisions "..."` call. It also runs on `ledger add` when either flag is present.

---

## Valid sets

| Field | Valid set source |
|-------|-----------------|
| `covers_ac` | Union of: (a) AC ids declared in `motive.md` `## Acceptance criteria` section + (b) `acceptance-criterion` nodes in the canonical fold |
| `decisions` | `decision` nodes in the canonical fold only |

A charter-declared AC is valid even before any `AC_COVERAGE` event has been emitted — first-time coverage annotation must not be rejected.

---

## Graceful degradation

When any of the following conditions hold, validation is **skipped** (no crash, exit 0):

- No motive is stamped on the ledger (`motive_ref` absent).
- The journal is absent (no `.jsonl` shards for the motive).
- Fold assembly fails (e.g. corrupt shard).

---

## Diagnostic format

On a dangling reference, the ledger prints a machine-readable diagnostic and exits nonzero:

```
Error: unknown covers_ac id "AC-999" — not in charter or canonical fold
Error: unknown decisions id "D-999" — not in canonical fold
```

The field name (`covers_ac` or `decisions`) and the unknown id are always named explicitly.

---

## Example: valid and invalid calls

```bash
# Valid — AC-1 is in the fold
ledger set s1 --covers-ac "AC-1"   # exit 0

# Valid — AC-2 is charter-declared (not yet in fold)
ledger set s1 --covers-ac "AC-2"   # exit 0

# Invalid — AC-999 is neither in charter nor in fold
ledger set s1 --covers-ac "AC-999" # exit 1, diagnostic printed

# Valid — D-1 is in the fold
ledger set s1 --decisions "D-1"    # exit 0

# Invalid — D-999 is not in the fold
ledger set s1 --decisions "D-999"  # exit 1, diagnostic printed
```
