/**
 * The Projects tab (design.md §4): the project list with the derived
 * action-coverage flag (a project without an open action is the classic
 * red flag — shown as a tag, never stored).
 */
import { Card, EmptyState, Tag } from '@nextdo/ui';
import { FlatList, Text, View } from 'react-native';
import { useProjects } from '@/hooks/use-projects';

export default function ProjectsScreen() {
  const { data, error } = useProjects();

  return (
    <View className="flex-1 bg-canvas p-4 dark:bg-canvas-dark">
      <Text className="mb-4 text-xl font-semibold text-ink dark:text-ink-dark">Projects</Text>
      {error !== null ? (
        <EmptyState title="Could not load projects" hint={error} />
      ) : data.length === 0 ? (
        <EmptyState
          title="No projects yet"
          hint="Projects you are working toward will show up here, with whether they have an open next action."
        />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          contentContainerClassName="gap-2"
          renderItem={({ item }) => (
            <Card>
              <View className="flex-row items-center justify-between gap-2">
                <Text className="flex-1 text-base text-ink dark:text-ink-dark">{item.title}</Text>
                <Tag
                  label={item.hasOpenAction ? 'has open action' : 'no open action'}
                  tone={item.hasOpenAction ? 'accent' : 'danger'}
                />
              </View>
              <Text className="mt-1 text-xs text-muted dark:text-muted-dark">{item.outcome}</Text>
            </Card>
          )}
        />
      )}
    </View>
  );
}
