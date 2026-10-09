/**
 * Upload rejection store (dead-letter queue for sync validation errors).
 *
 * When the PowerSync backend rejects an op during POST /upload (e.g. unknown
 * table, append-only violation, malformed payload), it returns HTTP 200 with
 * a `rejected[]` payload to allow the local client queue to advance.
 *
 * To avoid silently dropping changes, this module persists rejected ops
 * locally so users or diagnostics can surface "sync abnormal" warnings.
 */
import { getStorageBackend, type KeyValueStore } from './owner-token';

export const UPLOAD_REJECTIONS_KEY = 'nextdo.sync.upload-rejections';
const MAX_RETAINED_REJECTIONS = 50;

export interface UploadRejectedOp {
  /** Op index in the upload transaction batch. */
  index: number;
  /** Rejection error code (e.g. 'upload.append-only', 'upload.unknown-table'). */
  code: string;
  /** Error explanation message from server. */
  message: string;
  /** Affected table name if available. */
  table?: string;
  /** Primary key ID if available. */
  id?: string;
  /** ISO timestamp when client received the rejection. */
  timestamp: string;
  /** The local op payload that was rejected, if available. */
  opData?: Record<string, unknown> | null;
}

type RejectionListener = (rejections: UploadRejectedOp[]) => void;
const listeners = new Set<RejectionListener>();

let memoryFallback: UploadRejectedOp[] = [];

/** Read recent upload rejections from local storage. */
export async function getRecentUploadRejections(store?: KeyValueStore): Promise<UploadRejectedOp[]> {
  try {
    const s = store ?? (await getStorageBackend());
    const raw = await s.getItem(UPLOAD_REJECTIONS_KEY);
    if (!raw) return [...memoryFallback];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as UploadRejectedOp[];
    }
  } catch {
    // Fall back to in-memory state on parse/storage error
  }
  return [...memoryFallback];
}

/** Record new rejected ops, appending to recent history and capping size. */
export async function recordUploadRejections(
  rejections: UploadRejectedOp[],
  store?: KeyValueStore,
): Promise<void> {
  if (rejections.length === 0) return;

  const current = await getRecentUploadRejections(store);
  const updated = [...current, ...rejections].slice(-MAX_RETAINED_REJECTIONS);
  memoryFallback = updated;

  try {
    const s = store ?? (await getStorageBackend());
    await s.setItem(UPLOAD_REJECTIONS_KEY, JSON.stringify(updated));
  } catch {
    // Keep in memory if persistent storage fails
  }

  for (const listener of listeners) {
    try {
      listener(updated);
    } catch {
      // Listener errors do not block storage
    }
  }
}

/** Clear all stored upload rejections (e.g. user acknowledged the error). */
export async function clearUploadRejections(store?: KeyValueStore): Promise<void> {
  memoryFallback = [];
  try {
    const s = store ?? (await getStorageBackend());
    await s.removeItem(UPLOAD_REJECTIONS_KEY);
  } catch {
    // Ignore error
  }

  for (const listener of listeners) {
    try {
      listener([]);
    } catch {
      // Ignore error
    }
  }
}

/** Subscribe to upload rejection updates. Returns an unsubscribe function. */
export function subscribeToUploadRejections(listener: RejectionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
