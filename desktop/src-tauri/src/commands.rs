use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;
#[cfg(target_os = "windows")]
use raw_window_handle::{HasWindowHandle, RawWindowHandle};

const STORE_FILE: &str = "zoommate.json";
const OVERLAY_LABEL: &str = "overlay";

// ── Settings schema ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub opacity: Option<f64>,
    pub always_on_top: Option<bool>,
    pub launch_on_startup: Option<bool>,
    pub privacy_blur: Option<bool>,
    pub stealth: Option<bool>,
    pub auto_hide_blur_seconds: Option<u32>,
    pub compact_mode: Option<bool>,
    pub theme: Option<String>,
    pub assistant: Option<String>,
}

// ── Helpers ────────────────────────────────────────────────────────────────────

fn overlay(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window(OVERLAY_LABEL)
}

// ── OAuth ──────────────────────────────────────────────────────────────────────

/// Starts the OAuth loopback flow in a background task.
/// Emits "oauth-callback" event to the renderer when done.
#[tauri::command]
pub async fn start_oauth(app: AppHandle) -> Result<(), String> {
    tokio::spawn(async move {
        if let Err(e) = crate::oauth::run(&app).await {
            let _ = app.emit(
                "oauth-callback",
                serde_json::json!({ "success": false, "error": e }),
            );
        }
    });
    Ok(())
}

// ── Settings ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<AppSettings, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let settings: AppSettings = store
        .get("settings")
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    Ok(settings)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set("settings", serde_json::to_value(&settings).unwrap());
    store.save().map_err(|e| e.to_string())
}

// ── Window controls ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn set_ignore_cursor(app: AppHandle, ignore: bool) -> Result<(), String> {
    if let Some(w) = overlay(&app) {
        w.set_ignore_cursor_events(ignore)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn hide_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(w) = overlay(&app) {
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn show_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(w) = overlay(&app) {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn toggle_always_on_top(app: AppHandle) -> Result<bool, String> {
    if let Some(w) = overlay(&app) {
        let current = w.is_always_on_top().map_err(|e| e.to_string())?;
        let next = !current;
        w.set_always_on_top(next).map_err(|e| e.to_string())?;
        return Ok(next);
    }
    Ok(true)
}

#[tauri::command]
pub fn set_launch_on_startup(app: AppHandle, value: bool) -> Result<(), String> {
    // Save the preference; autostart plugin can be wired in later
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let mut settings: AppSettings = store
        .get("settings")
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    settings.launch_on_startup = Some(value);
    store.set("settings", serde_json::to_value(&settings).unwrap());
    store.save().map_err(|e| e.to_string())
}

/// Enables or disables WDA_EXCLUDEFROMCAPTURE stealth on Windows.
#[tauri::command]
pub fn set_stealth(app: AppHandle, enabled: bool) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set("stealth", serde_json::Value::Bool(enabled));
    store.save().map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    if let Some(w) = overlay(&app) {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
        };
        if let Ok(handle) = w.window_handle() {
            if let RawWindowHandle::Win32(win32) = handle.as_raw() {
                let hwnd = win32.hwnd.get() as windows_sys::Win32::Foundation::HWND;
                let affinity = if enabled { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
                unsafe { SetWindowDisplayAffinity(hwnd, affinity) };
            }
        }
    }
    Ok(())
}

/// Persists window position/size so we can restore on next launch.
#[tauri::command]
pub fn save_window_bounds(
    app: AppHandle,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(
        "window_bounds",
        serde_json::json!({ "x": x, "y": y, "w": w, "h": h }),
    );
    store.save().map_err(|e| e.to_string())
}
