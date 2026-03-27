use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "zoommate.json";
const OVERLAY_LABEL: &str = "overlay";

// Saved HWND of the editor window so we can restore focus after resync
static TARGET_HWND: std::sync::Mutex<usize> = std::sync::Mutex::new(0);

fn es<E: std::fmt::Display>(e: E) -> String { e.to_string() }

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
    let store = app.store(STORE_FILE).map_err(es)?;
    let settings: AppSettings = store
        .get("settings")
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    Ok(settings)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(es)?;
    store.set("settings", serde_json::to_value(&settings).unwrap());
    store.save().map_err(es)
}

// ── Window controls ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn set_ignore_cursor(app: AppHandle, ignore: bool) -> Result<(), String> {
    if let Some(w) = overlay(&app) {
        w.set_ignore_cursor_events(ignore)
            .map_err(es)?;
    }
    Ok(())
}

#[tauri::command]
pub fn hide_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(w) = overlay(&app) {
        w.hide().map_err(es)?;
    }
    Ok(())
}

#[tauri::command]
pub fn show_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(w) = overlay(&app) {
        w.show().map_err(es)?;
        w.set_focus().map_err(es)?;
    }
    Ok(())
}

/// Shows the overlay without stealing keyboard focus from the active editor.
/// Uses SW_SHOWNOACTIVATE so the foreground window (editor) keeps focus.
#[tauri::command]
pub fn show_overlay_no_focus(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        use windows_sys::Win32::UI::WindowsAndMessaging::ShowWindow;
        const SW_SHOWNOACTIVATE: i32 = 4;
        if let Some(w) = overlay(&app) {
            if let Ok(handle) = w.window_handle() {
                if let RawWindowHandle::Win32(win32) = handle.as_raw() {
                    let hwnd = win32.hwnd.get() as windows_sys::Win32::Foundation::HWND;
                    unsafe { ShowWindow(hwnd, SW_SHOWNOACTIVATE); }
                    return Ok(());
                }
            }
            // fallback
            w.show().map_err(es)?;
        }
    }
    #[cfg(not(target_os = "windows"))]
    if let Some(w) = overlay(&app) {
        w.show().map_err(es)?;
    }
    Ok(())
}

#[tauri::command]
pub fn toggle_always_on_top(app: AppHandle) -> Result<bool, String> {
    if let Some(w) = overlay(&app) {
        let current = w.is_always_on_top().map_err(es)?;
        let next = !current;
        w.set_always_on_top(next).map_err(es)?;
        return Ok(next);
    }
    Ok(true)
}

#[tauri::command]
pub fn set_launch_on_startup(app: AppHandle, value: bool) -> Result<(), String> {
    // Save the preference; autostart plugin can be wired in later
    let store = app.store(STORE_FILE).map_err(es)?;
    let mut settings: AppSettings = store
        .get("settings")
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    settings.launch_on_startup = Some(value);
    store.set("settings", serde_json::to_value(&settings).unwrap());
    store.save().map_err(es)
}

/// Enables or disables WDA_EXCLUDEFROMCAPTURE stealth on Windows.
#[tauri::command]
pub fn set_stealth(app: AppHandle, enabled: bool) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(es)?;
    store.set("stealth", serde_json::Value::Bool(enabled));
    store.save().map_err(es)?;

    #[cfg(target_os = "windows")]
    if let Some(w) = overlay(&app) {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
        };
        if let Ok(handle) = w.window_handle() {
            let raw: RawWindowHandle = handle.as_raw();
            if let RawWindowHandle::Win32(win32) = raw {
                let hwnd = win32.hwnd.get() as windows_sys::Win32::Foundation::HWND;
                let affinity = if enabled { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
                unsafe { SetWindowDisplayAffinity(hwnd, affinity) };
            }
        }
    }
    Ok(())
}

/// Injects a single keystroke into the currently focused OS window.
///
/// char_code : Unicode code point of the character to type (ignored when `special` is set).
/// special   : "backspace" | "enter" | "tab"  — sends the corresponding virtual key instead.
///
/// On non-Windows platforms this is a no-op (returns Ok).
#[tauri::command]
pub fn inject_keystroke(char_code: u32, special: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        typing::inject(char_code, special);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (char_code, special);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
mod typing {
    // Raw Win32 SendInput — no extra windows-sys feature flags required.
    const INPUT_KEYBOARD:      u32 = 1;
    const KEYEVENTF_UNICODE:   u32 = 0x0004;
    const KEYEVENTF_KEYUP:     u32 = 0x0002;
    const KEYEVENTF_EXTENDEDKEY: u32 = 0x0001;
    const VK_BACK:    u16 = 0x08;
    const VK_RETURN:  u16 = 0x0D;
    const VK_TAB:     u16 = 0x09;
    const VK_ESCAPE:  u16 = 0x1B;
    const VK_CONTROL: u16 = 0x11;
    const VK_SHIFT:   u16 = 0x10;
    const VK_HOME:    u16 = 0x24;
    const VK_END:     u16 = 0x23;
    const VK_DELETE:  u16 = 0x2E;

    #[repr(C)]
    #[derive(Copy, Clone)]
    struct KeybdInput { vk: u16, scan: u16, flags: u32, time: u32, extra: usize }

    #[repr(C)]
    union InputData { ki: KeybdInput, _pad: [u64; 4] }

    #[repr(C)]
    struct Input { ty: u32, data: InputData }

    extern "system" {
        fn SendInput(n: u32, p: *const Input, cb: i32) -> u32;
    }

    unsafe fn send_key(vk: u16, scan: u16, flags: u32) {
        let inputs = [
            Input { ty: INPUT_KEYBOARD, data: InputData { ki: KeybdInput { vk, scan, flags,                      time: 0, extra: 0 } } },
            Input { ty: INPUT_KEYBOARD, data: InputData { ki: KeybdInput { vk, scan, flags: flags | KEYEVENTF_KEYUP, time: 0, extra: 0 } } },
        ];
        SendInput(2, inputs.as_ptr(), std::mem::size_of::<Input>() as i32);
    }

    // Shift+End — selects to end of current line (clears auto-indent)
    unsafe fn send_shift_end() {
        let inputs = [
            Input { ty: INPUT_KEYBOARD, data: InputData { ki: KeybdInput { vk: VK_SHIFT, scan: 0, flags: 0,                                          time: 0, extra: 0 } } },
            Input { ty: INPUT_KEYBOARD, data: InputData { ki: KeybdInput { vk: VK_END,   scan: 0, flags: KEYEVENTF_EXTENDEDKEY,                      time: 0, extra: 0 } } },
            Input { ty: INPUT_KEYBOARD, data: InputData { ki: KeybdInput { vk: VK_END,   scan: 0, flags: KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP,    time: 0, extra: 0 } } },
            Input { ty: INPUT_KEYBOARD, data: InputData { ki: KeybdInput { vk: VK_SHIFT, scan: 0, flags: KEYEVENTF_KEYUP,                            time: 0, extra: 0 } } },
        ];
        SendInput(4, inputs.as_ptr(), std::mem::size_of::<Input>() as i32);
    }

    // Ctrl+Shift+End — selects from cursor to end of document (to delete bad content)
    unsafe fn send_ctrl_shift_end() {
        let inputs = [
            Input { ty: INPUT_KEYBOARD, data: InputData { ki: KeybdInput { vk: VK_CONTROL, scan: 0, flags: 0,                                                    time: 0, extra: 0 } } },
            Input { ty: INPUT_KEYBOARD, data: InputData { ki: KeybdInput { vk: VK_SHIFT,   scan: 0, flags: 0,                                                    time: 0, extra: 0 } } },
            Input { ty: INPUT_KEYBOARD, data: InputData { ki: KeybdInput { vk: VK_END,     scan: 0, flags: KEYEVENTF_EXTENDEDKEY,                                 time: 0, extra: 0 } } },
            Input { ty: INPUT_KEYBOARD, data: InputData { ki: KeybdInput { vk: VK_END,     scan: 0, flags: KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP,               time: 0, extra: 0 } } },
            Input { ty: INPUT_KEYBOARD, data: InputData { ki: KeybdInput { vk: VK_SHIFT,   scan: 0, flags: KEYEVENTF_KEYUP,                                       time: 0, extra: 0 } } },
            Input { ty: INPUT_KEYBOARD, data: InputData { ki: KeybdInput { vk: VK_CONTROL, scan: 0, flags: KEYEVENTF_KEYUP,                                       time: 0, extra: 0 } } },
        ];
        SendInput(6, inputs.as_ptr(), std::mem::size_of::<Input>() as i32);
    }

    unsafe fn send_ctrl(vk: u16, extra_flags: u32) {
        let inputs = [
            Input { ty: INPUT_KEYBOARD, data: InputData { ki: KeybdInput { vk: VK_CONTROL, scan: 0, flags: 0,                                  time: 0, extra: 0 } } },
            Input { ty: INPUT_KEYBOARD, data: InputData { ki: KeybdInput { vk, scan: 0,            flags: extra_flags,                          time: 0, extra: 0 } } },
            Input { ty: INPUT_KEYBOARD, data: InputData { ki: KeybdInput { vk, scan: 0,            flags: extra_flags | KEYEVENTF_KEYUP,        time: 0, extra: 0 } } },
            Input { ty: INPUT_KEYBOARD, data: InputData { ki: KeybdInput { vk: VK_CONTROL, scan: 0, flags: KEYEVENTF_KEYUP,                     time: 0, extra: 0 } } },
        ];
        SendInput(4, inputs.as_ptr(), std::mem::size_of::<Input>() as i32);
    }

    pub fn inject(char_code: u32, special: Option<String>) {
        unsafe {
            match special.as_deref() {
                Some("backspace") => send_key(VK_BACK,   0, 0),
                Some("enter")     => send_key(VK_RETURN, 0, 0),
                Some("tab")       => send_key(VK_TAB,    0, 0),
                Some("escape")    => send_key(VK_ESCAPE, 0, 0),
                Some("ctrl+a")    => send_ctrl(0x41, 0),
                Some("ctrl+c")    => send_ctrl(0x43, 0),
                Some("ctrl+end")        => send_ctrl(VK_END, KEYEVENTF_EXTENDEDKEY),
                Some("ctrl+shift+end") => send_ctrl_shift_end(),
                Some("home")           => send_key(VK_HOME,   0, KEYEVENTF_EXTENDEDKEY),
                Some("shift+end")      => send_shift_end(),
                Some("delete")         => send_key(VK_DELETE, 0, KEYEVENTF_EXTENDEDKEY),
                _ => {
                    if char_code <= 0xFFFF {
                        send_key(0, char_code as u16, KEYEVENTF_UNICODE);
                    } else {
                        let c    = char_code - 0x10000;
                        let high = (0xD800 + (c >> 10)) as u16;
                        let low  = (0xDC00 + (c & 0x3FF)) as u16;
                        send_key(0, high, KEYEVENTF_UNICODE);
                        send_key(0, low,  KEYEVENTF_UNICODE);
                    }
                }
            }
        }
    }
}

// ── Clipboard read ──────────────────────────────────────────────────────────

/// Returns the current OS clipboard text (Windows only).
#[tauri::command]
pub fn read_clipboard() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        clipboard_win::read()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(String::new())
    }
}

#[cfg(target_os = "windows")]
mod clipboard_win {
    const CF_UNICODETEXT: u32 = 13;

    extern "system" {
        fn OpenClipboard(hwnd: *mut core::ffi::c_void) -> i32;
        fn CloseClipboard() -> i32;
        fn GetClipboardData(format: u32) -> *mut core::ffi::c_void;
        fn GlobalLock(mem: *mut core::ffi::c_void) -> *mut core::ffi::c_void;
        fn GlobalUnlock(mem: *mut core::ffi::c_void) -> i32;
    }

    pub fn read() -> Result<String, String> {
        unsafe {
            if OpenClipboard(std::ptr::null_mut()) == 0 {
                return Err("OpenClipboard failed".into());
            }
            let h = GetClipboardData(CF_UNICODETEXT);
            if h.is_null() {
                let _ = CloseClipboard();
                return Ok(String::new());
            }
            let ptr = GlobalLock(h) as *const u16;
            if ptr.is_null() {
                let _ = CloseClipboard();
                return Err("GlobalLock failed".into());
            }
            let mut len = 0usize;
            while *ptr.add(len) != 0 { len += 1; }
            let text = String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len));
            GlobalUnlock(h);
            let _ = CloseClipboard();
            Ok(text)
        }
    }
}

// ── Active window title ─────────────────────────────────────────────────────

/// Returns the title of the currently focused OS window.
#[tauri::command]
pub fn get_active_window_title() -> String {
    #[cfg(target_os = "windows")]
    {
        extern "system" {
            fn GetForegroundWindow() -> *mut core::ffi::c_void;
            fn GetWindowTextW(hwnd: *mut core::ffi::c_void, buf: *mut u16, max: i32) -> i32;
        }
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_null() { return String::new(); }
            let mut buf = [0u16; 512];
            let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), 512);
            if len <= 0 { return String::new(); }
            String::from_utf16_lossy(&buf[..len as usize])
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        String::new()
    }
}

// ── Screen capture ─────────────────────────────────────────────────────────

/// Captures the primary screen at 50 % scale and returns it as a base64-encoded PNG.
/// Used by the Typing Playback feature to send the screen to GPT-4o mini for context.
#[tauri::command]
pub async fn capture_screen() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        tokio::task::spawn_blocking(screenshot::capture)
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(String::new())
    }
}

#[cfg(target_os = "windows")]
mod screenshot {
    const SRCCOPY: u32 = 0x00CC0020;
    const HALFTONE: i32 = 4;
    const SM_CXSCREEN: i32 = 0;
    const SM_CYSCREEN: i32 = 1;
    const DIB_RGB_COLORS: u32 = 0;
    const BI_RGB: u32 = 0;

    extern "system" {
        fn GetDC(hwnd: *mut core::ffi::c_void) -> *mut core::ffi::c_void;
        fn ReleaseDC(hwnd: *mut core::ffi::c_void, hdc: *mut core::ffi::c_void) -> i32;
        fn CreateCompatibleDC(hdc: *mut core::ffi::c_void) -> *mut core::ffi::c_void;
        fn DeleteDC(hdc: *mut core::ffi::c_void) -> i32;
        fn CreateCompatibleBitmap(hdc: *mut core::ffi::c_void, cx: i32, cy: i32) -> *mut core::ffi::c_void;
        fn SelectObject(hdc: *mut core::ffi::c_void, h: *mut core::ffi::c_void) -> *mut core::ffi::c_void;
        fn StretchBlt(hdc_dst: *mut core::ffi::c_void, x_dst: i32, y_dst: i32, cx_dst: i32, cy_dst: i32, hdc_src: *mut core::ffi::c_void, x_src: i32, y_src: i32, cx_src: i32, cy_src: i32, rop: u32) -> i32;
        fn SetStretchBltMode(hdc: *mut core::ffi::c_void, mode: i32) -> i32;
        fn GetDIBits(hdc: *mut core::ffi::c_void, hbm: *mut core::ffi::c_void, start: u32, lines: u32, pv_bits: *mut core::ffi::c_void, pbmi: *mut BitmapInfo, usage: u32) -> i32;
        fn DeleteObject(ho: *mut core::ffi::c_void) -> i32;
        fn GetSystemMetrics(n_index: i32) -> i32;
    }

    #[repr(C)]
    struct BitmapInfoHeader {
        bi_size: u32, bi_width: i32, bi_height: i32,
        bi_planes: u16, bi_bit_count: u16, bi_compression: u32,
        bi_size_image: u32, bi_x_pels: i32, bi_y_pels: i32,
        bi_clr_used: u32, bi_clr_important: u32,
    }
    #[repr(C)]
    struct BitmapInfo { bmi_header: BitmapInfoHeader, bmi_colors: [u32; 1] }

    pub fn capture() -> Result<String, String> {
        use base64::Engine;
        unsafe {
            let sw = GetSystemMetrics(SM_CXSCREEN);
            let sh = GetSystemMetrics(SM_CYSCREEN);
            // Capture at 50 % — good enough for text detection, half the size
            let dw = sw / 2;
            let dh = sh / 2;

            let hdc_screen = GetDC(std::ptr::null_mut());
            if hdc_screen.is_null() { return Err("GetDC failed".into()); }

            let hdc_mem = CreateCompatibleDC(hdc_screen);
            let hbm = CreateCompatibleBitmap(hdc_screen, dw, dh);
            let _old = SelectObject(hdc_mem, hbm);
            SetStretchBltMode(hdc_mem, HALFTONE);
            StretchBlt(hdc_mem, 0, 0, dw, dh, hdc_screen, 0, 0, sw, sh, SRCCOPY);

            let stride = ((dw * 4 + 3) & !3) as usize;
            let mut pixels = vec![0u8; stride * dh as usize];
            let mut bmi = BitmapInfo {
                bmi_header: BitmapInfoHeader {
                    bi_size: std::mem::size_of::<BitmapInfoHeader>() as u32,
                    bi_width: dw, bi_height: -dh,
                    bi_planes: 1, bi_bit_count: 32, bi_compression: BI_RGB,
                    bi_size_image: 0, bi_x_pels: 0, bi_y_pels: 0,
                    bi_clr_used: 0, bi_clr_important: 0,
                },
                bmi_colors: [0],
            };
            GetDIBits(hdc_mem, hbm, 0, dh as u32, pixels.as_mut_ptr() as *mut _, &mut bmi, DIB_RGB_COLORS);

            DeleteObject(hbm);
            DeleteDC(hdc_mem);
            ReleaseDC(std::ptr::null_mut(), hdc_screen);

            // BGRA → RGBA
            for chunk in pixels.chunks_exact_mut(4) {
                chunk.swap(0, 2);
            }

            // Encode as PNG
            let mut png_buf = Vec::new();
            {
                let mut enc = png::Encoder::new(&mut png_buf, dw as u32, dh as u32);
                enc.set_color(png::ColorType::Rgba);
                enc.set_depth(png::BitDepth::Eight);
                let mut writer = enc.write_header().map_err(|e| e.to_string())?;
                writer.write_image_data(&pixels).map_err(|e| e.to_string())?;
            }

            Ok(base64::engine::general_purpose::STANDARD.encode(&png_buf))
        }
    }
}

/// Saves the currently focused window handle so we can restore focus after resync.
#[tauri::command]
pub fn save_target_window() {
    #[cfg(target_os = "windows")]
    unsafe {
        extern "system" { fn GetForegroundWindow() -> *mut core::ffi::c_void; }
        let hwnd = GetForegroundWindow();
        if let Ok(mut h) = TARGET_HWND.lock() { *h = hwnd as usize; }
    }
}

/// Restores keyboard focus to the previously saved editor window.
/// With SW_SHOWNOACTIVATE the overlay no longer steals focus, so this is mainly
/// a safety net for cases where something else moved focus unexpectedly.
#[tauri::command]
pub fn refocus_target_window() {
    #[cfg(target_os = "windows")]
    unsafe {
        extern "system" { fn SetForegroundWindow(hwnd: *mut core::ffi::c_void) -> i32; }
        if let Ok(h) = TARGET_HWND.lock() {
            if *h != 0 { SetForegroundWindow(*h as *mut core::ffi::c_void); }
        }
    }
}

/// Returns true if the left mouse button was clicked since the last call.
/// Uses GetAsyncKeyState low-order bit which is cleared on each call.
/// Lets TypeScript detect cursor repositioning without a global hook.
#[tauri::command]
pub fn check_mouse_click() -> bool {
    #[cfg(target_os = "windows")]
    unsafe {
        extern "system" { fn GetAsyncKeyState(v_key: i32) -> i16; }
        (GetAsyncKeyState(0x01) & 1) != 0   // VK_LBUTTON
    }
    #[cfg(not(target_os = "windows"))]
    { false }
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
    let store = app.store(STORE_FILE).map_err(es)?;
    store.set(
        "window_bounds",
        serde_json::json!({ "x": x, "y": y, "w": w, "h": h }),
    );
    store.save().map_err(es)
}
