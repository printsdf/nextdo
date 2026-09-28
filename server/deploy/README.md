# Nextdo Production Deployment (`server/deploy`)

A single-host Docker Compose stack that runs the whole backend:

| Service      | Image / build                          | Listens (127.0.0.1) | Role                                              |
| ------------ | -------------------------------------- | ------------------- | ------------------------------------------------- |
| `postgres`   | `postgres:16-alpine` (`wal_level=logical`) | `5432`             | Source DB (what `/upload` writes) + PowerSync storage |
| `powersync`  | `journeyapps/powersync-service:1.26.1` | `8080`              | PowerSync sync endpoint (WebSocket + sync API)     |
| `api`        | built from `server/app/Dockerfile`     | `8787`              | Hono backend — `GET /credentials`, `POST /upload`  |

Every service binds **`127.0.0.1` only**. Nothing is exposed to the network
directly: a **same-host reverse proxy** (Caddy or nginx) is the single public
entrypoint and terminates TLS. The phone (Expo) and desktop (Tauri) clients
connect to the proxy, never to the containers.

```
phone / desktop  →  https://<your-domain>/
                        ├── /api/*  →  127.0.0.1:8787  (api)
                        └── /sync/* →  127.0.0.1:8080  (powersync)
```

The Postgres data lives in the named volume `pgdata` — back it up before
re-provisioning the host.

---

## Prerequisites

- Docker Engine + Docker Compose v2 (`docker compose version`).
- A domain (or subdomain) that points at this host, plus TLS for it — the
  reverse proxy handles the certificate.

---

## 1. Configure the secrets

```bash
cd server/deploy
cp .env.example .env
```

Fill in `.env` — three secrets are required; the owner token is optional
(see below):

| Variable             | How to generate                                  | Used by                                  |
| -------------------- | ------------------------------------------------ | ---------------------------------------- |
| `POSTGRES_PASSWORD`  | any strong string                                | `postgres`, `powersync`, `api`           |
| `NEXTDO_OWNER_TOKEN` | **optional** — `openssl rand -hex 32`, or leave empty for auto-generation | `api` — the token clients enter in the Settings tab |
| `JWT_SECRET`         | `openssl rand -base64 32 \| tr '+/' '-_' \| tr -d '='` | `api` + `powersync` — **one shared secret** |
| `PS_ADMIN_TOKEN`     | `openssl rand -hex 32`                           | `powersync` admin API (local ops only)   |

### The owner token — two ways

- **Explicit (recommended once devices are connected):** generate one
  (`openssl rand -hex 32`) and set `NEXTDO_OWNER_TOKEN` in `.env`.
- **Auto-generated:** leave it empty. On the **first boot** `server/app`
  generates a random 64-hex token and prints it **once** in a banner:

  ```bash
  docker compose logs api    # the banner contains the token — shown ONCE
  ```

  The token is persisted in `./data/owner-token` (git-ignored, on the
  deploy host) and **reused silently** on every later boot — container
  rebuilds and restarts never rotate it and never re-print it. If you
  lose both the log and the file, delete `./data/owner-token` (or set the
  env var) to get a fresh one — every device must re-enter it then.

  The API and the client UI never return the token (the Settings tab is
  input-only) — the banner is its only display path.

> `JWT_SECRET` must be the **same value** in both `api` and `powersync` — the
> backend signs the `/credentials` JWT with it and the PowerSync service
> verifies it. A mismatch means clients connect but never sync.

`.env` is git-ignored. If it is ever committed or leaked, rotate every secret
above.

---

## 2. Start the stack

```bash
docker compose up -d --build     # builds the api image on first run
docker compose ps                # all three "running"/"healthy"
docker compose logs -f api       # expect: "listening on :8787"
```

The init SQL (`../powersync/init`, reused from the dev stack) runs **once**,
on first volume init, and creates the `nextdo_powersync` storage database plus
the app tables. Subsequent starts reuse the existing volume.

---

## 3. Reverse proxy (Caddy example)

Caddy issues TLS certificates automatically and upgrades WebSockets for you, so
it needs no `proxy_set_header` boilerplate. Put this in your Caddyfile,
replacing `your.domain`:

```caddy
your.domain {
    handle /api/* {
        uri strip_prefix /api
        reverse_proxy 127.0.0.1:8787
    }
    handle /sync/* {
        uri strip_prefix /sync
        reverse_proxy 127.0.0.1:8080
    }
}
```

- `/api/*` strips the `/api` prefix → the Hono backend sees `/credentials` and
  `/upload` at its root.
- `/sync/*` strips the `/sync` prefix → the PowerSync service sees its routes
  at its root. Caddy handles the `Upgrade` header automatically.

**nginx equivalent** (the manual WebSocket headers are why Caddy is simpler):

```nginx
server {
    listen 443 ssl http2;
    server_name your.domain;
    # ... ssl_certificate / ssl_certificate_key ...

    location /api/ {
        proxy_pass http://127.0.0.1:8787/;     # trailing slash strips /api
        proxy_set_header Host $host;
    }
    location /sync/ {
        proxy_pass http://127.0.0.1:8080/;     # trailing slash strips /sync
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

> The path layout (`/api`, `/sync`) is a **choice**, not a requirement — the
> client only needs the final URLs (step 4). Use subdomains instead if you
> prefer (`api.your.domain` / `sync.your.domain`); just point the two client
> constants at them.

---

## 4. Point the clients at your domain

The client backend URLs are a **single config point** shared by phone and
desktop: `apps/mobile/lib/env.ts`. Replace the placeholders with your real
URLs (matching the proxy paths you chose):

```ts
const BACKEND: NextdoPowerSyncConfig = {
  backendUrl: 'https://your.domain/api',
  endpoint: 'https://your.domain/sync',
};
```

Then rebuild/reload each client (mobile: normal Expo build; desktop:
`pnpm --filter @nextdo/desktop build`).

---

## 5. Connect a device

Cloud sync is **optional** — the app works fully local without it. To sync:
open the **Settings tab** (the 5th tab), enter the owner token from step 1
(or the auto-generated banner), and press **连接**. On success the token is
stored (Keychain / Keystore on mobile, encrypted stronghold file on desktop)
and the device syncs — you won't be asked again. **断开连接** in the same
block stops syncing (local data is kept).

---

## Verifying from the host

```bash
# api answers (401 without the token is correct):
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/credentials
# expect: 401

# the reverse proxy, from any machine:
curl -s -o /dev/null -w '%{http_code}\n' https://your.domain/api/credentials
# expect: 401 (proves TLS + routing + CORS are up)
```

A connected client should reach a synced state; check `docker compose logs -f
powersync` for the WebSocket stream.

---

## Operations

- **Rotate the owner token:** set a new `NEXTDO_OWNER_TOKEN` in `.env` (or
  delete `./data/owner-token`) and `docker compose up -d api` — then re-enter
  it in every device (Settings tab). The old token stops working immediately.
- **Update the backend:** pull your changes, then `docker compose up -d --build`
  (only `api` rebuilds; `postgres`/`powersync` images are pinned and untouched).
- **Update the PowerSync schema:** a client schema change is one unit —
  `packages/db/src/schema.ts` + `server/powersync/sync-config.yaml` +
  `server/powersync/init`. The init SQL only runs on a **fresh** volume; on an
  existing deployment apply schema changes to the live DB directly.
- **Backup:** `docker compose exec postgres pg_dumpall -U "$POSTGRES_USER"` or
  snapshot the `pgdata` volume.
- **Roll back the deployment:** the stack is isolated under `server/deploy` —
  it never touches the dev `server/powersync` stack. Stop with
  `docker compose down` (add `-v` only if you also want to drop the data).
