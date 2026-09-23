/**
 * The weekly review route (design.md §4.5 — PRD R7): the read-only
 * snapshot (inbox / project table with last progress / waiting follow-ups /
 * someday count / stalled projects / next-7-day schedule) + the decision
 * area:
 *   - inboxCleared / calendarReasonable confirmation switches
 *     (inboxCleared defaults from `snapshot.inboxCount === 0`);
 *   - followUpsRaised — waiting follow-up check-offs (record-only);
 *   - projectDecisions — per-project status chips (default: current);
 *   - somedayDecisions — per-item keep/trash (v1: no →project/→action,
 *     PRD decision 2).
 *
 * Submit order is fixed (design.md §8): the CHANGED decisions land first
 * (project status → `updateProject`; someday trash → `trashSomedayMaybeItem`),
 * then the append-only `addReviewRecord`. Any failed step stops the
 * sequence with a message and NO record is written.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Tag } from '@nextdo/ui';
import {
  type ProjectStatus,
  type SomedayDecision,
  type WeeklyReviewAnswers,
} from '@nextdo/core';
import { errorMessage as errorCopy } from '@/lib/error-messages';
import { PROJECT_STATUS_LABELS } from '@/lib/status-labels';
import { useWeeklyReviewData } from '@/hooks/use-weekly-review-data';
import { useProjectStatus } from '@/hooks/use-project-status';
import { useTrashSomeday } from '@/hooks/use-trash-someday';
import { useAddReviewRecord } from '@/hooks/use-add-review-record';
import { formatLocalDate, formatLocalDateTime } from '@/lib/format';

const STATUS_OPTIONS: ProjectStatus[] = ['active', 'on-hold', 'done', 'dropped'];

type SomedayChoice = 'keep' | 'trash';

export default function WeeklyReviewScreen() {
  const { data, error } = useWeeklyReviewData();
  const { set: setProjectStatus, error: statusError } = useProjectStatus();
  const { trash, error: trashError } = useTrashSomeday();
  const { add, error: recordError } = useAddReviewRecord();

  // Decision state — seeded ONCE when the snapshot first lands (later
  // reloads must not clobber the user's in-progress decisions).
  const [inboxCleared, setInboxCleared] = useState(false);
  const [calendarReasonable, setCalendarReasonable] = useState(true);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [projectStatuses, setProjectStatuses] = useState<Record<string, ProjectStatus>>({});
  const [somedayChoices, setSomedayChoices] = useState<Record<string, SomedayChoice>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const seeded = useRef(false);

  useEffect(() => {
    if (data === null || seeded.current) return;
    seeded.current = true;
    setInboxCleared(data.snapshot.inboxCount === 0);
    setCalendarReasonable(true);
    setProjectStatuses(Object.fromEntries(data.projects.map((project) => [project.id, project.status])));
    setSomedayChoices(Object.fromEntries(data.somedays.map((item) => [item.id, 'keep' as const])));
  }, [data]);

  const waitingItems = useMemo(
    () =>
      (data?.snapshot.waitingFollowUps ?? [])
        .map((id) => data?.waiting.find((item) => item.id === id))
        .filter((item): item is NonNullable<typeof item> => item !== undefined),
    [data],
  );

  if (error !== null) {
    return (
      <View className="flex-1 bg-canvas p-4 dark:bg-canvas-dark">
        <Text className="mb-4 text-xl font-semibold text-ink dark:text-ink-dark">本周回顾</Text>
        <Card>
          <Text className="text-danger">加载回顾数据失败：{errorCopy(error)}</Text>
        </Card>
      </View>
    );
  }

  if (data === null || !seeded.current) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas p-4 dark:bg-canvas-dark">
        <Text className="text-base text-muted dark:text-muted-dark">加载中…</Text>
      </View>
    );
  }

  const { snapshot } = data;

  const toggleFollowUp = (id: string) => {
    setFollowUps((prev) => (prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]));
  };

  const buildAnswers = (): WeeklyReviewAnswers => {
    const somedayDecisions: SomedayDecision[] = data.somedays.map((item) => ({
      id: item.id,
      to: (somedayChoices[item.id] ?? 'keep') as SomedayDecision['to'],
    }));
    const projectDecisions = data.projects.map((project) => ({
      id: project.id,
      to: (projectStatuses[project.id] ?? project.status) as ProjectStatus,
    }));
    return {
      inboxCleared,
      followUpsRaised: followUps,
      calendarReasonable,
      somedayDecisions,
      projectDecisions,
    };
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const answers = buildAnswers();
    try {
      // 1. Project status DECISIONS that changed → updateProject (the db
      //    layer asserts the lifecycle transition; done/dropped terminal).
      for (const decision of answers.projectDecisions) {
        const project = data.projects.find((entry) => entry.id === decision.id);
        if (project === undefined || project.status === decision.to) continue;
        const ok = await setProjectStatus({ project, status: decision.to });
        if (!ok) throw new Error('project status failed');
      }
      // 2. Someday trash decisions.
      for (const item of data.somedays) {
        if ((somedayChoices[item.id] ?? 'keep') !== 'trash') continue;
        const ok = await trash(item.id);
        if (!ok) throw new Error('someday trash failed');
      }
      // 3. Last: the append-only record (all-or-nothing with step 1–2).
      const recorded = await add({ kind: 'weekly', snapshot, answers });
      if (!recorded) throw new Error('record failed');
      router.back();
    } catch {
      // The mutation hooks surface their own typed error below; the record
      // was NOT written (submit stopped before step 3).
      setSubmitError('提交在中途失败，回顾记录未写入。请检查提示后重新提交。');
    } finally {
      setSubmitting(false);
    }
  };

  const calendarEntries = snapshot.calendarNext7
    .map((id) => data.calendar.find((entry) => entry.id === id))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);

  const stalledIds = new Set(snapshot.stalledProjects);

  return (
    <View className="flex-1 bg-canvas p-4 dark:bg-canvas-dark">
      <ScrollView className="flex-1" contentContainerClassName="gap-4">
        <View className="flex-row items-center justify-between">
          <Button label="← 回顾" variant="ghost" onPress={() => router.back()} />
          <Text className="text-xl font-semibold text-ink dark:text-ink-dark">本周回顾</Text>
          <View />
        </View>

        {/* 快照（只读） */}
        <Card className="gap-3">
          <View className="flex-row flex-wrap gap-2">
            <Tag label={`收件箱 ${snapshot.inboxCount} 条`} />
            <Tag label={`Someday ${snapshot.somedayCount} 条`} />
          </View>
          {waitingItems.length > 0 ? (
            <View className="gap-1">
              <Text className="text-xs font-medium text-muted dark:text-muted-dark">待跟进（已过期）</Text>
              {waitingItems.map((item) => (
                <Text key={item.id} className="text-sm text-ink dark:text-ink-dark">
                  {item.title} — 等{item.waitingOn}
                </Text>
              ))}
            </View>
          ) : null}
          {calendarEntries.length > 0 ? (
            <View className="gap-1">
              <Text className="text-xs font-medium text-muted dark:text-muted-dark">未来 7 天日程</Text>
              {calendarEntries.map((entry) => (
                <Text key={entry.id} className="text-sm text-ink dark:text-ink-dark">
                  {entry.title}（{formatLocalDateTime(entry.startsAt)}）
                </Text>
              ))}
            </View>
          ) : null}
        </Card>

        {/* 项目（状态决策区） */}
        <View className="gap-2">
          <Text className="text-base font-medium text-ink dark:text-ink-dark">项目（{snapshot.projects.length}）</Text>
          {snapshot.projects.length === 0 ? (
            <Card>
              <Text className="text-sm text-muted dark:text-muted-dark">还没有项目。</Text>
            </Card>
          ) : (
            snapshot.projects.map((project) => {
              const current = projectStatuses[project.id] ?? 'active';
              return (
                <Card key={project.id} className="gap-2">
                  <View className="flex-row items-center gap-2">
                    <Text className="flex-1 text-base text-ink dark:text-ink-dark">{project.title}</Text>
                    <Tag
                      label={project.hasOpenAction ? '有进行中的行动' : '缺少行动'}
                      tone={project.hasOpenAction ? 'accent' : 'danger'}
                    />
                    {stalledIds.has(project.id) ? <Tag label="停滞 ≥ 14 天" tone="warning" /> : null}
                  </View>
                  <Text className="text-xs text-muted dark:text-muted-dark">
                    最近进展：{project.lastProgressAt !== null ? formatLocalDate(project.lastProgressAt) : '暂无'}
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {STATUS_OPTIONS.map((status) => (
                      <Pressable
                        key={status}
                        accessibilityRole="button"
                        accessibilityLabel={`项目 ${project.title} 状态：${PROJECT_STATUS_LABELS[status]}`}
                        accessibilityState={{ selected: current === status }}
                        onPress={() =>
                          setProjectStatuses((prev) => ({ ...prev, [project.id]: status }))
                        }
                        className={
                          current === status
                            ? 'rounded-full bg-accent px-3 py-1 dark:bg-accent-dark'
                            : 'rounded-full border border-border px-3 py-1 dark:border-border-dark'
                        }
                      >
                        <Text
                          className={
                            current === status
                              ? 'text-sm text-on-accent'
                              : 'text-sm text-ink dark:text-ink-dark'
                          }
                        >
                          {PROJECT_STATUS_LABELS[status]}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </Card>
              );
            })
          )}
        </View>

        {/* 待跟进（勾选 = 已跟进，仅记录） */}
        {waitingItems.length > 0 ? (
          <View className="gap-2">
            <Text className="text-base font-medium text-ink dark:text-ink-dark">跟进勾选</Text>
            {waitingItems.map((item) => (
              <Card key={item.id} className="gap-1">
                <View className="flex-row items-center justify-between gap-2">
                  <Text className="flex-1 text-sm text-ink dark:text-ink-dark">{item.title}</Text>
                  <Button
                    label={followUps.includes(item.id) ? '已跟进 ✓' : '已跟进'}
                    variant={followUps.includes(item.id) ? 'primary' : 'secondary'}
                    onPress={() => toggleFollowUp(item.id)}
                  />
                </View>
              </Card>
            ))}
          </View>
        ) : null}

        {/* Someday（保留/删除） */}
        <View className="gap-2">
          <Text className="text-base font-medium text-ink dark:text-ink-dark">Someday（{data.somedays.length}）</Text>
          {data.somedays.length === 0 ? (
            <Card>
              <Text className="text-sm text-muted dark:text-muted-dark">没有"有空再说"的条目。</Text>
            </Card>
          ) : (
            data.somedays.map((item) => {
              const choice = somedayChoices[item.id] ?? 'keep';
              return (
                <Card key={item.id} className="gap-2">
                  <Text className="text-sm text-ink dark:text-ink-dark">{item.title}</Text>
                  <View className="flex-row gap-2">
                    <Button
                      label="保留"
                      variant={choice === 'keep' ? 'primary' : 'secondary'}
                      onPress={() => setSomedayChoices((prev) => ({ ...prev, [item.id]: 'keep' }))}
                    />
                    <Button
                      label="删除"
                      variant={choice === 'trash' ? 'primary' : 'ghost'}
                      onPress={() => setSomedayChoices((prev) => ({ ...prev, [item.id]: 'trash' }))}
                    />
                  </View>
                </Card>
              );
            })
          )}
        </View>

        {/* 确认开关 */}
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm text-ink dark:text-ink-dark">收件箱已清空</Text>
            <Button
              label={inboxCleared ? '是 ✓' : '否'}
              variant={inboxCleared ? 'primary' : 'secondary'}
              onPress={() => setInboxCleared((value) => !value)}
            />
          </View>
          <View className="flex-row items-center justify-between">
            <Text className="text-sm text-ink dark:text-ink-dark">日程安排合理</Text>
            <Button
              label={calendarReasonable ? '是 ✓' : '否'}
              variant={calendarReasonable ? 'primary' : 'secondary'}
              onPress={() => setCalendarReasonable((value) => !value)}
            />
          </View>
        </Card>

        {/* 提交 */}
        <View className="gap-2">
          {submitError !== null ? <Text className="text-sm text-danger">{submitError}</Text> : null}
          {statusError !== null ? <Text className="text-sm text-danger">{errorCopy(statusError)}</Text> : null}
          {trashError !== null ? <Text className="text-sm text-danger">{errorCopy(trashError)}</Text> : null}
          {recordError !== null ? <Text className="text-sm text-danger">{errorCopy(recordError)}</Text> : null}
          <Button label={submitting ? '提交中…' : '提交回顾'} onPress={() => void submit()} disabled={submitting} />
        </View>
      </ScrollView>
    </View>
  );
}
