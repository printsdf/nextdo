/**
 * Node-only PowerSync test database.
 *
 * Runs the *web* PowerSync client — the same code path the Tauri/desktop
 * build uses — on top of Node's built-in `node:sqlite` module, through the
 * SDK's `{ opened: DBAdapter }` hook (documented for testing). On Node the
 * web SDK auto-detects SSR mode (no `window` global), which skips the
 * browser-only version storage / offline-status lookups and swaps the
 * cross-tab lock for an in-process mutex; the `opened` adapter path is
 * unaffected, so local DB operations run for real. Sync is never started
 * (tests must not call `connect()`).
 *
 * The SDK's internal SQL relies on `powersync_*` functions (`powersync_replace_schema`,
 * `powersync_js_migrated_subkeys`, …) that only exist in the PowerSync build of
 * SQLite — a native C extension, not JS. The extension binary is shipped by
 * `@powersync/node` (devDependency, pinned in research/versions-powersync.md);
 * it is loaded into every connection via `DatabaseSync.loadExtension`, the
 * same mechanism the first-party Node SDK uses.
 *
 * Test support only. Nothing in the app-facing `src/` tree imports this
 * file, so Metro never bundles it into the Expo app.
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { dirname, join } from 'node:path';
import {
  DBAdapter,
  LockContext,
  PowerSyncDatabase,
  type RawQueryResult,
  type Schema,
  type SqliteValue,
} from '@powersync/web';
import { wrapPowerSyncWithKysely, type PowerSyncKyselyDatabase } from '@powersync/kysely-driver';

/**
 * Filename of the PowerSync SQLite extension for the current platform,
 * mirroring `getPowerSyncExtensionFilename()` in @powersync/node.
 */
function powersyncExtensionFilename(): string {
  const { platform, arch } = process;
  if (platform === 'darwin') {
    if (arch === 'arm64') return 'libpowersync_aarch64.macos.dylib';
    if (arch === 'x64') return 'libpowersync_x64.macos.dylib';
  } else if (platform === 'linux') {
    if (arch === 'x64') return 'libpowersync_x64.linux.so';
    if (arch === 'arm64') return 'libpowersync_aarch64.linux.so';
    if (arch === 'arm') return 'libpowersync_armv7.linux.so';
  } else if (platform === 'win32') {
    if (arch === 'x64') return 'powersync_x64.dll';
    if (arch === 'ia32') return 'powersync_x86.dll';
    if (arch === 'arm64') return 'powersync_aarch64.dll';
  }
  throw new Error(`Unsupported platform for the PowerSync SQLite extension: ${platform}/${arch}`);
}

/** Resolve the extension path inside the installed @powersync/node package. */
function powersyncExtensionPath(): string {
  // require.resolve works under jest's CJS runtime; this file is never
  // bundled by Metro (test-only).
  const pkgJsonPath = require.resolve('@powersync/node/package.json');
  return join(dirname(pkgJsonPath), 'lib', powersyncExtensionFilename());
}

/**
 * Open a `node:sqlite` connection with the PowerSync extension loaded
 * (registers the `powersync_*` SQL functions the SDK's internal SQL calls).
 */
function openPowersyncDatabase(fileName: string = ':memory:'): DatabaseSync {
  const db = new DatabaseSync(fileName, { allowExtension: true });
  // @ts-expect-error — @types/node is missing the two-argument overload
  // (path, entryPoint) that node:sqlite has had since v22.13.0; the PowerSync
  // build exports `sqlite3_powersync_init`, not the default entry point.
  db.loadExtension(powersyncExtensionPath(), 'sqlite3_powersync_init');
  return db;
}

/** Statements whose main clause is a read (produces rows). */
const READ_LEADING = /^\s*(select|pragma|explain|values)\b/i;
/** Statements that open with a CTE block. */
const WITH_LEADING = /^\s*with\b/i;

/**
 * The first top-level keyword after a `WITH (...)` CTE block — i.e. the
 * kind of statement the CTE feeds (`SELECT`, `UPDATE`, …).
 */
function cteTopLevelKeyword(query: string): string | null {
  let depth = 0;
  for (let i = 0; i < query.length; i++) {
    const ch = query.charAt(i);
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && !/\S/.test(ch)) {
      const match = /^(select|explain|values|update|delete|insert)\b/i.exec(query.slice(i + 1));
      if (match !== null) return match[1]!.toLowerCase();
    }
  }
  return null;
}

/**
 * Whether a statement produces rows (read via `StatementSync.all()`) or is
 * a write (executed via `StatementSync.run()` so `rowsAffected` /
 * `insertId` are reported — the SDK's JSON view system reads `rowsAffected`
 * on writes).
 *
 * CTE queries need special handling: PowerSync's `ps_crud` upload-queue
 * iterator is a `WITH RECURSIVE` READ that the SDK issues via `getAll`
 * (hence the read lock) — a leading `WITH` must not be classified as a
 * write, or the rows are silently discarded (`run()` on a read).
 *
 * - in a READ lock context the CTE is always a read (the SDK only issues
 *   CTE reads through `getAll`);
 * - in a WRITE lock context the top-level keyword decides (a future
 *   `WITH … UPDATE` write still goes through `run()`).
 */
function producesRows(query: string, cteIsRead: boolean): boolean {
  if (READ_LEADING.test(query)) return true;
  if (!WITH_LEADING.test(query)) return false;
  if (cteIsRead) return true;
  const keyword = cteTopLevelKeyword(query);
  return keyword === 'select' || keyword === 'explain' || keyword === 'values';
}

class NodeSqliteLockContext extends LockContext {
  constructor(
    private readonly db: DatabaseSync,
    private readonly cteIsRead: boolean,
  ) {
    super();
  }

  override async executeRaw(query: string, params?: SQLInputValue[]): Promise<RawQueryResult> {
    const stmt = this.db.prepare(query);
    const values = params ?? [];
    if (producesRows(query, this.cteIsRead)) {
      const columnNames = stmt.columns().map((c) => c.name);
      const rows = stmt.all(...values) as Record<string, unknown>[];
      return {
        columnNames,
        rawRows: rows.map((row) =>
          columnNames.map((name) => (row[name] ?? null) as SqliteValue),
        ),
      };
    }
    const result = stmt.run(...values);
    return {
      columnNames: [],
      rawRows: [],
      rowsAffected: Number(result.changes),
      insertId: Number(result.lastInsertRowid),
    };
  }
}

/**
 * A single `node:sqlite` connection cannot interleave transactions, and the
 * SDK's `readTransaction`/`writeTransaction` both start `BEGIN IMMEDIATE`
 * inside the lock context, so every lock is serialized on one promise chain.
 */
class SerializedQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/** `DBAdapter` over a single `node:sqlite` connection (test scale). */
export class NodeSqliteDBAdapter extends DBAdapter {
  private readonly db: DatabaseSync;
  private readonly fileName: string;
  private readonly queue = new SerializedQueue();
  private closed = false;

  constructor(fileName: string = ':memory:') {
    super();
    this.fileName = fileName;
    this.db = openPowersyncDatabase(fileName);
  }

  override get name(): string {
    return this.fileName;
  }

  override readLock<T>(fn: (tx: LockContext) => Promise<T>): Promise<T> {
    return this.queue.enqueue(() => fn(new NodeSqliteLockContext(this.db, true)));
  }

  override writeLock<T>(fn: (tx: LockContext) => Promise<T>): Promise<T> {
    // Single connection: reads and writes share the same serialization.
    return this.queue.enqueue(() => fn(new NodeSqliteLockContext(this.db, false)));
  }

  override async refreshSchema(): Promise<void> {
    // Single connection — there is no second connection to refresh.
  }

  override close(): void {
    // `powersync.close()` already invokes adapter.close(); stay idempotent
    // (note: node:sqlite's `DatabaseSync.open` is a *method*, not a flag).
    if (!this.closed) {
      this.closed = true;
      this.db.close();
    }
  }
}

export interface NodeTestDatabase<DB = unknown> {
  /** The initialized web PowerSyncDatabase (local operations only — never `connect()`). */
  powersync: PowerSyncDatabase;
  /** Kysely wrapper over `powersync` for query/transaction access. */
  kysely: PowerSyncKyselyDatabase<DB>;
  /** Closes the PowerSync database and the underlying SQLite connection. */
  close: () => Promise<void>;
}

/**
 * Create an initialized in-memory PowerSync database (web SDK + node:sqlite)
 * for a given v2 schema. Use for unit tests; never from app code.
 */
export async function createNodeTestDatabase<DB>(
  schema: Schema,
  options?: { fileName?: string },
): Promise<NodeTestDatabase<DB>> {
  const adapter = new NodeSqliteDBAdapter(options?.fileName ?? ':memory:');
  const powersync = new PowerSyncDatabase({
    schema,
    opened: adapter,
  });
  await powersync.init();
  const kysely = wrapPowerSyncWithKysely<DB>(powersync);
  return {
    powersync,
    kysely,
    close: async () => {
      try {
        await powersync.close();
      } finally {
        adapter.close();
      }
    },
  };
}
