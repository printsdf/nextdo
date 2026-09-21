/**
 * The Review tab (design.md §4): minimal screen — the review record trail
 * (append-only) as the daily/weekly entry point. The review checklists
 * themselves are a later task.
 */
import { Card, EmptyState, Tag } from '@nextdo/ui';
import { FlatList, Text, View } from 'react-native';
import { useReviewRecords } from '@/hooks/use-review-records';
import { formatLocalDate } from '@/lib/format';

export default function ReviewScreen() {
  const { data, error } = useReviewRecords();

  return (
    <View className="flex-1 bg-canvas p-4 dark:bg-canvas-dark">
      <Text className="mb-4 text-xl font-semibold text-ink dark:text-ink-dark">Review</Text>
      {error !== null ? (
        <EmptyState title="Could not load reviews" hint={error} />
      ) : data.length === 0 ? (
        <EmptyState
          title="No reviews yet"
          hint="Daily and weekly reviews will be recorded here as you run them."
        />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          contentContainerClassName="gap-2"
          renderItem={({ item }) => (
            <Card>
              <View className="flex-row items-center justify-between gap-2">
                <Tag label={item.kind} tone="accent" />
                <Text className="text-sm text-muted dark:text-muted-dark">
                  {formatLocalDate(item.at)}
                </Text>
              </View>
            </Card>
          )}
        />
      )}
    </View>
  );
}
