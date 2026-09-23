/**
 * The Projects tab (design.md §4.4 — PRD R6): the project list with the
 * derived action-coverage tag + inline new-project form. Row tap → the
 * project detail route (`/projects/[id]`).
 *
 * Presentational only: data arrives from `useProjects` (watched query —
 * the coverage flag re-derives itself), creation goes through
 * `useAddProject` (component-guidelines).
 */
import { useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, EmptyState, Tag, type TagTone } from '@nextdo/ui';
import type { ProjectStatus, Value } from '@nextdo/core';
import { useProjects } from '@/hooks/use-projects';
import { useAddProject } from '@/hooks/use-add-project';
import { errorMessage } from '@/lib/error-messages';
import { PROJECT_STATUS_LABELS } from '@/lib/status-labels';

const STATUS_TONES: Record<ProjectStatus, TagTone> = {
  active: 'accent',
  'on-hold': 'warning',
  done: 'neutral',
  dropped: 'neutral',
};

const VALUE_CHIPS: Value[] = [1, 2, 3, 4, 5];

const INPUT_CLASS =
  'rounded-md border border-border bg-surface p-3 text-base text-ink placeholder:text-muted dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

/** The inline new-project form (title + outcome + value 1–5). */
function NewProjectForm({ onDone }: { onDone: () => void }) {
  const { add, error } = useAddProject();
  const [title, setTitle] = useState('');
  const [outcome, setOutcome] = useState('');
  const [value, setValue] = useState<Value>(3);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = title.trim() !== '' && outcome.trim() !== '' && !submitting;

  const create = () => {
    if (!canSubmit) return;
    setSubmitting(true);
    void add({ title, outcome, value }).then(() => {
      setSubmitting(false);
      setTitle('');
      setOutcome('');
      setValue(3);
      onDone();
    });
  };

  return (
    <Card className="gap-3">
      <Text className="text-sm font-medium text-muted dark:text-muted-dark">新项目</Text>
      <TextInput
        className={INPUT_CLASS}
        placeholder="项目标题"
        value={title}
        onChangeText={setTitle}
      />
      <TextInput
        className={INPUT_CLASS}
        placeholder="完成是什么样（结果）"
        value={outcome}
        onChangeText={setOutcome}
      />
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-medium text-ink dark:text-ink-dark">价值（1–5）</Text>
        <View className="flex-row gap-2">
          {VALUE_CHIPS.map((chip) => (
            <Pressable
              key={chip}
              accessibilityRole="button"
              accessibilityLabel={`价值 ${chip}`}
              accessibilityState={{ selected: value === chip }}
              onPress={() => setValue(chip)}
              className={
                value === chip
                  ? 'h-8 w-8 items-center justify-center rounded-full bg-accent dark:bg-accent-dark'
                  : 'h-8 w-8 items-center justify-center rounded-full border border-border dark:border-border-dark'
              }
            >
              <Text
                className={
                  value === chip ? 'text-sm text-on-accent' : 'text-sm text-ink dark:text-ink-dark'
                }
              >
                {chip}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      {error !== null ? <Text className="text-sm text-danger">{errorMessage(error)}</Text> : null}
      <View className="flex-row gap-2">
        <Button label="创建" onPress={create} disabled={!canSubmit} />
        <Button label="取消" variant="secondary" onPress={onDone} />
      </View>
    </Card>
  );
}

export default function ProjectsScreen() {
  const { data, error } = useProjects();
  const [showForm, setShowForm] = useState(false);

  return (
    <View className="flex-1 bg-canvas p-4 dark:bg-canvas-dark">
      <View className="mb-4 flex-row items-center justify-between">
        <Text className="text-xl font-semibold text-ink dark:text-ink-dark">项目</Text>
        <Button label="＋ 新项目" variant="secondary" onPress={() => setShowForm((value) => !value)} />
      </View>

      {showForm ? <NewProjectForm onDone={() => setShowForm(false)} /> : null}

      <View className="mt-3 flex-1">
        {error !== null ? (
          <EmptyState title="加载项目失败" hint={errorMessage(error)} />
        ) : data.length === 0 && !showForm ? (
          <EmptyState
            title="还没有项目"
            hint="需要多个步骤才能完成的事，就是一个项目。点右上「＋ 新项目」。"
          />
        ) : (
          <FlatList
            data={data}
            keyExtractor={(item) => item.id}
            contentContainerClassName="gap-2"
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`打开项目：${item.title}`}
                onPress={() => router.push(`/projects/${item.id}`)}
              >
                <Card className="gap-1">
                  <View className="flex-row items-center gap-2">
                    <Text className="flex-1 text-base text-ink dark:text-ink-dark" numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Tag label={PROJECT_STATUS_LABELS[item.status]} tone={STATUS_TONES[item.status]} />
                  </View>
                  <Text className="text-xs text-muted dark:text-muted-dark" numberOfLines={1}>
                    {item.outcome}
                  </Text>
                  <View className="mt-1 flex-row items-center gap-2">
                    <Tag
                      label={item.hasOpenAction ? '有进行中的行动' : '缺少行动'}
                      tone={item.hasOpenAction ? 'accent' : 'danger'}
                    />
                    <Tag label={`价值 ${item.value}`} />
                  </View>
                </Card>
              </Pressable>
            )}
          />
        )}
      </View>
    </View>
  );
}
