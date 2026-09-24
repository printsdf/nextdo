import { View } from 'react-native';

import { cn } from '../lib/cn';

export interface ProgressBarProps {
  /** Fill ratio, clamped to [0, 1] (e.g. completed / total actions). */
  value: number;
  /** Optional extra classes for screen-specific layout (built with `cn`). */
  className?: string;
}

/**
 * Thin linear progress — Paper Serenity: terracotta fill on a border-color
 * track, fully rounded. Shared by the project completion bar (done/total)
 * and the clarify step progress. The value is exposed to assistive tech via
 * the progressbar role (width is never the only signal).
 */
export function ProgressBar({ value, className }: ProgressBarProps) {
  const clamped = Math.min(1, Math.max(0, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 1, now: clamped }}
      className={cn(
        'h-1.5 w-full overflow-hidden rounded-full bg-border dark:bg-border-dark',
        className,
      )}
    >
      <View
        className="h-full rounded-full bg-accent dark:bg-accent-dark"
        style={{ width: `${clamped * 100}%` }}
      />
    </View>
  );
}
