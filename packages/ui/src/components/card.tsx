import type { ReactNode } from 'react';
import { View } from 'react-native';

import { cn } from '../lib/cn';

export interface CardProps {
  children: ReactNode;
  /** Optional extra classes for screen-specific layout (built with `cn`). */
  className?: string;
}

/**
 * Surface card — Paper Serenity Level 1: pure paper white on the canvas with
 * a 1px warm micro-border (tonal layering over heavy shadows).
 */
export function Card({ children, className }: CardProps) {
  return (
    <View
      className={cn(
        'rounded-2xl border border-border/70 bg-surface p-4 shadow-sm dark:border-border-dark dark:bg-surface-dark',
        className,
      )}
    >
      {children}
    </View>
  );
}
