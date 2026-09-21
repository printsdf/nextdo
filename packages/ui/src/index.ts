/**
 * @nextdo/ui — design tokens + shared cross-platform components.
 *
 * The package's single entrypoint; every public symbol is re-exported
 * explicitly (spec: project/directory-structure.md Rule 3;
 * project/conventions.md §Exports).
 *
 * Component list is exactly what the mobile shell uses (design.md §5 — no
 * speculative components): Button, Card, Tag, EmptyState.
 */
export { cn } from './lib/cn';
export { Button } from './components/button';
export type { ButtonProps } from './components/button';
export { Card } from './components/card';
export type { CardProps } from './components/card';
export { Tag } from './components/tag';
export type { TagProps, TagTone } from './components/tag';
export { EmptyState } from './components/empty-state';
export type { EmptyStateProps } from './components/empty-state';
export { colors, radii, spacing, typography } from './tokens';
export type {
  ColorToken,
  RadiusToken,
  SpacingToken,
  TypographyToken,
} from './tokens';
