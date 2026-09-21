import { Text, View } from 'react-native';

import { cn } from '../lib/cn';

export type TagTone = 'neutral' | 'accent' | 'warning' | 'danger';

export interface TagProps {
  label: string;
  tone?: TagTone;
}

const TONE_CLASSES: Record<TagTone, string> = {
  neutral: 'bg-border/60 text-ink dark:bg-border-dark dark:text-ink-dark',
  accent: 'bg-accent/15 text-accent dark:bg-accent-dark/20 dark:text-accent-dark',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
};

/** Small non-interactive label chip (status, kind, flags). */
export function Tag({ label, tone = 'neutral' }: TagProps) {
  return (
    <View
      accessibilityRole="text"
      className={cn('h-5 items-center justify-center rounded-full px-2', TONE_CLASSES[tone])}
    >
      <Text className="text-xs" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
