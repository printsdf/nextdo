import type { ReactNode } from 'react';
import { View } from 'react-native';

import { cn } from '../lib/cn';

export interface CardProps {
  children: ReactNode;
  /** Optional extra classes for screen-specific layout (built with `cn`). */
  className?: string;
}

/**
 * Surface card — iOS Inset Grouped style.
 * Uses surface background and rounded-2xl with subtle separator border.
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
