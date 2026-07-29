# Issue-Type Routing Detail (Codex)

Use this routing as a compact decision aid:

- Bug or regression → reproduce, diagnose, fix, and add regression evidence.
- Clear small change → implement directly, then verify behavior.
- Ambiguous or risky change → clarify scope, write acceptance criteria, then
  implement through slices.
- Multi-behavior feature → plan, decompose into conflict-free slices, execute
  waves in dependency order, and review the result.
- Design uncertainty → prototype the smallest disposable experiment first.

Load the named skill through the available skill surface. Track plan, slice,
and review state in the host plan or a user-visible artifact. Delegation,
interactive questioning, ledger persistence, and completion enforcement are
host-specific; do not assume any of them are native Codex capabilities.
