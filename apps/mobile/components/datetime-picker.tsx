/**
 * DateTimePicker — cross-platform date/time selection modal (user feedback
 * round 2, design §15): the wizard forms must not force the user to hand-type
 * 'YYYY-MM-DD' / 'HH:mm' strings. The community native picker
 * (@react-native-community/datetimepicker) renders NOTHING on web — and the
 * web build is the desktop surface — so this is a pure React Native modal
 * instead: tap chips in a grid (年/月/日 or 时/分), then 确定.
 *
 * - identical UI on every platform (no native module, no per-Platform
 *   branches); deterministic in tests;
 * - value contract = the strings the clarify-flow state machine already
 *   stores: mode 'date' → 'YYYY-MM-DD', mode 'time' → 'HH:mm';
 * - the app clock comes in as `now` (hook-guidelines Rule 4 — no Date.now()
 *   here); it seeds the selection when the field is unset.
 *
 * Modal shell follows the app convention (quick-capture-modal): transparent
 * backdrop (tap to dismiss) + a centered card.
 */
import { useState, type ReactNode } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Button, cn } from '@nextdo/ui';

const pad = (n: number): string => String(n).padStart(2, '0');

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export interface DateTimePickerProps {
  mode: 'date' | 'time';
  /** The modal's title (开始日期 / 开始时间 / 截止 / 期望日期). */
  title: string;
  /** The stored value ('' = unset — the selection defaults from `now`). */
  value: string;
  /** The single app clock (hook-guidelines Rule 4). */
  now: Date;
  onConfirm: (value: string) => void;
  onClose: () => void;
}

/** One tappable grid cell. Selected = filled (the same active/idle idiom as
 *  the wizard's Chip); the fill plus the accessibility state carry the
 *  selection, so color is never the only signal. */
function Cell({
  label,
  a11y,
  active,
  onPress,
}: {
  label: string;
  a11y: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={cn(
        'h-8 w-11 items-center justify-center rounded-full',
        active
          ? 'bg-accent dark:bg-accent-dark'
          : 'border border-border bg-surface dark:border-border-dark dark:bg-surface-dark',
      )}
    >
      <Text
        className={cn(
          'font-sans text-xs',
          active ? 'text-on-accent dark:text-on-accent-dark' : 'text-ink dark:text-ink-dark',
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="font-sans text-xs font-medium text-muted dark:text-muted-dark">{label}</Text>
      <View className="flex-row flex-wrap gap-1.5">{children}</View>
    </View>
  );
}

export function DateTimePicker({ mode, title, value, now, onConfirm, onClose }: DateTimePickerProps) {
  // Seed the selection from the stored value; unset → the app clock.
  const dateMatch = mode === 'date' ? DATE_ONLY.exec(value) : null;
  const timeMatch = mode === 'time' ? HHMM.exec(value) : null;

  const [year, setYear] = useState(() =>
    dateMatch !== null ? Number(dateMatch[1]) : now.getFullYear(),
  );
  const [month, setMonth] = useState(() =>
    dateMatch !== null ? Number(dateMatch[2]) : now.getMonth() + 1,
  );
  const [day, setDay] = useState(() => (dateMatch !== null ? Number(dateMatch[3]) : now.getDate()));
  const [hour, setHour] = useState(() => (timeMatch !== null ? Number(timeMatch[1]) : now.getHours()));
  const [minute, setMinute] = useState(() =>
    timeMatch !== null ? Number(timeMatch[2]) : now.getMinutes(),
  );

  const daysInMonth = new Date(year, month, 0).getDate();
  const years: number[] = [];
  for (let y = now.getFullYear() - 2; y <= now.getFullYear() + 5; y++) {
    years.push(y);
  }

  // Month/year changes can shrink the day (Feb 31 → Feb 28/29).
  function pickYear(nextYear: number) {
    setYear(nextYear);
    const limit = new Date(nextYear, month, 0).getDate();
    if (day > limit) setDay(limit);
  }

  function pickMonth(nextMonth: number) {
    setMonth(nextMonth);
    const limit = new Date(year, nextMonth, 0).getDate();
    if (day > limit) setDay(limit);
  }

  function confirm() {
    onConfirm(mode === 'time' ? `${pad(hour)}:${pad(minute)}` : `${year}-${pad(month)}-${pad(day)}`);
    onClose();
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/40 px-4">
        {/* Backdrop dismiss */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭选择器"
          className="absolute inset-0"
          onPress={onClose}
        />

        <View className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl dark:border-border-dark dark:bg-surface-dark">
          <View className="mb-4">
            <Text className="font-sans text-base font-semibold text-ink dark:text-ink-dark">{title}</Text>
          </View>

          {mode === 'date' ? (
            <View className="gap-3">
              <Row label="年">
                {years.map((y) => (
                  <Cell key={y} label={String(y)} a11y={`年 ${y}`} active={year === y} onPress={() => pickYear(y)} />
                ))}
              </Row>
              <Row label="月">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <Cell key={m} label={`${m}月`} a11y={`月 ${m}`} active={month === m} onPress={() => pickMonth(m)} />
                ))}
              </Row>
              <Row label="日">
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
                  <Cell key={d} label={String(d)} a11y={`日 ${d}`} active={day === d} onPress={() => setDay(d)} />
                ))}
              </Row>
            </View>
          ) : (
            <View className="gap-3">
              <Row label="时">
                {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                  <Cell key={h} label={pad(h)} a11y={`小时 ${pad(h)}`} active={hour === h} onPress={() => setHour(h)} />
                ))}
              </Row>
              <Row label="分">
                {Array.from({ length: 60 }, (_, i) => i).map((m) => (
                  <Cell key={m} label={pad(m)} a11y={`分钟 ${pad(m)}`} active={minute === m} onPress={() => setMinute(m)} />
                ))}
              </Row>
            </View>
          )}

          <View className="mt-4 flex-row gap-2.5">
            <View className="flex-1">
              <Button label="确定" onPress={confirm} />
            </View>
            <View className="flex-1">
              <Button label="取消" variant="secondary" onPress={onClose} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
