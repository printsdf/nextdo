import { Pressable, Text } from 'react-native';

import { cn } from '../lib/cn';

export interface ButtonProps {
  /** Visible label; also the accessibility label (names the action). */
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
}

const VARIANT_CLASSES: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-accent active:bg-accent/90 dark:bg-accent-dark',
  secondary:
    'border border-border bg-surface active:bg-surface/90 dark:border-border-dark dark:bg-surface-dark',
  ghost: 'bg-transparent',
};

const VARIANT_TEXT_CLASSES: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'text-on-accent',
  secondary: 'text-ink dark:text-ink-dark',
  ghost: 'text-accent dark:text-accent-dark',
};

/**
 * Tappable action button. 44pt tall (touch target, tokens.spacing.touch),
 * labelled for accessibility (component-guidelines).
 */
export function Button({ label, onPress, variant = 'primary', disabled = false }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={cn(
        'h-11 items-center justify-center rounded-md px-4',
        VARIANT_CLASSES[variant],
        disabled && 'opacity-40',
      )}
    >
      <Text className={cn('text-sm font-medium', VARIANT_TEXT_CLASSES[variant])}>{label}</Text>
    </Pressable>
  );
}
