/**
 * Canonical "demo user" fixture dataset (spec: app/database-guidelines.md
 * "Testing" — every test file seeds from this file).
 *
 * A representative spread across ALL 14 MVP tables of `schema.ts`:
 * inbox items in various states, projects with and without action coverage,
 * NextActions incl. one blocked by an unfinished dependency, CalendarActions
 * incl. one starting soon, SomedayMaybe/Reference/WaitingFor/Contexts,
 * Habits with HabitDays across cycle positions (first / middle / last),
 * FocusSessions, Reminders, ReviewRecords, CompletionRecords.
 *
 * Determinism: ids are fixed (ULID-shaped, Crockford-base32 — see
 * packages/core/src/lib/ids.ts); every timestamp is built from the
 * injected `now` (never the device clock). `FIXTURE_NOW` is a Monday
 * (device-local, TZ pinned to UTC by the jest setup) so weekday-window
 * logic is stable.
 *
 * Test support only — never imported from the app-facing `src/` tree.
 */
import { habitDayId, localDateKey, toIso, type EntityBase } from '@nextdo/core';
import {
  calendarActionToRow,
  completionRecordToRow,
  contextToRow,
  focusSessionToRow,
  habitDayToRow,
  habitToRow,
  inboxItemToRow,
  nextActionToRow,
  projectToRow,
  referenceItemToRow,
  reminderToRow,
  reviewRecordToRow,
  somedayMaybeItemToRow,
  waitingForItemToRow,
} from '../schema';
import type { NextdoDb } from '../types';
import type {
  CalendarAction,
  CompletionRecord,
  Context,
  FocusSession,
  Habit,
  HabitDay,
  InboxItem,
  NextAction,
  Project,
  ReferenceItem,
  Reminder,
  ReviewRecord,
  SomedayMaybeItem,
  Value,
  WaitingForItem,
} from '@nextdo/core';

/** Canonical "now" for the demo dataset: Monday 2026-09-21, 10:00 UTC. */
export const FIXTURE_NOW = new Date('2026-09-21T10:00:00.000Z');

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Fixed ids (ULID-shaped: 26 chars, Crockford base32 alphabet). */
export const FIXTURE_IDS = {
  contexts: {
    home: '01TST0000000000000000000001',
    office: '01TST0000000000000000000002',
    computer: '01TST0000000000000000000003',
    phone: '01TST0000000000000000000004',
    outside: '01TST0000000000000000000005',
  },
  inbox: {
    /** live, captured 1 h ago */
    plain: '01TST0000000000000000000006',
    /** live, captured 3 days ago */
    old: '01TST0000000000000000000007',
    /** soft-deleted — completed on the spot via the do-now path */
    trashed: '01TST0000000000000000000008',
  },
  projects: {
    /** active, value 4, HAS an open next action (covered) */
    paper: '01TST0000000000000000000009',
    /** active, value 3, NO open next action (uncovered) */
    empty: '01TST0000000000000000000010',
    /** on-hold, value 2 */
    held: '01TST0000000000000000000011',
  },
  actions: {
    /** open, project=paper, est 40, value 4, deadline in 3 days (worked example B) */
    b: '01TST0000000000000000000012',
    /** open, standalone, est 10, value 2, created 1 day ago (worked example A) */
    a: '01TST0000000000000000000013',
    /** open, BLOCKED — depends on the open `baseline` action */
    blocked: '01TST0000000000000000000014',
    /** open — the dependency target of `blocked` */
    baseline: '01TST0000000000000000000015',
    /** open — depends on the done `done` action (dependencyDone = true) */
    depDone: '01TST0000000000000000000016',
    /** done, project=paper, est 30 (has a CompletionRecord) */
    done: '01TST0000000000000000000017',
    /** open, weekday window 09:00–17:00 (Mon–Fri) */
    window: '01TST0000000000000000000018',
    /** open, snoozed until +1 h (has a scheduled Reminder) */
    snoozed: '01TST0000000000000000000019',
    /** open, 3 consecutive skips (engine needsReclarify case) */
    skipped: '01TST0000000000000000000020',
    /** open status but soft-deleted (Trash) */
    trashed: '01TST0000000000000000000021',
  },
  waiting: {
    /** followUpAt in the past — due in the Daily Review */
    due: '01TST0000000000000000000022',
    /** followUpAt in the future */
    later: '01TST0000000000000000000023',
  },
  calendar: {
    /** open, starts in 30 min (preemption-window candidate) */
    soon: '01TST0000000000000000000024',
    /** open, starts tomorrow (hard block only, not a candidate) */
    tomorrow: '01TST0000000000000000000025',
    /** done, started yesterday (has a CompletionRecord) */
    done: '01TST0000000000000000000026',
  },
  someday: {
    keep: '01TST0000000000000000000027',
    trashed: '01TST0000000000000000000028',
  },
  reference: {
    link: '01TST0000000000000000000029',
  },
  habits: {
    /** active, started today — today is cycle day 1 of 21 */
    today: '01TST0000000000000000000030',
    /** active, started 10 days ago — today is cycle day 11 of 21 */
    mid: '01TST0000000000000000000031',
    /** active, started 20 days ago — today is cycle day 21 of 21 (last) */
    last: '01TST0000000000000000000032',
    /** active, weekday-only window 07:00–08:00, 14-day cycle */
    weekdays: '01TST0000000000000000000033',
    /** completed 7-day cycle */
    completed: '01TST0000000000000000000034',
    /** broken — an open HabitDay for a past local date (derived "missed") */
    broken: '01TST0000000000000000000035',
  },
  reminders: {
    /** calendar/soon, important, fires in 15 min, scheduled */
    soon: '01TST0000000000000000000036',
    /** next/snoozed, normal, fires at the snooze target, scheduled */
    snooze: '01TST0000000000000000000037',
    /** cancelled by the completion of actions.done */
    cancelled: '01TST0000000000000000000038',
    /** fired yesterday (calendar/done) */
    fired: '01TST0000000000000000000039',
  },
  focus: {
    /** live active session (recovers on app restart) */
    active: '01TST0000000000000000000040',
    completed: '01TST0000000000000000000041',
    abandoned: '01TST0000000000000000000042',
  },
  reviews: {
    daily: '01TST0000000000000000000043',
    weekly: '01TST0000000000000000000044',
  },
  completions: {
    naDone: '01TST0000000000000000000045',
    doNow: '01TST0000000000000000000046',
    caDone: '01TST0000000000000000000047',
  },
} as const;

/** Deterministic HabitDay ids: `hd-<habitId>-<YYYYMMDD>`. */
export function fixtureHabitDayId(habitId: string, daysOffset: number): string {
  const localDate = localDateKey(new Date(FIXTURE_NOW.getTime() + daysOffset * DAY_MS));
  return habitDayId(habitId, localDate);
}

const value = (n: 1 | 2 | 3 | 4 | 5): Value => n;

/**
 * Insert the full demo dataset. All timestamps are relative to `now`
 * (default: `FIXTURE_NOW`); deterministic ids from `FIXTURE_IDS`.
 */
export async function seedFixtures(db: NextdoDb, now: Date = FIXTURE_NOW): Promise<void> {
  const at = (days: number, hours = 0): string =>
    toIso(new Date(now.getTime() + days * DAY_MS + hours * HOUR_MS));
  const base = (
    id: string,
    createdDays: number,
    createdHours = 0,
    updatedDays?: number,
    updatedHours = 0,
  ): EntityBase => ({
    id,
    createdAt: at(createdDays, createdHours),
    updatedAt: at(updatedDays ?? createdDays, updatedHours),
    deletedAt: null,
  });

  // --- Contexts (the seeded defaults, domain-model.md "Context") ---------
  const contexts: Context[] = (
    [
      [FIXTURE_IDS.contexts.home, 'home'],
      [FIXTURE_IDS.contexts.office, 'office'],
      [FIXTURE_IDS.contexts.computer, 'computer'],
      [FIXTURE_IDS.contexts.phone, 'phone'],
      [FIXTURE_IDS.contexts.outside, 'outside'],
    ] as const
  ).map(([id, name]) => ({ ...base(id, -30), name }));
  for (const context of contexts) {
    await db.insertInto('contexts').values({ id: context.id, ...contextToRow(context) }).execute();
  }

  // --- InboxItems ---------------------------------------------------------
  const inbox: InboxItem[] = [
    { ...base(FIXTURE_IDS.inbox.plain, 0, -1), title: '回复李老师的邮件', capturedAt: at(0, -1) },
    { ...base(FIXTURE_IDS.inbox.old, -3), title: '订下周去杭州的高铁票', capturedAt: at(-3) },
    {
      ...base(FIXTURE_IDS.inbox.trashed, -2, 0, -2, 1),
      title: '倒垃圾（当场做了）',
      capturedAt: at(-2),
    },
  ];
  for (const item of inbox) {
    if (item.id === FIXTURE_IDS.inbox.trashed) item.deletedAt = at(-2, 1);
    await db.insertInto('inbox_items').values({ id: item.id, ...inboxItemToRow(item) }).execute();
  }

  // --- Projects -----------------------------------------------------------
  const projects: Project[] = [
    {
      ...base(FIXTURE_IDS.projects.paper, -14, 0, -2),
      title: '毕业论文实验',
      outcome: 'baseline A/B 跑完并写入论文 §4',
      value: value(4),
      status: 'active',
    },
    {
      ...base(FIXTURE_IDS.projects.empty, -10),
      title: '实验室设备报修',
      outcome: '3 号离心机恢复可用',
      value: value(3),
      status: 'active',
    },
    {
      ...base(FIXTURE_IDS.projects.held, -20, 0, -9),
      title: '搬家计划',
      outcome: '搬入新宿舍并完成网络/电表过户',
      value: value(2),
      status: 'on-hold',
    },
  ];
  for (const project of projects) {
    await db.insertInto('projects').values({ id: project.id, ...projectToRow(project) }).execute();
  }

  // --- NextActions ----------------------------------------------------------
  const A = FIXTURE_IDS.actions;
  const nextActions: NextAction[] = [
    {
      ...base(A.b, 0, -2),
      title: '运行论文 baseline A',
      projectId: FIXTURE_IDS.projects.paper,
      contextIds: [FIXTURE_IDS.contexts.computer],
      estMinutes: 40,
      value: value(4),
      category: 'work',
      deadline: at(3),
      consecutiveSkips: 0,
      status: 'open',
    },
    {
      ...base(A.a, -1),
      title: '回复普通邮件',
      contextIds: [FIXTURE_IDS.contexts.computer, FIXTURE_IDS.contexts.phone],
      estMinutes: 10,
      value: value(2),
      category: 'work',
      consecutiveSkips: 0,
      status: 'open',
    },
    {
      ...base(A.blocked, -1, 0, 0, -3),
      title: '分析 baseline A 结果',
      contextIds: [FIXTURE_IDS.contexts.computer],
      estMinutes: 30,
      value: value(4),
      dependsOnId: A.baseline,
      consecutiveSkips: 0,
      status: 'open',
    },
    {
      ...base(A.baseline, -1, 0, 0, -3),
      title: '整理 baseline A 的数据脚本',
      contextIds: [FIXTURE_IDS.contexts.computer],
      estMinutes: 60,
      value: value(3),
      consecutiveSkips: 0,
      status: 'open',
    },
    {
      ...base(A.depDone, -4),
      title: '写 §3 方法部分初稿',
      projectId: FIXTURE_IDS.projects.paper,
      contextIds: [FIXTURE_IDS.contexts.computer],
      estMinutes: 90,
      value: value(4),
      dependsOnId: A.done,
      consecutiveSkips: 0,
      status: 'open',
    },
    {
      ...base(A.done, -5, 0, -2),
      title: '配置实验环境',
      projectId: FIXTURE_IDS.projects.paper,
      contextIds: [FIXTURE_IDS.contexts.computer],
      estMinutes: 30,
      value: value(3),
      consecutiveSkips: 0,
      status: 'done',
    },
    {
      ...base(A.window, -2),
      title: '工作日联系客服报修打印机',
      contextIds: [FIXTURE_IDS.contexts.office],
      estMinutes: 20,
      value: value(3),
      windowStart: '09:00',
      windowEnd: '17:00',
      windowDays: [1, 2, 3, 4, 5],
      consecutiveSkips: 0,
      status: 'open',
    },
    {
      ...base(A.snoozed, -1, 0, 0, -0.5),
      title: '取快递',
      contextIds: [FIXTURE_IDS.contexts.outside],
      estMinutes: 15,
      value: value(3),
      category: 'life',
      snoozedUntil: at(0, 1),
      lastSnoozedAt: at(0, -0.5),
      consecutiveSkips: 0,
      status: 'open',
    },
    {
      ...base(A.skipped, -6, 0, 0, -2),
      title: '整理实验记录本',
      contextIds: [FIXTURE_IDS.contexts.office],
      estMinutes: 10,
      value: value(2),
      category: 'work',
      consecutiveSkips: 3,
      lastSkippedAt: at(0, -2),
      status: 'open',
    },
    {
      ...base(A.trashed, -2, 0, -1),
      title: '买打印机墨盒（已删）',
      contextIds: [],
      estMinutes: 15,
      value: value(2),
      category: 'other',
      consecutiveSkips: 0,
      status: 'open',
    },
  ];
  for (const action of nextActions) {
    if (action.id === A.trashed) action.deletedAt = at(-1);
    await db.insertInto('next_actions').values({ id: action.id, ...nextActionToRow(action) }).execute();
  }

  // --- WaitingForItems -------------------------------------------------------
  const waiting: WaitingForItem[] = [
    {
      ...base(FIXTURE_IDS.waiting.due, -1),
      title: '等导师确认开题材料',
      waitingOn: '导师（李老师说“有空再看”）',
      expectedBy: at(2),
      followUpAt: at(0, -1),
    },
    {
      ...base(FIXTURE_IDS.waiting.later, -2),
      title: '等师兄寄实验试剂',
      waitingOn: '师兄（快递）',
      followUpAt: at(2),
    },
  ];
  for (const item of waiting) {
    await db.insertInto('waiting_for_items').values({ id: item.id, ...waitingForItemToRow(item) }).execute();
  }

  // --- CalendarActions ---------------------------------------------------------
  const C = FIXTURE_IDS.calendar;
  const calendarActions: CalendarAction[] = [
    {
      ...base(C.soon, -1, 0, 0, -3),
      title: '组会汇报',
      startsAt: at(0, 0.5),
      contextIds: [FIXTURE_IDS.contexts.office],
      estMinutes: 30,
      value: value(4),
      category: 'work',
      consecutiveSkips: 0,
      status: 'open',
    },
    {
      ...base(C.tomorrow, -3),
      title: '牙医复诊',
      startsAt: at(1, 2),
      contextIds: [FIXTURE_IDS.contexts.outside],
      estMinutes: 45,
      value: value(3),
      category: 'health',
      consecutiveSkips: 0,
      status: 'open',
    },
    {
      ...base(C.done, 0, -20.5, 0, -19.25),
      title: '取论文打印稿',
      startsAt: at(0, -20),
      contextIds: [FIXTURE_IDS.contexts.office],
      estMinutes: 45,
      value: value(3),
      category: 'work',
      consecutiveSkips: 0,
      status: 'done',
    },
  ];
  for (const action of calendarActions) {
    await db
      .insertInto('calendar_actions')
      .values({ id: action.id, ...calendarActionToRow(action) })
      .execute();
  }

  // --- SomedayMaybe / Reference ---------------------------------------------------
  const someday: SomedayMaybeItem[] = [
    { ...base(FIXTURE_IDS.someday.keep, -9), title: '学 Rust', note: '等手头实验结束' },
    { ...base(FIXTURE_IDS.someday.trashed, -15, 0, -7), title: '换手机壳', note: undefined },
  ];
  for (const item of someday) {
    if (item.id === FIXTURE_IDS.someday.trashed) item.deletedAt = at(-7);
    await db
      .insertInto('someday_maybe_items')
      .values({ id: item.id, ...somedayMaybeItemToRow(item) })
      .execute();
  }

  const reference: ReferenceItem[] = [
    {
      ...base(FIXTURE_IDS.reference.link, -5),
      title: '论文模板 LaTeX 配置说明',
      url: 'https://example.com/thesis-template',
      note: '学校官方模板，见 §2 宏包列表',
    },
  ];
  for (const item of reference) {
    await db.insertInto('reference_items').values({ id: item.id, ...referenceItemToRow(item) }).execute();
  }

  // --- Habits + HabitDays ---------------------------------------------------------
  const H = FIXTURE_IDS.habits;
  const habits: Habit[] = [
    {
      ...base(H.today, 0, -4),
      title: '21 天晨读挑战',
      actionTitle: '阅读 30 分钟',
      estMinutes: 30,
      value: value(3),
      category: 'health',
      cycleDays: 21,
      startedAt: at(0, -4),
      status: 'active',
    },
    {
      ...base(H.mid, -11),
      title: '21 天力量训练',
      actionTitle: '力量训练 45 分钟',
      estMinutes: 45,
      value: value(4),
      category: 'health',
      projectId: FIXTURE_IDS.projects.empty,
      cycleDays: 21,
      startedAt: at(-10),
      status: 'active',
    },
    {
      ...base(H.last, -21),
      title: '21 天冥想',
      actionTitle: '冥想 10 分钟',
      estMinutes: 10,
      value: value(2),
      category: 'health',
      cycleDays: 21,
      startedAt: at(-20),
      status: 'active',
    },
    {
      ...base(H.weekdays, -3),
      title: '工作日晨跑',
      actionTitle: '晨跑 20 分钟',
      estMinutes: 20,
      value: value(3),
      category: 'health',
      windowStart: '07:00',
      windowEnd: '08:00',
      windowDays: [1, 2, 3, 4, 5],
      cycleDays: 14,
      startedAt: at(-2),
      status: 'active',
    },
    {
      ...base(H.completed, -31, 0, -24),
      title: '7 天戒咖啡',
      actionTitle: '无咖啡日',
      estMinutes: 5,
      value: value(2),
      category: 'health',
      cycleDays: 7,
      startedAt: at(-30),
      status: 'completed',
    },
    {
      ...base(H.broken, -6, 0, 0, -10),
      title: '7 天早睡挑战',
      actionTitle: '23:30 前入睡',
      estMinutes: 5,
      value: value(2),
      category: 'health',
      cycleDays: 7,
      startedAt: at(-5),
      status: 'broken',
    },
  ];
  for (const habit of habits) {
    await db.insertInto('habits').values({ id: habit.id, ...habitToRow(habit) }).execute();
  }

  const habitDays: HabitDay[] = [
    // hb-today: cycle day 1 (today)
    { ...base(fixtureHabitDayId(H.today, 0), 0, -4), habitId: H.today, localDate: localDateKey(new Date(now)), status: 'open', consecutiveSkips: 0 },
    // hb-mid: cycle day 11 (today, open) + yesterday (done)
    {
      ...base(fixtureHabitDayId(H.mid, 0), 0, -4),
      habitId: H.mid,
      localDate: localDateKey(new Date(now)),
      status: 'open',
      consecutiveSkips: 0,
    },
    {
      ...base(fixtureHabitDayId(H.mid, -1), -1, -4, -1, 1),
      habitId: H.mid,
      localDate: localDateKey(new Date(now.getTime() - DAY_MS)),
      status: 'done',
      consecutiveSkips: 0,
    },
    // hb-last: cycle day 21 (today, open — the LAST day)
    {
      ...base(fixtureHabitDayId(H.last, 0), 0, -4),
      habitId: H.last,
      localDate: localDateKey(new Date(now)),
      status: 'open',
      consecutiveSkips: 0,
    },
    // hb-weekdays: today is a weekday → in-window open day
    {
      ...base(fixtureHabitDayId(H.weekdays, 0), 0, -4),
      habitId: H.weekdays,
      localDate: localDateKey(new Date(now)),
      status: 'open',
      consecutiveSkips: 0,
    },
    // hb-broken: an OPEN day for a past local date → derived "missed"
    {
      ...base(fixtureHabitDayId(H.broken, -1), -1, -4),
      habitId: H.broken,
      localDate: localDateKey(new Date(now.getTime() - DAY_MS)),
      status: 'open',
      consecutiveSkips: 0,
    },
    // hb-completed: a stale open day (the habit is no longer active —
    // the pool must not surface it)
    {
      ...base(fixtureHabitDayId(H.completed, 0), 0, -4),
      habitId: H.completed,
      localDate: localDateKey(new Date(now)),
      status: 'open',
      consecutiveSkips: 0,
    },
  ];
  for (const day of habitDays) {
    await db.insertInto('habit_days').values({ id: day.id, ...habitDayToRow(day) }).execute();
  }

  // --- Reminders -----------------------------------------------------------------
  const R = FIXTURE_IDS.reminders;
  const reminders: Reminder[] = [
    {
      ...base(R.soon, 0, -3),
      actionKind: 'calendar',
      actionId: C.soon,
      firesAt: at(0, 0.25),
      intensity: 'important',
      state: 'scheduled',
    },
    {
      ...base(R.snooze, 0, -0.5),
      actionKind: 'next',
      actionId: A.snoozed,
      firesAt: at(0, 1),
      intensity: 'normal',
      state: 'scheduled',
    },
    {
      ...base(R.cancelled, -3, 0, -2),
      actionKind: 'next',
      actionId: A.done,
      firesAt: at(-2),
      intensity: 'normal',
      state: 'cancelled',
    },
    {
      ...base(R.fired, 0, -20.5, 0, -20.25),
      actionKind: 'calendar',
      actionId: C.done,
      firesAt: at(0, -20.25),
      intensity: 'important',
      state: 'fired',
    },
  ];
  for (const reminder of reminders) {
    await db.insertInto('reminders').values({ id: reminder.id, ...reminderToRow(reminder) }).execute();
  }

  // --- FocusSessions ----------------------------------------------------------------
  const F = FIXTURE_IDS.focus;
  const focusSessions: FocusSession[] = [
    {
      ...base(F.active, 0, -10 / 60),
      actionId: A.a,
      actionKind: 'next',
      mode: 'preset',
      plannedMinutes: 25,
      startedAt: at(0, -10 / 60),
      pausedSec: 0,
      status: 'active',
    },
    {
      ...base(F.completed, 0, -3, 0, -2.5),
      actionId: A.b,
      actionKind: 'next',
      mode: 'preset',
      plannedMinutes: 25,
      startedAt: at(0, -3),
      pausedSec: 120,
      endedAt: at(0, -2.5),
      status: 'completed',
    },
    {
      ...base(F.abandoned, -1, 0, -1, 1 / 3),
      actionId: A.window,
      actionKind: 'next',
      mode: 'free',
      plannedMinutes: null,
      startedAt: at(-1),
      pausedSec: 60,
      endedAt: at(-1, 1 / 3),
      status: 'abandoned',
    },
  ];
  for (const session of focusSessions) {
    await db.insertInto('focus_sessions').values({ id: session.id, ...focusSessionToRow(session) }).execute();
  }

  // --- ReviewRecords (append-only) ------------------------------------------------------
  const reviews: ReviewRecord[] = [
    {
      ...base(FIXTURE_IDS.reviews.daily, -1, 11, -1, 11),
      kind: 'daily',
      at: at(-1, 11),
      snapshot: {
        inboxCount: 2,
        completedToday: [A.done],
        stillOpen: [A.b, A.a, A.blocked, A.baseline],
        projectsMissingActions: [FIXTURE_IDS.projects.empty],
        waitingFollowUps: [FIXTURE_IDS.waiting.due],
        calendarToday: [],
        calendarTomorrow: [C.tomorrow],
        repeatedSkips: [A.skipped],
      },
      answers: {
        completedActionIds: [A.done],
        rescheduled: [],
        skippedNoted: [],
        tomorrowMustDo: [A.b],
      },
    },
    {
      ...base(FIXTURE_IDS.reviews.weekly, -7, 11, -7, 11),
      kind: 'weekly',
      at: at(-7, 11),
      snapshot: {
        inboxCount: 1,
        projects: [
          { id: FIXTURE_IDS.projects.paper, title: '毕业论文实验', hasOpenAction: true, lastProgressAt: at(-8) },
          { id: FIXTURE_IDS.projects.empty, title: '实验室设备报修', hasOpenAction: false, lastProgressAt: null },
        ],
        waitingFollowUps: [],
        somedayCount: 1,
        stalledProjects: [],
        calendarNext7: [C.tomorrow],
      },
      answers: {
        inboxCleared: true,
        followUpsRaised: [],
        calendarReasonable: true,
        somedayDecisions: [],
        projectDecisions: [],
      },
    },
  ];
  for (const record of reviews) {
    await db.insertInto('review_records').values({ id: record.id, ...reviewRecordToRow(record) }).execute();
  }

  // --- CompletionRecords (append-only) ----------------------------------------------------
  const completions: CompletionRecord[] = [
    {
      ...base(FIXTURE_IDS.completions.naDone, -2),
      actionKind: 'next',
      actionId: A.done,
      completedAt: at(-2),
      estMinutes: 30,
    },
    {
      ...base(FIXTURE_IDS.completions.doNow, -2, 1),
      actionKind: 'do_now',
      actionId: FIXTURE_IDS.inbox.trashed,
      completedAt: at(-2, 1),
      estMinutes: null,
    },
    {
      ...base(FIXTURE_IDS.completions.caDone, 0, -19.25),
      actionKind: 'calendar',
      actionId: C.done,
      completedAt: at(0, -19.25),
      estMinutes: 45,
    },
  ];
  for (const record of completions) {
    await db
      .insertInto('completion_records')
      .values({ id: record.id, ...completionRecordToRow(record) })
      .execute();
  }
}
