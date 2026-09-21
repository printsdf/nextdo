/**
 * The Now tab (design.md §4) — the engine-wired vertical slice:
 * packages/db pool → packages/core `recommend()` → the ONE recommendation
 * with its "Why this?" reasons (top 3) and the skip action.
 *
 * Presentational only: data arrives from the `useNow` hook, mutations go
 * through `useSkipAction` (component-guidelines).
 */
import { Button, Card, EmptyState, Tag } from '@nextdo/ui';
import { Text, View } from 'react-native';
import { useNow } from '@/hooks/use-now';
import { useSkipAction } from '@/hooks/use-skip-action';
import { REASON_LABELS } from '@/lib/reason-labels';

export default function NowScreen() {
  const { data, error } = useNow();
  const { skip, error: skipError } = useSkipAction();

  return (
    <View className="flex-1 bg-canvas p-4 dark:bg-canvas-dark">
      <Text className="mb-4 text-xl font-semibold text-ink dark:text-ink-dark">Now</Text>
      {error !== null || skipError !== null ? (
        <EmptyState title="Could not load your next action" hint={error ?? skipError ?? undefined} />
      ) : data === null ? (
        <EmptyState
          title="Nothing to do right now"
          hint="Capture an action in the Inbox and the next one to do will be ranked here."
        />
      ) : (
        <View className="gap-3">
          <Card>
            <View className="mb-2 flex-row items-center gap-2">
              <Tag label={data.action.kind} tone="accent" />
              {data.action.estMinutes > 0 ? (
                <Tag label={`${data.action.estMinutes} min`} />
              ) : null}
            </View>
            <Text className="text-base font-medium text-ink dark:text-ink-dark">
              {data.action.title}
            </Text>
          </Card>
          <Card>
            <Text className="mb-2 text-sm font-medium text-muted dark:text-muted-dark">
              Why this?
            </Text>
            <View className="gap-1">
              {data.reasons.slice(0, 3).map((reason) => (
                <Text
                  key={`${reason.type}-${reason.code}`}
                  className="text-sm text-ink dark:text-ink-dark"
                >
                  • {REASON_LABELS[reason.code]}
                </Text>
              ))}
            </View>
          </Card>
          <Button
            label="Skip this one"
            variant="secondary"
            onPress={() => {
              void skip({ actionKind: data.action.kind, actionId: data.action.id });
            }}
          />
        </View>
      )}
    </View>
  );
}
