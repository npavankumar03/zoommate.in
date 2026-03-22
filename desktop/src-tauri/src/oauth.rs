/// OAuth loopback flow.
///
/// 1. Binds a random local TCP port.
/// 2. Opens the user's browser to the Zoommate OAuth authorize page.
/// 3. Waits (up to 5 min) for the browser to redirect back with `?token=xxx`.
/// 4. Emits "oauth-callback" → { success: true, token } to the renderer.
///    The renderer then POSTs /api/auth/desktop-session with credentials:include
///    so the session cookie is stored in WebView2's cookie jar.
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;
use tiny_http::{Header, Response, Server};
use std::time::{Duration, Instant};
use url::Url;

const SERVER_URL: &str = "https://ai.zoommate.in";
const TIMEOUT_SECS: u64 = 300;

pub async fn run(app: &AppHandle) -> Result<(), String> {
    // ── Find a free port ───────────────────────────────────────────────────────
    let port = free_port()?;

    // ── Random state for CSRF protection ──────────────────────────────────────
    let state = hex::encode(rand::random::<[u8; 16]>());

    let redirect_uri = format!("http://127.0.0.1:{}/callback", port);
    let auth_url = format!(
        "{}/oauth/authorize?redirect_uri={}&state={}",
        SERVER_URL,
        urlencoding::encode(&redirect_uri),
        state
    );

    // ── Open browser ───────────────────────────────────────────────────────────
    app.shell()
        .open(&auth_url, None)
        .map_err(|e| format!("Failed to open browser: {}", e))?;

    // ── Start callback HTTP server (blocking, runs inside tokio::spawn) ────────
    // We use spawn_blocking because tiny_http is synchronous.
    let app2 = app.clone();
    let state2 = state.clone();

    tokio::task::spawn_blocking(move || {
        run_server(app2, port, &state2);
    })
    .await
    .map_err(|e| format!("OAuth server task error: {}", e))?;

    Ok(())
}

fn run_server(app: AppHandle, port: u16, expected_state: &str) {
    let server = match Server::http(format!("127.0.0.1:{}", port)) {
        Ok(s) => s,
        Err(e) => {
            let _ = app.emit(
                "oauth-callback",
                serde_json::json!({ "success": false, "error": format!("Cannot start callback server: {}", e) }),
            );
            return;
        }
    };

    let deadline = Instant::now() + Duration::from_secs(TIMEOUT_SECS);

    loop {
        if Instant::now() > deadline {
            let _ = app.emit(
                "oauth-callback",
                serde_json::json!({
                    "success": false,
                    "error": "Sign-in timed out (5 minutes). Please try again."
                }),
            );
            return;
        }

        match server.recv_timeout(Duration::from_millis(500)) {
            Err(e) => {
                let _ = app.emit(
                    "oauth-callback",
                    serde_json::json!({ "success": false, "error": e.to_string() }),
                );
                return;
            }
            Ok(None) => continue, // poll loop
            Ok(Some(request)) => {
                let full_url = format!("http://localhost{}", request.url());
                let url = match Url::parse(&full_url) {
                    Ok(u) => u,
                    Err(_) => {
                        let _ = request.respond(text_response(400, "Bad request"));
                        continue;
                    }
                };

                if !url.path().starts_with("/callback") {
                    let _ = request.respond(text_response(404, "Not found"));
                    continue;
                }

                let params: std::collections::HashMap<_, _> = url.query_pairs().collect();

                // User cancelled
                if let Some(err) = params.get("error") {
                    let _ = request.respond(html_response(page("Sign-in cancelled.", false)));
                    let _ = app.emit(
                        "oauth-callback",
                        serde_json::json!({
                            "success": false,
                            "error": format!("Sign-in cancelled: {}", err)
                        }),
                    );
                    return;
                }

                // CSRF check
                let returned_state = params.get("state").map(|s| s.as_ref()).unwrap_or("");
                if returned_state != expected_state {
                    let _ = request.respond(text_response(400, "State mismatch"));
                    let _ = app.emit(
                        "oauth-callback",
                        serde_json::json!({
                            "success": false,
                            "error": "OAuth state mismatch — possible CSRF."
                        }),
                    );
                    return;
                }

                let token = match params.get("token") {
                    Some(t) => t.to_string(),
                    None => {
                        let _ = request.respond(text_response(400, "Missing token"));
                        let _ = app.emit(
                            "oauth-callback",
                            serde_json::json!({ "success": false, "error": "No token in callback." }),
                        );
                        return;
                    }
                };

                // ✓ Success — send nice HTML to the browser tab
                let _ = request.respond(html_response(page(
                    "✓ Signed in to Zoommate! You can close this tab.",
                    true,
                )));

                // Emit token to React — React will exchange it for a session cookie
                let _ = app.emit(
                    "oauth-callback",
                    serde_json::json!({ "success": true, "token": token }),
                );
                return;
            }
        }
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

fn free_port() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Cannot bind temporary socket: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Cannot get local addr: {}", e))?
        .port();
    drop(listener);
    Ok(port)
}

fn page(message: &str, success: bool) -> String {
    let (icon, color) = if success {
        ("✓", "#10b981")
    } else {
        ("✕", "#ef4444")
    };
    format!(
        r#"<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Zoommate</title>
<style>
  *{{box-sizing:border-box;margin:0;padding:0}}
  body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        display:flex;align-items:center;justify-content:center;
        min-height:100vh;background:#0d0d18;color:#e2e8f0}}
  .card{{text-align:center;padding:56px 48px;max-width:440px;
         background:rgba(20,20,40,0.95);border-radius:20px;
         border:1px solid rgba(255,255,255,0.1);
         box-shadow:0 24px 80px rgba(0,0,0,0.6)}}
  .icon{{font-size:52px;color:{color};margin-bottom:20px}}
  h1{{font-size:22px;font-weight:700;margin-bottom:8px}}
  p{{font-size:14px;opacity:0.6}}
</style></head><body>
<div class="card">
  <div class="icon">{icon}</div>
  <h1>Zoommate</h1>
  <p>{message}</p>
</div></body></html>"#,
        color = color,
        icon = icon,
        message = message
    )
}

fn html_response(html: String) -> Response<std::io::Cursor<Vec<u8>>> {
    let bytes = html.into_bytes();
    let len = bytes.len();
    Response::new(
        tiny_http::StatusCode(200),
        vec![
            Header::from_bytes(b"Content-Type".as_ref(), b"text/html; charset=utf-8".as_ref())
                .unwrap(),
            Header::from_bytes(b"Cache-Control".as_ref(), b"no-store".as_ref()).unwrap(),
        ],
        std::io::Cursor::new(bytes),
        Some(len),
        None,
    )
}

fn text_response(code: u16, body: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    let bytes = body.as_bytes().to_vec();
    let len = bytes.len();
    Response::new(
        tiny_http::StatusCode(code),
        vec![],
        std::io::Cursor::new(bytes),
        Some(len),
        None,
    )
}
