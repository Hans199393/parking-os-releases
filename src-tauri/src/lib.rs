use bcrypt::{hash, verify, DEFAULT_COST};
use tauri::AppHandle;
use base64::Engine;
use std::sync::{Arc, Mutex};
use std::process::Child;

// ─── PWA server process management ──────────────────────────────────────────
pub struct PwaServer(pub Arc<Mutex<Option<Child>>>);

#[tauri::command]
fn spawn_pwa(state: tauri::State<'_, PwaServer>) -> Result<u16, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;

    // Kill previous instance if still running
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }

    // pwa dir: zawsze <parking_os>/pwa — niezależnie od working dir
    // CARGO_MANIFEST_DIR wskazuje na src-tauri/, cofamy się o jeden poziom
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let pwa_dir = manifest_dir.parent()
        .ok_or("Nie można znaleźć katalogu nadrzędnego".to_string())?
        .join("pwa");

    if !pwa_dir.exists() {
        return Err(format!("Katalog PWA nie znaleziony: {}", pwa_dir.display()));
    }

    // On Windows npm is a .cmd script — must run through cmd.exe
    let child = std::process::Command::new("cmd")
        .args(["/c", "npm", "run", "dev"])
        .current_dir(&pwa_dir)
        .spawn()
        .map_err(|e| format!("Nie można uruchomić serwera PWA: {}", e))?;

    *guard = Some(child);
    Ok(3001)
}

#[tauri::command]
fn stop_pwa(state: tauri::State<'_, PwaServer>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
fn hash_password(password: String) -> Result<String, String> {
    hash(password, DEFAULT_COST).map_err(|e| e.to_string())
}

#[tauri::command]
fn verify_password(password: String, hashed: String) -> Result<bool, String> {
    verify(password, &hashed).map_err(|e| e.to_string())
}

#[tauri::command]
async fn send_notification(app: AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn fetch_snapshot(url: String) -> Result<String, String> {
    // Parsuj URL i wyciągnij credentials
    let mut parsed = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    let username = if !parsed.username().is_empty() {
        Some(parsed.username().to_string())
    } else {
        None
    };
    let password = parsed.password().map(|s| s.to_string());
    // Usuń credentials z URL przed wysłaniem
    parsed.set_username("").ok();
    parsed.set_password(None).ok();

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let mut builder = client.get(parsed);
    if let Some(user) = username {
        builder = builder.basic_auth(user, password);
    }

    let response = builder.send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    // Sprawdź czy to faktycznie obraz (JPEG: FF D8 FF, PNG: 89 50 4E 47)
    let is_jpeg = bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF;
    let is_png  = bytes.len() >= 4 && bytes[0] == 0x89 && bytes[1] == 0x50;
    if !is_jpeg && !is_png {
        let preview = String::from_utf8_lossy(&bytes[..bytes.len().min(120)]).to_string();
        return Err(format!("Odpowiedź nie jest obrazem (otrzymano: {}...)", preview.trim()));
    }
    let mime = if is_png { "image/png" } else { "image/jpeg" };
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PwaServer(Arc::new(Mutex::new(None))))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            hash_password,
            verify_password,
            send_notification,
            fetch_snapshot,
            spawn_pwa,
            stop_pwa
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
