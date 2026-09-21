/**
 * /upload apply logic (spec: app/database-guidelines.md "PowerSync Rules"
 * + "Upload conflict policy v1").
 *
 * THE CONTRACT — the client connector (packages/db/src/powersync.ts,
 * source of truth) expects:
 *   - body: `{ ops: [{ op, id, table, opData }] }` — one entry per ps_crud
 *     op (`op` = PUT | PATCH | DELETE; `opData` is `null` for DELETE).
 *   - 2xx-ON-REJECTION: the endpoint answers 2xx both when ops are applied
 *     AND for validation-level rejections (unknown table, append-only
 *     PATCH/DELETE, malformed op — rejected ops are NOT applied). The
 *     client advances its upload queue on 2xx and blocks + retries on any
 *     non-2xx, so:
 *       - never 4xx for a rejected op (the queue would block forever on a
 *         permanent problem);
 *       - 5xx ONLY for transient/server failures (DB down, etc.).
 *   - The batch applies in ONE transaction: rejected ops are skipped, the
 *     rest commit; a SQL failure rolls the whole batch back → 5xx → the
 *     client retries the batch (all statements are idempotent upserts /
 *     inserts, so the retry is safe).
 *
 * Rejection detail is reported in the 2xx response body (`rejected[]`) —
 * the client ignores the body; surfacing it to the user via sync tables
 * is a forward seam, not part of v1.
 */
import {
  APPEND_ONLY_TABLES,
  MUTABLE_TABLES,
  buildInsertOnly,
  buildSoftDelete,
  buildUpsert,
  type DbClient,
} from './db.js';

const CRUD_OPS = ['PUT', 'PATCH', 'DELETE'] as const;
export type CrudOpType = (typeof CRUD_OPS)[number];

/** Stable rejection codes (convention: typed codes, no message parsing). */
export const REJECT_MALFORMED_OP = 'upload.malformed-op';
export const REJECT_UNKNOWN_TABLE = 'upload.unknown-table';
export const REJECT_APPEND_ONLY = 'upload.append-only';

/** One upload op as received (every field untrusted — narrowed here). */
export interface RejectedOp {
  /** Position of the op in the submitted `ops` array. */
  index: number;
  code: string;
  message: string;
  table?: string;
  id?: string;
}

export interface UploadOutcome {
  /** Ops applied to Postgres (incl. no-ops). */
  applied: number;
  /** Validation-level rejections — NOT applied, but the response is 2xx. */
  rejected: RejectedOp[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCrudOp(value: unknown): value is CrudOpType {
  return typeof value === 'string' && (CRUD_OPS as readonly string[]).includes(value);
}

/**
 * Validate the POST /upload JSON body. Returns null on a protocol-level
 * problem (not an object / `ops` not an array) — the caller answers 400
 * (a consistently malformed body will not heal by retrying, so blocking
 * the client queue is the correct outcome).
 */
export function parseUploadBody(body: unknown): { ops: readonly unknown[] } | null {
  if (!isRecord(body) || !Array.isArray(body.ops)) {
    return null;
  }
  return { ops: body.ops };
}

/**
 * Apply one crud batch on the given client (the caller runs it inside
 * `withTransaction`). Never throws for validation-level problems — those
 * become entries in `rejected`; it throws ONLY when a SQL statement fails
 * (transient/server failure → the transaction rolls back → 5xx).
 */
export async function applyCrudBatch(
  client: DbClient,
  ops: readonly unknown[],
  now: Date,
): Promise<UploadOutcome> {
  const rejected: RejectedOp[] = [];
  let applied = 0;
  const nowIso = now.toISOString();

  for (let i = 0; i < ops.length; i++) {
    const raw = ops[i];
    const entryTable = isRecord(raw) && typeof raw.table === 'string' ? raw.table : undefined;
    const entryId = isRecord(raw) && typeof raw.id === 'string' ? raw.id : undefined;
    const reject = (code: string, message: string): void => {
      rejected.push({ index: i, code, message, table: entryTable, id: entryId });
    };

    if (!isRecord(raw)) {
      reject(REJECT_MALFORMED_OP, `ops[${i}] is not an object`);
      continue;
    }
    if (!isCrudOp(raw.op)) {
      reject(REJECT_MALFORMED_OP, `ops[${i}].op must be PUT, PATCH or DELETE`);
      continue;
    }
    const op = raw.op;
    const id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : undefined;
    const table = typeof raw.table === 'string' && raw.table !== '' ? raw.table : undefined;
    if (id === undefined) {
      reject(REJECT_MALFORMED_OP, `ops[${i}].id must be a non-empty string`);
      continue;
    }
    if (table === undefined) {
      reject(REJECT_MALFORMED_OP, `ops[${i}].table must be a non-empty string`);
      continue;
    }

    if (op === 'DELETE') {
      const appendOnly = APPEND_ONLY_TABLES[table];
      if (appendOnly !== undefined) {
        reject(
          REJECT_APPEND_ONLY,
          `ops[${i}]: DELETE is not allowed on append-only table ${table}`,
        );
        continue;
      }
      const mutable = MUTABLE_TABLES[table];
      if (mutable === undefined) {
        reject(REJECT_UNKNOWN_TABLE, `ops[${i}]: unknown table ${table}`);
        continue;
      }
      const stmt = buildSoftDelete(table, id, nowIso);
      await client.query(stmt.text, stmt.values);
      applied += 1;
      continue;
    }

    // PUT / PATCH — opData must be an object.
    if (!isRecord(raw.opData)) {
      reject(REJECT_MALFORMED_OP, `ops[${i}].opData must be an object for ${op}`);
      continue;
    }

    const appendOnly = APPEND_ONLY_TABLES[table];
    if (appendOnly !== undefined) {
      if (op === 'PATCH') {
        reject(
          REJECT_APPEND_ONLY,
          `ops[${i}]: PATCH is not allowed on append-only table ${table}`,
        );
        continue;
      }
      // PUT → insert-only: a duplicate PUT (retries) keeps the first write.
      const stmt = buildInsertOnly(table, appendOnly, id, raw.opData);
      if (stmt === null) {
        applied += 1; // no declared columns present — a no-op, still applied
        continue;
      }
      await client.query(stmt.text, stmt.values);
      applied += 1;
      continue;
    }

    const mutable = MUTABLE_TABLES[table];
    if (mutable === undefined) {
      reject(REJECT_UNKNOWN_TABLE, `ops[${i}]: unknown table ${table}`);
      continue;
    }
    const stmt = buildUpsert(table, mutable, id, raw.opData);
    if (stmt === null) {
      applied += 1; // no declared columns present — a no-op, still applied
      continue;
    }
    await client.query(stmt.text, stmt.values);
    applied += 1;
  }

  return { applied, rejected };
}
