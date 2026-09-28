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

Fill in `.env` — all four values are required:

| Variable             | How to generate                                  | Used by                                  |
| -------------------- | ------------------------------------------------ | ---------------------------------------- |
| `POSTGRES_PASSWORD`  | any strong string                                | `postgres`, `powersync`, `api`           |
| `NEXTDO_OWNER_TOKEN` | **required** — `openssl rand -hex 32`            | `api` — the token clients enter in the Settings tab |
| `JWT_SECRET`         | `openssl rand -base64 32 \| tr '+/' '-_' \| tr -d '='` | `api` + `powersync` — **one shared secret** |
| `PS_ADMIN_TOKEN`     | `openssl rand -hex 32`                           | `powersync` admin API (local ops only)   |

### The owner token — one way (deploy-owned)

Generate it once before starting the stack:

```bash
openssl rand -hex 32
```

and set it as `NEXTDO_OWNER_TOKEN` in `.env`. The server **refuses to
start** when the value is missing or empty (the boot error names the
command above). The token lives ONLY in that `.env` — there is no
persisted file, no log line, and no API echo. Every device (the first
one and all later ones) enters the same value in the Settings tab
(step 5).

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
> client only needs the final URLs (step 5). Use subdomains instead if you
> prefer (`api.your.domain` / `sync.your.domain`); just enter the two URLs in
> each device's Settings tab.

---

## 4. No client rebuild — the OSS default is local

The open-source client ships **no default server**: a fresh install is
pure-local (no sync, the local DB is the source of truth). The server
addresses are entered **per device, at runtime** in the **Settings tab**
(step 5) — there is no `env.ts` edit and no rebuild. This is by design: an
open-source build must not point at anyone's server.

---

## 5. Connect a device

Cloud sync is **optional** — the app works fully local without it. To sync:
open the **Settings tab** (the 5th tab) and fill in the fields, then press
**连接**:

1. **后端地址 (backend URL)** — where `/credentials` and `/upload` live.
2. **同步流地址 (sync-stream URL)** — where PowerSync's `/sync/stream` lives.
3. **owner token** — the value you generated at deploy time (step 1,
   `NEXTDO_OWNER_TOKEN` in `.env`); it is required, and **every device
   (the first one and all later ones) goes through this same flow**.

The two addresses match the reverse-proxy layout you chose in step 3:

- **Single domain with prefixes** (the Caddy example): backend URL
  `https://your.domain/api`, sync-stream URL `https://your.domain/sync`.
- **Subdomains** (if you deployed that way): backend URL
  `https://api.your.domain`, sync-stream URL `https://sync.your.domain`.

On success the token **and** the two addresses are stored (Keychain / Keystore
on mobile, encrypted stronghold file on desktop) and the device syncs — you
won't be asked again. **断开连接** in the same block stops syncing and clears
only the token (the addresses stay, so reconnecting is just re-entering the
token); local data is kept.

> **Upgrading from a hardcoded-domain build:** the old build pointed at a
> fixed domain and stored only the token. After installing this build, enter
> your two server addresses in the Settings tab once (the token is already
> stored). From then on the addresses are stored too, so 断开/重连 only needs
> the token.

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

- **Migrate an existing deployment to required-token boot:** the new
  build refuses to start without `NEXTDO_OWNER_TOKEN`, so write the token
  into `.env` BEFORE deploying it. The current token is either the old
  `.env`'s `NEXTDO_OWNER_TOKEN` (if non-empty) or the content of the old
  `./data/owner-token` file:

  ```bash
  cd server/deploy
  # find the current token (one of these two places):
  grep '^NEXTDO_OWNER_TOKEN=' .env        # explicit deploy
  cat ./data/owner-token                  # older deployments (first-boot auto-generation)
  # then write that value into .env and deploy the new build:
  docker compose up -d --build
  ```

  Already-connected devices are unaffected when the token value is
  unchanged (no re-entry needed); only a token CHANGE forces every device
  to re-enter it (Settings tab). The old `./data/owner-token` file is no
  longer read by the new code — you may delete it afterwards.
- **Rotate the owner token:** set a new value for `NEXTDO_OWNER_TOKEN` in
  `.env` (`openssl rand -hex 32`) and `docker compose up -d api` — then
  re-enter it in every device (Settings tab). The old token stops working
  immediately.
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
