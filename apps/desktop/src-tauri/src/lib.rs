//! Nextdo desktop shell — a Tauri v2 window that loads the `@nextdo/mobile`
//! web build (`expo export --platform web` → `apps/mobile/dist`).
//!
//! The React app itself lives in `apps/mobile` and the shared `packages/*`;
//! nothing app-specific is compiled here. This crate only provides:
//!   * the native window (`tauri.conf.json`),
//!   * the Stronghold plugin (encrypted local secrets), and
//!   * a minimal owner-token command seam (scaffold; see below).

use std::sync::Mutex;
use tauri::Manager;

/// Minimal, in-process owner-token seam (scaffold).
///
/// The runtime owner-token backend is Tauri **Stronghold** — the
/// `tauri-plugin-stronghold` plugin registered in `run()` below — which the web
/// front-end consumes through `packages/db/src/owner-token.ts`. This managed
/// state is intentionally *not* wired to the stronghold store yet: it exists so
/// the Rust-side command surface (`save_owner_token` / `load_owner_token`) is
/// present and callable now, and is a documented follow-up to persist to the
/// stronghold snapshot. Keeping it in memory keeps the scaffold minimal and
/// free of the (compile-unverified) stronghold Rust store API.
#[derive(Default)]
struct OwnerTokenStore {
    token: Mutex<Option<String>>,
}

/// Store the owner token (scaffold seam — see `OwnerTokenStore`).
#[tauri::command]
fn save_owner_token(store: tauri::State<'_, OwnerTokenStore>, token: String) -> Result<(), String> {
    if token.is_empty() {
        return Err("owner token must be non-empty".into());
    }
    *store
        .token
        .lock()
        .map_err(|_| "owner-token store is poisoned".to_string())? = Some(token);
    Ok(())
}

/// Read the stored owner token, or `None` when none has been set (scaffold
/// seam — see `OwnerTokenStore`).
#[tauri::command]
fn load_owner_token(store: tauri::State<'_, OwnerTokenStore>) -> Option<String> {
    store.token.lock().ok().and_then(|guard| guard.clone())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(OwnerTokenStore::default())
        .setup(|app| {
            // Initialize the Stronghold plugin with the default Argon2
            // password-hash. The salt lives in the app-local data dir so the
            // derived key is stable across launches. The JS side
            // (`packages/db/src/owner-token.ts`) then drives the store via the
            // plugin's built-in commands.
            let salt_path = app
                .path()
                .app_local_data_dir()
                .expect("could not resolve app-local data dir")
                .join("stronghold-salt");
            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_owner_token,
            load_owner_token
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nextdo desktop");
}
