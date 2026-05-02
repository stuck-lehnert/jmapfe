use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
    let body = res
        .text()
        .await
        .map_err(|err| format!("JMAP bridge body read failed: {err}"))?;

    Ok(JmapHttpResponse { status, headers, body })
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
        .invoke_handler(tauri::generate_handler![jmap_api, jmap_http, vault_get, vault_set, vault_delete])
        .run(tauri::generate_context!())
        .expect("failed to run jmapfe desktop shell");
}
