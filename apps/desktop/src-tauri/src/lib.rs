//! Nextdo desktop shell — a Tauri v2 window that loads the `@nextdo/mobile`
//! web build (`expo export --platform web` → `apps/mobile/dist`).
//!
//! The React app itself lives in `apps/mobile` and the shared `packages/*`;
//! nothing app-specific is compiled here. This crate only provides:
//!   * the native window (created in `setup` — see `start_frontend_server`
//!     for why the URL is dynamic),
//!   * the Stronghold plugin (encrypted local secrets),
//!   * a minimal owner-token command seam (scaffold; see below), and
//!   * (release builds only) a loopback static file server, because the
//!     PowerSync web client needs a REAL http origin: it runs its SQLite
//!     engine in a `type: 'module'` web worker, and WebKit gives the
//!     `tauri://localhost` custom protocol an OPAQUE origin — module
//!     workers from an opaque origin are always rejected ("Cross-origin
//!     script load denied by CORS policy"). Serving the same bundle from
//!     `http://127.0.0.1:<port>` gives the page a normal origin, and
//!     Tauri still treats it as LOCAL (the URL IS `frontendDist`), so the
//!     IPC bridge + capabilities work unchanged.

use std::sync::Mutex;
use tauri::Manager;

/// Loopback port of the release-build frontend server. It must match
/// `build.frontendDist` in `tauri.conf.json` — that match is what makes
/// Tauri treat the page as a LOCAL origin (IPC + capabilities).
#[cfg(not(dev))]
const FRONTEND_PORT: u16 = 52123;
#[cfg(not(dev))]
const FRONTEND_URL: &str = "http://127.0.0.1:52123";

/// Start the loopback static file server that release builds serve the
/// frontend bundle from (see the module docs for why).
///
/// - Binds 127.0.0.1 ONLY (never the LAN; the files are the app bundle
///   itself, but there is no reason to expose them).
/// - Serves `root` (the `frontend-dist` resource dir inside the .app) with
///   the SPA fallback: unknown paths WITHOUT a file extension get
///   `index.html` (expo-router client-side routing); everything else 404s.
/// - Runs on its own thread; the thread outlives the process (no stop
///   hook needed — the server dies with the app).
#[cfg(not(dev))]
fn start_frontend_server(app: &tauri::AppHandle) -> tauri::Result<()> {
    let root = app
        .path()
        .resource_dir()
        .map_err(tauri::Error::from)?
        .join("frontend-dist");
    if !root.join("index.html").is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!(
                "frontend bundle missing: {} (bundle.resources misconfigured?)",
                root.display()
            ),
        )
        .into());
    }
    let addr = format!("127.0.0.1:{FRONTEND_PORT}");
    let addr: std::net::SocketAddr = addr
        .parse()
        .expect("static loopback address");
    // Retry briefly — a stale instance of our own app may still be holding
    // the port while macOS finishes tearing it down.
    let mut server = None;
    for attempt in 0..20 {
        match tiny_http::Server::http(addr) {
            Ok(s) => {
                server = Some(s);
                break;
            }
            Err(_) if attempt < 19 => std::thread::sleep(std::time::Duration::from_millis(500)),
            Err(e) => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!(
                        "could not bind the local frontend server on {FRONTEND_URL}: {e} — \
                         close other Nextdo instances and retry"
                    ),
                )
                .into());
            }
        }
    }
    let server = server.expect("bind loop always yields a server");
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            if let Err(err) = serve_file_request(&root, request) {
                eprintln!("nextdo frontend server: {err}");
            }
        }
    });
    Ok(())
}

#[cfg(not(dev))]
fn serve_file_request(root: &std::path::Path, request: tiny_http::Request) -> Result<(), String> {
    let mut path = request.url().to_string();
    if let Some(query) = path.find('?') {
        path.truncate(query);
    }
    let rel = path.trim_start_matches('/');
    // Path-traversal guard: reject any `..` segment. The server is bound to
    // 127.0.0.1 only and serves our own bundle, but this keeps a hostile path
    // (e.g. `/../../etc/passwd`) from ever escaping `root`.
    if rel.split('/').any(|segment| segment == "..") {
        return request
            .respond(
                tiny_http::Response::from_string("forbidden").with_status_code(403),
            )
            .map_err(|_| "respond failed".to_string());
    }
    let candidate = root.join(rel);
    let (file, status) = if candidate.is_file() {
        (candidate, 200)
    } else if std::path::Path::new(rel).extension().is_none() {
        // SPA fallback (no extension → client-side route, e.g. /projects).
        // `candidate` does not exist on disk for routes — that is expected;
        // the web router takes over after we hand it index.html.
        (root.join("index.html"), 200)
    } else {
        let _ = request.respond(
            tiny_http::Response::from_string("not found").with_status_code(404),
        );
        return Ok(());
    };
    let bytes = std::fs::read(&file).map_err(|e| e.to_string())?;
    let mime = mime_for(&file);
    let response = tiny_http::Response::from_data(bytes)
        .with_status_code(status)
        .with_header(
            tiny_http::Header::from_bytes(&b"Content-Type"[..], mime.as_bytes())
                .map_err(|_| "invalid Content-Type header".to_string())?,
        );
    request
        .respond(response)
        .map_err(|_| "respond failed".to_string())
}

#[cfg(not(dev))]
fn mime_for(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
    {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "wasm" => "application/wasm",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "ttf" => "font/ttf",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

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

/// Absolute path of the Stronghold snapshot the web front-end loads
/// (packages/db/src/owner-token.ts). The plugin resolves a RELATIVE
/// snapshot path against the process cwd — which lands the vault file in
/// the source tree during `tauri dev` and next to the launcher in a
/// release build — so the JS side must receive an absolute path here.
/// The parent dir is created by `setup()` before the plugin builds.
#[tauri::command]
fn stronghold_snapshot_path(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(dir.join("nextdo-stronghold").to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(OwnerTokenStore::default())
        .setup(|app| {
            // Initialize the Stronghold plugin with the Argon2 password-hash.
            // The salt lives in the app-local data dir so the derived key is
            // stable across launches; the JS side
            // (`packages/db/src/owner-token.ts`) drives the store via the
            // plugin's built-in commands, using the absolute snapshot path
            // from `stronghold_snapshot_path` (see above).
            // The plugin writes the salt file but does NOT create the parent
            // directory itself — on a fresh machine the write panics with
            // "Failed to write salt: NotFound". Ensure the dir exists first.
            let data_dir = app
                .path()
                .app_local_data_dir()
                .expect("could not resolve app-local data dir");
            std::fs::create_dir_all(&data_dir)
                .expect("could not create app-local data dir");
            let salt_path = data_dir.join("stronghold-salt");
            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;

            // Release builds serve the bundle from the loopback server so the
            // page runs on a real http origin (module-worker requirement —
            // see the module docs). The server must be up BEFORE the window
            // loads, which is why the window is created HERE instead of in
            // tauri.conf.json `app.windows` (config windows are created
            // before setup runs).
            #[cfg(not(dev))]
            start_frontend_server(app.handle())?;

            // Label MUST stay "main" — capabilities/default.json grants the
            // Stronghold permissions to that window label.
            {
                // `WebviewUrl::App` resolves the path against the app base URL,
                // which Tauri sets to `devUrl` in dev and to `frontendDist`
                // (a URL here) in release — see `AppManager::get_app_url`. An
                // empty path loads that base: the Expo dev server in dev, the
                // loopback frontend server in release. Either way the page runs
                // on a REAL http origin (PowerSync's module worker is rejected
                // under the `tauri://` custom-protocol's opaque origin).
                let url = tauri::WebviewUrl::App(std::path::PathBuf::from(""));
                tauri::WebviewWindowBuilder::new(app, "main", url)
                    .title("Nextdo")
                    .inner_size(1200.0, 800.0)
                    .build()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_owner_token,
            load_owner_token,
            stronghold_snapshot_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nextdo desktop");
}
