use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const VAULT_SERVICE: &str = "app.jmapfe.desktop";

#[derive(Debug, Deserialize)]
struct JmapBridgeRequest {
    url: String,
    authorization: String,
    body: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct JmapBridgeResponse {
    status: u16,
    body: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct JmapHttpRequest {
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
}

#[derive(Debug, Serialize)]
struct JmapHttpResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
    #[serde(rename = "bodyBase64")]
    body_base64: String,
}

#[derive(Debug, Deserialize)]
struct VaultRequest {
    key: String,
}

#[derive(Debug, Deserialize)]
struct VaultPutRequest {
    key: String,
    secret: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveFileRequest {
    suggested_name: String,
    bytes_base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenFileRequest {
    suggested_name: String,
    bytes_base64: String,
}

#[tauri::command]
async fn jmap_http(req: JmapHttpRequest) -> Result<JmapHttpResponse, String> {
    let client = reqwest::Client::new();
    let method = req
        .method
        .as_deref()
        .unwrap_or("GET")
        .parse::<reqwest::Method>()
        .map_err(|err| format!("Invalid HTTP method: {err}"))?;
    let mut builder = client.request(method, req.url);

    if let Some(headers) = req.headers {
        for (name, value) in headers {
            builder = builder.header(name, value);
        }
    }
    if let Some(body) = req.body {
        builder = builder.body(body);
    }

    let res = builder
        .send()
        .await
        .map_err(|err| format!("JMAP bridge request failed: {err}"))?;
    let status = res.status().as_u16();
    let headers = res
        .headers()
        .iter()
        .filter_map(|(name, value)| value.to_str().ok().map(|header_value| (name.to_string(), header_value.to_string())))
        .collect();
    let body_bytes = res
        .bytes()
        .await
        .map_err(|err| format!("JMAP bridge body read failed: {err}"))?;
    let body_base64 = BASE64_STANDARD.encode(&body_bytes);
    let body = String::from_utf8_lossy(&body_bytes).into_owned();

    Ok(JmapHttpResponse { status, headers, body, body_base64 })
}

#[tauri::command]
async fn vault_get(req: VaultRequest) -> Result<Option<String>, String> {
    keyring::use_native_store(true).map_err(|err| format!("OS keyring unavailable: {err}"))?;
    let entry = keyring_core::Entry::new(VAULT_SERVICE, &req.key)
        .map_err(|err| format!("OS keyring entry unavailable: {err}"))?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring_core::Error::NoEntry) => Ok(None),
        Err(err) => Err(format!("OS keyring read failed: {err}")),
    }
}

#[tauri::command]
async fn vault_set(req: VaultPutRequest) -> Result<(), String> {
    keyring::use_native_store(true).map_err(|err| format!("OS keyring unavailable: {err}"))?;
    let entry = keyring_core::Entry::new(VAULT_SERVICE, &req.key)
        .map_err(|err| format!("OS keyring entry unavailable: {err}"))?;
    entry
        .set_password(&req.secret)
        .map_err(|err| format!("OS keyring write failed: {err}"))
}

#[tauri::command]
async fn vault_delete(req: VaultRequest) -> Result<(), String> {
    keyring::use_native_store(true).map_err(|err| format!("OS keyring unavailable: {err}"))?;
    let entry = keyring_core::Entry::new(VAULT_SERVICE, &req.key)
        .map_err(|err| format!("OS keyring entry unavailable: {err}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!("OS keyring delete failed: {err}")),
    }
}

#[tauri::command]
async fn save_file(req: SaveFileRequest) -> Result<bool, String> {
    let bytes = BASE64_STANDARD
        .decode(req.bytes_base64)
        .map_err(|err| format!("Invalid file data: {err}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new().set_file_name(&req.suggested_name).save_file() else {
            return Ok(false);
        };
        std::fs::write(path, bytes).map_err(|err| format!("File save failed: {err}"))?;
        Ok(true)
    })
    .await
    .map_err(|err| format!("File save task failed: {err}"))?
}

#[tauri::command]
async fn open_file(req: OpenFileRequest) -> Result<(), String> {
    let bytes = BASE64_STANDARD
        .decode(req.bytes_base64)
        .map_err(|err| format!("Invalid file data: {err}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = temporary_attachment_path(&req.suggested_name);
        std::fs::write(&path, bytes).map_err(|err| format!("Temp file write failed: {err}"))?;
        open_path(&path)
    })
    .await
    .map_err(|err| format!("File open task failed: {err}"))?
}

fn temporary_attachment_path(suggested_name: &str) -> PathBuf {
    let file_name = Path::new(suggested_name)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("attachment");
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    std::env::temp_dir().join(format!("jmapfe-{timestamp}-{file_name}"))
}

fn open_path(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let path_text = path.to_string_lossy().to_string();
        Command::new("cmd")
            .args(["/C", "start", ""])
            .arg(&path_text)
            .spawn()
            .map_err(|err| format!("File open failed: {err}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|err| format!("File open failed: {err}"))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|err| format!("File open failed: {err}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn jmap_api(req: JmapBridgeRequest) -> Result<JmapBridgeResponse, String> {
    let client = reqwest::Client::new();
    let res = client
        .post(req.url)
        .header("authorization", req.authorization)
        .json(&req.body)
        .send()
        .await
        .map_err(|err| format!("JMAP bridge request failed: {err}"))?;
    let status = res.status().as_u16();
    let body = res
        .json::<serde_json::Value>()
        .await
        .map_err(|err| format!("JMAP bridge JSON parse failed: {err}"))?;

    Ok(JmapBridgeResponse { status, body })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![jmap_api, jmap_http, vault_get, vault_set, vault_delete, save_file, open_file])
        .run(tauri::generate_context!())
        .expect("failed to run jmapfe desktop shell");
}
