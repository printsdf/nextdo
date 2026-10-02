/**
 * Connector + owner-token unit tests (spec: app/database-guidelines.md
 * "PowerSync Rules" — the 2xx-on-rejection upload protocol, null = not
 * signed in, throw = temporary failure).
 *
 * `fetch` is mocked; no platform PowerSync module is loaded (the lazy
 * `require` in powersync.ts is never reached here) and the storage backend
 * is the in-memory fallback (plain Node, no localStorage).
 */
import { SyncNextdoError } from '@nextdo/core';
import {
  SYNC_STREAM_NAME,
  createPowerSyncConnector,
  subscribeAppStream,
  type NextdoPowerSyncConfig,
} from '../powersync';
import {
  __setStorageBackendForTests,
  clearOwnerToken,
  getOwnerToken,
  setOwnerToken,
  subscribeToOwnerTokenChange,
} from '../owner-token';
import type {
  CommonPowerSyncDatabase,
  CrudEntry,
  CrudTransaction,
} from '@powersync/common';

const CONFIG: NextdoPowerSyncConfig = {
  backendUrl: 'http://backend.test',
  endpoint: 'http://powersync-service.test',
};

/** A fetch mock returning a canned response. */
function mockFetch(status = 200, body: unknown = {}) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
  global.fetch = fetchMock;
  return fetchMock;
}

/** The minimal db surface the connector's uploadData uses. */
function fakeCrudDb(crud: CrudEntry[] = []) {
  const complete = jest.fn().mockResolvedValue(undefined);
  const tx: CrudTransaction | null =
    crud.length > 0
      ? ({ crud, complete, transactionId: 1 } as unknown as CrudTransaction)
      : null;
  const db = {
    getNextCrudTransaction: jest.fn().mockResolvedValue(tx),
  } as unknown as CommonPowerSyncDatabase;
  return { db, complete };
}

function putEntry(
  id: string,
  table: string,
  opData: Record<string, unknown>,
): CrudEntry {
  return { op: 'PUT', id, table, opData } as unknown as CrudEntry;
}

async function expectSyncNextdoError(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: 'SyncNextdoError',
    code,
  });
}

beforeEach(async () => {
  __setStorageBackendForTests(null); // fresh lazy default (in-memory)
  await clearOwnerToken();
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// owner-token: single-user storage (v1)
// ---------------------------------------------------------------------------

describe('owner-token storage', () => {
  it('returns null when nothing is stored (SDK stays disconnected)', async () => {
    expect(await getOwnerToken()).toBeNull();
  });

  it('stores and reads the token', async () => {
    await setOwnerToken('owner-token-1');
    expect(await getOwnerToken()).toBe('owner-token-1');
  });

  it('setOwnerToken replaces the previous token', async () => {
    await setOwnerToken('token-1');
    await setOwnerToken('token-2');
    expect(await getOwnerToken()).toBe('token-2');
  });

  it('clearOwnerToken forgets the token', async () => {
    await setOwnerToken('token-1');
    await clearOwnerToken();
    expect(await getOwnerToken()).toBeNull();
  });

  it('rejects an empty token with a typed validation error', async () => {
    await expect(setOwnerToken('')).rejects.toMatchObject({ code: 'auth.empty-token' });
    expect(await getOwnerToken()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// owner-token change notification (drives the app's connect/disconnect)
// ---------------------------------------------------------------------------

describe('owner-token change notification', () => {
  it('fires on setOwnerToken (sign-in)', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToOwnerTokenChange(listener);
    try {
      await setOwnerToken('owner-token-1');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(await getOwnerToken()).toBe('owner-token-1');
    } finally {
      unsubscribe();
    }
  });

  it('fires on clearOwnerToken (sign-out)', async () => {
    await setOwnerToken('owner-token-1');
    const listener = jest.fn();
    const unsubscribe = subscribeToOwnerTokenChange(listener);
    try {
      await clearOwnerToken();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(await getOwnerToken()).toBeNull();
    } finally {
      unsubscribe();
    }
  });

  it('does not fire after unsubscribe', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToOwnerTokenChange(listener);
    unsubscribe();
    await setOwnerToken('owner-token-1');
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not fire when setOwnerToken rejects (empty token)', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToOwnerTokenChange(listener);
    try {
      await expect(setOwnerToken('')).rejects.toMatchObject({ code: 'auth.empty-token' });
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('a throwing listener does not break the auth operation', async () => {
    const bad = jest.fn(() => {
      throw new Error('listener broke');
    });
    const good = jest.fn();
    const unsubBad = subscribeToOwnerTokenChange(bad);
    const unsubGood = subscribeToOwnerTokenChange(good);
    try {
      await setOwnerToken('owner-token-1');
      expect(bad).toHaveBeenCalledTimes(1);
      expect(good).toHaveBeenCalledTimes(1);
      expect(await getOwnerToken()).toBe('owner-token-1');
    } finally {
      unsubBad();
      unsubGood();
    }
  });
});

// ---------------------------------------------------------------------------
// connector.fetchCredentials
// ---------------------------------------------------------------------------

describe('connector.fetchCredentials', () => {
  it('returns null without a session (SDK stays disconnected)', async () => {
    const fetchMock = mockFetch();
    const connector = createPowerSyncConnector(CONFIG);
    await expect(connector.fetchCredentials()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches /credentials with the owner token and maps the response', async () => {
    await setOwnerToken('owner-token-1');
    const fetchMock = mockFetch(200, { token: 'ps-service-token' });
    const connector = createPowerSyncConnector(CONFIG);

    const credentials = await connector.fetchCredentials();

    // No endpoint in the body (an old server) → the injected config's value.
    expect(credentials).toEqual({
      endpoint: CONFIG.endpoint,
      token: 'ps-service-token',
    });
    expect(fetchMock).toHaveBeenCalledWith(CONFIG.backendUrl + '/credentials', {
      headers: { Authorization: 'Bearer owner-token-1' },
    });
  });

  it('prefers the server-supplied endpoint over the injected config (10-02)', async () => {
    await setOwnerToken('owner-token-1');
    mockFetch(200, { token: 'ps-service-token', endpoint: 'https://custom.example.com/stream' });
    const connector = createPowerSyncConnector(CONFIG);

    await expect(connector.fetchCredentials()).resolves.toEqual({
      endpoint: 'https://custom.example.com/stream',
      token: 'ps-service-token',
    });
  });

  it('falls back to the injected config when the server endpoint is malformed', async () => {
    await setOwnerToken('owner-token-1');
    mockFetch(200, { token: 'ps-service-token', endpoint: 'ftp://bad' });
    const connector = createPowerSyncConnector(CONFIG);

    await expect(connector.fetchCredentials()).resolves.toEqual({
      endpoint: CONFIG.endpoint,
      token: 'ps-service-token',
    });
  });

  it('throws on network failure (temporary — SDK retries)', async () => {
    await setOwnerToken('owner-token-1');
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const connector = createPowerSyncConnector(CONFIG);
    await expectSyncNextdoError(connector.fetchCredentials(), 'credentials.network');
  });

  it('throws on non-2xx (SDK retries)', async () => {
    await setOwnerToken('owner-token-1');
    mockFetch(500);
    const connector = createPowerSyncConnector(CONFIG);
    await expectSyncNextdoError(connector.fetchCredentials(), 'credentials.rejected');
  });

  it('throws when the response has no token (invalid — not retried blindly)', async () => {
    await setOwnerToken('owner-token-1');
    mockFetch(200, { unexpected: true });
    const connector = createPowerSyncConnector(CONFIG);
    await expectSyncNextdoError(connector.fetchCredentials(), 'credentials.invalid');
  });
});

// ---------------------------------------------------------------------------
// connector.uploadData — the 2xx-on-rejection protocol
// ---------------------------------------------------------------------------

describe('connector.uploadData', () => {
  it('resolves without a request when the queue is empty', async () => {
    await setOwnerToken('owner-token-1');
    const fetchMock = mockFetch();
    const { db, complete } = fakeCrudDb([]);
    const connector = createPowerSyncConnector(CONFIG);

    await connector.uploadData(db);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('throws when the queue has ops but no owner token (queue stays blocked)', async () => {
    const fetchMock = mockFetch();
    const { db, complete } = fakeCrudDb([putEntry('r1', 'inbox_items', { title: 't' })]);
    const connector = createPowerSyncConnector(CONFIG);

    await expectSyncNextdoError(connector.uploadData(db), 'upload.no-owner-token');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('POSTs one crud transaction and completes on 2xx', async () => {
    await setOwnerToken('owner-token-1');
    const fetchMock = mockFetch(200, { accepted: 1 });
    const { db, complete } = fakeCrudDb([
      putEntry('r1', 'inbox_items', { title: 't', created_at: 'now' }),
      { op: 'DELETE', id: 'r2', table: 'projects' } as unknown as CrudEntry,
    ]);
    const connector = createPowerSyncConnector(CONFIG);

    await connector.uploadData(db);

    expect(fetchMock).toHaveBeenCalledWith(
      CONFIG.backendUrl + '/upload',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer owner-token-1',
          'Content-Type': 'application/json',
        }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      ops: [
        { op: 'PUT', id: 'r1', table: 'inbox_items', opData: { title: 't', created_at: 'now' } },
        { op: 'DELETE', id: 'r2', table: 'projects', opData: null },
      ],
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('completes on 2xx EVEN for validation-level rejections (protocol)', async () => {
    await setOwnerToken('owner-token-1');
    // The backend answers 2xx with the error detail (delivered via sync
    // tables) — the queue MUST advance.
    mockFetch(200, {
      ok: false,
      errors: [{ code: 'validation.failed', message: 'estMinutes must be > 0' }],
    });
    const { db, complete } = fakeCrudDb([putEntry('r1', 'next_actions', { est_minutes: -5 })]);
    const connector = createPowerSyncConnector(CONFIG);

    await connector.uploadData(db);

    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('throws on non-2xx WITHOUT completing (queue blocks for retry)', async () => {
    await setOwnerToken('owner-token-1');
    mockFetch(500);
    const { db, complete } = fakeCrudDb([putEntry('r1', 'inbox_items', { title: 't' })]);
    const connector = createPowerSyncConnector(CONFIG);

    await expectSyncNextdoError(connector.uploadData(db), 'upload.rejected');

    expect(complete).not.toHaveBeenCalled();
  });

  it('throws on network failure WITHOUT completing', async () => {
    await setOwnerToken('owner-token-1');
    global.fetch = jest.fn().mockRejectedValue(new Error('socket hang up'));
    const { db, complete } = fakeCrudDb([putEntry('r1', 'inbox_items', { title: 't' })]);
    const connector = createPowerSyncConnector(CONFIG);

    await expectSyncNextdoError(connector.uploadData(db), 'upload.network');

    expect(complete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// stream subscription
// ---------------------------------------------------------------------------

describe('subscribeAppStream', () => {
  it('subscribes to the single v1 stream name (resolves void — the client no longer seeds)', async () => {
    const subscribe = jest.fn().mockResolvedValue({ unsubscribe: jest.fn() });
    const powersync = {
      syncStream: jest.fn().mockReturnValue({ subscribe }),
    } as unknown as CommonPowerSyncDatabase;

    await expect(subscribeAppStream(powersync)).resolves.toBeUndefined();

    expect(powersync.syncStream).toHaveBeenCalledWith(SYNC_STREAM_NAME, {});
    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});

/** The connector's errors are the domain SyncNextdoError (typed codes). */
it('emits SyncNextdoError instances from the connector', async () => {
  await setOwnerToken('owner-token-1');
  global.fetch = jest.fn().mockRejectedValue(new Error('down'));
  const connector = createPowerSyncConnector(CONFIG);

  let caught: unknown;
  try {
    await connector.fetchCredentials();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(SyncNextdoError);
});
