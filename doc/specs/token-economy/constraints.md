# Token Economy — Normative Constraints

## TOKEN-ECONOMY-R-001 — Prose compression rules apply to agent output {#token-economy-r-001}

Agent output prose **shall** apply the following compression rules sourced from the caveman project: drop definite and indefinite articles; drop filler words (`just`, `really`, `basically`, `actually`, `simply`); drop pleasantries (`happy to help`, `great question`, `of course`); drop hedging-as-padding (hedges that carry no information, such as `I think` or `it seems like` used as sentence openers without intent); allow sentence fragments; prefer shorter synonyms (`use` over `utilise`, `fix` over `remediate`); omit tool-call narration (`Let me read the file`); omit preamble and progress notes before or between tool calls; omit decorative tables and emoji; quote the shortest decisive line rather than dumping a log excerpt.

- **Why** — these rules target the highest-frequency token sources (articles, filler, narration) that add no information to the receiving agent's reasoning. Removing them reduces input-token cost without changing any claim.
- **Fit criterion** — a diff of any agent output prose shows no articles, no filler words from the enumerated set, no tool-call narration, no opening preamble, and no decorative tables or standalone emoji.
- **Verification**: automated — enforced by parity test asserting guard-rail text is present in every regenerated agent definition; a mirror tree cannot drift silently.
- **Criticality**: must
- **Source** — token-economy#D-1

---

## TOKEN-ECONOMY-R-002 — Intensity level is bounded per surface {#token-economy-r-002}

Every agent output surface **shall** apply compression at no more than the intensity level assigned to that surface: leaf agent output prose at `full` intensity (drop articles, fragments permitted); orchestrator sequencing prose — wave ordering, `blocked_by`, and gate sequences — at `lite` intensity at most (drop filler only; keep articles and full sentences); evidence surfaces at `none` (see TOKEN-ECONOMY-R-003). The intensity level `ultra` (strip conjunctions) **shall not** be used on any surface in groundwork.

- **Why** — `ultra` removes conjunctions, which makes step order ambiguous. Orchestration sequencing depends on unambiguous ordering; a wave that strips `then` and `before` from its sequencing prose can be misread as parallel when it is serial. `lite` is the safety cap for any prose where ordering is semantically load-bearing.
- **Fit criterion** — reviewing a diff of orchestrator sequencing prose shows no removed conjunctions; articles are present; sentence fragments are absent. Reviewing a diff of leaf agent output prose shows articles absent and fragments present where appropriate. No output anywhere applies `ultra`.
- **Verification**: manual — reviewer reads the diff of every sequencing block (wave ordering, gate sequences, `blocked_by` fields) against this rule; a summary of the diff is not sufficient.
- **Criticality**: must
- **Source** — token-economy#D-2

### Manual procedure

1. Identify all orchestrator sequencing prose in the diff: wave-ordering lists, `blocked_by` field values, and gate sequences in `CLAUDE.md` or session-reminder injection.
2. Check each item: conjunctions (`then`, `before`, `after`, `and then`, `so that`) must be present where present in the original; articles (`a`, `an`, `the`) must be present; sentence fragments must be absent.
3. Confirm no output anywhere applies `ultra` intensity (stripped conjunctions in non-sequencing prose is also a violation).
4. If all conditions hold, the requirement is satisfied for that change.

---

## TOKEN-ECONOMY-R-003 — Compression is forbidden on evidence surfaces {#token-economy-r-003}

Compression **shall not** alter any of the following evidence surfaces: advisor citations; ledger entries; gate evidence; test output; `file:line` references; error text; code blocks. These surfaces must be quoted or reproduced exactly as they appear in their source.

- **Why** — terse summaries that collapse "tests appear to pass" to "tests pass" manufacture false APPROVEs. This is a documented recurring failure in this repo (see memory entry `implementer-self-report-reliability.md`). Evidence surfaces are the ground truth against which gate verdicts are issued; any compression of them introduces distortion at the point where distortion is most costly.
- **Fit criterion** — no diff changes any advisor citation, ledger entry, gate evidence block, test output snippet, `file:line` reference, error message, or code block by removing words, shortening phrases, or substituting synonyms. The text either appears verbatim or is absent entirely.
- **Verification**: manual — reviewer checks every evidence surface in the diff against the original source; a summary of the diff is not sufficient.
- **Criticality**: must
- **Source** — token-economy#D-3

### Manual procedure

1. Identify all evidence surfaces in the diff: advisor citations, ledger JSON entries, gate evidence blocks, test output excerpts, `file:line` references, error messages, and fenced code blocks.
2. For each, locate the original source (session transcript, ledger file, test runner output, source file).
3. Confirm the text is reproduced verbatim or removed entirely — no words dropped, no phrases shortened, no synonyms substituted.
4. Flag any surface where the reproduced text differs from the source, even if the difference appears minor.

---

## TOKEN-ECONOMY-R-004 — Negation and scope words are preserved {#token-economy-r-004}

Compression **shall** never remove `not`, `never`, `no`, `only`, or `except` from any prose, regardless of intensity level.

- **Why** — these words invert or bound the scope of a claim. Removing `not` from "must not delegate" produces "must delegate" — the opposite instruction. Flipping a negation costs more than any token saved; no token budget justifies it.
- **Fit criterion** — a diff of any agent output shows no removal of `not`, `never`, `no`, `only`, or `except` from an existing sentence. New sentences may omit them if the claim is positive; existing negations are inviolable.
- **Verification**: automated — a grep guard over changed files flags any hunk that removes a line containing a negation word and does not restore it in the replacement.
- **Criticality**: must
- **Source** — token-economy#D-1

---

## TOKEN-ECONOMY-R-005 — Modality is preserved {#token-economy-r-005}

Compression **shall not** upgrade a modal hedge (`may`, `could`, `sometimes`, `is likely to`, `might`, `appears to`) to a stronger claim (`will`, `does`, `always`, `is`) in any prose output.

- **Why** — hedges (`may`, `could`, `sometimes`, `is likely to`) carry the author's confidence, and confidence is content. A shorter sentence that upgrades a hedge to a fact is not a simplification — it is a different claim. False precision introduced at a gate or in a summary propagates into downstream decisions.
- **Fit criterion** — a diff shows no sentence where a modal verb or hedge phrase was replaced with a stronger form. If a hedge is present in the original, the replacement either preserves the hedge or removes the sentence entirely.
- **Verification**: automated — a grep guard over changed files flags hunks that remove a modal hedge word and replace it with a stronger assertion in the same subject-predicate position.
- **Criticality**: must
- **Source** — token-economy#D-1

---

## TOKEN-ECONOMY-R-006 — No invented abbreviations; domain vocabulary preserved {#token-economy-r-006}

Compression **shall not** introduce ad-hoc abbreviations or contractions (`cfg`, `fn`, `req`) as substitutes for their full forms. Groundwork's existing domain vocabulary (`AC`, `TBD`, `TBR`) **shall** be left unchanged — neither expanded nor further contracted.

- **Why** — ad-hoc abbreviations save no tokens: the tokenizer splits `cfg` and `config` identically, so the substitution provides zero saving while imposing a real decode cost on the reader. Domain vocabulary (`AC`, `TBD`, `TBR`) is defined terms-of-art with stable meaning in `doc/specs/` and the motive corpus; expanding or contracting them changes search recall and breaks requirement tracing.
- **Fit criterion** — a diff shows no introduced instances of `cfg`, `fn`, `req`, `impl` (when used as abbreviation for implementation), or other ad-hoc contractions. Existing uses of `AC`, `TBD`, `TBR` are unchanged.
- **Verification**: automated — a grep guard over changed files flags newly introduced instances of the prohibited abbreviation set; a separate guard flags any diff that expands `AC`, `TBD`, or `TBR` to their full forms.
- **Criticality**: must
- **Source** — token-economy#D-4

---

## TOKEN-ECONOMY-R-007 — ASD-STE100 skill is at v0.4.0 or later {#token-economy-r-007}

The user-level ASD-STE100 skill install at `~/.claude/skills/asd-ste100/` **shall** be upgraded to upstream v0.4.0 with the frontmatter `name` field corrected to the value defined in the upstream manifest.

- **Why** — the locally installed v0.1.0 is a strict subset of v0.4.0; rules added in v0.2.0–v0.4.0 cover modality preservation and scope-word handling that groundwork's compression model depends on. Running the earlier version silently omits those rules.
- **Fit criterion** — `cat ~/.claude/skills/asd-ste100/SKILL.md | head -5` shows a `version` or frontmatter field at `0.4.0` or later, and the frontmatter `name` matches the upstream value. The v0.1.0 install no longer exists at that path.
- **Verification**: manual — reviewer checks the installed version field against the upstream manifest; the repo test suite cannot access the user-level skills directory.
- **Criticality**: must
- **Source** — token-economy#D-5

### Manual procedure

1. Run `cat ~/.claude/skills/asd-ste100/SKILL.md | head -10` to read the frontmatter.
2. Confirm the version is `0.4.0` or later.
3. Confirm the `name` field matches the upstream manifest value (not the locally-patched name from v0.1.0).
4. If both conditions hold, the requirement is satisfied.

---

## TOKEN-ECONOMY-R-008 — No implementation slice assumes a clean working tree {#token-economy-r-008}

Every implementation slice in this motive **shall** stage or commit changes by explicit file path rather than using `git add .`, `git add -A`, or any command that stages all modified and untracked files.

- **Why** — the working tree carried approximately thirty uncommitted entries at planning time. A slice that runs `git add .` risks staging or committing files it does not own, corrupting the change attribution of other slices and polluting commits with unrelated modifications.
- **Fit criterion** — every `git add` invocation in the session transcript for this motive names explicit paths; no invocation uses `.`, `-A`, or `--all`. `git status` after each commit shows only intentional changes were staged.
- **Verification**: manual — reviewer reads the session transcript for any `git add` invocations, confirms explicit paths, and checks `git status` output after each commit.
- **Criticality**: must
- **Source** — token-economy#D-6

### Manual procedure

1. Open the session transcript for any slice in this motive that made commits.
2. Search for `git add` invocations. Confirm each names explicit file paths.
3. Check `git status` output immediately after each commit to confirm no unintended files were staged.
4. If all `git add` calls use explicit paths, the requirement is satisfied.
