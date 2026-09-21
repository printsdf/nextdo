/**
 * The Inbox tab (design.md §4): the capture list (oldest first). The
 * clarify flow is a later task — this screen is the minimal list + empty
 * state.
 */
import { Card, EmptyState } from '@nextdo/ui';
import { FlatList, Text, View } from 'react-native';
import { useInboxItems } from '@/hooks/use-inbox-items';
import { formatLocalDate } from '@/lib/format';

export default function InboxScreen() {
  const { data, error } = useInboxItems();

  return (
    <View className="flex-1 bg-canvas p-4 dark:bg-canvas-dark">
      <Text className="mb-4 text-xl font-semibold text-ink dark:text-ink-dark">Inbox</Text>
      {error !== null ? (
        <EmptyState title="Could not load the inbox" hint={error} />
      ) : data.length === 0 ? (
        <EmptyState
          title="Inbox is empty"
          hint="Capture something here and it will show up as a list below."
        />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          contentContainerClassName="gap-2"
          renderItem={({ item }) => (
            <Card>
              <Text className="text-base text-ink dark:text-ink-dark">{item.title}</Text>
              <Text className="mt-1 text-xs text-muted dark:text-muted-dark">
                Captured {formatLocalDate(item.capturedAt)}
              </Text>
            </Card>
          )}
        />
      )}
    </View>
  );
}
