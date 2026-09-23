/**
 * Chinese labels for the three action kinds (Now screen, Focus screen,
 * project detail — one home for the mapping).
 */
import type { CandidateKind } from '@nextdo/core';

export const KIND_LABELS: Record<CandidateKind, string> = {
  next: '下一步行动',
  habit: '习惯',
  calendar: '日程',
};
