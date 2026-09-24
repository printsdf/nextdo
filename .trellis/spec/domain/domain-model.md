# Domain Model

> Entities and lifecycle of the GTD system (Proposal §5). The engine consumes these
> types; the DB layer persists them. Types live in `packages/core/src/domain`.

---

## The Clarify Decision Table (Proposal §5.2 — complete, no implicit branches)

Every `InboxItem` is resolved by exactly this flow. The UI walks the user through the
questions one at a time; the resolution is **one DB transaction** that deletes the
`InboxItem` and creates the target row(s). The target row carries `sourceInboxId`
(= the deleted item's id) for traceability.

```text
InboxItem
├─ 1. 可以行动吗？(Is it actionable?)
│   ├─ NO
│   │   ├─ 有参考价值            → ReferenceItem        (title, url?, note)
│   │   ├─ 以后可能做            → SomedayMaybeItem     (title, note?)
│   │   └─ 否                    → Trash (InboxItem soft-deleted, no target row)
│   └─ YES
│       ├─ 2. 需要多个步骤吗？(Multiple steps?)
│       │   ├─ YES → Project + its first NextAction, created ATOMICALLY in the same
│       │   │       transaction. If the user aborts before both are confirmed,
│       │   │       neither row exists (all-or-nothing; the InboxItem survives).
│       │   └─ NO ↓
│       ├─ 2b. 属于哪个已有项目？(Part of an existing project?)
│       │   ├─ <an existing ACTIVE project> → NextAction attached to it:
│       │   │       `projectId` = the project's id; `value` defaults to the
│       │   │       project's value (overridable in the action form).
│       │   │       Questions 3–5 do NOT apply — a project-attached action is
│       │   │       always a NextAction in v1 (a CalendarAction has no
│       │   │       `projectId`; fixed-time and project membership are mutually
│       │   │       exclusive). The project must exist and be `active`
│       │   │       (db errors `clarify.project-not-found` /
│       │   │       `clarify.project-not-active`; validated before the
│       │   │       transaction — no partial writes).
│       │   ├─ 新建项目 (New project) → the Project branch above (same form).
│       │   └─ 不属于项目 (No project) ↓
│       ├─ 3. 约 2 分钟内能完成吗？(Doable in ~2 min?)
│       │   ├─ YES → DO NOW: the UI executes it immediately.
│       │   │   • completed on the spot → CompletionRecord(action_kind="do_now",
│       │   │     action_id = sourceInboxId) and the InboxItem is trashed. No action
│       │   │     entity is ever created.
│       │   │   • not completed on the spot → becomes a `NextAction` and the flow
│       │   │     **ends here** (questions 4–5 do not apply — the user already
│       │   │     declared it theirs and immediately doable). Transaction: delete
│       │   │     the InboxItem, insert the NextAction (`sourceInboxId` set,
│       │   │     `value` default 3 — no project context to inherit from).
│       │   └─ NO ↓
│       ├─ 4. 应该由我完成吗？(My responsibility?)
│       │   ├─ NO → WaitingForItem   (waitingOn, expectedBy?)
│       │   └─ YES ↓
│       └─ 5. 必须在特定日期/时间执行吗？(Fixed date/time?)
│           ├─ YES → CalendarAction (startsAt, plus shared action fields)
│           └─ NO  → NextAction
```

Rules:

- A clarification that creates a `Project` must also create its first `NextAction`
  (Proposal §5.3) — a project without a next action is rejected in the UI before the
  transaction, with `ValidationNextdoError("project.needs-outcome")` if the outcome
  field is empty.
- "Trash" is always soft delete (`deleted_at` set); the Trash screen is a query over
  soft-deleted rows, with restore (clears `deleted_at`) and hard-purge.
- Re-clarify (triggered by the engine, see Next Action Engine) re-enters this table at
  question 2 for the existing action: the outcome replaces the old action row
  (old row soft-deleted; `sourceInboxId` chain preserved via the new row's
  `replacesActionId`). Because it re-enters at question 2, re-clarify also passes
  through question 2b — the user can keep the current project, re-attach to another,
  or detach (the replacement action's `projectId` is null).
- Capture handoff (v1 UI): each saved capture enters this walk **immediately**
  (one item at a time; after the walk the UI offers "capture another" / "done").
  An aborted walk leaves the InboxItem in the inbox for later.

## Core Entities

Common to every entity: `id` (ULID, minted at creation in
`packages/core/src/lib/ids.ts`), `created_at`, `updated_at` (ISO-8601 UTC),
`deleted_at` (soft delete, see Trash above). Domain types map snake_case DB columns to
camelCase TS fields; the mapping table is the single one in
`packages/db/src/schema.ts`.

### InboxItem
Raw capture (Proposal §5.1). Required: `title` (free text), `capturedAt`. No contexts,
no estimates — captures stay friction-free. The v1 capture UI hands each saved item
straight into the Clarify walk (see "Capture handoff" rule below); an item survives
in the inbox only when the walk is aborted.

### Project
A multi-step outcome (Proposal §5.3).
- `title`, `outcome` (what "done" means; required, see Clarify rules),
- `value: 1..5` (goal importance — used by the engine's `project-importance` signal),
- `status: "active" | "on-hold" | "done" | "dropped"`.
- **Coverage is always derived, never stored:** `projectActionCoverage()` (in
  `packages/db`) returns the active projects lacking an open action. The weekly review
  screen and the engine both query it; nothing "bumps" a stored counter.

### NextAction
A single concrete step (Proposal §5.3: "运行 baseline A", never "完成论文实验").
- `title`, `projectId?` (at most one project),
- `contextIds: string[]` (where it can be done),
- `estMinutes: number` (user estimate; feeds the engine's hard filter and `time-fit`),
- `value: 1..5` (set in Clarify; defaults to the parent project's value when created
  from one or attached to one via question 2b — overridable in the form),
- `category?: "work" | "health" | "life" | "other"` (the health signal reads
  `category === "health"`),
- `dueDate?` (ISO date, soft) / `deadline?` (ISO **datetime** — the exact moment;
  drives `deadline-urgency`, computed in exact hours),
- `dependsOnId?: string` (v1: at most one, direct dependency — the id of another
  action; the hard filter excludes the dependent until it is done),
- `windowStart?`, `windowEnd?` ("HH:mm", **device-local timezone**) plus
  `windowDays?: number[]` (0=Sunday … 6=Saturday, device-local weekday; undefined =
  every day) — for actions only doable in a daily window, e.g. "工作日 09:00–17:00
  联系客服" = `windowDays: [1,2,3,4,5]`, `windowStart "09:00"`, `windowEnd "17:00"`,
- `snoozedUntil?` (ISO datetime; set/cleared only by the snooze transaction),
  `lastSnoozedAt?` (set by the snooze transaction; feeds the engine's `waiting-time`),
- `consecutiveSkips: number`, `lastSkippedAt?` (semantics in Next Action Engine),
- `status: "open" | "done"`,
- `sourceInboxId?`, `replacesActionId?` (Clarify/re-clarify traceability).
- **Invariant:** one sitting, no sub-list. Enforced softly by Clarify question 2; the
  engine never splits actions itself.

### WaitingForItem
Delegated or blocked on someone/something else (Proposal §5.2).
- `title`, `waitingOn` (who/what), `expectedBy?`, `followUpAt?`.
- When `followUpAt` passes, the item appears in the **Daily Review** list — it never
  enters the engine pool.

### CalendarAction
Time-bound action (Proposal §5.2). `title`, `startsAt` (ISO datetime) + the shared
action fields (contextIds, estMinutes, value, category, deadline optional). Carries
the same execution columns as NextAction (`snoozedUntil`, `lastSnoozedAt`,
`consecutiveSkips`, `lastSkippedAt`) — **snooze/skip transactions target all three
action kinds**. A
`CalendarAction` is a hard schedule entry: the engine preempts it when it is near
(see Next Action Engine). An action is never both `NextAction` and `CalendarAction`.

### SomedayMaybeItem
`title`, `note?`. Weekly review re-asks: promote (→ Project/NextAction via Clarify),
keep, or trash.

### ReferenceItem
External material (Proposal §4.3: v1 = links only). `title`, `url?`, `note?`.

### Context
Named execution environments (Proposal §6.1). Seeded defaults: `home`, `office`,
`computer`, `phone`, `outside`; user can add. Seeding implementation:
`seedDefaultContexts(db, now)` (`packages/db/src/queries/contexts.ts`) — inserts
the five defaults (id = `ulid(now)`) only when **no non-deleted context row
exists**; otherwise a no-op returning 0 (a user who deletes all five is not
re-seeded — user intent is respected). Idempotent. Called once at app start,
after PowerSync init/stream (`apps/mobile/app/_layout.tsx` `start()`,
non-fatal try/catch). Seed rows are ordinary user data — they ride the
existing upload/sync path (no schema change).
The user's current environments are a
UI-layer declaration (mobile: **manual selection** — location-assisted context is
post-MVP; desktop: `computer` + user selection) and are passed to the engine as
`EngineContext.contextIds` — not stored per action beyond the action's own
`contextIds`.

### Habit (+ HabitDay)
A rule generating a recurring action (Proposal §7).
- `Habit`: `title`, `actionTitle` (e.g. "阅读 30 min"), `estMinutes`, `value: 1..5`,
  `category?`, `windowStart` / `windowEnd` ("HH:mm", device-local),
  `windowDays?: number[]` (same semantics as NextAction),
  `cycleDays: number` (default 21 — a **challenge cycle**, UI copy must not claim
  "21 days guarantees a habit"), `startedAt`,
  `status: "active" | "completed" | "broken"`.
  - Status transitions: `active → completed` (last day of the cycle done);
    `active → broken` (a day in the cycle missed — detected at the start of the next
    local day: a current-cycle HabitDay with `localDate < today` not done);
    `broken → active` (user restarts the challenge — new cycle from today).
- `HabitDay`: one row per habit per **local calendar day** — the generated action
  instance.
  - **Deterministic id: `hd-<habitId>-<YYYYMMDD>`** (device-local date).
  - Unique constraint on `(habitId, localDate)`.
  - Generation is `INSERT OR IGNORE` — idempotent, so offline multi-device generation
    never creates duplicates (Proposal §10).
  - "Day" and the window are evaluated in the **device's local calendar timezone** at
    generation time; no server timezone is involved.
  - Persisted `status: "open" | "done"`. **`missed` is derived** (a past localDate
    whose row is not done) — computed at query time, never written.
  - HabitDay rows also carry the execution columns (`snoozedUntil`,
    `lastSnoozedAt`, `consecutiveSkips`, `lastSkippedAt`) — see CalendarAction.
  - A `HabitDay` maps to the engine's `HabitCandidate` (see engine types) with
    `cycleDay` = days since `habit.startedAt` + 1.

### Reminder (Proposal §8 — MVP-required)
- `Reminder`: `id`, `actionKind: "next" | "habit" | "calendar"`, `actionId`,
  `firesAt` (ISO datetime), `intensity: "normal" | "important" | "alarm"`,
  `state: "scheduled" | "fired" | "cancelled"`.
- **Creation rules (v1, in `packages/core` so they are testable):**
  | Trigger | firesAt | intensity |
  |---------|---------|-----------|
  | Snooze (any) | = the snooze target time | `normal` |
  | CalendarAction with `startsAt` within 60 min | `startsAt − 15 min` | `important` |
  | Habit window closing | `windowEnd − 30 min` (if before window end) | `normal` |
  | Repeated skips / "do nothing" nagging | **never** — forbidden by Proposal §6.4 | — |
- **Notification actions** (Proposal §8: 完成 / 推迟 / 跳过 in the notification itself).
  A notification deep-links into the app and applies the **same transaction** as the
  in-app equivalent:
  - 完成 → the complete transaction (below);
  - 推迟 → the snooze transaction (creates the next `Reminder`);
  - 跳过 → the skip transaction (`consecutiveSkips += 1`).
  - Idempotency: the reminder row flips to `fired` in the same transaction; a second
    tap on the same notification is a no-op.
- Delivery is best-effort local notification (expo-notifications, scheduled at creation
  and re-armed on foreground). The `Reminder` row is the source of truth; a missed
  delivery surfaces as "due" on the Now screen.
- Snooze is a **DB-only** state: the snooze transaction sets
  `snoozedUntil` (+ creates the `Reminder`) and no copy of it exists in UI state.
- **Snooze presets (Proposal §8)** — named constants in core, resolved against
  `now` (device-local):
  | preset | target |
  |--------|--------|
  | `10m` / `30m` / `1h` | `now + 10 / 30 / 60 min` |
  | `tonight` | 21:00 device-local today; if `now ≥ 21:00`, 21:00 next day |
  | `tomorrow` | 09:00 device-local next day |
- **Platform capability matrix** — the snooze/skip/complete transactions are
  identical on every platform; only delivery differs:
  | Platform | Delivery | In-notification actions |
  |----------|----------|-------------------------|
  | Mobile (iOS/Android) | expo-notifications (local) | 完成 / 推迟 / 跳过 buttons |
  | Desktop (Tauri) | Web Notification API (display only — the API has no notification action buttons) | none: the notification deep-links into the app and the user acts in-app via the same transactions |
  Missed delivery on any platform: the `Reminder` row stays the source of truth and
  the item surfaces as "due" on the Now screen.

### FocusSession (Proposal §9)
- `actionId`, `actionKind`, `mode: "preset" | "free"`,
  `plannedMinutes: number | null` (preset ∈ {25, 45, 60}; `null` for free timer),
  `startedAt`, `pausedSec`, `endedAt?` (set when the session leaves `active`, in
  **either** terminal state — elapsed = `endedAt − startedAt − pausedSec`),
  `status: "active" | "completed" | "abandoned"`.
- `completed`: user finishes (or timer ends and user confirms) → row finalized;
  **timer end ≠ task complete** — marking the action complete is a separate, explicit
  user confirmation that runs the complete transaction.
- `abandoned`: user stops early; the row is kept (with `pausedSec` and elapsed) so
  time spent is visible in review. Abandon does not touch the action.
- The live, in-progress session is the only focus-related value in UI state (see
  app/state-management.md); it is persisted as an `active` row from the moment it
  starts, so app kill/restart recovers it.

### ReviewRecord (Proposal §5.4)
Append-only, a **discriminated union** on `kind`:
`type ReviewRecord = DailyReviewRecord | WeeklyReviewRecord`. Every variant carries
`kind`, `at`, `snapshot`, `answers`:

- `snapshot` — **computed** by a pure core function at review start (machine-generated,
  never hand-edited):
  - daily: `{ inboxCount, completedToday: string[], stillOpen: string[],
    projectsMissingActions: string[], waitingFollowUps: string[],
    calendarToday: string[], calendarTomorrow: string[], repeatedSkips: string[] }`
  - weekly: `{ inboxCount, projects: { id, title, hasOpenAction, lastProgressAt }[],
    waitingFollowUps: string[], somedayCount, stalledProjects: string[]
    (no completion on the project's actions for ≥ 14 days), calendarNext7: string[] }`
- `answers` — **the user's** checklist responses:
  - daily: `{ completedActionIds: string[], rescheduled: { actionId, toDate }[],
    skippedNoted: string[], tomorrowMustDo: string[] }`
  - weekly: `{ inboxCleared: boolean, followUpsRaised: string[],
    calendarReasonable: boolean,
    somedayDecisions: { id, to: "project" | "action" | "keep" | "trash" }[],
    projectDecisions: { id, to: "active" | "on-hold" | "done" | "dropped" }[] }`
- **Validation without dependencies:** core stays dependency-free, so the shapes are
  TS types plus a hand-written pure validator in core (`assertReviewRecord`);
  `packages/db` calls it before every write. No zod (or any runtime dep) in core.
- Review decisions are **applied as real transactions** (e.g. a `projectDecisions`
  entry writes the status change); the record is the audit trail, the entities are
  the state.

### CompletionRecord
`actionKind` + `actionId` (polymorphic: NextAction / HabitDay / CalendarAction /
`"do_now"`), `completedAt`, `estMinutes: number | null` (copied at completion for
estimate-accuracy review; **null for `do_now`** — no estimate ever existed).
Append-only.

## Lifecycle Assertions

Every entity with a lifecycle exposes its statuses as a TS union plus
`assertTransition(entity, to, now)` in `packages/core/src/domain` that throws
`ValidationNextdoError` on illegal jumps (e.g. `done → open`). Transitions with side
effects (complete → CompletionRecord; habit done → cycle advance; re-clarify →
replace) are composed in `packages/db` query functions — assertions check legality;
the DB layer applies, atomically, in one transaction per user intent.

## The Complete Transaction (canonical example)

`completeAction(db, { actionKind, actionId, now })`:
1. `assertTransition(open → done)`;
2. set `status = "done"`, clear `snoozedUntil`, reset `consecutiveSkips = 0`;
3. insert `CompletionRecord`;
4. cancel any `scheduled` Reminder pointing at the action;
5. if the action belonged to a HabitDay: mark the day `done` and, if it was the last
   day of the cycle, set the habit `status = "completed"`.
All five steps in one local transaction (synced in the background — see
app/state-management.md). Project action coverage is **not** updated here; it is
derived on query.

## Invariants

1. Inbox items have no contexts, estimates, or values — raw captures only.
2. An action is never both `NextAction` and `CalendarAction`.
3. `WaitingForItem` never enters the engine pool.
4. Trash = `deleted_at` set; trashing an active project requires the UI to dispose of
   its actions (trash-with-project or keep) — the model exposes `projectActionIds()`.
5. Every `id` is a ULID minted at creation in `packages/core/src/lib/ids.ts`;
   `HabitDay` ids are the deterministic `hd-<habitId>-<YYYYMMDD>` (the one exception,
   required for multi-device idempotency).
