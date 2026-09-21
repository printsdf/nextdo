/**
 * Per-device sync state (sync_state table).
 *
 * `pendingChanges` is the count of local operations not yet acked by
 * the server.
 */
export interface SyncState {
  id: string;
  deviceId: string;
  lastSyncedAt: string;
  pendingChanges: number;
}
