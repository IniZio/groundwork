# 06: Upstream drift check for mattpocock-skills

**What to build:** one command reports the installed mattpocock-skills version and commit next to upstream HEAD's version and commit, and flags drift. The upstream record doc pins the upstream commit it was written against, and the parity test checks it.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## Parent

Retro of session ce8fea42, 2026-10-06. `claude plugin update` said 1.2.3 was latest while upstream was at 1.3.1, and the installed commit did not match its manifest version; finding this took a manual clone.

- [ ] Script prints installed version + SHA, upstream HEAD version + SHA, and a drift verdict; exits non-zero on drift
- [ ] Upstream record doc carries the upstream SHA alongside the version
- [ ] Parity test fails when the recorded SHA disagrees with the installed one (skipIf cache missing)
