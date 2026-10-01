/**
 * DateTimePicker — cross-platform date/time selection modal.
 *
 * Design:
 * - 'datetime' mode: Clean hero readout & relative distance + 7-day week
 *   strip (all 7 days visible simultaneously) + dual Hour & Minute wheels
 *   with center lens + quick minute presets (:00, :15, :30, :45);
 * - 'time' mode: Clean digital clock + Hour & Minute wheels with center lens;
 * - 'date' mode: Minimalist 年 / 月 / 日 pill grids;
 * - Real-time relative distance tag (约 X 分钟后 / 已早于当前时刻);
 * - 100% cross-platform React Native + Web; deterministic in tests.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Button, cn } from '@nextdo/ui';

const pad = (n: number): string => String(n).padStart(2, '0');

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DATETIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

const DAY_OFFSETS = Array.from({ length: 7 }, (_, i) => i);
const DAY_MS = 86_400_000;

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const MINUTE_PRESETS = [0, 15, 30, 45];

const ITEM_HEIGHT = 36; // 36px (h-9)

function dayOffsetOf(now: Date, target: Date): number {
  const midnight = (d: Date): number => {
    const m = new Date(d);
    m.setHours(0, 0, 0, 0);
    return m.getTime();
  };
  const offset = Math.round((midnight(target) - midnight(now)) / DAY_MS);
  return Math.min(6, Math.max(0, offset));
}

function dayLabel(now: Date, offset: number): string {
  if (offset === 0) return '今天';
  if (offset === 1) return '明天';
  if (offset === 2) return '后天';
  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
  const day = new Date(now);
  day.setDate(day.getDate() + offset);
  return `周${WEEKDAYS[day.getDay()]}`;
}

function daySublabel(now: Date, offset: number): string {
  const day = new Date(now);
  day.setDate(day.getDate() + offset);
  return `${day.getMonth() + 1}/${day.getDate()}`;
}

function formatRelativeDiff(now: Date, target: Date): string {
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return '已早于当前时刻';
  const diffMinutes = Math.round(diffMs / 60_000);
  if (diffMinutes < 60) return `约 ${diffMinutes} 分钟后`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `约 ${diffHours} 小时后`;
  const diffDays = Math.round(diffHours / 24);
  return `约 ${diffDays} 天后`;
}

export interface DateTimePickerProps {
  mode: 'date' | 'time' | 'datetime';
  title: string;
  value: string;
  now: Date;
  onConfirm: (value: string) => void;
  onClose: () => void;
}

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
        'h-8 min-w-10 items-center justify-center rounded-xl px-2.5',
        active
          ? 'bg-accent shadow-xs dark:bg-accent-dark'
          : 'bg-surface-container/50 active:bg-surface-container dark:bg-surface-container-dark/50 dark:active:bg-surface-container-dark',
      )}
    >
      <Text
        className={cn(
          'font-sans text-xs',
          active
            ? 'font-bold text-on-accent dark:text-on-accent-dark'
            : 'text-ink dark:text-ink-dark',
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="gap-1.5">
      <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">{label}</Text>
      <View className="flex-row flex-wrap gap-1.5">{children}</View>
    </View>
  );
}

export function DateTimePicker({ mode, title, value, now, onConfirm, onClose }: DateTimePickerProps) {
  const dateMatch = mode === 'date' ? DATE_ONLY.exec(value) : null;
  const timeMatch = mode === 'time' ? HHMM.exec(value) : null;
  const dateTimeMatch = mode === 'datetime' ? DATETIME_LOCAL.exec(value) : null;

  const [year, setYear] = useState(() =>
    dateMatch !== null ? Number(dateMatch[1]) : now.getFullYear(),
  );
  const [month, setMonth] = useState(() =>
    dateMatch !== null ? Number(dateMatch[2]) : now.getMonth() + 1,
  );
  const [day, setDay] = useState(() => (dateMatch !== null ? Number(dateMatch[3]) : now.getDate()));
  const [hour, setHour] = useState(() => {
    if (timeMatch !== null) return Number(timeMatch[1]);
    if (dateTimeMatch !== null) return Number(dateTimeMatch[4]);
    return now.getHours();
  });
  const [minute, setMinute] = useState(() => {
    if (timeMatch !== null) return Number(timeMatch[2]);
    if (dateTimeMatch !== null) return Number(dateTimeMatch[5]);
    return now.getMinutes();
  });
  const [dayOffset, setDayOffset] = useState(() => {
    if (dateTimeMatch === null) return 0;
    return dayOffsetOf(
      now,
      new Date(Number(dateTimeMatch[1]), Number(dateTimeMatch[2]) - 1, Number(dateTimeMatch[3])),
    );
  });

  const hourScrollRef = useRef<ScrollView>(null);
  const minuteScrollRef = useRef<ScrollView>(null);

  // Auto-scroll the hour/minute lists into center lens on mount
  useEffect(() => {
    if (mode === 'date') return;
    const timer = setTimeout(() => {
      hourScrollRef.current?.scrollTo({
        y: hour * ITEM_HEIGHT,
        animated: false,
      });
      minuteScrollRef.current?.scrollTo({
        y: minute * ITEM_HEIGHT,
        animated: false,
      });
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  const daysInMonth = new Date(year, month, 0).getDate();
  const years: number[] = [];
  for (let y = now.getFullYear() - 2; y <= now.getFullYear() + 5; y++) {
    years.push(y);
  }

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

  function selectHour(h: number) {
    setHour(h);
    hourScrollRef.current?.scrollTo({
      y: h * ITEM_HEIGHT,
      animated: true,
    });
  }

  function selectMinute(m: number) {
    setMinute(m);
    minuteScrollRef.current?.scrollTo({
      y: m * ITEM_HEIGHT,
      animated: true,
    });
  }

  function confirm() {
    if (mode === 'datetime') {
      const date = new Date(now);
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() + dayOffset);
      date.setHours(hour, minute, 0, 0);
      onConfirm(
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`,
      );
    } else {
      onConfirm(mode === 'time' ? `${pad(hour)}:${pad(minute)}` : `${year}-${pad(month)}-${pad(day)}`);
    }
    onClose();
  }

  // Compute live target preview
  let relativeHint = '';
  let isPast = false;
  if (mode === 'datetime') {
    const target = new Date(now);
    target.setHours(0, 0, 0, 0);
    target.setDate(target.getDate() + dayOffset);
    target.setHours(hour, minute, 0, 0);
    isPast = target.getTime() <= now.getTime();
    relativeHint = formatRelativeDiff(now, target);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/50 px-4 py-6">
        {/* Backdrop dismiss */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭选择器"
          className="absolute inset-0"
          onPress={onClose}
        />

        <View className="relative z-10 w-full max-w-sm rounded-3xl border border-border/80 bg-surface p-5 shadow-2xl dark:border-border-dark/80 dark:bg-surface-dark">
          {/* Header bar: Title & Close */}
          <View className="mb-3.5 flex-row items-center justify-between">
            <Text className="font-sans text-base font-bold text-ink dark:text-ink-dark">
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭"
              onPress={onClose}
              className="h-7 w-7 items-center justify-center rounded-full bg-surface-container/60 active:bg-surface-container dark:bg-surface-container-dark/60"
            >
              <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">✕</Text>
            </Pressable>
          </View>

          {/* Hero Selection Preview */}
          <View className="mb-3.5 flex-row items-center justify-between rounded-2xl border border-border/40 bg-surface-container/50 px-4 py-3 dark:border-border-dark/40 dark:bg-surface-container-dark/50">
            {mode === 'datetime' ? (
              <>
                <View className="flex-row items-baseline gap-2.5">
                  <Text className="font-sans text-3xl font-extrabold tracking-tight text-ink dark:text-ink-dark">
                    {pad(hour)}:{pad(minute)}
                  </Text>
                  <View className="flex-row items-center gap-1">
                    <Text className="font-sans text-sm font-bold text-accent dark:text-accent-dark">
                      {dayLabel(now, dayOffset)}
                    </Text>
                    <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                      {daySublabel(now, dayOffset)}
                    </Text>
                  </View>
                </View>
                <View
                  className={cn(
                    'rounded-full border px-2.5 py-1',
                    isPast
                      ? 'border-danger/30 bg-danger/10'
                      : 'border-accent/25 bg-accent/10 dark:border-accent-dark/30 dark:bg-accent-dark/15',
                  )}
                >
                  <Text
                    className={cn(
                      'font-sans text-xs font-bold',
                      isPast
                        ? 'text-danger dark:text-danger-dark'
                        : 'text-accent dark:text-accent-dark',
                    )}
                  >
                    {relativeHint}
                  </Text>
                </View>
              </>
            ) : mode === 'time' ? (
              <View className="w-full flex-row items-baseline justify-between">
                <Text className="font-sans text-3xl font-extrabold tracking-tight text-ink dark:text-ink-dark">
                  {pad(hour)}:{pad(minute)}
                </Text>
                <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                  指定时间
                </Text>
              </View>
            ) : (
              <View className="w-full flex-row items-baseline justify-between">
                <Text className="font-sans text-xl font-bold tracking-tight text-ink dark:text-ink-dark">
                  {year}年{pad(month)}月{pad(day)}日
                </Text>
                <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                  已选日期
                </Text>
              </View>
            )}
          </View>

          {/* Mode content */}
          {mode === 'date' ? (
            <View className="gap-3">
              <Row label="年">
                {years.map((y) => (
                  <Cell
                    key={y}
                    label={String(y)}
                    a11y={`年 ${y}`}
                    active={year === y}
                    onPress={() => pickYear(y)}
                  />
                ))}
              </Row>
              <Row label="月">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <Cell
                    key={m}
                    label={`${m}月`}
                    a11y={`月 ${m}`}
                    active={month === m}
                    onPress={() => pickMonth(m)}
                  />
                ))}
              </Row>
              <Row label="日">
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
                  <Cell
                    key={d}
                    label={String(d)}
                    a11y={`日 ${d}`}
                    active={day === d}
                    onPress={() => setDay(d)}
                  />
                ))}
              </Row>
            </View>
          ) : (
            <View className="gap-3">
              {/* Day horizontal strip (datetime mode only: all 7 days fit in 1 row) */}
              {mode === 'datetime' ? (
                <View className="flex-row gap-1">
                  {DAY_OFFSETS.map((offset) => {
                    const active = dayOffset === offset;
                    return (
                      <Pressable
                        key={offset}
                        accessibilityRole="button"
                        accessibilityLabel={`日 ${dayLabel(now, offset)}`}
                        accessibilityState={{ selected: active }}
                        onPress={() => setDayOffset(offset)}
                        className={cn(
                          'h-12 flex-1 items-center justify-center gap-0.5 rounded-xl py-1',
                          active
                            ? 'bg-accent shadow-xs dark:bg-accent-dark'
                            : 'bg-surface-container/50 active:bg-surface-container dark:bg-surface-container-dark/50 dark:active:bg-surface-container-dark',
                        )}
                      >
                        <Text
                          className={cn(
                            'font-sans text-xs',
                            active
                              ? 'font-bold text-on-accent dark:text-on-accent-dark'
                              : 'font-semibold text-ink dark:text-ink-dark',
                          )}
                        >
                          {dayLabel(now, offset)}
                        </Text>
                        <Text
                          className={cn(
                            'font-sans text-[10px]',
                            active
                              ? 'font-medium text-on-accent/90 dark:text-on-accent-dark/90'
                              : 'text-muted dark:text-muted-dark',
                          )}
                        >
                          {daySublabel(now, offset)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              {/* Time selection: Wheel columns with center lens */}
              <View>
                {/* Column Headers */}
                <View className="mb-1 flex-row items-center justify-around px-4">
                  <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                    时 (00-23)
                  </Text>
                  <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                    分 (00-59)
                  </Text>
                </View>

                {/* Wheel box */}
                <View className="relative h-[180px] overflow-hidden rounded-2xl border border-border/60 bg-surface-container/30 dark:border-border-dark/60 dark:bg-surface-container-dark/30">
                  {/* Center selection lens */}
                  <View
                    pointerEvents="none"
                    className="absolute left-2 right-2 top-[72px] h-9 rounded-xl border border-accent/20 bg-accent/10 dark:border-accent-dark/25 dark:bg-accent-dark/15"
                  />

                  <View className="h-[180px] flex-row items-stretch">
                    {/* Hour Column */}
                    <ScrollView
                      ref={hourScrollRef}
                      className="h-full flex-1"
                      style={{ height: 180 }}
                      showsVerticalScrollIndicator={false}
                      nestedScrollEnabled
                      snapToInterval={ITEM_HEIGHT}
                      decelerationRate="fast"
                      scrollEventThrottle={16}
                      contentContainerStyle={{ paddingTop: 72, paddingBottom: 72 }}
                      onScroll={(e) => {
                        const h = Math.min(23, Math.max(0, Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT)));
                        setHour(h);
                      }}
                      onMomentumScrollEnd={(e) => {
                        const h = Math.min(23, Math.max(0, Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT)));
                        setHour(h);
                      }}
                    >
                      {HOURS.map((h) => {
                        const active = hour === h;
                        return (
                          <Pressable
                            key={h}
                            accessibilityRole="button"
                            accessibilityLabel={`小时 ${pad(h)}`}
                            accessibilityState={{ selected: active }}
                            onPress={() => selectHour(h)}
                            className="h-9 items-center justify-center"
                          >
                            <Text
                              className={cn(
                                'font-sans',
                                active
                                  ? 'text-base font-extrabold text-accent dark:text-accent-dark'
                                  : 'text-sm font-medium text-ink/45 dark:text-ink-dark/45',
                              )}
                            >
                              {pad(h)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>

                    {/* Divider */}
                    <View className="w-6 items-center justify-center">
                      <Text className="font-sans text-xl font-black text-ink/30 dark:text-ink-dark/30 pb-0.5">
                        :
                      </Text>
                    </View>

                    {/* Minute Column */}
                    <ScrollView
                      ref={minuteScrollRef}
                      className="h-full flex-1"
                      style={{ height: 180 }}
                      showsVerticalScrollIndicator={false}
                      nestedScrollEnabled
                      snapToInterval={ITEM_HEIGHT}
                      decelerationRate="fast"
                      scrollEventThrottle={16}
                      contentContainerStyle={{ paddingTop: 72, paddingBottom: 72 }}
                      onScroll={(e) => {
                        const m = Math.min(59, Math.max(0, Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT)));
                        setMinute(m);
                      }}
                      onMomentumScrollEnd={(e) => {
                        const m = Math.min(59, Math.max(0, Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT)));
                        setMinute(m);
                      }}
                    >
                      {MINUTES.map((m) => {
                        const active = minute === m;
                        return (
                          <Pressable
                            key={m}
                            accessibilityRole="button"
                            accessibilityLabel={`分钟 ${pad(m)}`}
                            accessibilityState={{ selected: active }}
                            onPress={() => selectMinute(m)}
                            className="h-9 items-center justify-center"
                          >
                            <Text
                              className={cn(
                                'font-sans',
                                active
                                  ? 'text-base font-extrabold text-accent dark:text-accent-dark'
                                  : 'text-sm font-medium text-ink/45 dark:text-ink-dark/45',
                              )}
                            >
                              {pad(m)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>
                </View>

                {/* Minute Presets */}
                <View className="mt-2.5 flex-row items-center justify-between px-1">
                  <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                    常用分钟
                  </Text>
                  <View className="flex-row items-center gap-1.5">
                    {MINUTE_PRESETS.map((m) => (
                      <Pressable
                        key={m}
                        accessibilityRole="button"
                        accessibilityLabel={`快捷 ${pad(m)}分`}
                        onPress={() => selectMinute(m)}
                        className={cn(
                          'rounded-lg px-2.5 py-1',
                          minute === m
                            ? 'bg-accent shadow-xs dark:bg-accent-dark'
                            : 'bg-surface-container/60 active:bg-surface-container dark:bg-surface-container-dark/60',
                        )}
                      >
                        <Text
                          className={cn(
                            'font-sans text-xs',
                            minute === m
                              ? 'font-bold text-on-accent dark:text-on-accent-dark'
                              : 'font-medium text-ink/75 dark:text-ink-dark/75',
                          )}
                        >
                          :{pad(m)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
            </View>
          )}

          {/* Footer actions */}
          <View className="mt-5 flex-row gap-2.5">
            <View className="flex-1">
              <Button label="取消" variant="secondary" onPress={onClose} />
            </View>
            <View className="flex-1">
              <Button label="确定" onPress={confirm} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
