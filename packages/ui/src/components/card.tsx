import type { ReactNode } from 'react';
import { View } from 'react-native';

import { cn } from '../lib/cn';

export interface CardProps {
  children: ReactNode;
  /** Optional extra classes for screen-specific layout (built with `cn`). */
  className?: string;
}

/** Surface card — the basic content container for list rows and Now. */
export function Card({ children, className }: CardProps) {
  return (
    <View
      className={cn(
        'rounded-md border border-border bg-surface p-4 dark:border-border-dark dark:bg-surface-dark',
        className,
      )}
    >
      {children}
    </View>
  );
}
