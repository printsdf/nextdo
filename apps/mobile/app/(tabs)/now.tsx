/**
 * The Now tab (design §5 — Paper Serenity rework, PRD D2 hero-first):
 *
 *   engine-context bar (scene chips from contexts + time chips, persisted
 *   via secure-store) → re-clarify banner → STATS ROW (可执行 n/总 ·
 *   预计耗时 Σ est · 认知负荷 三档) → the ONE recommendation (hero:
 *   kind / est / 项目·截止 / Why this? top-3 / 开始 / 换一个 / 稍后) →
 *   CONTEXT FILTER chips (local UI state — list area only, NEVER the
 *   hero) → the eligible list (always expanded) → today's habit strip.
 *
 * Presentational only: data arrives from `useNow` (+ contexts / habit-days
 * hooks); every mutation goes through a mutation hook (component-
 * guidelines). The 1-second focus tick does NOT live here — the screen
 * runs on the minute app clock (hook-guidelines Rule 4). The engine
 * context (bar) and the list filter (chips) are two INDEPENDENT state
 * sets: the filter never touches the recommendation (state-management).
 */
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useAppInsets } from '@/lib/use-app-insets';
import { router, useFocusEffect } from 'expo-router';
import { Button, Card, ContextChip, EmptyState, Tag, cn } from '@nextdo/ui';
import type { CandidateKind } from '@nextdo/core';
import { useNow, shouldOfferReclarify, type NowEligible } from '@/hooks/use-now';
import { useAppClock } from '@/hooks/use-app-clock';
import { useSkipAction } from '@/hooks/use-skip-action';
import { useSnoozeAction } from '@/hooks/use-snooze-action';
import { useTrashAction } from '@/hooks/use-trash-action';
import { useCompleteAction } from '@/hooks/use-complete-action';
import { useContexts } from '@/hooks/use-contexts';
import { useHabits, type HabitWithProgress } from '@/hooks/use-habits';
import { useProjectTitles } from '@/hooks/use-project-titles';
import { useEngineContextSettings, type EngineContextSettings } from '@/lib/engine-context';
import { errorMessage } from '@/lib/error-messages';
import { cognitiveLoadLabel } from '@/lib/cognitive-load';
import { FILTER_RULE_LABELS, REASON_LABELS } from '@/lib/reason-labels';
import { KIND_LABELS } from '@/lib/kind-labels';
import { formatLocalDate, formatLocalDateTime, formatDueLabel } from '@/lib/format';
import { SnoozeSheet } from '@/components/snooze-sheet';

const TIME_CHIPS = [15, 30, 60, 120];

/** 32px visual chip (h-8) + 6pt vertical hitSlop = 44pt tap target (spec/accessibility).
 *  4pt left/right ensures adjacent targets don't overlap with 8px (gap-2) spacing. */
const CHIP_HIT_SLOP = { top: 6, bottom: 6, left: 4, right: 4 } as const;

/** Extended hitSlop for inputs. */
const FIELD_HIT_SLOP = { top: 6, bottom: 6 } as const;

const SCENE_UNSELECTED_CLASS =
  'h-8 flex-row items-center rounded-lg border border-border/80 bg-surface px-3 active:bg-surface-container dark:border-border-dark dark:bg-surface-dark dark:active:bg-surface-container-dark';

const SCENE_SELECTED_CLASS =
  'h-8 flex-row items-center rounded-lg border border-accent bg-accent px-3 active:opacity-90 dark:border-accent-dark dark:bg-accent-dark';

/** One dimension's heading: a muted label on the left, the current STATE capsule on
 *  the right. The state capsule is the single place 「任意」 lives — it is a clear-
 *  selection action, not a peer scene in the options flow. */
function ConditionLabel({
  title,
  state,
  onClear,
}: {
  title: string;
  state?: string;
  onClear?: () => void;
}) {
  return (
    <View className="mb-2.5 flex-row items-center justify-between">
      <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
        {title}
      </Text>
      {onClear !== undefined && state !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="清除场景选择，回到任意"
          accessibilityState={{ selected: false }}
          hitSlop={CHIP_HIT_SLOP}
          onPress={onClear}
          className="h-6 flex-row items-center gap-1 rounded-full border border-border/80 bg-surface px-2.5 active:bg-surface-container dark:border-border-dark dark:bg-surface-dark dark:active:bg-surface-container-dark"
        >
          <Text className="font-sans text-[11px] font-medium text-accent dark:text-accent-dark">
            {state}
          </Text>
          <Text className="font-sans text-[11px] text-muted dark:text-muted-dark">✕</Text>
        </Pressable>
      ) : state !== undefined ? (
        <View className="h-6 items-center justify-center rounded-full bg-surface-container/70 px-2.5 dark:bg-surface-container-dark/70">
          <Text className="font-sans text-[11px] font-medium text-muted dark:text-muted-dark">
            {state}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Engine-bar scene option — the MULTI-SELECT (OR) vocabulary:
 * Clean, serene paper tile when idle; lights up in terracotta with a round
 * checkmark badge when selected.
 *
 * Appearance is a pure function of `selected`: every scene — seed or
 * user-created, `office` or `厨房` — renders through the exact same class string.
 * Nothing depends on the name (preventing false selection signals from hash tones).
 */
function SceneOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${selected ? '取消场景' : '选择场景'}：${label}`}
      accessibilityState={{ selected }}
      hitSlop={CHIP_HIT_SLOP}
      onPress={onPress}
      className={selected ? SCENE_SELECTED_CLASS : SCENE_UNSELECTED_CLASS}
    >
      {selected ? (
        <View className="mr-1.5 h-3.5 w-3.5 items-center justify-center rounded-full bg-on-accent/25 dark:bg-on-accent-dark/25">
          <Text className="font-sans text-[10px] font-bold leading-none text-on-accent dark:text-on-accent-dark">
            ✓
          </Text>
        </View>
      ) : null}
      <Text
        numberOfLines={1}
        className={cn(
          'font-sans text-xs',
          selected
            ? 'font-semibold text-on-accent dark:text-on-accent-dark'
            : 'font-medium text-ink dark:text-ink-dark',
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Engine-bar minutes option — the SINGLE-SELECT vocabulary:
 * A subtle tinted terracotta tile with a radio dot indicator when selected,
 * clearly contrasting with the multi-select checkmark of the scene row.
 */
function MinutesOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`设置可用时间：${label} 分钟`}
      accessibilityState={{ selected }}
      hitSlop={CHIP_HIT_SLOP}
      onPress={onPress}
      className={cn(
        'h-8 min-w-12 flex-row items-center justify-center rounded-lg px-2.5',
        selected
          ? 'border border-accent bg-accent/10 dark:border-accent-dark dark:bg-accent-dark/20'
          : 'border border-border/80 bg-surface active:bg-surface-container dark:border-border-dark dark:bg-surface-dark dark:active:bg-surface-container-dark',
      )}
    >
      {selected ? (
        <View className="mr-1.5 h-1.5 w-1.5 rounded-full bg-accent dark:bg-accent-dark" />
      ) : null}
      <Text
        className={cn(
          'font-sans text-xs',
          selected
            ? 'font-semibold text-accent dark:text-accent-dark'
            : 'font-medium text-ink dark:text-ink-dark',
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** The free-form minutes field, styled at 32px (h-8) to share the row rhythm. */
function CustomMinutesInput({
  value,
  onApply,
}: {
  value: number;
  onApply: (minutes: number) => void;
}) {
  const [custom, setCustom] = useState('');
  const isCustomActive = !TIME_CHIPS.includes(value);

  const applyCustom = () => {
    const parsed = Math.round(Number(custom));
    if (Number.isFinite(parsed) && parsed >= 1) onApply(parsed);
    setCustom('');
  };

  return (
    <TextInput
      className={cn(
        'h-8 w-20 rounded-lg px-2 text-center font-sans text-xs text-ink placeholder:text-muted dark:text-ink-dark dark:placeholder:text-muted-dark',
        isCustomActive
          ? 'border border-accent bg-accent/10 font-semibold text-accent dark:border-accent-dark dark:bg-accent-dark/20 dark:text-accent-dark'
          : 'border border-border/80 bg-surface dark:border-border-dark dark:bg-surface-dark',
      )}
      hitSlop={FIELD_HIT_SLOP}
      placeholder="自定义"
      accessibilityLabel="自定义可用时间（分钟）"
      keyboardType="number-pad"
      value={custom}
      onChangeText={setCustom}
      onSubmitEditing={applyCustom}
      onEndEditing={applyCustom}
    />
  );
}

/** The engine-context bar (scene chips + time chips, design.md §4.1.1).
 *  The settings instance is OWNED by NowScreen (single source of truth —
 *  the pool in `useNow` must recompute on chip changes). */
function EngineContextBar({
  settings,
  update,
}: {
  settings: EngineContextSettings | null;
  update: (patch: Partial<EngineContextSettings>) => Promise<void>;
}) {
  const { data: contexts, add } = useContexts();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const contextIds = settings?.contextIds ?? [];
  const availableMinutes = settings?.availableMinutes ?? 60;
  // Empty selection = 「任意」 = runnable anywhere (engine contract).
  const anyScene = contextIds.length === 0;

  const toggleContext = (id: string) => {
    const next = contextIds.includes(id)
      ? contextIds.filter((entry) => entry !== id)
      : [...contextIds, id];
    void update({ contextIds: next });
  };

  const createContext = () => {
    const name = newName.trim();
    if (name === '') return;
    void add(name).then(() => {
      setNewName('');
      setAdding(false);
    });
  };

  return (
    <Card className="gap-3.5 p-4">
      {/* Dimension 1 — scenes, MULTI-select / OR. */}
      <View>
        <ConditionLabel
          title="当前场景"
          state={anyScene ? '任意' : `已选 ${contextIds.length} 个`}
          {...(anyScene ? {} : { onClear: () => void update({ contextIds: [] }) })}
        />
        <View className="flex-row flex-wrap items-center gap-2">
          {(contexts ?? []).map((context) => (
            <SceneOption
              key={context.id}
              label={context.name}
              selected={contextIds.includes(context.id)}
              onPress={() => toggleContext(context.id)}
            />
          ))}
          {adding ? (
            <View className="flex-row items-center gap-1.5">
              <TextInput
                className="h-8 w-24 rounded-lg border border-accent/80 bg-surface px-2.5 font-sans text-xs text-ink placeholder:text-muted dark:border-accent-dark/80 dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark"
                hitSlop={FIELD_HIT_SLOP}
                value={newName}
                onChangeText={setNewName}
                placeholder="新场景"
                accessibilityLabel="新场景名称"
                onSubmitEditing={createContext}
                autoFocus
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="添加场景"
                hitSlop={CHIP_HIT_SLOP}
                onPress={createContext}
                className="h-8 items-center justify-center rounded-lg bg-accent px-2.5 active:opacity-85 dark:bg-accent-dark"
              >
                <Text className="font-sans text-xs font-semibold text-on-accent dark:text-on-accent-dark">
                  加
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="取消添加场景"
                hitSlop={CHIP_HIT_SLOP}
                onPress={() => {
                  setAdding(false);
                  setNewName('');
                }}
                className="h-8 items-center justify-center rounded-lg px-1.5 active:bg-surface-container dark:active:bg-surface-container-dark"
              >
                <Text className="font-sans text-xs text-muted dark:text-muted-dark">✕</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="新建场景"
              accessibilityState={{ selected: false }}
              hitSlop={CHIP_HIT_SLOP}
              onPress={() => setAdding(true)}
              className="h-8 flex-row items-center gap-1 rounded-lg border border-border/80 bg-surface px-2.5 active:bg-surface-container dark:border-border-dark dark:bg-surface-dark dark:active:bg-surface-container-dark"
            >
              <Text className="font-sans text-sm font-semibold leading-none text-accent dark:text-accent-dark">
                +
              </Text>
              <Text className="font-sans text-xs font-medium text-muted dark:text-muted-dark">
                场景
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Subtle divider between scene and time dimensions */}
      <View className="h-px bg-border/40 dark:bg-border-dark/40" />

      {/* Dimension 2 — minutes, SINGLE-select. */}
      <View>
        <ConditionLabel title="可用时间（分钟）" />
        <View className="flex-row flex-wrap items-center gap-2">
          {TIME_CHIPS.map((minutes) => (
            <MinutesOption
              key={minutes}
              label={String(minutes)}
              selected={availableMinutes === minutes}
              onPress={() => void update({ availableMinutes: minutes })}
            />
          ))}
          <CustomMinutesInput
            value={availableMinutes}
            onApply={(minutes) => void update({ availableMinutes: minutes })}
          />
        </View>
      </View>
    </Card>
  );
}

/**
 * The LIST-AREA filter chip (the row under the hero card) — and nothing else.
 *
 * It stays a soft PILL precisely so it does NOT look like the engine bar's
 * inputs: the pills down here only trim the list, while the bar's rect tiles
 * and underlined numbers decide what the engine recommends. The engine bar
 * must not reuse this component (nor `ContextChip`, whose name-keyed earth
 * tones fake a "selected" look on an unselected scene).
 */
function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      onPress={onPress}
      className={
        active
          ? 'h-8 items-center justify-center rounded-full bg-accent px-3.5 shadow-xs dark:bg-accent-dark'
          : 'h-8 items-center justify-center rounded-full border border-border/80 bg-surface px-3.5 shadow-2xs dark:border-border-dark dark:bg-surface-dark'
      }
    >
      <Text
        className={
          active
            ? 'font-sans text-xs font-semibold text-on-accent dark:text-on-accent-dark'
            : 'font-sans text-xs font-medium text-ink dark:text-ink-dark'
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** One stats cell of the stats row (small muted label + value). */
function StatsCell({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 items-center gap-0.5 px-1 py-2">
      <Text className="font-sans text-xs text-muted dark:text-muted-dark">{label}</Text>
      <Text className="font-sans text-base font-semibold text-ink dark:text-ink-dark">{value}</Text>
    </View>
  );
}

/** One always-visible eligible row (design §5): title + project chip +
 *  read-only context chips + due label + 稍后/删除. */
function ActionRow({
  entry,
  now,
  projectName,
  contextName,
  onSnooze,
  onTrash,
}: {
  entry: NowEligible;
  now: Date;
  projectName: string | undefined;
  contextName: (id: string) => string;
  onSnooze: () => void;
  onTrash: () => void;
}) {
  const action = entry.action;
  return (
    <Card className="gap-2 p-3.5">
      <View className="flex-row items-start gap-2">
        <View className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-accent/60 dark:bg-accent-dark/60" />
        <Text className="flex-1 font-sans text-base font-medium text-ink dark:text-ink-dark">
          {action.title}
        </Text>
      </View>
      <View className="flex-row flex-wrap items-center gap-1.5">
        {projectName !== undefined ? <Tag label={projectName} /> : null}
        {action.contextIds.map((id) => (
          <ContextChip key={id} name={contextName(id)} />
        ))}
        <View className="ml-auto flex-row items-center gap-1">
          {action.kind === 'calendar' && action.startsAt !== undefined ? (
            <Text className="font-sans text-xs text-muted dark:text-muted-dark">
              开始 {formatLocalDateTime(action.startsAt)}
            </Text>
          ) : action.deadline !== undefined ? (
            <Tag label={formatDueLabel(action.deadline, now)} tone="warning" />
          ) : (
            <Text className="font-sans text-xs text-muted dark:text-muted-dark">随时</Text>
          )}
        </View>
      </View>
      <View className="flex-row justify-end gap-2">
        <Button size="sm" label="稍后" variant="ghost" onPress={onSnooze} />
        <Button size="sm" label="删除" variant="ghost" onPress={onTrash} />
      </View>
    </Card>
  );
}

/** One habit in the Now screen's habit block: name + where it stands in
 *  the 21-day challenge + today's check-in. The check-in is a button only
 *  when today's HabitDay is still open — a done day (or a day the weekday
 *  mask excluded) renders as read-only state, so the block never offers a
 *  completion that `completeAction` would reject. */
function HabitBlockRow({
  row,
  onComplete,
}: {
  row: HabitWithProgress;
  onComplete: () => void;
}) {
  const { habit, cycleDay, doneCount, today } = row;
  const open = today !== null && today.status === 'open';
  const cycleLabel =
    cycleDay === null ? `本期 ${habit.cycleDays} 天` : `第 ${cycleDay}/${habit.cycleDays} 天`;

  return (
    <View className="gap-1.5">
      <View className="flex-row items-center gap-2">
        <Text
          className="flex-1 font-sans text-sm font-medium text-ink dark:text-ink-dark"
          numberOfLines={1}
        >
          {habit.title}
        </Text>
        <Tag label={cycleLabel} tone="accent" />
      </View>
      <View className="flex-row items-center gap-2">
        <Text className="font-sans text-xs text-muted dark:text-muted-dark">
          本期已完成 {doneCount} 天
        </Text>
        {open ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`完成习惯：${habit.title}`}
            hitSlop={CHIP_HIT_SLOP}
            className="ml-auto h-8 items-center justify-center rounded-full border border-border/80 bg-surface px-3.5 shadow-2xs active:bg-surface-container dark:border-border-dark dark:bg-surface-dark dark:active:bg-surface-container-dark"
            onPress={onComplete}
          >
            <Text className="font-sans text-xs font-medium text-ink dark:text-ink-dark">
              ✓ 打卡
            </Text>
          </Pressable>
        ) : (
          <Text className="ml-auto font-sans text-xs text-muted dark:text-muted-dark">
            {today === null ? '今天无安排' : '今天已完成'}
          </Text>
        )}
      </View>
    </View>
  );
}

export default function NowScreen() {
  const now = useAppClock();
  // ONE engine-context instance for the whole screen: the bar writes it,
  // the pool reads it — both re-render from this single state.
  const { settings, update } = useEngineContextSettings();
  const { data, error } = useNow(settings);
  const { skip, error: skipError } = useSkipAction();
  const { snooze, error: snoozeError } = useSnoozeAction();
  const { trash, error: trashError } = useTrashAction();
  const { complete, error: completeError } = useCompleteAction();
  const { data: habitRows, error: habitError, reload: reloadHabits } = useHabits(now);
  // Habit rows are read through query-style hooks (no watch query), and
  // the Now tab is NOT unmounted when /habits is pushed on top of it —
  // so a habit created there would stay invisible. Re-read on every
  // focus (design.md §3); the first focus is one extra idempotent read.
  useFocusEffect(
    useCallback(() => {
      reloadHabits();
    }, [reloadHabits]),
  );
  const projectTitles = useProjectTitles();
  const { data: contexts } = useContexts();
  const [snoozeTarget, setSnoozeTarget] = useState<{ kind: CandidateKind; id: string } | null>(null);
  // Rotation (spec: `eligible` backs "换一个"): the ONE displayed action is
  // the first eligible entry not yet skipped in this view cycle. The skip
  // counter is persisted by the skip transaction (banner at ≥ 3); the
  // engine itself is a pure function and never re-ranks on skips.
  const [skippedViewIds, setSkippedViewIds] = useState<string[]>([]);
  // The LIST-AREA context filter (design §5): independent from the engine
  // context above — it only trims the list, never the hero recommendation.
  const [selectedContextIds, setSelectedContextIds] = useState<string[]>([]);
  const insets = useAppInsets();
  const topPadding = Math.max(insets.top, 16);
  const mutationError = skipError ?? snoozeError ?? trashError ?? completeError ?? habitError;

  const eligible = data?.eligible ?? [];
  const displayed =
    eligible.find((entry) => !skippedViewIds.includes(entry.action.id)) ??
    eligible[0] ??
    null;

  // Stats row: eligible vs total pool, Σ est minutes, the load band.
  const totalCount = eligible.length + (data?.filtered.length ?? 0);
  const totalEst = eligible.reduce((sum, entry) => sum + entry.action.estMinutes, 0);

  // Context-less actions are runnable ANYWHERE: they survive every filter
  // selection.
  const visible = eligible.filter(
    (entry) =>
      selectedContextIds.length === 0 ||
      entry.action.contextIds.length === 0 ||
      entry.action.contextIds.some((id) => selectedContextIds.includes(id)),
  );

  const toggleFilterContext = (contextId: string) =>
    setSelectedContextIds((prev) =>
      prev.includes(contextId) ? prev.filter((id) => id !== contextId) : [...prev, contextId],
    );

  const contextName = (id: string) =>
    contexts?.find((entry) => entry.id === id)?.name ?? id;

  const handleSkip = () => {
    if (displayed === null) return;
    void skip({ actionKind: displayed.action.kind, actionId: displayed.action.id });
    // Already excluded (we wrapped around) → restart the cycle from here.
    setSkippedViewIds((prev) =>
      prev.includes(displayed.action.id)
        ? [displayed.action.id]
        : [...prev, displayed.action.id],
    );
  };

  const subtitleParts: string[] = [];
  if (displayed !== null) {
    if (displayed.action.projectId !== undefined) {
      const title = projectTitles[displayed.action.projectId];
      if (title !== undefined) subtitleParts.push(title);
    }
    if (displayed.action.kind === 'calendar') {
      subtitleParts.push(`开始 ${formatLocalDateTime(displayed.action.startsAt)}`);
    }
    if (displayed.action.deadline !== undefined) {
      subtitleParts.push(`截止 ${formatLocalDate(displayed.action.deadline)}`);
    }
  }

  const habits = habitRows ?? [];
  // The block counts only habits that generated a row TODAY (the weekday
  // mask / cycle boundary can exclude one) — same set the old strip showed,
  // so 「今天习惯 n/m」 keeps its meaning.
  const todayRows = habits.filter((row) => row.today !== null);
  const todayDone = todayRows.filter((row) => row.today?.status === 'done').length;

  return (
    <View className="flex-1 bg-canvas dark:bg-canvas-dark">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: topPadding, paddingHorizontal: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <Text className="font-display text-3xl font-bold tracking-tight text-ink dark:text-ink-dark">
          现在
        </Text>
      <View className="mt-4">
        <EngineContextBar settings={settings} update={update} />
      </View>

      {mutationError !== null ? (
        <Text className="mt-2 font-sans text-sm text-danger">{errorMessage(mutationError)}</Text>
      ) : null}

      <View className="mt-3 gap-3.5">
        {error !== null ? (
          <EmptyState title="加载执行池失败" hint={errorMessage(error)} />
        ) : data === null ? (
          <EmptyState title="加载中…" />
        ) : data.poolEmpty ? (
          <EmptyState title="执行池是空的" hint="去收件箱捕获一条，这里会排好你接下来该做的事。" />
        ) : (
          <>
            {/* Habits are not re-clarifiable (db: reclarify.unsupported-kind —
             * habits are edited on the habit itself) — the banner offers the
             * re-clarify wizard only for next/calendar actions. */}
            {displayed !== null &&
            displayed.action.kind !== 'habit' &&
            shouldOfferReclarify(displayed.action.consecutiveSkips) ? (
              <Card className="border-warning bg-warning/10 p-3.5">
                <Text className="font-sans text-sm font-medium text-ink dark:text-ink-dark">
                  这个任务已连续跳过 {displayed.action.consecutiveSkips} 次 — 重新明确下一步？
                </Text>
                <View className="mt-2.5">
                  <Button
                    size="sm"
                    label="重新明晰"
                    variant="secondary"
                    onPress={() =>
                      router.push(`/reclarify/${displayed.action.id}?kind=${displayed.action.kind}`)
                    }
                  />
                </View>
              </Card>
            ) : null}

            {/* Stats row (design §5) */}
            <Card className="flex-row items-stretch px-1">
              <StatsCell label="可执行" value={`${eligible.length}/${totalCount} 项`} />
              <StatsCell label="预计耗时" value={`${totalEst} 分钟`} />
              <StatsCell label="认知负荷" value={cognitiveLoadLabel(totalEst)} />
            </Card>

            {displayed === null ? (
              <EmptyState title="没有任何适合当前场景与时间的行动" hint="试试切换上面的场景或时间。">
                {data.filtered.length > 0 ? (
                  <View className="mt-4 w-full gap-1">
                    <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                      被过滤的事项：
                    </Text>
                    {data.filtered.map((entry) => (
                      <Text
                        key={entry.action.id}
                        className="font-sans text-sm text-muted dark:text-muted-dark"
                      >
                        • {entry.action.title} — {FILTER_RULE_LABELS[entry.rule]}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </EmptyState>
            ) : (
              <>
                {/* Recommendation Hero Card */}
                <Card className="p-4">
                  <View className="mb-2.5 flex-row items-center gap-2">
                    <Tag label={KIND_LABELS[displayed.action.kind]} tone="accent" />
                    {displayed.action.estMinutes > 0 ? (
                      <Tag label={`${displayed.action.estMinutes} 分钟`} tone="neutral" />
                    ) : null}
                  </View>
                  <Text className="font-display text-xl font-bold tracking-tight text-ink dark:text-ink-dark">
                    {displayed.action.title}
                  </Text>
                  {subtitleParts.length > 0 ? (
                    <Text className="mt-1.5 font-sans text-xs text-muted dark:text-muted-dark">
                      {subtitleParts.join(' · ')}
                    </Text>
                  ) : null}

                  {displayed.reasons.length > 0 ? (
                    <View className="mt-3.5 rounded-xl bg-canvas p-3 dark:bg-canvas-dark">
                      <Text className="mb-1 font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                        为什么是它？
                      </Text>
                      <View className="gap-1">
                        {displayed.reasons.slice(0, 3).map((reason) => (
                          <Text
                            key={`${reason.type}-${reason.code}`}
                            className="font-sans text-xs text-ink/80 dark:text-ink-dark/80"
                          >
                            • {REASON_LABELS[reason.code]}
                          </Text>
                        ))}
                      </View>
                    </View>
                  ) : null}
                </Card>

                {/* Restructured Action Button Hierarchy: Prominent Primary + Spacious Secondary Toolbar */}
                <View className="gap-2.5">
                  <Button
                    size="lg"
                    label="开始"
                    className="w-full shadow-sm"
                    onPress={() =>
                      router.push(`/focus/${displayed.action.id}?kind=${displayed.action.kind}`)
                    }
                  />
                  <View className="flex-row gap-3">
                    <View className="flex-1">
                      <Button
                        label="换一个"
                        variant="secondary"
                        className="w-full"
                        onPress={handleSkip}
                      />
                    </View>
                    <View className="flex-1">
                      <Button
                        label="稍后"
                        variant="secondary"
                        className="w-full"
                        onPress={() =>
                          setSnoozeTarget({ kind: displayed.action.kind, id: displayed.action.id })
                        }
                      />
                    </View>
                  </View>
                </View>

                {/* Context filter chips (design §5 — list area only, the
                 *  hero recommendation above is never filtered). */}
                <View className="flex-row flex-wrap gap-2">
                  <Chip
                    label="全部"
                    active={selectedContextIds.length === 0}
                    onPress={() => setSelectedContextIds([])}
                  />
                  {(contexts ?? []).map((context) => (
                    <Chip
                      key={context.id}
                      label={context.name}
                      active={selectedContextIds.includes(context.id)}
                      onPress={() => toggleFilterContext(context.id)}
                    />
                  ))}
                </View>

                {/* Eligible list (always expanded, design §5) */}
                {visible.length === 0 ? (
                  <EmptyState
                    title="没有匹配当前情境的可执行事项"
                    hint="换一批情境 chip，或点「全部」看所有可执行事项。"
                  />
                ) : (
                  <View className="gap-2.5">
                    {visible.map((entry) => (
                      <ActionRow
                        key={entry.action.id}
                        entry={entry}
                        now={now}
                        projectName={
                          entry.action.projectId !== undefined
                            ? projectTitles[entry.action.projectId]
                            : undefined
                        }
                        contextName={contextName}
                        onSnooze={() =>
                          setSnoozeTarget({ kind: entry.action.kind, id: entry.action.id })
                        }
                        onTrash={() =>
                          void trash({ actionKind: entry.action.kind, actionId: entry.action.id })
                        }
                      />
                    ))}
                  </View>
                )}
              </>
            )}
          </>
        )}

        {/* Habit block. Renders in BOTH states (task 10-02): with no habit
         *  it used to render nothing at all, so the feature was
         *  undiscoverable — the empty state now carries the entry point,
         *  and a non-empty block carries a 「管理」 shortcut to /habits.
         *  `reload` runs on focus (useFocusEffect) because the Now tab
         *  stays mounted under the habits route (design.md §3).
         *
         *  Habits stay in the engine pool (they compete for the ONE hero
         *  recommendation); this block is the batch path — every habit at
         *  once, with the challenge context the ranked list cannot show. */}
        {habits.length > 0 ? (
          <Card className="gap-3 p-3.5">
            <View className="flex-row items-center justify-between">
              <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                今天习惯 {todayDone}/{todayRows.length}
              </Text>
              <Button
                size="sm"
                label="管理"
                variant="ghost"
                onPress={() => router.push('/habits')}
              />
            </View>
            {habits.map((row) => (
              <HabitBlockRow
                key={row.habit.id}
                row={row}
                onComplete={() => {
                  if (row.today !== null) {
                    void complete({ actionKind: 'habit', actionId: row.today.id });
                  }
                }}
              />
            ))}
          </Card>
        ) : habitRows !== null ? (
          <Card className="gap-2 p-3.5">
            <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
              今天习惯 0/0
            </Text>
            <Text className="font-sans text-sm text-muted dark:text-muted-dark">
              还没有习惯 — 创建后每天会生成一条行动，出现在这里的执行池中。
            </Text>
            <View className="flex-row">
              <Button
                size="sm"
                label="去创建习惯"
                variant="secondary"
                onPress={() => router.push('/habits')}
              />
            </View>
          </Card>
        ) : null}
      </View>
      </ScrollView>

      <SnoozeSheet
        open={snoozeTarget !== null}
        now={now}
        onClose={() => setSnoozeTarget(null)}
        onSelect={(target) => {
          if (snoozeTarget !== null) {
            void snooze({
              actionKind: snoozeTarget.kind,
              actionId: snoozeTarget.id,
              snoozedUntil: target,
            });
          }
        }}
      />
    </View>
  );
}
