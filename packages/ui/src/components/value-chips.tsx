import { Pressable, Text, View } from 'react-native';

import { cn } from '../lib/cn';

export interface ValueChipsProps {
  /**
   * The currently selected importance. Typed as the literal 1–5 union
   * (structurally identical to core's `Value`) so a screen's
   * `useState<Value>` setter is directly assignable without a cast.
   */
  value: 1 | 2 | 3 | 4 | 5;
  onChange: (value: 1 | 2 | 3 | 4 | 5) => void;
  /** Field label shown to the left of the chips ("价值（1–5）"). */
  label?: string;
}

/** The 1–5 importance scale, always in this order. */
const VALUES = [1, 2, 3, 4, 5] as const;

/**
 * The 价值（1–5）single-select row — ONE implementation of the CIRCULAR
 * chip variant, shared by five call sites: the Projects tab's
 * new-project form, the project detail screen's three inline action
 * forms (add / edit action, edit project), and the habits screen's
 * create form.
 *
 * Before this component the same circular block was copy-pasted into
 * those five places; the a11y state and the 44pt target are why it
 * cannot drift per copy (component-guidelines: promote a component to
 * `packages/ui` at the second copy-paste).
 *
 * DELIBERATELY NOT the clarify wizard's `ValuePicker`
 * (`apps/mobile/components/clarify-wizard.tsx`): that one is a PILL
 * (`h-8 rounded-full px-3`, auto-width for multi-digit labels) sitting
 * INSIDE a `Field` with the label ABOVE it, not a fixed 32px circle
 * with the label to the left. It is a different visual design that
 * happens to render the same 1–5 scale, not a copy of this component —
 * so it keeps its own implementation (likewise the EST_CHIPS row above
 * it, which selects minutes, not value).
 *
 * Each chip is a 32px circle (h-8 w-8) with a 6pt hitSlop ring → a 44pt
 * tap target, and carries `accessibilityState.selected` because it is a
 * single-select control. Full literal class strings (NativeWind cannot
 * match classes assembled from fragments at runtime).
 */
export function ValueChips({ value, onChange, label = '价值（1–5）' }: ValueChipsProps) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="font-sans text-sm font-medium text-ink dark:text-ink-dark">{label}</Text>
      <View className="flex-row gap-2">
        {VALUES.map((chip) => (
          <Pressable
            key={chip}
            accessibilityRole="button"
            accessibilityLabel={`价值 ${chip}`}
            accessibilityState={{ selected: value === chip }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            onPress={() => {
              onChange(chip);
            }}
            className={cn(
              'h-8 w-8 items-center justify-center rounded-full',
              value === chip
                ? 'bg-accent dark:bg-accent-dark'
                : 'border border-border/80 bg-surface dark:border-border-dark dark:bg-surface-dark',
            )}
          >
            <Text
              className={cn(
                'font-sans text-sm font-semibold',
                value === chip
                  ? 'text-on-accent dark:text-on-accent-dark'
                  : 'text-ink dark:text-ink-dark',
              )}
            >
              {chip}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
