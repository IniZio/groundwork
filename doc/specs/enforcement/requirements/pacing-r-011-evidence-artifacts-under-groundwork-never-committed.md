---
id: pacing-r-011
title: Evidence artifacts under `.groundwork/` are never committed
concept: "[[enforcement/index]]"
criticality: must
verification: manual
ears_pattern: Ubiquitous
verification_method: Inspection
design: "[[design/reference/enforcement-hooks-reference]]"
status: implemented
source: groundwork-development#D-27
verifies: []
---

## Statement

Evidence artifacts recorded in `pacing.milestone_artifacts` and stored under `.groundwork/` **shall** never be committed to the repository. HAR files routinely carry `Authorization` headers, `Cookie`/`Set-Cookie` headers, and session tokens; committing them exposes credentials to every consumer of the repository's history.

**Scope** — This rule addresses the commit path only. It does not prevent an agent from reading a HAR file during a session, or a human from pasting a response excerpt elsewhere. A scrubber was considered (to strip sensitive headers before committing) and deferred; the simpler rule is: do not commit.

## Why

The `.groundwork/` runtime directory is gitignored in the groundwork repo and excluded via `.git/info/exclude` in host repos. Artifacts under it inherit that exclusion. An explicit rule is stated here because the exclusion is an implementation detail that could change, and the security rationale should be durable.

## Fit criterion

`.groundwork/` is listed in `.gitignore` (groundwork repo) or `.git/info/exclude` (host repos). No evidence artifact path under `.groundwork/` appears in `git ls-files`.

## Verification procedure

Manual — confirm `.groundwork/` is excluded before any commit that touches milestone_artifacts.
