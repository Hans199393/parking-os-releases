use bcrypt::{hash, verify, DEFAULT_COST};
use tauri::AppHandle;
use base64::Engine;
use std::sync::{Arc, Mutex};
use std::process::Child;
use serde::Serialize;
use mailparse::MailHeaderMap;

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
async fn email_fetch_body(imap_host: String, imap_port: u16, user: String, pass: String, uid: u32) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let mut session = imap_session(&imap_host, imap_port, &user, &pass)?;
        session.select("INBOX").map_err(|e| e.to_string())?;
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
async fn email_send(smtp_host: String, smtp_port: u16, user: String, pass: String, to: String, subject: String, body: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        use lettre::{Message, SmtpTransport, Transport};
        use lettre::transport::smtp::authentication::Credentials;
        use lettre::message::header::ContentType;
        use lettre::message::{Mailbox, MultiPart, SinglePart, Attachment};

        let from: Mailbox = user.parse().map_err(|_| "Nieprawidłowy adres nadawcy".to_string())?;
        let to_mb: Mailbox = to.parse().map_err(|_| "Nieprawidłowy adres odbiorcy".to_string())?;

        // HTML body referencing inline logo via CID
        let html_part = SinglePart::builder()
            .header(ContentType::TEXT_HTML)
            .body(body);

        // Inline logo attachment (CID = logo@parking)
        let logo_bytes = include_bytes!("../../public/logo2026.png").to_vec();
        let logo_part = Attachment::new_inline(String::from("logo@parking"))
            .body(logo_bytes, ContentType::parse("image/png").unwrap());

        let email = Message::builder()
            .from(from)
            .to(to_mb)
            .subject(subject)
            .multipart(
                MultiPart::related()
                    .singlepart(html_part)
                    .singlepart(logo_part),
            )
            .map_err(|e| e.to_string())?;
        let creds = Credentials::new(user.clone(), pass);
        let mailer = if smtp_port == 465 {
            SmtpTransport::relay(&smtp_host)
                .map_err(|e| e.to_string())?
                .port(smtp_port)
                .credentials(creds)
                .build()
        } else {
            // 587 STARTTLS
            SmtpTransport::starttls_relay(&smtp_host)
                .map_err(|e| e.to_string())?
                .port(smtp_port)
                .credentials(creds)
                .build()
        };
        mailer.send(&email).map_err(|e| e.to_string())?;
        Ok(())
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
            stop_pwa,
            get_logo_base64,
            email_test_imap,
            email_fetch_list,
            email_fetch_body,
            email_send,
            email_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
