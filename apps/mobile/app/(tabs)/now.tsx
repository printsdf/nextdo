/**
 * The Now tab (design.md §4.1 — PRD R4): the execution screen.
 *
 *   engine-context bar (scene chips from contexts + time chips, persisted
 *   via secure-store) → the ONE recommendation (kind / est / 项目·截止 /
 *   Why this? top-3) → [开始]→focus / [换一个]→skip / [稍后]→snooze sheet
 *   → re-clarify banner (consecutiveSkips ≥ threshold)
 *   → "稍后 N 个可执行事项" (expandable) → today's habit strip.
 *
 * Presentational only: data arrives from `useNow` (+ contexts / habit-days
 * hooks); every mutation goes through a mutation hook (component-
 * guidelines). The 1-second focus tick does NOT live here — the screen
 * runs on the minute app clock (hook-guidelines Rule 4).
 */
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, EmptyState, Tag } from '@nextdo/ui';
import type { CandidateKind } from '@nextdo/core';
import { useNow, shouldOfferReclarify } from '@/hooks/use-now';
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
import { FILTER_RULE_LABELS, REASON_LABELS } from '@/lib/reason-labels';
import { KIND_LABELS } from '@/lib/kind-labels';
import { formatLocalDate, formatLocalDateTime } from '@/lib/format';
import { SnoozeSheet } from '@/components/snooze-sheet';

const TIME_CHIPS = [15, 30, 60, 120];

const INPUT_CLASS =
  'rounded-md border border-border bg-surface p-2 text-sm text-ink placeholder:text-muted dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

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
    const next = contextIds.includes(id) ? contextIds.filter((entry) => entry !== id) : [...contextIds, id];
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
    <Card className="gap-3">
      <View>
        <Text className="mb-2 text-xs font-medium text-muted dark:text-muted-dark">当前场景</Text>
        <View className="flex-row flex-wrap gap-2">
          <Chip label="任意" active={contextIds.length === 0} onPress={() => void update({ contextIds: [] })} />
          {(contexts ?? []).map((context) => (
            <Chip
              key={context.id}
              label={context.name}
              active={contextIds.includes(context.id)}
              onPress={() => toggleContext(context.id)}
            />
          ))}
          {adding ? (
            <View className="flex-row items-center gap-1">
              <TextInput
                className={INPUT_CLASS}
                value={newName}
                onChangeText={setNewName}
                placeholder="新场景"
                onSubmitEditing={createContext}
              />
              <Button label="加" variant="secondary" onPress={createContext} />
            </View>
          ) : (
            <Chip label="＋" active={false} onPress={() => setAdding(true)} />
          )}
        </View>
      </View>
      <View>
        <Text className="mb-2 text-xs font-medium text-muted dark:text-muted-dark">可用时间（分钟）</Text>
        <View className="flex-row flex-wrap items-center gap-2">
          {TIME_CHIPS.map((minutes) => (
            <Chip
              key={minutes}
              label={String(minutes)}
              active={availableMinutes === minutes}
              onPress={() => void update({ availableMinutes: minutes })}
            />
          ))}
          <CustomMinutesInput onApply={(minutes) => void update({ availableMinutes: minutes })} />
        </View>
      </View>
    </Card>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={
        active
          ? 'h-8 items-center justify-center rounded-full bg-accent px-3 text-on-accent dark:bg-accent-dark'
          : 'h-8 items-center justify-center rounded-full border border-border bg-surface px-3 text-ink dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark'
      }
    >
      <Text className="text-sm">{label}</Text>
    </Pressable>
  );
}

function CustomMinutesInput({ onApply }: { onApply: (minutes: number) => void }) {
  const [custom, setCustom] = useState('');
  return (
    <TextInput
      className={`${INPUT_CLASS} h-8 w-20 p-1`}
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

/** The "稍后 N 个可执行事项" expandable list (design.md §4.1.5). */
function EligibleList({
  entries,
  onSnooze,
  onTrash,
}: {
  entries: { id: string; kind: CandidateKind; title: string; estMinutes: number }[];
  onSnooze: (kind: CandidateKind, id: string) => void;
  onTrash: (kind: CandidateKind, id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`稍后 ${entries.length} 个可执行事项`}
        onPress={() => setExpanded((value) => !value)}
        className="flex-row items-center justify-between py-1"
      >
        <Text className="text-sm text-ink dark:text-ink-dark">稍后 {entries.length} 个可执行事项</Text>
        <Text className="text-xs text-muted dark:text-muted-dark">{expanded ? '收起 ▲' : '展开 ▼'}</Text>
      </Pressable>
      {expanded ? (
        <View className="mt-2 gap-2">
          {entries.map((entry) => (
            <View key={entry.id} className="flex-row items-center gap-2">
              <View className="flex-1">
                <Text className="text-sm text-ink dark:text-ink-dark">{entry.title}</Text>
                <Text className="text-xs text-muted dark:text-muted-dark">{entry.estMinutes} 分钟</Text>
              </View>
              <Button label="稍后" variant="ghost" onPress={() => onSnooze(entry.kind, entry.id)} />
              <Button label="删除" variant="ghost" onPress={() => onTrash(entry.kind, entry.id)} />
            </View>
          ))}
        </View>
      ) : null}
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
  const [snoozeTarget, setSnoozeTarget] = useState<{ kind: CandidateKind; id: string } | null>(null);
  // Rotation (spec: `eligible` backs "换一个"): the ONE displayed action is
  // the first eligible entry not yet skipped in this view cycle. The skip
  // counter is persisted by the skip transaction (banner at ≥ 3); the
  // engine itself is a pure function and never re-ranks on skips.
  const [skippedViewIds, setSkippedViewIds] = useState<string[]>([]);

  const mutationError = skipError ?? snoozeError ?? trashError ?? completeError ?? habitError;

  const eligible = data?.eligible ?? [];
  const displayed =
    eligible.find((entry) => !skippedViewIds.includes(entry.action.id)) ??
    eligible[0] ??
    null;

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
      <Text className="mb-4 text-xl font-semibold text-ink dark:text-ink-dark">现在</Text>

      <EngineContextBar settings={settings} update={update} />

      {mutationError !== null ? (
        <Text className="mt-2 text-sm text-danger">{errorMessage(mutationError)}</Text>
      ) : null}

      <View className="mt-3 gap-3">
        {error !== null ? (
          <EmptyState title="加载执行池失败" hint={errorMessage(error)} />
        ) : data === null ? (
          <EmptyState title="加载中…" />
        ) : data.poolEmpty ? (
          <EmptyState title="执行池是空的" hint="去收件箱捕获一条，这里会排好你接下来该做的事。" />
        ) : displayed === null ? (
          <EmptyState title="没有任何适合当前场景与时间的行动" hint="试试切换上面的场景或时间。">
            {data.filtered.length > 0 ? (
              <View className="mt-4 w-full gap-1">
                <Text className="text-xs font-medium text-muted dark:text-muted-dark">被过滤的事项：</Text>
                {data.filtered.map((entry) => (
                  <Text key={entry.action.id} className="text-sm text-muted dark:text-muted-dark">
                    • {entry.action.title} — {FILTER_RULE_LABELS[entry.rule]}
                  </Text>
                ))}
              </View>
            ) : null}
          </EmptyState>
        ) : (
          <>
            {/* Habits are not re-clarifiable (db: reclarify.unsupported-kind —
             * habits are edited on the habit itself) — the banner offers the
             * re-clarify wizard only for next/calendar actions. */}
            {displayed.action.kind !== 'habit' &&
            shouldOfferReclarify(displayed.action.consecutiveSkips) ? (
              <Card className="border-warning bg-warning/10 p-3">
                <Text className="text-sm text-ink dark:text-ink-dark">
                  这个任务已连续跳过 {displayed.action.consecutiveSkips} 次 — 重新明确下一步？
                </Text>
                <View className="mt-2">
                  <Button
                    label="重新明晰"
                    variant="secondary"
                    onPress={() =>
                      router.push(`/reclarify/${displayed.action.id}?kind=${displayed.action.kind}`)
                    }
                  />
                </View>
              </Card>
            ) : null}

            <Card>
              <View className="mb-2 flex-row items-center gap-2">
                <Tag label={KIND_LABELS[displayed.action.kind]} tone="accent" />
                {displayed.action.estMinutes > 0 ? (
                  <Tag label={`${displayed.action.estMinutes} 分钟`} />
                ) : null}
              </View>
              <Text className="text-base font-medium text-ink dark:text-ink-dark">
                {displayed.action.title}
              </Text>
              {subtitleParts.length > 0 ? (
                <Text className="mt-1 text-xs text-muted dark:text-muted-dark">
                  {subtitleParts.join(' · ')}
                </Text>
              ) : null}
            </Card>

            {displayed.reasons.length > 0 ? (
              <Card>
                <Text className="mb-2 text-sm font-medium text-muted dark:text-muted-dark">
                  为什么是它？
                </Text>
                <View className="gap-1">
                  {displayed.reasons.slice(0, 3).map((reason) => (
                    <Text
                      key={`${reason.type}-${reason.code}`}
                      className="text-sm text-ink dark:text-ink-dark"
                    >
                      • {REASON_LABELS[reason.code]}
                    </Text>
                  ))}
                </View>
              </Card>
            ) : null}

            <View className="flex-row gap-2">
              <Button
                label="开始"
                onPress={() =>
                  router.push(`/focus/${displayed.action.id}?kind=${displayed.action.kind}`)
                }
              />
              <Button label="换一个" variant="secondary" onPress={handleSkip} />
              <Button
                label="稍后"
                variant="secondary"
                onPress={() =>
                  setSnoozeTarget({ kind: displayed.action.kind, id: displayed.action.id })
                }
              />
            </View>
          </>
        )}

        {data !== null && data.eligible.length > 0 ? (
          <EligibleList
            entries={data.eligible.map((entry) => ({
              id: entry.action.id,
              kind: entry.action.kind,
              title: entry.action.title,
              estMinutes: entry.action.estMinutes,
            }))}
            onSnooze={(kind, id) => setSnoozeTarget({ kind, id })}
            onTrash={(kind, id) => void trash({ actionKind: kind, actionId: id })}
          />
        ) : null}

        {days !== null && days.length > 0 ? (
          <Card>
            <Text className="mb-2 text-sm font-medium text-muted dark:text-muted-dark">
              今天习惯 {days.filter((day) => day.status === 'done').length}/{days.length}
            </Text>
            {openHabitDays.length > 0 ? (
              <View className="flex-row flex-wrap gap-2">
                {openHabitDays.map((day) => (
                  <Pressable
                    key={day.id}
                    accessibilityRole="button"
                    accessibilityLabel={`完成习惯：${habitTitles[day.habitId] ?? '习惯'}`}
                    className="h-8 items-center justify-center rounded-full border border-border px-3 dark:border-border-dark"
                    onPress={() => void complete({ actionKind: 'habit', actionId: day.id })}
                  >
                    <Text className="text-sm text-ink dark:text-ink-dark">
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
            void snooze({ actionKind: snoozeTarget.kind, actionId: snoozeTarget.id, snoozedUntil: target });
          }
        }}
      />
    </View>
  );
}
