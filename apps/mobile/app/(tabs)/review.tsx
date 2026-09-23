/**
 * The Review tab (design.md §4.5 — PRD R7): the two entry cards (今日回顾
 * / 本周回顾 → the /review/daily and /review/weekly routes) + the
 * append-only history (newest first — the tab's list query orders by
 * `at` ascending, so the trail is reversed client-side).
 */
import { Button, Card, EmptyState, Tag } from '@nextdo/ui';
import { FlatList, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { ReviewRecord } from '@nextdo/core';
import { useReviewRecords } from '@/hooks/use-review-records';
import { formatLocalDate } from '@/lib/format';

const REVIEW_KIND_LABELS: Record<ReviewRecord['kind'], string> = {
  daily: '日常',
  weekly: '每周',
};

/** A compact one-line digest of what the review decided. */
function recordSummary(record: ReviewRecord): string {
  if (record.kind === 'daily') {
    return `完成 ${record.answers.completedActionIds.length} · 排期 ${record.answers.rescheduled.length} · 明日必做 ${record.answers.tomorrowMustDo.length}`;
  }
  return `项目 ${record.snapshot.projects.length} · 待跟进 ${record.snapshot.waitingFollowUps.length} · Someday ${record.snapshot.somedayCount}`;
}

export default function ReviewScreen() {
  const { data, error } = useReviewRecords();
  // Newest first — the watch query orders by `at` ascending.
  const records = data.slice().reverse();

  return (
    <View className="flex-1 bg-canvas p-4 dark:bg-canvas-dark">
      <Text className="mb-4 text-xl font-semibold text-ink dark:text-ink-dark">回顾</Text>

      <View className="flex-row gap-2">
        <View className="flex-1">
          <Button label="今日回顾" onPress={() => router.push('/review/daily')} />
        </View>
        <View className="flex-1">
          <Button label="本周回顾" onPress={() => router.push('/review/weekly')} />
        </View>
      </View>

      <View className="mt-5 flex-1">
        <Text className="mb-2 text-base font-medium text-ink dark:text-ink-dark">历史记录</Text>
        {error !== null ? (
          <EmptyState title="加载回顾记录失败" hint={error} />
        ) : records.length === 0 ? (
          <EmptyState
            title="还没有回顾记录"
            hint="做一次日常回顾或周回顾后，记录会留在这里。"
          />
        ) : (
          <FlatList
            data={records}
            keyExtractor={(item) => item.id}
            contentContainerClassName="gap-2"
            renderItem={({ item }) => (
              <Card className="gap-1">
                <View className="flex-row items-center justify-between gap-2">
                  <Tag label={REVIEW_KIND_LABELS[item.kind]} tone="accent" />
                  <Text className="text-sm text-muted dark:text-muted-dark">
                    {formatLocalDate(item.at)}
                  </Text>
                </View>
                <Text className="text-xs text-muted dark:text-muted-dark">{recordSummary(item)}</Text>
              </Card>
            )}
          />
        )}
      </View>
    </View>
  );
}
