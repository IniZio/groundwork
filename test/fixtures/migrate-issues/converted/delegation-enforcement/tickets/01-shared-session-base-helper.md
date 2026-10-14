---
title: "Shared session-base helper for groundwork hooks"
status: done
priority: none
tags: []
parent: "[[delegation-enforcement]]"
blocked_by: []
source: ""
created: 2026-10-03
---

**What to build:** groundwork's own hooks can resolve the session base commit (newest commit before the session's — or subagent's — first transcript entry) exactly as house-rules' density gate does, from an installed plugin cache that has no `plugins/` directory. Vendored copy guarded by a byte-parity test, like the existing house-rules lint vendor.



- [ ] groundwork hooks import a session-base helper that lives inside groundwork's hook lib, not under `plugins/`.
- [ ] Byte-parity test fails when the vendored copy and the house-rules source diverge.
- [ ] Test resolves the base from a simulated cache layout (no `plugins/`, no `package.json`), not the dev tree.
- [ ] Given a real transcript path, returns the newest commit before the first transcript timestamp; given none, falls back to HEAD (documented choice, tested).
- [ ] No behaviour change to any existing gate.

## Answer

Shipped in groundwork v2.13.0: e9d4bed session-base helper, 60abedb bounded rev-list.
