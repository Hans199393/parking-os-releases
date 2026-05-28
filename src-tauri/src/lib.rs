use bcrypt::{hash, verify, DEFAULT_COST};
use tauri::{AppHandle, Emitter, Manager};
use base64::Engine;
use std::sync::{Arc, Mutex};
use std::process::Child;
use serde::Serialize;
use mailparse::MailHeaderMap;
use serde::Deserialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::time::Duration;

const DEV_FFMPEG_PATH: &str = r"G:\parking_2026\ffmpeg-8.1-essentials_build\bin\ffmpeg.exe";
const CAMERA_PROXY_LOG_FILE: &str = "camera-proxy.log";
const LEGACY_CAMERA_RTSP_MIGRATIONS: [(&str, &str, &str, &str); 2] = [
    (
        "cam1_rtsp_url",
        "192.168.0.50:37777",
        "/cam/realmonitor?channel=1&subtype=0",
        "192.168.0.51:554",
    ),
    (
        "cam3_rtsp_url",
        "192.168.0.53:554",
        "/onvif1",
        "192.168.0.50:554",
    ),
];

#[derive(Deserialize)]
struct ProxyHealthCamera {
    id: String,
}

#[derive(Deserialize)]
struct ProxyHealthPayload {
    status: Option<String>,
    #[serde(default)]
    cameras: Vec<ProxyHealthCamera>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HelperUpdateLaunchResult {
    file_path: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HelperUpdateProgressPayload {
    phase: String,
    content_length: Option<u64>,
    chunk_length: u64,
}

const HELPER_UPDATE_PROGRESS_EVENT: &str = "helper-update-progress";

enum ExistingProxyState {
    None,
    Ready,
    OccupiedButIncomplete,
}

fn migrate_legacy_rtsp_url(
    value: &str,
    legacy_host: &str,
    legacy_path: &str,
    current_host: &str,
) -> Option<String> {
    let scheme_separator = "://";
    let scheme_index = value.find(scheme_separator)?;
    let authority_start = scheme_index + scheme_separator.len();
    let path_index = value[authority_start..].find('/')? + authority_start;
    let authority = &value[authority_start..path_index];
    let path = &value[path_index..];

    if path != legacy_path {
        return None;
    }

    let host = authority.rsplit('@').next()?;
    if host != legacy_host {
        return None;
    }

    let userinfo = authority.strip_suffix(host).unwrap_or("");

    Some(format!(
        "{}{}{}{}",
        &value[..authority_start],
        userinfo,
        current_host,
        path
    ))
}

#[cfg(windows)]
fn normalize_runtime_path(path: &Path) -> PathBuf {
    let raw = path.to_string_lossy();

    if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{}", stripped));
    }

    if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        return PathBuf::from(stripped);
    }

    path.to_path_buf()
}

#[cfg(not(windows))]
fn normalize_runtime_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

struct ProxyRuntimePaths {
    proxy_dir: PathBuf,
    server_js: PathBuf,
    server_js_exists: bool,
    bundled_node_exists: bool,
    bundled_ffmpeg_exists: bool,
    node_cmd: String,
    ffmpeg_path: String,
}

fn command_available(command: &str) -> bool {
    std::process::Command::new(command)
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn resolve_proxy_runtime_paths(app: &AppHandle) -> ProxyRuntimePaths {
    let resource_dir = normalize_runtime_path(&app.path().resource_dir().unwrap_or_default());
    let repo_dir = normalize_runtime_path(&PathBuf::from(env!("CARGO_MANIFEST_DIR")));

    let bundled_proxy_dir = resource_dir.join("rtsp-proxy");
    let repo_proxy_dir = repo_dir.join("../rtsp-proxy");
    let bundled_server_js = bundled_proxy_dir.join("server.js");
    let repo_server_js = repo_proxy_dir.join("server.js");

    let (proxy_dir, server_js) = if bundled_server_js.exists() {
        (bundled_proxy_dir, bundled_server_js)
    } else {
        (repo_proxy_dir, repo_server_js)
    };

    let bundled_node = resource_dir.join("bin").join("node.exe");
    let repo_node = repo_dir.join("bin").join("node.exe");
    let node_cmd = if bundled_node.exists() {
        bundled_node.to_string_lossy().to_string()
    } else if repo_node.exists() {
        repo_node.to_string_lossy().to_string()
    } else {
        "node".to_string()
    };

    let bundled_ffmpeg = resource_dir.join("bin").join("ffmpeg.exe");
    let repo_ffmpeg = repo_dir.join("bin").join("ffmpeg.exe");
    let ffmpeg_path = if bundled_ffmpeg.exists() {
        bundled_ffmpeg.to_string_lossy().to_string()
    } else if repo_ffmpeg.exists() {
        repo_ffmpeg.to_string_lossy().to_string()
    } else if Path::new(DEV_FFMPEG_PATH).exists() {
        DEV_FFMPEG_PATH.to_string()
    } else {
        "ffmpeg".to_string()
    };

    ProxyRuntimePaths {
        proxy_dir,
        server_js_exists: server_js.exists(),
        server_js,
        bundled_node_exists: bundled_node.exists() || repo_node.exists() || command_available("node"),
        bundled_ffmpeg_exists: bundled_ffmpeg.exists()
            || repo_ffmpeg.exists()
            || Path::new(DEV_FFMPEG_PATH).exists()
            || command_available("ffmpeg"),
        node_cmd,
        ffmpeg_path,
    }
}

fn read_settings_json(app: &AppHandle) -> Value {
    app.path()
        .app_data_dir()
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join("settings.json")).ok())
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .unwrap_or_else(|| Value::Object(Default::default()))
}

fn migrate_legacy_camera_settings(app: &AppHandle) -> Result<bool, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let settings_path = app_data_dir.join("settings.json");
    if !settings_path.exists() {
        return Ok(false);
    }

    let raw = std::fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
    let mut settings = serde_json::from_str::<Value>(&raw).map_err(|e| e.to_string())?;
    let Some(object) = settings.as_object_mut() else {
        return Ok(false);
    };

    let mut changed = false;

    for (key, legacy_host, legacy_path, current_host) in LEGACY_CAMERA_RTSP_MIGRATIONS {
        if let Some(updated_value) = object
            .get(key)
            .and_then(Value::as_str)
            .and_then(|value| migrate_legacy_rtsp_url(value, legacy_host, legacy_path, current_host))
        {
            object.insert(key.to_string(), Value::String(updated_value));
            changed = true;
        }
    }

    if changed {
        let serialized = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
        std::fs::write(&settings_path, serialized).map_err(|e| e.to_string())?;
    }

    Ok(changed)
}

fn read_setting_string(settings: &Value, key: &str) -> String {
    settings
        .get(key)
        .and_then(|value| match value {
            Value::String(value) => Some(value.clone()),
            Value::Number(value) => Some(value.to_string()),
            Value::Bool(value) => Some(value.to_string()),
            _ => None,
        })
        .unwrap_or_default()
}

fn expected_proxy_camera_ids(app: &AppHandle) -> Vec<String> {
    let settings = read_settings_json(app);
    [
        ("cam1", "cam1_rtsp_url"),
        ("cam2", "cam2_rtsp_url"),
        ("cam3", "cam3_rtsp_url"),
        ("cam4", "cam4_rtsp_url"),
    ]
    .into_iter()
    .filter_map(|(camera_id, key)| {
        let value = read_setting_string(&settings, key);
        if value.trim().is_empty() {
            None
        } else {
            Some(camera_id.to_string())
        }
    })
    .collect()
}

fn detect_existing_proxy_state(app: &AppHandle) -> ExistingProxyState {
    let expected_cameras = expected_proxy_camera_ids(app);
    if expected_cameras.is_empty() {
        return ExistingProxyState::None;
    }

    let client = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(1200))
        .build()
    {
        Ok(client) => client,
        Err(_) => return ExistingProxyState::None,
    };

    let response = match client.get("http://127.0.0.1:8888/").send() {
        Ok(response) => response,
        Err(_) => return ExistingProxyState::None,
    };

    if !response.status().is_success() {
        return ExistingProxyState::OccupiedButIncomplete;
    }

    let payload = match response.json::<ProxyHealthPayload>() {
        Ok(payload) => payload,
        Err(_) => return ExistingProxyState::OccupiedButIncomplete,
    };

    let lists_expected_cameras = payload.status.as_deref() == Some("running")
        && expected_cameras.iter().all(|camera_id| {
            payload
                .cameras
                .iter()
                .any(|camera| camera.id == camera_id.as_str())
        });

    if !lists_expected_cameras {
        return ExistingProxyState::OccupiedButIncomplete;
    }

    let manifests_ok = expected_cameras.iter().all(|camera_id| {
        client
            .get(format!("http://127.0.0.1:8888/stream/{}.m3u8", camera_id))
            .send()
            .map(|response| response.status().is_success())
            .unwrap_or(false)
    });

    if manifests_ok {
        ExistingProxyState::Ready
    } else {
        ExistingProxyState::OccupiedButIncomplete
    }
}

fn proxy_log_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    Ok(app_data_dir.join(CAMERA_PROXY_LOG_FILE))
}

fn proxy_log_timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

fn append_proxy_log(app: &AppHandle, message: &str) {
    let Ok(log_path) = proxy_log_path(app) else {
        return;
    };

    if let Ok(metadata) = std::fs::metadata(&log_path) {
        if metadata.len() > 1_000_000 {
            let _ = std::fs::write(&log_path, "");
        }
    }

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) {
        let _ = writeln!(file, "[{}] {}", proxy_log_timestamp(), message);
    }
}

fn read_proxy_log_tail(app: &AppHandle, max_lines: usize) -> Result<String, String> {
    let log_path = proxy_log_path(app)?;
    if !log_path.exists() {
        return Ok(String::new());
    }

    let raw = std::fs::read_to_string(&log_path).map_err(|e| e.to_string())?;
    let lines: Vec<&str> = raw.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    Ok(lines[start..].join("\n"))
}

fn kill_proxy_child(child: &mut Child) {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }

    #[cfg(not(windows))]
    {
        let _ = child.kill();
    }

    let _ = child.wait();
}

fn build_proxy_command(app: &AppHandle) -> Result<std::process::Command, String> {
    let runtime = resolve_proxy_runtime_paths(app);
    if !runtime.server_js_exists || !runtime.bundled_node_exists || !runtime.bundled_ffmpeg_exists {
        return Err("Brakuje lokalnego runtime kamer. Ten komputer potrzebuje pełnego update z pakietem Node.js, ffmpeg i RTSP proxy.".into());
    }

    let settings = read_settings_json(app);
    let cam1_rtsp = read_setting_string(&settings, "cam1_rtsp_url");
    let cam2_rtsp = read_setting_string(&settings, "cam2_rtsp_url");
    let cam3_rtsp = read_setting_string(&settings, "cam3_rtsp_url");
    let cam4_rtsp = read_setting_string(&settings, "cam4_rtsp_url");

    let log_path = proxy_log_path(app)?;
    if let Ok(metadata) = std::fs::metadata(&log_path) {
        if metadata.len() > 1_000_000 {
            let _ = std::fs::write(&log_path, "");
        }
    }

    let mut log_header = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Nie można otworzyć logu proxy: {}", e))?;
    writeln!(log_header, "\n===== {} proxy start =====", proxy_log_timestamp())
        .map_err(|e| format!("Nie można zapisać logu proxy: {}", e))?;

    let stdout_log = log_header
        .try_clone()
        .map_err(|e| format!("Nie można sklonować logu proxy: {}", e))?;
    let stderr_log = log_header
        .try_clone()
        .map_err(|e| format!("Nie można sklonować logu proxy: {}", e))?;

    append_proxy_log(
        app,
        &format!(
            "[proxy] start node={} ffmpeg={} server={}",
            runtime.node_cmd,
            runtime.ffmpeg_path,
            runtime.server_js.display()
        ),
    );

    let mut cmd = std::process::Command::new(&runtime.node_cmd);
    cmd.arg(&runtime.server_js)
        .current_dir(&runtime.proxy_dir)
        .env("FFMPEG_PATH", &runtime.ffmpeg_path)
        .stdout(std::process::Stdio::from(stdout_log))
        .stderr(std::process::Stdio::from(stderr_log));

    if !cam1_rtsp.trim().is_empty() {
        cmd.env("CAM1_RTSP", cam1_rtsp);
    }
    if !cam2_rtsp.trim().is_empty() {
        cmd.env("CAM2_RTSP", cam2_rtsp);
    }
    if !cam3_rtsp.trim().is_empty() {
        cmd.env("CAM3_RTSP", cam3_rtsp);
    }
    if !cam4_rtsp.trim().is_empty() {
        cmd.env("CAM4_RTSP", cam4_rtsp);
    }

    Ok(cmd)
}

fn start_proxy_process(app: &AppHandle, process: &ProxyProcess, force_restart: bool) -> Result<(), String> {
    let mut guard = process.0.lock().map_err(|e| e.to_string())?;

    let already_running = if let Some(child) = guard.as_mut() {
        matches!(child.try_wait(), Ok(None))
    } else {
        false
    };

    if already_running && !force_restart {
        append_proxy_log(app, "[proxy] Start pominięty — proces już działa.");
        return Ok(());
    }

    if !already_running {
        match detect_existing_proxy_state(app) {
            ExistingProxyState::Ready => {
                let _ = guard.take();
                append_proxy_log(app, "[proxy] Start pominięty — lokalny proxy już odpowiada i udostepnia oczekiwane streamy.");
                return Ok(());
            }
            ExistingProxyState::OccupiedButIncomplete => {
                let _ = guard.take();
                let message = "Port 8888 jest zajety przez inna instancje proxy kamer, ale nie udostepnia wszystkich oczekiwanych streamow. Zamknij stare procesy node/mediamtx i uruchom proxy ponownie.";
                append_proxy_log(app, &format!("[proxy] {}", message));
                return Err(message.to_string());
            }
            ExistingProxyState::None => {}
        }
    }

    if let Some(mut child) = guard.take() {
        append_proxy_log(app, "[proxy] Zatrzymywanie poprzedniej instancji...");
        kill_proxy_child(&mut child);
    }

    let mut cmd = build_proxy_command(app)?;
    match cmd.spawn() {
        Ok(child) => {
            *guard = Some(child);
            append_proxy_log(app, "[proxy] Proces node uruchomiony.");
            Ok(())
        }
        Err(e) => {
            append_proxy_log(app, &format!("[proxy] Nie można uruchomić node: {}", e));
            Err(format!("Nie można uruchomić lokalnego proxy kamer: {}", e))
        }
    }
}

// ─── Email types ─────────────────────────────────────────────────────────────
#[derive(Serialize, Clone)]
pub struct EmailMessage {
    pub uid: u32,
    pub subject: String,
    pub from: String,
    pub date: String,
    pub is_read: bool,
}

// ─── IMAP helper ─────────────────────────────────────────────────────────────
fn imap_session(
    host: &str,
    port: u16,
    user: &str,
    pass: &str,
) -> Result<imap::Session<native_tls::TlsStream<std::net::TcpStream>>, String> {
    let tls = native_tls::TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| e.to_string())?;
    let client = imap::connect((host, port), host, &tls)
        .map_err(|e: imap::Error| e.to_string())?;
    client.login(user, pass)
        .map_err(|(e, _): (imap::Error, _)| e.to_string())
}

fn find_part_body(mail: &mailparse::ParsedMail, mime: &str) -> Option<String> {
    if mail.ctype.mimetype == mime {
        return mail.get_body().ok();
    }
    for sub in &mail.subparts {
        if let Some(body) = find_part_body(sub, mime) {
            return Some(body);
        }
    }
    None
}

// ─── Email commands ───────────────────────────────────────────────────────────
#[tauri::command]
fn get_logo_base64() -> String {
    use base64::Engine;
    let bytes = include_bytes!("../../public/logo2026.png");
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    format!("data:image/png;base64,{}", b64)
}

#[tauri::command]
async fn email_test_imap(imap_host: String, imap_port: u16, user: String, pass: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let mut session = imap_session(&imap_host, imap_port, &user, &pass)?;
        session.logout().ok();
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn email_fetch_list(imap_host: String, imap_port: u16, user: String, pass: String) -> Result<Vec<EmailMessage>, String> {
    tokio::task::spawn_blocking(move || {
        let mut session = imap_session(&imap_host, imap_port, &user, &pass)?;
        let mailbox = session.select("INBOX").map_err(|e| e.to_string())?;
        let total = mailbox.exists;
        if total == 0 {
            session.logout().ok();
            return Ok(vec![]);
        }
        let range = if total > 50 { format!("{}:*", total.saturating_sub(49)) } else { "1:*".to_string() };
        let messages = session.fetch(&range, "(UID FLAGS BODY.PEEK[HEADER])").map_err(|e| e.to_string())?;

        let mut result: Vec<EmailMessage> = Vec::new();
        for msg in messages.iter() {
            let uid = msg.uid.unwrap_or(0);
            let is_read = msg.flags().iter().any(|f| *f == imap::types::Flag::Seen);
            let header_bytes = msg.header().unwrap_or(&[]);
            let (headers, _) = mailparse::parse_headers(header_bytes).unwrap_or_default();
            let subject = headers.get_first_value("Subject").unwrap_or_else(|| "(bez tematu)".into());
            let from = headers.get_first_value("From").unwrap_or_else(|| "(nieznany)".into());
            let date = headers.get_first_value("Date").unwrap_or_default();
            result.push(EmailMessage { uid, subject, from, date, is_read });
        }
        result.sort_by(|a, b| b.uid.cmp(&a.uid));
        session.logout().ok();
        Ok(result)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn email_fetch_body(imap_host: String, imap_port: u16, user: String, pass: String, uid: u32, folder: Option<String>) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let mut session = imap_session(&imap_host, imap_port, &user, &pass)?;
        let folder_name = folder.unwrap_or_else(|| "INBOX".to_string());
        session.select(&folder_name).map_err(|e| e.to_string())?;
        let messages = session.uid_fetch(uid.to_string(), "BODY[]").map_err(|e| e.to_string())?;
        let raw = messages.iter().next().and_then(|m| m.body()).unwrap_or(&[]);
        let parsed = mailparse::parse_mail(raw).map_err(|e| e.to_string())?;
        // Mark as read
        session.uid_store(uid.to_string(), "+FLAGS (\\Seen)").ok();
        session.logout().ok();
        if let Some(html) = find_part_body(&parsed, "text/html") {
            return Ok(html);
        }
        let text = find_part_body(&parsed, "text/plain").unwrap_or_else(|| "(brak treści)".into());
        let escaped = text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
        Ok(format!("<pre style='white-space:pre-wrap;font-family:sans-serif;font-size:14px;line-height:1.6'>{}</pre>", escaped))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn email_fetch_sent_body(imap_host: String, imap_port: u16, user: String, pass: String, uid: u32) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let mut session = imap_session(&imap_host, imap_port, &user, &pass)?;
        let sent_folder = {
            let names: Vec<String> = match session.list(None, Some("*")) {
                Ok(folders) => folders.iter().map(|n| n.name().to_string()).collect(),
                Err(_) => vec![],
            };
            names.iter()
                .find(|n| {
                    let l = n.to_lowercase();
                    l == "sent" || l == "sent messages" || l == "sent items" || l.contains("sent")
                })
                .cloned()
                .unwrap_or_else(|| "Sent".to_string())
        };
        session.select(&sent_folder).map_err(|e| e.to_string())?;
        let messages = session.uid_fetch(uid.to_string(), "BODY[]").map_err(|e| e.to_string())?;
        let raw = messages.iter().next().and_then(|m| m.body()).unwrap_or(&[]);
        let parsed = mailparse::parse_mail(raw).map_err(|e| e.to_string())?;
        session.logout().ok();
        if let Some(html) = find_part_body(&parsed, "text/html") {
            return Ok(html);
        }
        let text = find_part_body(&parsed, "text/plain").unwrap_or_else(|| "(brak treści)".into());
        let escaped = text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
        Ok(format!("<pre style='white-space:pre-wrap;font-family:sans-serif;font-size:14px;line-height:1.6'>{}</pre>", escaped))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn email_send(imap_host: String, imap_port: u16, smtp_host: String, smtp_port: u16, user: String, pass: String, to: String, subject: String, body: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        use lettre::{Message, SmtpTransport, Transport};
        use lettre::transport::smtp::authentication::Credentials;
        use lettre::message::header::ContentType;
        use lettre::message::{Mailbox, MultiPart, SinglePart, Attachment};
        use std::time::{SystemTime, UNIX_EPOCH};

        let from: Mailbox = user.parse().map_err(|_| "Nieprawidłowy adres nadawcy".to_string())?;
        let to_mb: Mailbox = to.parse().map_err(|_| "Nieprawidłowy adres odbiorcy".to_string())?;
        let reply_mb: Mailbox = user.parse().map_err(|_| "Nieprawidłowy adres Reply-To".to_string())?;

        // Domena nadawcy do Message-ID (DMARC alignment)
        let sender_domain = user.split('@').nth(1).unwrap_or("localhost").to_string();
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let pid = std::process::id();
        let message_id_value = format!("{}.{}@{}", nanos, pid, sender_domain);

        // Plain-text fallback z HTML (proste strip tagów + decode entities)
        let plain_text = html_to_plain(&body);

        // HTML body referencing inline logo via CID
        let html_part = SinglePart::builder()
            .header(ContentType::TEXT_HTML)
            .body(body);

        // Inline logo attachment (CID = logo@parking)
        let logo_bytes = include_bytes!("../../public/logo2026.png").to_vec();
        let logo_part = Attachment::new_inline(String::from("logo@parking"))
            .body(logo_bytes, ContentType::parse("image/png").unwrap());

        // Plain-text part (text/plain; charset=utf-8)
        let plain_part = SinglePart::builder()
            .header(ContentType::TEXT_PLAIN)
            .body(plain_text);

        // Hierarchia: multipart/alternative { text/plain, multipart/related { html, logo } }
        let html_with_logo = MultiPart::related()
            .singlepart(html_part)
            .singlepart(logo_part);

        let alternative = MultiPart::alternative()
            .singlepart(plain_part)
            .multipart(html_with_logo);

        let email = Message::builder()
            .from(from)
            .reply_to(reply_mb)
            .to(to_mb)
            .subject(subject)
            .message_id(Some(message_id_value))
            .multipart(alternative)
            .map_err(|e| e.to_string())?;

        // Build raw bytes for IMAP APPEND (Sent folder)
        let raw_email = email.formatted();

        let creds = Credentials::new(user.clone(), pass.clone());
        let mailer = if smtp_port == 465 {
            SmtpTransport::relay(&smtp_host)
                .map_err(|e| e.to_string())?
                .port(smtp_port)
                .credentials(creds)
                .build()
        } else {
            SmtpTransport::starttls_relay(&smtp_host)
                .map_err(|e| e.to_string())?
                .port(smtp_port)
                .credentials(creds)
                .build()
        };
        mailer.send(&email).map_err(|e| e.to_string())?;

        // Save to Sent folder via IMAP APPEND
        let mut session = imap_session(&imap_host, imap_port, &user, &pass)?;
        // Find the Sent folder name (OVH uses "Sent" or "Sent Messages")
        let sent_folder = {
            let names: Vec<String> = match session.list(None, Some("*")) {
                Ok(folders) => folders.iter().map(|n| n.name().to_string()).collect(),
                Err(_) => vec![],
            };
            names.iter()
                .find(|n| {
                    let l = n.to_lowercase();
                    l == "sent" || l == "sent messages" || l == "sent items" || l.contains("sent")
                })
                .cloned()
                .unwrap_or_else(|| "Sent".to_string())
        };
        session.append(&sent_folder, &raw_email).map_err(|e| e.to_string())?;
        session.logout().ok();
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

/// Iter 13: Konwertuje HTML na prosty text/plain jako alternatywa dla klientów
/// które nie wyświetlają HTML (oraz dla filtrów spamu Gmaila — wymagają text alt).
/// UWAGA: pracuje na &str / char (nie na bajtach) — UTF-8 safe dla polskich znaków.
fn html_to_plain(html: &str) -> String {
    // 1. Usuń <style>...</style> i <script>...</script> wraz z zawartością
    //    (case-insensitive — szukamy w lowercase kopii, ale wycinamy z oryginału po byte-index'ach
    //    które są tożsame, bo lowercasowanie ASCII tagów nie zmienia długości w bajtach).
    let lower = html.to_ascii_lowercase();
    let mut cleaned = String::with_capacity(html.len());
    let mut cursor_b: usize = 0; // byte index w oryginale (== w lower bo ASCII-lowercase)
    while cursor_b < html.len() {
        // znajdź najbliższy <style albo <script
        let next_style = lower[cursor_b..].find("<style").map(|i| (i + cursor_b, "</style>"));
        let next_script = lower[cursor_b..].find("<script").map(|i| (i + cursor_b, "</script>"));
        let (open_at, close_tag) = match (next_style, next_script) {
            (Some(a), Some(b)) => if a.0 < b.0 { a } else { b },
            (Some(a), None) => a,
            (None, Some(b)) => b,
            (None, None) => {
                // Brak więcej style/script — dopisz resztę i zakończ
                cleaned.push_str(&html[cursor_b..]);
                break;
            }
        };
        // dopisz wszystko PRZED otwierającym tagiem
        cleaned.push_str(&html[cursor_b..open_at]);
        // znajdź koniec close_tag (>... </style> lub </script>)
        let after_open = match lower[open_at..].find('>') {
            Some(off) => open_at + off + 1,
            None => { // niedomknięty tag — wytnij wszystko do końca
                break;
            }
        };
        let close_at = match lower[after_open..].find(close_tag) {
            Some(off) => after_open + off + close_tag.len(),
            None => { // niedomknięty — wytnij do końca
                break;
            }
        };
        cursor_b = close_at;
    }

    // 2. Zamień <br>, </p>, </div>, </tr>, <li> na newline — case-insensitive
    let mut t = cleaned;
    let replacements: &[(&str, &str)] = &[
        ("<br>", "\n"), ("<br/>", "\n"), ("<br />", "\n"),
        ("</p>", "\n\n"), ("</div>", "\n"), ("</tr>", "\n"),
        ("</h1>", "\n\n"), ("</h2>", "\n\n"), ("</h3>", "\n\n"),
        ("<li>", "\n• "), ("</li>", ""),
    ];
    for (pat, repl) in replacements {
        // Case-insensitive replace pracując na lowercase mapie
        loop {
            let lt = t.to_ascii_lowercase();
            match lt.find(pat) {
                Some(idx) => {
                    let end = idx + pat.len();
                    let mut new_s = String::with_capacity(t.len());
                    new_s.push_str(&t[..idx]);
                    new_s.push_str(repl);
                    new_s.push_str(&t[end..]);
                    t = new_s;
                }
                None => break,
            }
        }
    }

    // 3. Usuń wszystkie pozostałe tagi (operacja na CHARS, nie bajtach — UTF-8 safe)
    let mut out = String::with_capacity(t.len());
    let mut in_tag = false;
    for ch in t.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }

    // 4. Dekoduj najpopularniejsze entity
    let out = out
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'");

    // 5. Skompresuj wielokrotne puste linie
    let lines: Vec<&str> = out.lines().map(|l| l.trim_end()).collect();
    let mut compressed = String::with_capacity(out.len());
    let mut prev_blank = false;
    for line in lines {
        let blank = line.trim().is_empty();
        if blank && prev_blank { continue; }
        compressed.push_str(line);
        compressed.push('\n');
        prev_blank = blank;
    }
    let trimmed = compressed.trim().to_string();
    if trimmed.is_empty() {
        "(treść w wersji HTML)".to_string()
    } else {
        trimmed
    }
}

#[tauri::command]
async fn email_fetch_sent(imap_host: String, imap_port: u16, user: String, pass: String) -> Result<Vec<EmailMessage>, String> {
    tokio::task::spawn_blocking(move || {
        let mut session = imap_session(&imap_host, imap_port, &user, &pass)?;
        // Try common Sent folder names
        let sent_folder = {
            let names: Vec<String> = match session.list(None, Some("*")) {
                Ok(folders) => folders.iter().map(|n| n.name().to_string()).collect(),
                Err(_) => vec![],
            };
            names.iter()
                .find(|n| {
                    let l = n.to_lowercase();
                    l == "sent" || l == "sent messages" || l == "sent items" || l.contains("sent")
                })
                .cloned()
                .unwrap_or_else(|| "Sent".to_string())
        };
        let mailbox = session.select(&sent_folder).map_err(|e| e.to_string())?;
        let total = mailbox.exists;
        if total == 0 {
            session.logout().ok();
            return Ok(vec![]);
        }
        let range = if total > 50 { format!("{}:*", total.saturating_sub(49)) } else { "1:*".to_string() };
        let messages = session.fetch(&range, "(UID FLAGS BODY.PEEK[HEADER])").map_err(|e| e.to_string())?;
        let mut result: Vec<EmailMessage> = Vec::new();
        for msg in messages.iter() {
            let uid = msg.uid.unwrap_or(0);
            let is_read = msg.flags().iter().any(|f| *f == imap::types::Flag::Seen);
            let header_bytes = msg.header().unwrap_or(&[]);
            let (headers, _) = mailparse::parse_headers(header_bytes).unwrap_or_default();
            let subject = headers.get_first_value("Subject").unwrap_or_else(|| "(bez tematu)".into());
            let from = headers.get_first_value("To").unwrap_or_else(|| "(nieznany)".into());
            let date = headers.get_first_value("Date").unwrap_or_default();
            result.push(EmailMessage { uid, subject, from, date, is_read });
        }
        result.sort_by(|a, b| b.uid.cmp(&a.uid));
        session.logout().ok();
        Ok(result)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn email_delete(imap_host: String, imap_port: u16, user: String, pass: String, uid: u32) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let mut session = imap_session(&imap_host, imap_port, &user, &pass)?;
        session.select("INBOX").map_err(|e| e.to_string())?;
        let uid_str = uid.to_string();
        session.uid_store(&uid_str, "+FLAGS (\\Deleted)").map_err(|e| e.to_string())?;
        session.expunge().map_err(|e| e.to_string())?;
        session.logout().ok();
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

// ─────────────────────────────────────────────────────────────────────────────

// ─── Detector process management ─────────────────────────────────────────────
pub struct DetectorProcess(pub Arc<Mutex<Option<Child>>>);

#[tauri::command]
fn spawn_detector(
    state: tauri::State<'_, DetectorProcess>,
    rtsp_url: String,
    db_path: String,
    roi: Option<String>,
    line: Option<f64>,
) -> Result<u16, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;

    // Zatrzymaj poprzednią instancję
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }

    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let detector_py = manifest_dir
        .parent()
        .ok_or("Nie można znaleźć katalogu głównego")?
        .join("detection")
        .join("detector.py");

    if !detector_py.exists() {
        return Err(format!("Nie znaleziono detector.py: {}", detector_py.display()));
    }

    let mut cmd = std::process::Command::new("python");
    cmd.arg(detector_py.to_str().unwrap_or(""))
        .arg("--rtsp").arg(&rtsp_url)
        .arg("--db").arg(&db_path)
        .arg("--port").arg("8890");

    if let Some(r) = roi {
        cmd.arg("--roi").arg(r);
    }
    if let Some(l) = line {
        cmd.arg("--line").arg(l.to_string());
    }

    let child = cmd.spawn().map_err(|e| format!("Nie można uruchomić detektora: {}", e))?;
    *guard = Some(child);
    Ok(8890)
}

#[tauri::command]
fn stop_detector(state: tauri::State<'_, DetectorProcess>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

#[tauri::command]
fn detector_is_running(state: tauri::State<'_, DetectorProcess>) -> bool {
    let mut guard = match state.0.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    if let Some(child) = guard.as_mut() {
        match child.try_wait() {
            Ok(None) => true,  // Nadal działa
            _ => {
                *guard = None;
                false
            }
        }
    } else {
        false
    }
}

// ─── PWA server process management ──────────────────────────────────────────
pub struct PwaServer(pub Arc<Mutex<Option<Child>>>);

// ─── Ollama process management ───────────────────────────────────────────────
pub struct OllamaProcess(pub Arc<Mutex<Option<Child>>>);

#[tauri::command]
fn start_ollama(state: tauri::State<'_, OllamaProcess>) -> Result<String, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.as_mut() {
        if matches!(child.try_wait(), Ok(None)) {
            return Ok("already_running".to_string());
        }
    }
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let mut cmd = std::process::Command::new("ollama");
    cmd.arg("serve");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    match cmd.spawn() {
        Ok(child) => {
            *guard = Some(child);
            Ok("started".to_string())
        }
        Err(e) => Err(format!("Nie można uruchomić ollama serve: {}", e)),
    }
}

#[tauri::command]
fn stop_ollama(state: tauri::State<'_, OllamaProcess>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

#[tauri::command]
fn ollama_is_running(state: tauri::State<'_, OllamaProcess>) -> bool {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(child) = guard.as_mut() {
            return matches!(child.try_wait(), Ok(None));
        }
    }
    false
}

// ─── RTSP→HLS proxy process management ───────────────────────────────────────
pub struct ProxyProcess(pub Arc<Mutex<Option<Child>>>);

impl Drop for ProxyProcess {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(mut child) = guard.take() {
                kill_proxy_child(&mut child);
            }
        }
    }
}

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

#[tauri::command]
async fn camera_runtime_status(
    app: AppHandle,
    state: tauri::State<'_, ProxyProcess>,
) -> Result<CameraRuntimeStatus, String> {
    let runtime = resolve_proxy_runtime_paths(&app);

    let proxy_process_running = {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(child) = guard.as_mut() {
            matches!(child.try_wait(), Ok(None))
        } else {
            false
        }
    };

    let proxy_health_ok = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(1200))
        .build()
    {
        Ok(client) => match client.get("http://127.0.0.1:8888/").send().await {
            Ok(response) => response.status().is_success(),
            Err(_) => false,
        },
        Err(_) => false,
    };

    let server_js_exists = runtime.server_js_exists;
    let bundled_node_exists = runtime.bundled_node_exists;
    let bundled_ffmpeg_exists = runtime.bundled_ffmpeg_exists;

    let issue = if proxy_health_ok {
        None
    } else if !server_js_exists || !bundled_node_exists || !bundled_ffmpeg_exists {
        Some("Brakuje lokalnego runtime kamer. Ten komputer potrzebuje pełnego update z pakietem Node.js, ffmpeg i RTSP proxy.".to_string())
    } else if !proxy_process_running {
        Some("Lokalny proxy kamer nie wystartował. Wejdź w Ustawienia → Urządzenia i użyj Włącz proxy albo Restart proxy.".to_string())
    } else {
        Some("Lokalny proxy kamer nie odpowiada poprawnie na http://localhost:8888/. Szczegóły są w logu proxy w Ustawienia → Urządzenia.".to_string())
    };

    Ok(CameraRuntimeStatus {
        server_js_exists,
        bundled_node_exists,
        bundled_ffmpeg_exists,
        proxy_process_running,
        proxy_health_ok,
        issue,
    })
}

// ─── Splashscreen ────────────────────────────────────────────────────────────
/// Zamyka okno splashscreen i pokazuje główne okno aplikacji.
/// Wywoływane z React po zakończeniu inicjalizacji.
#[tauri::command]
async fn close_splashscreen(app: AppHandle) -> Result<(), String> {
    if let Some(splash) = app.get_webview_window("splashscreen") {
        splash.close().map_err(|e| e.to_string())?;
    }
    if let Some(main_win) = app.get_webview_window("main") {
        main_win.show().map_err(|e| e.to_string())?;
        main_win.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ─── Sync — odczyt/zapis bazy SQLite ─────────────────────────────────────────

#[derive(Serialize)]
pub struct DbSyncMeta {
    pub size_bytes: u64,
    pub last_modified: String,
    pub path: String,
}

#[derive(Serialize)]
pub struct CameraRuntimeStatus {
    pub server_js_exists: bool,
    pub bundled_node_exists: bool,
    pub bundled_ffmpeg_exists: bool,
    pub proxy_process_running: bool,
    pub proxy_health_ok: bool,
    pub issue: Option<String>,
}

#[derive(Serialize)]
pub struct CameraProxyLog {
    pub path: String,
    pub exists: bool,
    pub tail: String,
}

#[tauri::command]
fn camera_proxy_start(app: AppHandle, state: tauri::State<'_, ProxyProcess>) -> Result<(), String> {
    start_proxy_process(&app, &state, false)
}

#[tauri::command]
fn camera_proxy_restart(app: AppHandle, state: tauri::State<'_, ProxyProcess>) -> Result<(), String> {
    append_proxy_log(&app, "[proxy] Wymuszony restart z panelu ustawień.");
    start_proxy_process(&app, &state, true)
}

#[tauri::command]
fn camera_proxy_read_log(app: AppHandle) -> Result<CameraProxyLog, String> {
    let log_path = proxy_log_path(&app)?;
    let exists = log_path.exists();
    let tail = if exists {
        read_proxy_log_tail(&app, 120)?
    } else {
        String::new()
    };

    Ok(CameraProxyLog {
        path: log_path.to_string_lossy().to_string(),
        exists,
        tail,
    })
}

/// Zwraca bajty pliku SQLite jako base64 — do uploadowania przez JS do Supabase Storage.
#[tauri::command]
async fn db_read_for_sync(app: AppHandle) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let db_path = data_dir.join("parking_os.db");
    if !db_path.exists() {
        return Err("Plik bazy danych nie istnieje. Czy aplikacja była wcześniej uruchomiona?".into());
    }
    let bytes = std::fs::read(&db_path).map_err(|e| format!("Błąd odczytu bazy: {}", e))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(b64)
}

/// Zapisuje bajty bazy (base64) do tymczasowego pliku — do porównania przed sync.
#[tauri::command]
async fn db_save_temp_for_sync(app: AppHandle, data: String) -> Result<DbSyncMeta, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let temp_path = data_dir.join("parking_os_sync_temp.db");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("Błąd dekodowania danych: {}", e))?;
    std::fs::write(&temp_path, &bytes)
        .map_err(|e| format!("Błąd zapisu pliku tymczasowego: {}", e))?;
    let meta = std::fs::metadata(&temp_path).map_err(|e| e.to_string())?;
    let modified = meta.modified()
        .map(|t| {
            let secs = t
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            format!("{}", secs)
        })
        .unwrap_or_else(|_| "0".into());
    Ok(DbSyncMeta {
        size_bytes: meta.len(),
        last_modified: modified,
        path: temp_path.to_string_lossy().to_string(),
    })
}

/// Zastępuje aktualną bazę wybraną (tymczasową lub aktualną) — po decyzji użytkownika.
/// action: "replace" = zastąp lokalną bazę pobraną; "keep" = zostaw lokalną bez zmian.
#[tauri::command]
async fn db_apply_sync(app: AppHandle, action: String) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let db_path = data_dir.join("parking_os.db");
    let temp_path = data_dir.join("parking_os_sync_temp.db");

    if action == "replace" {
        if !temp_path.exists() {
            return Err("Brak tymczasowej bazy do zastosowania.".into());
        }
        // Kopia bezpieczeństwa przed nadpisaniem
        let backup_path = data_dir.join(format!(
            "parking_os_before_sync_{}.db.bak",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
        ));
        if db_path.exists() {
            std::fs::copy(&db_path, &backup_path)
                .map_err(|e| format!("Błąd tworzenia kopii bezpieczeństwa: {}", e))?;
        }
        std::fs::rename(&temp_path, &db_path)
            .map_err(|e| format!("Błąd zastępowania bazy: {}", e))?;
    } else {
        // "keep" — usuń tylko temp
        if temp_path.exists() {
            std::fs::remove_file(&temp_path).ok();
        }
    }
    Ok(())
}

/// Usuwa tymczasowy plik sync (po zakończeniu procesu).
#[tauri::command]
async fn db_delete_temp(app: AppHandle) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let temp_path = data_dir.join("parking_os_sync_temp.db");
    if temp_path.exists() {
        std::fs::remove_file(&temp_path).map_err(|e| format!("Błąd usuwania pliku: {}", e))?;
    }
    Ok(())
}

/// Zwraca metadane aktualnej bazy (rozmiar, data modyfikacji).
#[tauri::command]
async fn db_get_meta(app: AppHandle) -> Result<DbSyncMeta, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let db_path = data_dir.join("parking_os.db");
    if !db_path.exists() {
        return Ok(DbSyncMeta {
            size_bytes: 0,
            last_modified: "0".into(),
            path: db_path.to_string_lossy().to_string(),
        });
    }
    let meta = std::fs::metadata(&db_path).map_err(|e| e.to_string())?;
    let modified = meta.modified()
        .map(|t| {
            let secs = t
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            format!("{}", secs)
        })
        .unwrap_or_else(|_| "0".into());
    Ok(DbSyncMeta {
        size_bytes: meta.len(),
        last_modified: modified,
        path: db_path.to_string_lossy().to_string(),
    })
}

// ─── Autostart ────────────────────────────────────────────────────────────────
#[derive(Serialize, Deserialize)]
pub struct AutostartStatus {
    pub enabled: bool,
}

#[tauri::command]
async fn autostart_get_status(
    #[allow(unused)] autostart: tauri::State<'_, tauri_plugin_autostart::AutoLaunchManager>,
) -> Result<AutostartStatus, String> {
    let enabled = autostart.is_enabled().map_err(|e| e.to_string())?;
    Ok(AutostartStatus { enabled })
}

#[tauri::command]
async fn autostart_set(
    enable: bool,
    #[allow(unused)] autostart: tauri::State<'_, tauri_plugin_autostart::AutoLaunchManager>,
) -> Result<(), String> {
    if enable {
        autostart.enable().map_err(|e| e.to_string())?;
    } else {
        autostart.disable().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ─── App restart (po sync) ────────────────────────────────────────────────────
#[tauri::command]
async fn app_restart(app: AppHandle) {
    app.restart();
}

fn helper_updates_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(app_data_dir.join("helper-updates"))
}

fn sanitize_helper_file_name(raw: &str, version: &str) -> String {
    let sanitized: String = raw
        .trim()
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();

    if sanitized.is_empty() {
        format!("Parking.OS_{}_helper-update.exe", version)
    } else {
        sanitized
    }
}

fn helper_file_name(url: &str, version: &str, file_name: Option<&str>) -> String {
    if let Some(file_name) = file_name {
        let normalized = sanitize_helper_file_name(file_name, version);
        if !normalized.is_empty() {
            return normalized;
        }
    }

    let candidate = url
        .split('#')
        .next()
        .unwrap_or(url)
        .split('?')
        .next()
        .unwrap_or(url)
        .rsplit('/')
        .next()
        .unwrap_or("");

    sanitize_helper_file_name(candidate, version)
}

#[cfg(windows)]
fn launch_helper_installer(path: &Path) -> Result<(), String> {
    let normalized = normalize_runtime_path(path);
    let installer = normalized.to_string_lossy().to_string();
    let working_dir = normalized
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));

    std::process::Command::new("cmd")
        .arg("/C")
        .arg("start")
        .arg("")
        .arg(installer)
        .current_dir(working_dir)
        .spawn()
        .map_err(|e| format!("Nie udało się uruchomić instalatora: {}", e))?;

    Ok(())
}

#[cfg(not(windows))]
fn launch_helper_installer(path: &Path) -> Result<(), String> {
    std::process::Command::new(path)
        .spawn()
        .map_err(|e| format!("Nie udało się uruchomić instalatora: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn helper_update_download_and_launch_installer(
    app: AppHandle,
    url: String,
    version: String,
    file_name: Option<String>,
) -> Result<HelperUpdateLaunchResult, String> {
    let updates_dir = helper_updates_dir(&app)?;

    tokio::task::spawn_blocking(move || {
        std::fs::create_dir_all(&updates_dir)
            .map_err(|e| format!("Nie udało się utworzyć katalogu aktualizacji: {}", e))?;

        let resolved_file_name = helper_file_name(&url, &version, file_name.as_deref());
        let installer_path = updates_dir.join(resolved_file_name);

        let client = reqwest::blocking::Client::builder()
            .redirect(reqwest::redirect::Policy::limited(10))
            .timeout(Duration::from_secs(600))
            .build()
            .map_err(|e| format!("Nie udało się utworzyć klienta updatera: {}", e))?;

        let mut response = client
            .get(&url)
            .header(reqwest::header::USER_AGENT, "Parking.OS Helper Updater")
            .send()
            .map_err(|e| format!("Błąd pobierania instalatora: {}", e))?;

        if !response.status().is_success() {
            return Err(format!(
                "Serwer zwrócił błąd podczas pobierania instalatora: {}",
                response.status()
            ));
        }

        let mut file = std::fs::File::create(&installer_path)
            .map_err(|e| format!("Nie udało się utworzyć pliku instalatora: {}", e))?;

        let content_length = response.content_length();
        let _ = app.emit(
            HELPER_UPDATE_PROGRESS_EVENT,
            HelperUpdateProgressPayload {
                phase: "started".to_string(),
                content_length,
                chunk_length: 0,
            },
        );

        let mut buffer = [0_u8; 64 * 1024];

        loop {
            let read = response
                .read(&mut buffer)
                .map_err(|e| format!("Błąd odczytu instalatora: {}", e))?;

            if read == 0 {
                break;
            }

            file.write_all(&buffer[..read])
                .map_err(|e| format!("Błąd zapisu instalatora: {}", e))?;

            let _ = app.emit(
                HELPER_UPDATE_PROGRESS_EVENT,
                HelperUpdateProgressPayload {
                    phase: "progress".to_string(),
                    content_length,
                    chunk_length: read as u64,
                },
            );
        }

        drop(file);

        launch_helper_installer(&installer_path)?;

        Ok(HelperUpdateLaunchResult {
            file_path: installer_path.to_string_lossy().to_string(),
        })
    })
    .await
    .map_err(|e| format!("Wątek helper updatera zakończył się błędem: {}", e))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PwaServer(Arc::new(Mutex::new(None))))
        .manage(OllamaProcess(Arc::new(Mutex::new(None))))
        .manage(DetectorProcess(Arc::new(Mutex::new(None))))
        .manage(ProxyProcess(Arc::new(Mutex::new(None))))
        .setup(|app| {
            let app_handle = app.handle().clone();
            // ── Preload default settings on first install ──────────────────
            let resource_dir = app.path().resource_dir().unwrap_or_default();
            if let Ok(app_data_dir) = app.path().app_data_dir() {
                let settings_path = app_data_dir.join("settings.json");
                if !settings_path.exists() {
                    let default_settings = resource_dir.join("default-settings.json");
                    if default_settings.exists() {
                        let _ = std::fs::create_dir_all(&app_data_dir);
                        let _ = std::fs::copy(&default_settings, &settings_path);
                    }
                }
            }
            match migrate_legacy_camera_settings(&app_handle) {
                Ok(true) => append_proxy_log(
                    &app_handle,
                    "[settings] Zmigrowano stare adresy RTSP kamer do aktualnych wartosci.",
                ),
                Ok(false) => {}
                Err(e) => eprintln!("[settings] Migracja adresow RTSP nieudana: {}", e),
            }
            // ── Auto-start RTSP→HLS proxy ──────────────────────────────────
            if let Some(state) = app.try_state::<ProxyProcess>() {
                if let Err(e) = start_proxy_process(&app_handle, &state, false) {
                    append_proxy_log(&app_handle, &format!("[proxy] Autostart nieudany: {}", e));
                    eprintln!("[proxy] Autostart nieudany: {}", e);
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            hash_password,
            verify_password,
            send_notification,
            fetch_snapshot,
            camera_runtime_status,
            camera_proxy_start,
            camera_proxy_restart,
            camera_proxy_read_log,
            spawn_pwa,
            stop_pwa,
            spawn_detector,
            stop_detector,
            detector_is_running,
            get_logo_base64,
            email_test_imap,
            email_fetch_list,
            email_fetch_sent,
            email_fetch_body,
            email_fetch_sent_body,
            email_send,
            email_delete,
            close_splashscreen,
            db_read_for_sync,
            db_save_temp_for_sync,
            db_apply_sync,
            db_delete_temp,
            db_get_meta,
            autostart_get_status,
            autostart_set,
            helper_update_download_and_launch_installer,
            app_restart,
            start_ollama,
            stop_ollama,
            ollama_is_running,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
