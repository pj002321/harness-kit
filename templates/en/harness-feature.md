---
name: harness-feature
description: Builds one feature through the Planner → contract → Generator ⇄ Evaluator loop. Use when taking on a new feature that spans several files.
argument-hint: [feature to build]
---

# Build with the harness loop: $ARGUMENTS

You are the orchestrator. You do not write code yourself. Follow these steps in order and never skip one.
First choose a short English kebab-case name (slug) for the feature.

1. **Plan**: hand the request to the `harness-planner` subagent and get a spec. Save it to `docs/product-specs/<slug>.md` and add a line to `docs/product-specs/index.md`.
2. **Create the execution plan**: `docs/exec-plans/active/<slug>.md` — link to the spec and leave a section per sprint.
3. **For each sprint** (n = 1, 2, …):
   1. **Contract**: give `harness-generator` the spec and sprint number to get a proposed contract, then have `harness-evaluator` review it. Write the approved (or corrected) contract under `## Sprint <n> contract` in the execution plan.
   2. **Build**: give `harness-generator` the spec path, the full contract, and (if any) the full previous verdict, and have it implement.
   3. **Verify**: give `harness-evaluator` the full contract and have it verify. Append the verdict to the execution plan as `### Verdict #<k>`.
   4. On `VERDICT: PASS` move to the next sprint. Otherwise pass the verdict to the generator as-is and repeat from 3-2.
      **At most {{maxAttempts}} attempts.** Past that, stop and report the failing items and evidence to the user.
4. After each step append one line to `docs/exec-plans/progress.md`: `- <date> <slug> S<n> <step> → <result>`
{{featuresStep}}5. When every sprint passes, move the execution plan to `docs/exec-plans/completed/`, then summarize results per sprint, remaining issues, and changed files for the user.

Rules:

- Never overturn the Evaluator's FAIL with your own judgment.
- Do not change the contract mid-build. If it must change, ask the user.
- Subagents cannot see this conversation. Pass what they need (spec path, full contract, full verdict) every time.
