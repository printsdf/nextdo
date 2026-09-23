/**
 * Chinese labels for project statuses (Projects tab, project detail,
 * weekly review — one home for the mapping).
 */
import type { ProjectStatus } from '@nextdo/core';

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: '进行中',
  'on-hold': '搁置',
  done: '已完成',
  dropped: '已放弃',
};
