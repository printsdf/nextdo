/**
 * The Inbox tab (design.md §4.2 — PRD R1): low-friction capture + list.
 *
 * - capture: one TextInput, Enter or [记录] saves immediately (no
 *   classification, no required fields — Proposal §5.1);
 * - quick capture modal: automatically displayed on launch for zero-friction
 *   thought dump;
 * - list: oldest first; a row opens the Clarify wizard; the row's trash
 *   button confirms inline (one tap to arm, one tap to delete).
 *
 * Presentational only: data arrives from `useInboxItems`, mutations go
 * through the mutation hooks (component-guidelines).
 */
import { useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, EmptyState } from '@nextdo/ui';
import { useInboxItems } from '@/hooks/use-inbox-items';
import { useAddInboxItem } from '@/hooks/use-add-inbox-item';
import { useTrashInboxItem } from '@/hooks/use-trash-inbox-item';
import { formatLocalDate } from '@/lib/format';
import { errorMessage } from '@/lib/error-messages';
import { QuickCaptureModal } from '@/components/quick-capture-modal';
import type { InboxItem } from '@nextdo/core';

const INPUT_CLASS =
  'flex-1 rounded-2xl border border-border/80 bg-surface p-3 text-base text-ink placeholder:text-muted shadow-sm focus:border-accent dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

/** One inbox row: tap the title → clarify; trash arms, then confirms. */
function InboxRow({
  item,
  onTrash,
}: {
  item: InboxItem;
  onTrash: (id: string) => void;
}) {
  const [armed, setArmed] = useState(false);

  return (
    <Card className="p-3.5">
      <View className="flex-row items-center gap-3">
        <Pressable
          className="flex-1"
          accessibilityRole="button"
          accessibilityLabel={`明晰：${item.title}`}
          onPress={() => router.push(`/clarify/${item.id}`)}
        >
          <Text className="text-base font-medium text-ink dark:text-ink-dark">
            {item.title}
          </Text>
          <Text className="mt-1 text-xs text-muted dark:text-muted-dark">
            捕获于 {formatLocalDate(item.capturedAt)}
          </Text>
        </Pressable>
        {armed ? (
          <Button
            size="sm"
            label="确认删除？"
            variant="secondary"
            onPress={() => {
              setArmed(false);
              onTrash(item.id);
            }}
          />
        ) : (
          <Button
            size="sm"
            label="删除"
            variant="ghost"
            onPress={() => setArmed(true)}
          />
        )}
      </View>
    </Card>
  );
}

export default function InboxScreen() {
  const { data, error } = useInboxItems();
  const { add, error: captureError } = useAddInboxItem();
  const { trash, error: trashError } = useTrashInboxItem();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [showQuickCapture, setShowQuickCapture] = useState(true);

  const capture = async () => {
    const title = draft.trim();
    if (title === '' || saving) return;
    setSaving(true);
    try {
      await add(title);
      setDraft('');
    } finally {
      setSaving(false);
    }
  };

  const mutationError = captureError ?? trashError;

  return (
    <View className="flex-1 bg-canvas p-4 dark:bg-canvas-dark">
      {/* iOS Large Title Header */}
      <Text className="mb-4 text-2xl font-bold tracking-tight text-ink dark:text-ink-dark">
        收件箱
      </Text>

      {/* Inline Quick Capture Bar */}
      <View className="mb-4 flex-row items-center gap-2.5">
        <TextInput
          className={INPUT_CLASS}
          value={draft}
          onChangeText={setDraft}
          placeholder="记下任何事…（回车保存）"
          onSubmitEditing={() => void capture()}
          blurOnSubmit={false}
        />
        <Button
          label="记录"
          variant="primary"
          onPress={() => void capture()}
          disabled={draft.trim() === '' || saving}
        />
      </View>

      {mutationError !== null ? (
        <Text className="mb-2 text-sm text-danger">
          {errorMessage(mutationError)}
        </Text>
      ) : null}

      {error !== null ? (
        <EmptyState title="加载收件箱失败" hint={errorMessage(error)} />
      ) : data.length === 0 ? (
        <EmptyState
          title="收件箱是空的"
          hint="在上方输入并保存，这里会按捕获时间列出你记下的一切。"
        />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          contentContainerClassName="gap-2.5"
          renderItem={({ item }) => (
            <InboxRow item={item} onTrash={(id) => void trash(id)} />
          )}
        />
      )}

      {/* On-launch & triggerable quick capture modal */}
      <QuickCaptureModal
        visible={showQuickCapture}
        onClose={() => setShowQuickCapture(false)}
        onAdd={add}
        error={captureError}
      />
    </View>
  );
}
