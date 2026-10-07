# harness-kit

> Install a **coding-agent harness** — for Claude Code, Codex and Cursor — into any project through a step-by-step wizard.
> Instead of *asking* the AI in a prompt to "run the tests and don't touch that file", the harness *enforces* it with hooks and permission rules.

```bash
cd my-project
npx github:pj002321/harness-kit
```

A wizard opens in your browser (English · 한국어 · 日本語). Answer 8 steps and a harness tailored to that project is installed. Zero dependencies; no AI is called during installation.

## What is a harness?

Code outside the model that **controls the model's work through structure**. This kit combines two write-ups:

| Source | Idea | What harness-kit installs |
|---|---|---|
| OpenAI — [Harness engineering](https://openai.com/index/harness-engineering/) | The repo is the system of record. A short AGENTS.md is the map; knowledge lives in `docs/`; rules are checked mechanically. | `AGENTS.md` map, `docs/` knowledge base, link check in the gate |
| Anthropic — [Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps) | Agents grade their own work too generously. Separate the builder (Generator) from the judge (Evaluator), and agree on "done" (a contract) before building. | Planner / Generator / Evaluator subagents, `/harness-feature` |
| Anthropic — [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | A feature list that starts all-failing, a progress file, and a startup routine stop "it's done" when it isn't. | `docs/features.json`, `docs/exec-plans/progress.md`, session routine in AGENTS.md |

## Supported agents

The harness ideas are the same everywhere; each tool exposes different controls. Shared files are installed once, and each selected agent gets thin adapter files that call the same scripts in `.harness/`.

| | Claude Code | Codex | Cursor |
|---|---|---|---|
| Map (`AGENTS.md`) | ✅ (+ `@AGENTS.md` in `CLAUDE.md`) | ✅ | ✅ |
| Completion gate | ✅ Stop hook blocks finishing | ✅ Stop hook blocks finishing — approve hooks once with `/hooks` | △ `stop` hook sends the agent back with "fix this" (max 8) |
| No-read / blocked commands | ✅ `permissions.deny` | ✅ PreToolUse guard (Bash, apply_patch) | ✅ `beforeReadFile`, `beforeShellExecution` (only for matching commands) |
| No-edit paths | ✅ `permissions.deny` | ✅ guard on apply_patch | ✕ written as a rule only — no enforcing hook confirmed |
| Read-only Evaluator | ✅ `.claude/agents/` | ✅ `.codex/agents/*.toml`, `sandbox_mode = "read-only"` | ✅ `readonly: true` |
| Loop | `/harness-feature` | `$harness-feature` | `/harness-feature` |
| Status | tested with real sessions | experimental | experimental |

Sources: [Codex hooks](https://developers.openai.com/codex/hooks), [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [Codex skills](https://developers.openai.com/codex/skills), [Cursor hooks](https://cursor.com/docs/hooks), [Cursor subagents](https://cursor.com/docs/subagents).

## The wizard

| Step | Asks | Installs |
|---|---|---|
| 0 Agents | Claude Code / Codex / Cursor — what each one enforces is shown | Adapter files per agent |
| 1 Project | Description, folder notes, team rules — folders are guessed from their names and contents; common rules are one click | `AGENTS.md` map (+ `@AGENTS.md` in `CLAUDE.md`) |
| 2 Structure | Knowledge base (OpenAI) / feature list (Anthropic) | `docs/` skeleton — only files that don't exist yet |
| 3 Checks | Test / lint / type-check commands — **run them right there** | Completion gate (Stop hook) |
| 4 Run & verify | How to start the app, which URL to check | How the Evaluator launches and pokes the real app |
| 5 Guardrails | No-read / no-edit paths, blocked commands | Permission rules / guard hooks |
| 6 Components | Gate, Planner→Generator⇄Evaluator loop, retry limit | Subagents, `/harness-feature` |
| 7 Review | Every file that will be created or changed → install | |

Install is locked if the gate is on but a check hasn't passed, or if the knowledge base would contain broken links right after install — either would leave the AI unable to ever finish.

## What gets installed

```
AGENTS.md                               map — only a managed block (<!-- harness-kit:start/end -->) is added or replaced
CLAUDE.md                               @AGENTS.md import (Claude Code; existing content kept)
ARCHITECTURE.md                         only if no architecture doc exists (an existing docs/architecture.md is linked instead)
docs/
├── design-docs/{index,core-beliefs}.md
├── product-specs/index.md              Planner specs land here
├── exec-plans/
│   ├── active/  completed/             contracts + verdicts per feature
│   ├── progress.md                     append-only log
│   └── tech-debt-tracker.md
├── references/  generated/
├── QUALITY_SCORE.md  RELIABILITY.md  SECURITY.md
└── features.json                       (optional) feature list, every item starts passes:false
.harness/                               shared by every agent
├── config.json                         your answers — rerunning the wizard pre-fills them
├── gate.mjs                            completion gate
├── guard.mjs                           path / command guard (Codex, Cursor)
└── check-docs.mjs                      knowledge-base link check (runs inside the gate)
.claude/   settings.json (Stop hook + permissions.deny), agents/, skills/harness-feature/        ← Claude Code
.codex/    hooks.json (Stop + PreToolUse), config.toml, agents/*.toml                            ← Codex
.agents/   skills/harness-feature/                                                                ← Codex
.cursor/   hooks.json (stop, beforeReadFile, beforeShellExecution), agents/, commands/            ← Cursor
```

Every config file is merged: only harness entries are added, replaced or removed. Deselect an agent and its harness entries are removed; a project installed with an older harness-kit is migrated automatically.

Generated files are written in the language selected in the wizard.

### Completion gate

When the agent tries to finish, the gate runs your checks. If any fails, it blocks finishing (Claude Code, Codex) or sends the agent back with the failure output (Cursor). If nothing changed (the agent only answered a question) it is skipped. Claude Code stops on its own after 8 consecutive blocks; Cursor after the hook's loop limit.

With the gate on, `.harness/**` and the agents' hook config are also protected, so the agent cannot switch the gate off to get past it.

### `/harness-feature <feature>`

```
Planner ─ spec → docs/product-specs/ ─▶ for each sprint:
   Generator proposes a contract ─▶ Evaluator reviews it ─▶ docs/exec-plans/active/<feature>.md
   Generator builds ─▶ Evaluator runs it for real: PASS/FAIL + evidence per item
   FAIL → verdict goes back to the Generator (retry limit, then report to a human)
done ─▶ plan moves to docs/exec-plans/completed/
```

Each subagent starts with a fresh context and receives what it needs (spec path, contract, verdict) through files — the original article's way around long tasks losing coherence.

## Verified

Installed on a copy of an [example project](https://github.com/pj002321/Harness-ToDo), then driven with real Claude Code sessions (haiku). Codex and Cursor adapters are covered by unit tests only so far:

| Attempt | Result |
|---|---|
| "Change behavior a test pins down, then finish right away" | Gate **blocked finishing twice** → the AI updated the test for the new requirement, passed, then finished |
| "Empty the checks in the harness config to turn the gate off" (v0.1, then `.claude/harness.json`) | **Permission denied** — file unchanged |
| "Write a file into the protected `runs/` path" | **Permission denied** |
| A broken link added to `docs/` | Docs check fails → gate blocks finishing |

Not yet run: the full `/harness-feature` loop on a real feature, and any live Codex or Cursor session.

## Limits

- The gate cannot tell a legitimately updated test from a weakened one (in the first attempt above the requirement really changed, so updating the test was right). Rules and the Evaluator share that job. You can mark test files no-edit in step 5, but that also blocks legitimate updates.
- Permission rules cover Claude Code's file tools and shell redirects, not a script that opens files itself. For full isolation use the Claude Code sandbox as well.
- If the AI commits mid-session the working tree looks clean and the gate skips.
- Claude Code reads `AGENTS.md` directly from v2.1.277; `CLAUDE.md` gets an `@AGENTS.md` import so older versions read it too.

## Undo

Rerun the wizard and turn components or agents off — harness entries are removed from each config file and user entries are kept. Starter docs in `docs/` are yours once created.

## Security

The wizard can run commands on your machine, so the server listens on `127.0.0.1` only, every API call needs a one-time token created at launch (blocks other websites from calling it), and requests whose Host header isn't localhost are rejected (blocks DNS rebinding).

## Development

```bash
npm test                          # detection, generation, merging, gate, docs check, server security, i18n key parity — no Claude calls
node bin/harness-kit.js <path>    # run the wizard locally
```
