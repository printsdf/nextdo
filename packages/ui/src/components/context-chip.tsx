import { Pressable, Text, View } from 'react-native';

import { cn } from '../lib/cn';

export interface ContextChipProps {
  /** The context's display name (e.g. "home", "office") — also its tone key. */
  name: string;
  /** Selected state (selector usage): an accent border on top of the earth tone. */
  active?: boolean;
  /** When provided the chip is a tappable selector; otherwise it is read-only. */
  onPress?: () => void;
  /** Optional extra classes for screen-specific layout (built with `cn`). */
  className?: string;
}

/**
 * The five earthy chip tones (Paper Serenity "Context & Status Badges").
 * Full literal class strings — NativeWind only recognizes complete class
 * names, never fragments assembled at runtime. Each entry carries the
 * container background AND the label color; both are applied to the Text as
 * well, because native runtimes do not cascade text styles from a container.
 */
const EARTH_TONE_CLASSES = [
  'bg-tag-earth-1-bg text-tag-earth-1-text',
  'bg-tag-earth-2-bg text-tag-earth-2-text',
  'bg-tag-earth-3-bg text-tag-earth-3-text',
  'bg-tag-earth-4-bg text-tag-earth-4-text',
  'bg-tag-earth-5-bg text-tag-earth-5-text',
] as const;

/**
 * Stable tone for a context name (djb2 hash → one of the five earth tones).
 * Pure and deterministic: the same name always maps to the same tone, so
 * user-created contexts get a color too.
 */
export function contextTone(name: string): number {
  let hash = 5381;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 33 + name.charCodeAt(i)) >>> 0;
  }
  return hash % EARTH_TONE_CLASSES.length;
}

/**
 * Context chip — Paper Serenity badge geometry (22px pill, 11px / weight 500
 * label) in one of the five earth tones chosen by `contextTone(name)`.
 *
 * With `onPress`: a selector (accessibility role button, 44pt target via
 * hitSlop around the 22px visual height). Without: a read-only row chip.
 */
export function ContextChip({ name, active, onPress, className }: ContextChipProps) {
  const tone = EARTH_TONE_CLASSES[contextTone(name)] ?? EARTH_TONE_CLASSES[0];
  const chipClass = cn(
    'h-[22px] items-center justify-center rounded-full px-2',
    tone,
    active && 'border border-accent dark:border-accent-dark',
    className,
  );
  const label = (
    <Text className={cn('text-[11px] font-medium', tone)} numberOfLines={1}>
      {name}
    </Text>
  );
  if (onPress === undefined) {
    return (
      <View accessibilityRole="text" className={chipClass}>
        {label}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`选择情境：${name}`}
      accessibilityState={{ selected: active === true }}
      hitSlop={{ top: 11, bottom: 11, left: 4, right: 4 }}
      onPress={onPress}
      className={chipClass}
    >
      {label}
    </Pressable>
  );
}
