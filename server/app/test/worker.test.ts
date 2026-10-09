import worker, { type WorkerEnv } from '../src/worker.js';
import { JWT_SECRET, OWNER_TOKEN, SYNC_ENDPOINT } from './helpers.js';

jest.mock('../src/db.js', () => {
  const actual = jest.requireActual('../src/db.js');
  const helpers = jest.requireActual('./helpers.js');
  return {
    ...actual,
    createPool: jest.fn(() => helpers.createMockPool().pool),
  };
});

describe('Cloudflare Worker entry point', () => {
  const validEnv: WorkerEnv = {
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/nextdo',
    JWT_SECRET,
    NEXTDO_SYNC_ENDPOINT: SYNC_ENDPOINT,
    NEXTDO_OWNER_TOKEN: OWNER_TOKEN,
  };

  it('fails with 500 when DATABASE_URL is missing', async () => {
    const response = await worker.fetch(
      new Request('https://worker.local/claim/status'),
      {
        DATABASE_URL: '',
        JWT_SECRET,
        NEXTDO_SYNC_ENDPOINT: SYNC_ENDPOINT,
      },
    );
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('server_init_failed');
  });

  it('handles CORS OPTIONS preflight correctly', async () => {
    const response = await worker.fetch(
      new Request('https://worker.local/credentials', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3000',
          'Access-Control-Request-Method': 'GET',
        },
      }),
      validEnv,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('rejects /credentials without authorization header with 401', async () => {
    const response = await worker.fetch(
      new Request('https://worker.local/credentials'),
      validEnv,
    );
    expect(response.status).toBe(401);
  });

  it('accepts /credentials with valid owner token', async () => {
    const response = await worker.fetch(
      new Request('https://worker.local/credentials', {
        headers: {
          Authorization: `Bearer ${OWNER_TOKEN}`,
        },
      }),
      validEnv,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string; endpoint: string };
    expect(body.endpoint).toBe(SYNC_ENDPOINT);
    expect(typeof body.token).toBe('string');
  });

  it('accepts /api/credentials with valid owner token (client single-url derivation)', async () => {
    const response = await worker.fetch(
      new Request('https://worker.local/api/credentials', {
        headers: {
          Authorization: `Bearer ${OWNER_TOKEN}`,
        },
      }),
      validEnv,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string; endpoint: string };
    expect(body.endpoint).toBe(SYNC_ENDPOINT);
    expect(typeof body.token).toBe('string');
  });

  it('accepts /api/claim/status', async () => {
    const response = await worker.fetch(
      new Request('https://worker.local/api/claim/status'),
      validEnv,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { claimed: boolean };
    expect(body.claimed).toBe(true);
  });
});
