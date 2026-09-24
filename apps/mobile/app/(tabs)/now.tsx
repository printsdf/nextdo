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
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, ContextChip, EmptyState, Tag } from '@nextdo/ui';
import type { CandidateKind } from '@nextdo/core';
import { useNow, shouldOfferReclarify, type NowEligible } from '@/hooks/use-now';
import { useAppClock } from '@/hooks/use-app-clock';
import { useSkipAction } from '@/hooks/use-skip-action';
import { useSnoozeAction } from '@/hooks/use-snooze-action';
import { useTrashAction } from '@/hooks/use-trash-action';
import { useCompleteAction } from '@/hooks/use-complete-action';
import { useContexts } from '@/hooks/use-contexts';
import { useHabitDays } from '@/hooks/use-habit-days';
import { useProjectTitles } from '@/hooks/use-project-titles';
import { useEngineContextSettings, type EngineContextSettings } from '@/lib/engine-context';
import { errorMessage } from '@/lib/error-messages';
import { cognitiveLoadLabel } from '@/lib/cognitive-load';
import { FILTER_RULE_LABELS, REASON_LABELS } from '@/lib/reason-labels';
import { KIND_LABELS } from '@/lib/kind-labels';
import { formatLocalDate, formatLocalDateTime, formatDueLabel } from '@/lib/format';
import { SnoozeSheet } from '@/components/snooze-sheet';

const TIME_CHIPS = [15, 30, 60, 120];

const INPUT_CLASS =
  'rounded-xl border border-border/80 bg-surface p-2 text-sm text-ink placeholder:text-muted dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

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
    <Card className="gap-3 p-3.5">
      <View>
        <Text className="mb-2 font-sans text-xs font-semibold text-muted dark:text-muted-dark">
          当前场景
        </Text>
        <View className="flex-row flex-wrap gap-2">
          <Chip
            label="任意"
            active={contextIds.length === 0}
            onPress={() => void update({ contextIds: [] })}
          />
          {(contexts ?? []).map((context) => (
            <Chip
              key={context.id}
              label={context.name}
              active={contextIds.includes(context.id)}
              onPress={() => toggleContext(context.id)}
            />
          ))}
          {adding ? (
            <View className="flex-row items-center gap-1.5">
              <TextInput
                className={INPUT_CLASS}
                value={newName}
                onChangeText={setNewName}
                placeholder="新场景"
                onSubmitEditing={createContext}
              />
              <Button size="sm" label="加" variant="secondary" onPress={createContext} />
            </View>
          ) : (
            <Chip label="＋" active={false} onPress={() => setAdding(true)} />
          )}
        </View>
      </View>
      <View>
        <Text className="mb-2 font-sans text-xs font-semibold text-muted dark:text-muted-dark">
          可用时间（分钟）
        </Text>
        <View className="flex-row flex-wrap items-center gap-2">
          {TIME_CHIPS.map((minutes) => (
            <Chip
              key={minutes}
              label={String(minutes)}
              active={availableMinutes === minutes}
              onPress={() => void update({ availableMinutes: minutes })}
            />
          ))}
          <CustomMinutesInput
            onApply={(minutes) => void update({ availableMinutes: minutes })}
          />
        </View>
      </View>
    </Card>
  );
}

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

function CustomMinutesInput({ onApply }: { onApply: (minutes: number) => void }) {
  const [custom, setCustom] = useState('');
  return (
    <TextInput
      className={`${INPUT_CLASS} h-8 w-20 p-1 text-center`}
      placeholder="自定义"
      keyboardType="number-pad"
      value={custom}
      onChangeText={setCustom}
      onSubmitEditing={() => {
        const parsed = Math.round(Number(custom));
        if (Number.isFinite(parsed) && parsed >= 1) onApply(parsed);
        setCustom('');
      }}
    />
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
  const { days, habitTitles, error: habitError } = useHabitDays(now);
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

  const openHabitDays = (days ?? []).filter((day) => day.status === 'open');

  return (
    <View className="flex-1 bg-canvas p-4 dark:bg-canvas-dark">
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

        {days !== null && days.length > 0 ? (
          <Card className="p-3.5">
            <Text className="mb-2 font-sans text-xs font-semibold text-muted dark:text-muted-dark">
              今天习惯 {days.filter((day) => day.status === 'done').length}/{days.length}
            </Text>
            {openHabitDays.length > 0 ? (
              <View className="flex-row flex-wrap gap-2">
                {openHabitDays.map((day) => (
                  <Pressable
                    key={day.id}
                    accessibilityRole="button"
                    accessibilityLabel={`完成习惯：${habitTitles[day.habitId] ?? '习惯'}`}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                    className="h-8 items-center justify-center rounded-full border border-border/80 bg-surface px-3.5 shadow-2xs dark:border-border-dark dark:bg-surface-dark"
                    onPress={() => void complete({ actionKind: 'habit', actionId: day.id })}
                  >
                    <Text className="font-sans text-xs font-medium text-ink dark:text-ink-dark">
                      ✓ {habitTitles[day.habitId] ?? '习惯'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </Card>
        ) : null}
      </View>

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
