# Nextdo Desktop (`@nextdo/desktop`)

The Nextdo desktop app is a **Tauri v2 shell**: a thin native window that loads
the **same web build** the mobile app produces with
`expo export --platform web`. There is **no React code in this workspace** — the
UI, routing, data hooks, and the PowerSync/owner-token logic all live in
`apps/mobile` and the shared `packages/*`. The desktop app is a leaf: it only
wraps that build in a native window and provides the Tauri-side secrets backend.

```
apps/desktop/
├── package.json            # @nextdo/desktop — pins the Tauri npm packages
└── src-tauri/
    ├── tauri.conf.json     # v2 config: frontendDist / devUrl / build hooks
    ├── Cargo.toml          # pins the Rust `tauri` + `tauri-plugin-stronghold` crates
    ├── build.rs            # standard tauri-build codegen
    ├── capabilities/
    │   └── default.json    # ACL: core:default + stronghold commands
    ├── icons/              # valid icon set (generated via `tauri icon`)
    └── src/
        ├── main.rs         # entrypoint → nextdo_desktop_lib::run()
        └── lib.rs          # Builder + Stronghold plugin + owner-token command seam
```

## How the web build is wired in

All the wiring lives in the `build` section of
[`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json). The four fields form
two pairs — one for **production** builds, one for **development**:

| Field | Value | Role |
|-------|-------|------|
| `frontendDist` | `../../mobile/dist` | **Production.** Relative to `src-tauri/`, this resolves to `apps/mobile/dist` — the output of `expo export --platform web`. Tauri recursively reads this directory and embeds it into the binary, using its `index.html` as the entry. The desktop shell therefore serves the *exact same* bundle as the standalone web export. |
| `beforeBuildCommand` | `pnpm --filter @nextdo/mobile exec expo export --platform web` | Runs **before** `tauri build` so `frontendDist` is freshly populated with the current mobile web export. |
| `devUrl` | `http://localhost:8081` | **Development.** The URL `tauri dev` loads — the Expo/Metro **web** dev server (HMR). |
| `beforeDevCommand` | `pnpm --filter @nextdo/mobile run web` | Runs **before** `tauri dev`; it starts the Expo web server (`expo start --web`, default port 8081) that `devUrl` points at. |

So the flow is:

- **`pnpm --filter @nextdo/desktop run build`** → runs `beforeBuildCommand`
  (rebuilds `apps/mobile/dist` from the mobile source) → Tauri embeds
  `frontendDist` → produces a native desktop bundle.
- **`pnpm --filter @nextdo/desktop run dev`** → runs `beforeDevCommand`
  (starts the Metro web dev server on :8081) → the window loads `devUrl` with
  hot reload.

Because `frontendDist` and the web export share the same `apps/mobile/dist`
output, the desktop surface is guaranteed to match
`pnpm --filter @nextdo/mobile exec expo export --platform web`. (The mobile
`app.json` sets `web.output: "single"`, i.e. a single-page bundle with a root
`index.html`, which is what Tauri's `frontendDist` expects.)

## Owner token — Tauri Stronghold

Per the owner-token platform matrix (`packages/db/src/owner-token.ts` and the
design doc), the desktop backend is **Stronghold** (an encrypted local secret
store). The wiring in this skeleton:

- **Rust crate** `tauri-plugin-stronghold` is a dependency (`Cargo.toml`) and is
  registered in `lib.rs` with the default Argon2 hash
  (`tauri_plugin_stronghold::Builder::with_argon2(&salt_path)`). This makes the
  plugin's built-in JS commands available to the web front-end.
- **npm package** `@tauri-apps/plugin-stronghold` is a dependency
  (`package.json`) — it is what the front-end imports.
- **Capability** `src-tauri/capabilities/default.json` grants the JS side access
  to the Stronghold commands: `stronghold:default` (initialize / create+load
  client / save+read store record / save) plus
  `stronghold:allow-remove-store-record` (so the token can be cleared).

> **Follow-up (documented, not shipped here):** the actual runtime
> store/read/clear of the owner token through the Stronghold *snapshot* is a
> later task. This skeleton ships the plugin registration + capability + a
> minimal Rust command seam (`save_owner_token` / `load_owner_token` in
> `lib.rs`). Those two commands are intentionally backed by in-process state,
> not the Stronghold store, to keep the scaffold minimal; the persistent
> Stronghold-backed flow lands when the settings/token-entry UI is built.

## Running it

A **Rust toolchain** is required to build/run the desktop binary (Rust stable ≥
1.77.2; the `tauri` 2.11.x crate MSRV is 1.77.2). On macOS this also needs the
Xcode command-line tools. The Rust build is **not** part of the repository
quality gate — the gate only checks that the config parses and the paths
resolve.

```bash
# from the repo root
pnpm install                      # installs @tauri-apps/cli into this workspace
pnpm --filter @nextdo/desktop run dev     # tauri dev (starts Expo web + window, HMR)
pnpm --filter @nextdo/desktop run build   # tauri build (expo export → embed → bundle)
```

## Version pins (exact — no `^`/`~`)

| Package | Pin | Where |
|---------|-----|-------|
| `tauri` (Rust crate) | `2.11.6` | `src-tauri/Cargo.toml` |
| `tauri-plugin-stronghold` (Rust crate) | `2.3.2` | `src-tauri/Cargo.toml` |
| `@tauri-apps/cli` (npm) | `2.11.5` | `package.json` (devDependency) |
| `@tauri-apps/api` (npm) | `2.11.1` | `package.json` (dependency) |
| `@tauri-apps/plugin-stronghold` (npm) | `2.3.2` | `package.json` (dependency) |

Tauri 3.0 is alpha and intentionally **not** used; this stays on the stable v2
line.
