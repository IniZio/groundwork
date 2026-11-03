# Proof

A check is evidence only if it could have failed. These rules bind your own quick fixes as much as a worker's. Read an assertion's history before inverting it.

- Before you count a test, break the behaviour it covers and watch it go red, then restore. Back up with `cp` outside the repo and restore with `cmp`, never with git. Flipping the expected constant, asserting a set is non-empty, or a perturbation you never restore are not proof.
- A clean result counts only if the check could have seen a dirty one. Feed it a known-bad input through the interface the caller really uses.
- Cover the invocation variants a human uses, not the one easiest to script. For a commit hook that means `-m`, `-F`, `--amend`, the editor and stdin.
- Run suites and type checks unfiltered. Check the exit code directly, since a pipe to `tail` hides it. Never accept "I ran tests" or "should pass" without fresh output.
- Before calling a failure pre-existing, reproduce it on main.
- One failure in a mostly green test is a bug until a load loop (about 200 runs under contention) passes clean.
- A timing claim counts only when before and after start from the same cold state on the same host, with caches and host tools stripped from PATH and HOME. State the environment with the number.
- A false approval costs far more than a false send-back. When in doubt, send it back with a `file:line` citation you produced.
- Keep QA and approval separate. QA produces evidence. A different agent, or you, decides.
- QA reports one row per acceptance criterion: `[PASS|FAIL] <id>: evidence=<link> replay=<saved flow>`. Evidence is a video, trace or screenshot pair. QA replays a saved flow before exploring and saves each new flow.
- Grade research findings HIGH, MEDIUM or LOW with the check that would falsify each. Never invent a citation.
