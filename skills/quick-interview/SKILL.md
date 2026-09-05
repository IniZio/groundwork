---
name: quick-interview
description: Run the interview primitive for an ambiguous small change — tight question limit, then briefs general-purpose.
disable-model-invocation: false
---
Entry: ambiguous small change touching shared code, API, or auth.

Load `groundwork:interview`. 3–4 questions max; cover only the unclear aspects — boundaries, edge cases, acceptance criteria. Skip data model, architecture, and error handling unless relevant. The synthesis IS the spec; a motive is optional. User can always request more interviewing.

Output: brief for `groundwork:general-purpose` → proceed to implement.
