# Loop Construction Reference

Ten ways to build a feedback loop, in priority order. Each option is a fallback for the one above it.

| # | Method | When to use |
|---|--------|-------------|
| 1 | **Failing test** | Any bug reachable through the test suite at a correct seam |
| 2 | **HTTP script** | `curl` or HTTP client against a dev server |
| 3 | **CLI invocation** | Fixture file + diff stdout vs known-good snapshot |
| 4 | **Headless browser** | UI bug; Playwright or Puppeteer script |
| 5 | **Replay trace** | Captured network request, payload, or event log |
| 6 | **Throwaway harness** | Minimal subset of the system; delete after Phase 6 |
| 7 | **Fuzz / property test** | 1000+ random inputs to force reproduction |
| 8 | **Bisection harness** | Regression across commits; use with `git bisect run` |
| 9 | **Differential** | Old version vs new version; compare outputs |
| 10 | **HITL script** | Human-in-the-loop bash script; last resort only |

## Tightening the loop

- Reduce loop latency to seconds, not minutes — a 2-second loop is a debugging superpower.
- For non-deterministic bugs: run the loop 100× in parallel; target ≥50% reproduction per run. A 1% rate is not actionable.

## When no loop is possible

State explicitly why (hardware, live third-party, destructive side effect) and name what the human observer must look for. The remaining phases become observation-based rather than automated.
