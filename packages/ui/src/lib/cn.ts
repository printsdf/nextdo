/**
 * Class-string joiner (component-guidelines: "Dynamic classes: build the
 * full class string (`cn()` helper in `packages/ui`)"). NativeWind only
 * recognizes complete class strings — never assemble classes from partial
 * fragments at runtime.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts
    .filter((part): part is string => part !== undefined && part !== null && part !== false)
    .join(' ');
}
