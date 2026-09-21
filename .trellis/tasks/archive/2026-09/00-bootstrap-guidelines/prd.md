# Bootstrap Task: Fill Project Development Guidelines

**You (the AI) are running this task. The developer does not read this file.**

The developer just ran `trellis init` on this project for the first time.
`.trellis/` now exists with empty spec scaffolding, and this bootstrap task
exists under `.trellis/tasks/`. When they want to work on it, they should start
this task from a session that provides Trellis session identity.

**Your job**: help them populate `.trellis/spec/` with the team's real
coding conventions. Every future AI session — this project's
`trellis-implement` and `trellis-check` sub-agents — auto-loads spec files
listed in per-task jsonl manifests. Empty spec = sub-agents write generic
code. Real spec = sub-agents match the team's actual patterns.

Don't dump instructions. Open with a short greeting, figure out if the repo
has any existing convention docs (CLAUDE.md, .cursorrules, etc.), and drive
the rest conversationally.

---

## Status (update the checkboxes as you complete each item)

- [x] Fill backend guidelines → restructured as `project/` + `app/` + `domain/` layers (backend/frontend split did not fit the Expo monorepo)
- [x] Fill frontend guidelines → covered by `app/` layer
- [ ] Add code examples → **greenfield exception: intentionally not done in this task.** This task's completion gate = agreed conventions + advisor APPROVE (review history below). Real file examples are a deliverable of the scaffold task, which updates the specs in its Phase 3.3. The template's "real examples before archive" requirement is superseded for this task by that exception.

## Stack Decisions (2026-09-20, user-confirmed)

| # | Decision | Value |
|---|----------|-------|
| 1 | Core platform | Expo (React Native) + TypeScript — iOS/Android/Web |
| 2 | Sync layer | PowerSync cloud + Postgres (local SQLite via PowerSync client) |
| 3 | Desktop | Tauri v2 shell loading the Expo Web build |
| 4 | Monorepo | pnpm workspaces: `apps/mobile`, `apps/desktop`, `packages/core`, `packages/db`, `packages/ui`, `server/app` |
| 5 | App backend | Hono (TypeScript) on Node 20, `server/app` workspace, Dockerfile; 2 endpoints, owner-token auth; v1 host: Fly.io |

Derived conventions (documented in spec, changeable before scaffold):
Kysely queries, Zustand (transient only), NativeWind v4, Expo Router, Jest (jest-expo),
ESLint flat + Prettier, strict TS / named exports only, ULIDs, typed `NextdoError`
hierarchy, engine as pure function with injected `now`; server Postgres driver pinned
to `pg` (node-postgres), server SQL isolated to `server/app/src`.

---

## Spec files to populate (actual final set — supersedes the template's backend/frontend list)

The template's `backend/*` + `frontend/*` split was replaced on 2026-09-20 with
layers that match the Expo monorepo. Final set (all filled):

| File | What it documents |
|------|-------------------|
| `.trellis/spec/index.md` | Stack decisions + layer map + greenfield status note |
| `.trellis/spec/project/index.md` | Pre-dev checklist + quality gate |
| `.trellis/spec/project/directory-structure.md` | Monorepo layout, placement rules, dependency graph |
| `.trellis/spec/project/conventions.md` | TS, naming, exports, errors, logging, time |
| `.trellis/spec/project/quality-guidelines.md` | Lint/test tooling, testing bar, review standards |
| `.trellis/spec/app/index.md` | Pre-dev checklist + quality gate |
| `.trellis/spec/app/component-guidelines.md` | Component patterns, styling, a11y |
| `.trellis/spec/app/hook-guidelines.md` | Data hooks vs UI hooks |
| `.trellis/spec/app/state-management.md` | Local-first state model, Zustand scope |
| `.trellis/spec/app/database-guidelines.md` | Schema, PowerSync read/write paths, mutations, schema changes |
| `.trellis/spec/domain/index.md` | Pre-dev checklist + quality gate |
| `.trellis/spec/domain/domain-model.md` | Entities, Clarify decision table, transactions |
| `.trellis/spec/domain/next-action-engine.md` | Engine contract, weights/formula, skip semantics, tests |

Thinking guides (`.trellis/spec/guides/`) remain as-is (Trellis defaults).

## Review history

- 2026-09-20: advisor review pass 1 (gpt-5.6-sol, xhigh, read-only) — verdict REVISE,
  11 blocking findings; all fixed (Clarify table + Do Now branch, full
  CandidateAction/field definitions, pinned v1 weights + worked example,
  consecutive-skip semantics, ReviewRecord schema, Reminder entity, HabitDay
  determinism/timezone, focus terminal states, snooze DB-only + immediate writes,
  Expo Router default-export exception, dependency graph, PowerSync service model,
  this file's stale paths). Non-blocking item (hard line-count/FlashList thresholds)
  also softened to heuristics.
- 2026-09-20: advisor review pass 2 — verdict REVISE, 8 blocking findings; all fixed:
  Do Now non-completion branch now terminates at NextAction (no re-entry into
  questions 4–5); CandidateAction gained `dependencyDone` + `windowDays`, pool
  contract documented (open/non-deleted, self-block exclusion), snooze/skip columns
  on all three action kinds, GPS/external-calendar marked post-MVP; deadline bands
  made boundary-inclusive (72 h → 0.7, consistent with the example); health-protection
  restated with exact arithmetic (boost = +0.5 value units, not a top-slot guarantee);
  ReviewRecord now a kind-discriminated union with completedToday/stillOpen/
  calendarReasonable and a dep-free core validator (no zod); snooze presets pinned
  (10m/30m/1h/tonight 21:00/tomorrow 09:00) + mobile/desktop notification capability
  matrix (Tauri: no action buttons → deep-link fallback) + FocusSession `endedAt`;
  PowerSync section rewritten to the verified official model (read path = Service
  Sync Streams; write path = ps_crud → connector.uploadData() → app backend →
  Postgres; fetchCredentials short-TTL JWT with automatic pre-fetch; no client
  migrations — schemaless view applies at app start); component guidelines carry the
  same Expo Router default-export exception; this task's archive exception stated
  above. (The "boost = +0.5 value units" wording in this entry was superseded by the
  Round 3 fix to **+2.5 value levels** — the original arithmetic was wrong.)
- 2026-09-20: advisor review pass 3 — verdict REVISE, 6 blocking findings; all fixed:
  no client-side migration mechanism (schema.ts = PowerSync client schema / local
  table view; schema changes = server-only protocol); FocusSession completedAt →
  endedAt; no static token (backend mints a short-TTL 15-min JWT on request,
  auto-refresh); server tree replaced with the Hono (TypeScript, Node 20) service and
  /credentials + /upload (owner-token auth); health boost arithmetic corrected to
  +2.5 value levels; write path fixed to ps_crud → connector.uploadData() →
  backend /upload → Postgres. Non-blocking: Habit broken-transition semantics added.
- 2026-09-20: advisor review pass 4 (gpt-5.6-sol, xhigh, read-only) — verdict REVISE,
  4 blocking findings; all fixed: removed the contradiction that the backend "must
  call batch.complete()" (only the client's uploadData() calls it after 2xx — the
  server cannot call a client object); "no static token" scoped to "no static
  PowerSync JWT" + owner-token storage matrix per platform (expo-secure-store is
  native-only: iOS/Android SecureStore, Tauri Stronghold, browser Web in-memory);
  server/app formalized as a pnpm workspace (stack table, dependency graph, root
  lint/typecheck/test coverage; `pg` driver pinned; client SQL in packages/db vs
  server Postgres SQL in server/app/src); this review-history entry corrected
  (+2.5 value levels).
- 2026-09-20: advisor review pass 5 (gpt-5.6-sol, xhigh, read-only) — verdict
  **APPROVE**. No blocking findings, no non-blocking notes. Advisor: the spec has
  sufficient consistency, actionability, and platform accuracy to be archived and
  handed to the scaffold task.

---

## How to fill the spec

### Step 1: Import from existing convention files first (preferred)

Search the repo for existing convention docs. If any exist, read them and
extract the relevant rules into the matching `.trellis/spec/` files —
usually much faster than documenting from scratch.

| File / Directory | Tool |
|------|------|
| `CLAUDE.md` / `CLAUDE.local.md` | Claude Code |
| `AGENTS.md` | Codex / Claude Code / agent-compatible tools |
| `.cursorrules` | Cursor |
| `.cursor/rules/*.mdc` | Cursor (rules directory) |
| `.windsurfrules` | Windsurf |
| `.clinerules` | Cline |
| `.roomodes` | Roo Code |
| `.github/copilot-instructions.md` | GitHub Copilot |
| `.vscode/settings.json` → `github.copilot.chat.codeGeneration.instructions` | VS Code Copilot |
| `CONVENTIONS.md` / `.aider.conf.yml` | aider |
| `CONTRIBUTING.md` | General project conventions |
| `.editorconfig` | Editor formatting rules |

### Step 2: Analyze the codebase for anything not covered by existing docs

Scan real code to discover patterns. Before writing each spec file:
- Find 2-3 real examples of each pattern in the codebase.
- Reference real file paths (not hypothetical ones).
- Document anti-patterns the team clearly avoids.

### Step 3: Document reality, not ideals

**Critical**: write what the code *actually does*, not what it should do.
Sub-agents match the spec, so aspirational patterns that don't exist in the
codebase will cause sub-agents to write code that looks out of place.

If the team has known tech debt, document the current state — improvement
is a separate conversation, not a bootstrap concern.

---

## Quick explainer of the runtime (share when they ask "why do we need spec at all")

- Every AI coding task spawns two sub-agents: `trellis-implement` (writes
  code) and `trellis-check` (verifies quality).
- Each task has `implement.jsonl` / `check.jsonl` manifests listing which
  spec files to load.
- The platform hook auto-injects those spec files + the task's `prd.md`
  into every sub-agent prompt, so the sub-agent codes/reviews per team
  conventions without anyone pasting them manually.
- Source of truth: `.trellis/spec/`. That's why filling it well now pays
  off forever.

---

## Completion (greenfield exception — overrides the generic gate above)

This project was greenfield: there was no code to import conventions from and no
real examples to reference. Per the decision recorded in Status, the archive gate
for **this** task is **advisor APPROVE** (see Review history), not "real examples
landed". The "real code examples" item is intentionally deferred to the scaffold
task, which will add concrete file references to these specs in its Phase 3.3.

Once the advisor returns APPROVE, run:

```bash
python3 ./.trellis/scripts/task.py finish
python3 ./.trellis/scripts/task.py archive 00-bootstrap-guidelines
```

After archive, every new developer who joins this project will get a
`00-join-<slug>` onboarding task instead of this bootstrap task.

---

## Suggested opening line

"Welcome to Trellis! Your init just set me up to help you fill the project
spec — a one-time setup so every future AI session follows the team's
conventions instead of writing generic code. Before we start, do you have
any existing convention docs (CLAUDE.md, .cursorrules, CONTRIBUTING.md,
etc.) I can pull from, or should I scan the codebase from scratch?"
