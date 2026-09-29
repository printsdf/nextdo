/**
 * Snooze choice sheet (design.md §4.7 — shared by the Now screen and the
 * project detail). RN `Modal` (no new dependency). Options come from the
 * pure `lib/snooze-options` (`[10 分钟后, 30 分钟后, 今晚 20:00, 明天 08:00]`,
 * tonight 20:00 → 明晚 20:00 once passed — all device-local).
 */
import { Modal, Pressable, Text, View } from 'react-native';
import { useAppInsets } from '@/lib/use-app-insets';
import { Button } from '@nextdo/ui';
import { snoozeOptions } from '@/lib/snooze-options';

export interface SnoozeSheetProps {
  open: boolean;
  /** The device clock for the option math (screen-level, display + choice). */
  now: Date;
  onSelect: (target: Date) => void;
  onClose: () => void;
}

function formatOptionTime(target: Date, now: Date): string {
  const sameDay =
    target.getFullYear() === now.getFullYear() &&
    target.getMonth() === now.getMonth() &&
    target.getDate() === now.getDate();
  const time = `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`;
  if (target.getTime() - now.getTime() <= 24 * 60 * 60_000 && sameDay) return `今天 ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (
    target.getFullYear() === tomorrow.getFullYear() &&
    target.getMonth() === tomorrow.getMonth() &&
    target.getDate() === tomorrow.getDate()
  ) {
    return `明天 ${time}`;
  }
  return target.toLocaleDateString();
}

export function SnoozeSheet({ open, now, onSelect, onClose }: SnoozeSheetProps) {
  const insets = useAppInsets();
  const bottomPadding = Math.max(insets.bottom, 16);
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="flex-1" onPress={onClose} />
        <View
          style={{ paddingBottom: bottomPadding }}
          className="gap-3 rounded-t-2xl bg-surface p-4 dark:bg-surface-dark"
        >
          <Text className="text-base font-semibold text-ink dark:text-ink-dark">稍后提醒</Text>
          <View className="gap-2">
            {snoozeOptions(now).map((option) => (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                accessibilityLabel={`${option.label}（${formatOptionTime(option.target, now)}）`}
                className="flex-row items-center justify-between rounded-md border border-border p-3 dark:border-border-dark"
                onPress={() => {
                  onSelect(option.target);
                  onClose();
                }}
              >
                <Text className="text-base text-ink dark:text-ink-dark">{option.label}</Text>
                <Text className="text-sm text-muted dark:text-muted-dark">
                  {formatOptionTime(option.target, now)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Button label="取消" variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
