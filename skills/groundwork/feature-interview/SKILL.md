---
name: feature-interview
description: Start here to plan a feature — runs the interview primitive then dispatches to the planner.
disable-model-invocation: true
---
Entry: user signals feature intent ("build X", "plan this", >1h).

Load `groundwork:interview`. Full interview, captures motive charter. Set `motive_ref` to the slug so the planner can locate it. Interview and planner are complementary stages, not competing alternatives — interview feeds the planner, the planner cannot prompt the user.

Hand off to `groundwork:planner` on completion.

Pipeline: feature-interview → planner → vertical-slice → plan-review → fan out.
