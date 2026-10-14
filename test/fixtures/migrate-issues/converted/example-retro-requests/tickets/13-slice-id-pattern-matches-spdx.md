---
title: "Slice-id pattern flags licence names like BSD-3-Clause"
status: triage
priority: none
tags: [bug]
parent: "[[example-retro-requests]]"
blocked_by: []
source: "peer-b, 2026-10-12. Seen in the body of https://github.com/example/app/pull/46"
created: 2026-10-12
---



## Problem

human-doc-check, and human-doc-reviewer, which repeats its output, flag "BSD-3" inside "BSD-3-Clause" as groundwork vocabulary.

Cause: `SLICE_RE = /\b([A-Z]{2,4})-\d{1,3}\b/g` in src/review/human-doc-rules.ts. The `\b` after the digit still holds when a `-Clause` suffix follows. The `NOT_SLICE` exclusion set (SHA, UTF, ISO, RFC, CVE, HTTP) does not cover licence names.

## Suggested fix

Do not match when the digits are followed by `-` or `.` and another word character (for example `(?![-.]\w)`), and/or exclude known SPDX ids (BSD-2-Clause, BSD-3-Clause, GPL-2.0, LGPL-3.0, and so on). Add test cases for both, and keep a real slice id such as `RP-1` flagged as a positive control.
