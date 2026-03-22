mod commands;
mod oauth;

use tauri_plugin_store::StoreExt;
use tauri::{
    AppHandle, Manager, RunEvent,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const OVERLAY_LABEL: &str = "overlay";

pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        handle_hotkey(app, shortcut);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::start_oauth,
            commands::get_settings,
            commands::save_settings,
            commands::set_ignore_cursor,
            commands::hide_overlay,
            commands::show_overlay,
            commands::toggle_always_on_top,
            commands::set_launch_on_startup,
            commands::save_window_bounds,
            commands::set_stealth,
        ])
        .setup(|app| {
            setup_app(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Error building Zoommate")
        .run(|_app, event| {
            // Keep running in tray even when overlay is closed
            if let RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();
            }
        });
}

fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let overlay = app
        .get_webview_window(OVERLAY_LABEL)
        .expect("overlay window missing — check tauri.conf.json label");

    // ── Restore saved bounds, or default to top-right of primary screen ───────
    let mut restored = false;
    if let Ok(store) = app.store("zoommate.json") {
        if let Some(bounds) = store.get("window_bounds") {
            if let (Some(x), Some(y), Some(w), Some(h)) = (
                bounds.get("x").and_then(|v: &serde_json::Value| v.as_i64()),
                bounds.get("y").and_then(|v: &serde_json::Value| v.as_i64()),
                bounds.get("w").and_then(|v: &serde_json::Value| v.as_u64()),
                bounds.get("h").and_then(|v: &serde_json::Value| v.as_u64()),
            ) {
                let _ = overlay.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
                let _ = overlay.set_size(tauri::PhysicalSize::new(w as u32, h as u32));
                restored = true;
            }
        }
    }
    if !restored {
        // First launch: center the window
        let _ = overlay.center();
    }

    // ── Stealth: only apply if user has enabled it in settings ────────────────
    #[cfg(target_os = "windows")]
    {
        let stealth_enabled = app.store("zoommate.json").ok()
            .and_then(|s| s.get("stealth"))
            .and_then(|v: serde_json::Value| v.as_bool())
            .unwrap_or(false);   // OFF by default so remote desktop users can see the app
        if stealth_enabled {
            apply_stealth(&overlay);
        }
    }

    // ── System tray ────────────────────────────────────────────────────────────
    setup_tray(app)?;

    // ── Global hotkey: Ctrl+Shift+Space (fallback if already taken) ───────────
    let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
    if let Err(e) = app.global_shortcut().register(shortcut) {
        log::warn!("[hotkey] Ctrl+Shift+Space registration failed: {}. App will still work via tray.", e);
    }

    // ── Force window visible and focused ──────────────────────────────────────
    let _ = overlay.show();
    let _ = overlay.set_focus();
    log::info!("[setup] Overlay window shown");

    Ok(())
}

fn handle_hotkey(app: &AppHandle, _shortcut: &Shortcut) {
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        match window.is_visible() {
            Ok(true) => {
                let _ = window.hide();
            }
            _ => {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    }
}

fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Open Zoommate", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Zoommate", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &sep, &quit])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Zoommate – AI Interview Copilot")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window(OVERLAY_LABEL) {
                    let _ = w.show();
                    let _ = w.set_focus();
                    // Re-center in case window drifted off-screen
                    let _ = w.center();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window(OVERLAY_LABEL) {
                    if w.is_visible().unwrap_or(false) {
                        let _ = w.hide();
                    } else {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

/// Calls SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE) so the overlay
/// is invisible to Zoom, Teams, OBS, Discord screen capture — Windows only.
#[cfg(target_os = "windows")]
fn apply_stealth(window: &tauri::WebviewWindow) {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE,
    };

    match window.window_handle() {
        Ok(handle) => {
            if let RawWindowHandle::Win32(win32) = handle.as_raw() {
                let hwnd = win32.hwnd.get() as windows_sys::Win32::Foundation::HWND;
                let ok = unsafe { SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE) };
                if ok == 0 {
                    log::warn!(
                        "[stealth] SetWindowDisplayAffinity failed. \
                         Requires Windows 10 version 2004 (build 19041) or later."
                    );
                } else {
                    log::info!("[stealth] ✓ Overlay excluded from screen capture");
                }
            }
        }
        Err(e) => log::error!("[stealth] Cannot get window handle: {}", e),
    }
}
