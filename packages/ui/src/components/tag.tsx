import { Text, View } from 'react-native';

import { cn } from '../lib/cn';

export type TagTone = 'neutral' | 'accent' | 'warning' | 'danger';

export interface TagProps {
  label: string;
  tone?: TagTone;
  className?: string;
}

const BG_CLASSES: Record<TagTone, string> = {
  neutral: 'bg-border/60 dark:bg-border-dark',
  accent: 'bg-accent/15 dark:bg-accent-dark/20',
  warning: 'bg-warning/15',
  danger: 'bg-danger/15',
};

const TEXT_CLASSES: Record<TagTone, string> = {
  neutral: 'text-ink dark:text-ink-dark font-medium',
  accent: 'text-accent dark:text-accent-dark font-medium',
  warning: 'text-warning font-medium',
  danger: 'text-danger font-medium',
};

/** Small non-interactive label chip (status, kind, flags) — iOS pill style. */
export function Tag({ label, tone = 'neutral', className }: TagProps) {
  return (
    <View
      accessibilityRole="text"
      className={cn('h-6 items-center justify-center rounded-full px-2.5', BG_CLASSES[tone], className)}
    >
      <Text className={cn('text-xs', TEXT_CLASSES[tone])} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
