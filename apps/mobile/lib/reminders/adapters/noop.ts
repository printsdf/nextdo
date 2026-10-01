/**
 * Plain-web no-op adapter (R6 / D1): the browser is a dev surface — the
 * snooze / clarify flows keep working (the reminder rows are written to
 * the local DB as usual), nothing is delivered, and the Settings block
 * says so (the `platform: 'web'` drives its copy). Every method is a
 * safe no-op; `permission()` reports "denied" so no caller ever tries to
 * schedule.
 */
import type { DeliveryAdapter, ReminderPermissionState } from './types';

const PERMISSION: ReminderPermissionState = {
  platform: 'web',
  status: 'denied',
  canAskAgain: false,
};

export function createNoopAdapter(): DeliveryAdapter {
  return {
    platform: 'web',
    async init(): Promise<void> {},
    async listPendingIds(): Promise<Set<string>> {
      return new Set();
    },
    async apply(): Promise<void> {},
    async permission(): Promise<ReminderPermissionState> {
      return PERMISSION;
    },
    async requestPermission(): Promise<ReminderPermissionState> {
      return PERMISSION;
    },
    async openSystemSettings(): Promise<void> {},
    dispose(): void {},
  };
}
