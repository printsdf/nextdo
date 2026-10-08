import { createApp } from '../src/app.js';
import { ServerClaimManager } from '../src/claim.js';
import {
  createMockPool,
  JWT_SECRET,
  NOW,
  OWNER_TOKEN,
  SYNC_ENDPOINT,
} from './helpers.js';

describe('server claim and pairing protocol', () => {
  describe('static mode (NEXTDO_OWNER_TOKEN configured)', () => {
    it('GET /claim/status reports claimed=true', async () => {
      const { pool } = createMockPool();
      const app = createApp({
        pool,
        ownerToken: OWNER_TOKEN,
        jwtSecret: JWT_SECRET,
        syncEndpoint: SYNC_ENDPOINT,
        now: () => NOW,
      });

      const res = await app.request('/claim/status');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ claimed: true });
    });

    it('POST /claim returns 409 already_claimed', async () => {
      const { pool } = createMockPool();
      const app = createApp({
        pool,
        ownerToken: OWNER_TOKEN,
        jwtSecret: JWT_SECRET,
        syncEndpoint: SYNC_ENDPOINT,
        now: () => NOW,
      });

      const res = await app.request('/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ownerToken: 'attempted-token' }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body).toEqual({
        error: 'already_claimed',
        code: 'claim.already_claimed',
      });
    });
  });

  describe('unclaimed mode -> claim -> authenticated transition', () => {
    it('starts unclaimed, claims with auto-generated token, and authenticates subsequent requests', async () => {
      // In-memory mock pool with custom query handling for system_settings table
      const storedSettings = new Map<string, string>();
      const customPool = {
        async query(text: string, values?: readonly unknown[]) {
          const upper = text.trim().toUpperCase();
          if (upper.startsWith('SELECT VALUE FROM SYSTEM_SETTINGS')) {
            const key = values?.[0] as string;
            const val = storedSettings.get(key);
            return { rows: val ? [{ value: val }] : [] };
          }
          if (upper.startsWith('INSERT INTO SYSTEM_SETTINGS')) {
            const key = values?.[0] as string;
            const val = values?.[1] as string;
            if (storedSettings.has(key)) {
              return { rows: [] }; // conflict
            }
            storedSettings.set(key, val);
            return { rows: [{ key }] };
          }
          return { rows: [] };
        },
        async connect() {
          return {
            query: this.query,
            release() {},
          };
        },
        async end() {},
      };

      const claimState = new ServerClaimManager({
        pool: customPool,
        staticToken: null,
        initialDynamicToken: null,
        now: () => NOW,
      });

      const app = createApp({
        pool: customPool,
        claimState,
        jwtSecret: JWT_SECRET,
        syncEndpoint: SYNC_ENDPOINT,
        now: () => NOW,
      });

      // 1. Initial status is unclaimed
      const statusRes1 = await app.request('/claim/status');
      expect(statusRes1.status).toBe(200);
      expect(await statusRes1.json()).toEqual({ claimed: false });

      // 2. Before claiming, requests to /credentials with any token are unauthorized (401)
      const credsBefore = await app.request('/credentials', {
        headers: { authorization: 'Bearer any-token' },
      });
      expect(credsBefore.status).toBe(401);

      // 3. POST /claim generates a secure 64-hex token
      const claimRes = await app.request('/claim', { method: 'POST' });
      expect(claimRes.status).toBe(200);
      const claimBody = (await claimRes.json()) as { ok: boolean; ownerToken: string };
      expect(claimBody.ok).toBe(true);
      expect(typeof claimBody.ownerToken).toBe('string');
      expect(claimBody.ownerToken).toMatch(/^[0-9a-f]{64}$/);

      // 4. Status is now claimed
      const statusRes2 = await app.request('/claim/status');
      expect(statusRes2.status).toBe(200);
      expect(await statusRes2.json()).toEqual({ claimed: true });

      // 5. Subsequent POST /claim is rejected with 409
      const secondClaim = await app.request('/claim', { method: 'POST' });
      expect(secondClaim.status).toBe(409);
      expect(await secondClaim.json()).toEqual({
        error: 'already_claimed',
        code: 'claim.already_claimed',
      });

      // 6. /credentials now succeeds with the claimed token
      const credsAfter = await app.request('/credentials', {
        headers: { authorization: `Bearer ${claimBody.ownerToken}` },
      });
      expect(credsAfter.status).toBe(200);
      const credsBody = (await credsAfter.json()) as { token: string; endpoint: string };
      expect(typeof credsBody.token).toBe('string');
      expect(credsBody.endpoint).toBe(SYNC_ENDPOINT);

      // 7. Wrong token is still 401
      const credsWrong = await app.request('/credentials', {
        headers: { authorization: 'Bearer wrong-token' },
      });
      expect(credsWrong.status).toBe(401);
    });
  });
});
