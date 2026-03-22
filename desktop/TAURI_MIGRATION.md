# Zoommate — Tauri v2 Migration Guide

## Prerequisites

```bash
# 1. Install Rust (Windows: https://rustup.rs)
rustup update stable

# 2. Install Tauri CLI
npm install -g @tauri-apps/cli@2

# 3. On Windows — required build tools
# Install "Desktop development with C++" from Visual Studio Build Tools
# https://visualstudio.microsoft.com/visual-cpp-build-tools/

# 4. WebView2 runtime (pre-installed on Win 10+/Win 11, but just in case)
# https://developer.microsoft.com/microsoft-edge/webview2/
```

---

## Step 1 — Remove Electron

```bash
cd desktop

# Delete Electron directories and artefacts
rm -rf electron/ dist-electron/ release/ tsconfig.electron.json

# Remove Electron packages
npm uninstall electron electron-builder vite-plugin-electron concurrently
```

---

## Step 2 — Install new dependencies

```bash
npm install
# This installs everything in the new package.json:
#   @tauri-apps/api  @tauri-apps/plugin-store
#   @tauri-apps/plugin-shell  @tauri-apps/plugin-global-shortcut
#   socket.io-client  microsoft-cognitiveservices-speech-sdk
```

---

## Step 3 — Generate Tauri icons

Put a 1024×1024 PNG named `app-icon.png` in `desktop/`, then:

```bash
npx tauri icon app-icon.png
# Creates src-tauri/icons/ with all required sizes
```

If you don't have an icon yet, create a placeholder:

```bash
mkdir -p src-tauri/icons
# Copy any 32×32, 128×128 PNG as placeholder — build won't fail
```

---

## Step 4 — Run in dev mode

Open TWO terminals:

**Terminal 1 (Vite dev server):**
```bash
cd desktop
npm run dev
```

**Terminal 2 (Tauri + Rust compilation):**
```bash
cd desktop
npx tauri dev
```

First run takes 3–5 minutes (Rust compiles). Subsequent runs are fast.

---

## Step 5 — Build production installer

### Windows (.exe installer)

```bash
cd desktop

# Run as Administrator (needed for Rust build tools)
npx tauri build

# Output:
# src-tauri/target/release/bundle/nsis/Zoommate_1.0.0_x64-setup.exe
```

### macOS (.dmg)

```bash
npx tauri build
# Output: src-tauri/target/release/bundle/dmg/Zoommate_1.0.0_x64.dmg
```

---

## Architecture After Migration

```
desktop/
├── src/                          # React frontend (unchanged structure)
│   ├── App.tsx                   # Uses bridge.ts instead of window.acemate
│   ├── lib/bridge.ts             # NEW: Tauri IPC wrapper
│   ├── hooks/useZoommateSocket.ts # NEW: Socket.IO + Azure STT hook
│   └── components/
│       ├── LoginScreen.tsx       # Uses bridge.startOAuth()
│       ├── SettingsPanel.tsx     # Calls bridge.createMeeting() for real ID
│       └── OverlayWindow.tsx     # Glassmorphism UI, fully transparent
│
└── src-tauri/                    # Rust backend (NEW)
    ├── src/
    │   ├── main.rs               # Entry point
    │   ├── lib.rs                # App setup, tray, stealth, hotkey
    │   ├── commands.rs           # IPC commands callable from React
    │   └── oauth.rs              # OAuth loopback HTTP server
    ├── Cargo.toml
    ├── tauri.conf.json
    └── capabilities/default.json
```

---

## Key Behaviours

### Stealth (Windows only)
`SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` is called in `lib.rs`
immediately after window creation. The overlay is:
- ✅ Visible on your screen
- ❌ Hidden from Zoom, Teams, OBS, Discord, Win+G recorder
- Requires Windows 10 build 19041 (version 2004) or later

### Auth flow
1. User clicks "Sign in" → React calls `bridge.startOAuth()`
2. Rust starts tiny_http loopback server on a random port
3. Rust opens browser → `https://ai.zoommate.in/oauth/authorize`
4. User approves → browser redirects to `http://127.0.0.1:{port}/callback?token=xxx`
5. Rust catches the token, emits `oauth-callback` event to React
6. React POSTs `/api/auth/desktop-session` with `credentials: include`
7. Server sets session cookie → stored in WebView2's persistent cookie jar
8. On next launch, `/api/auth/me` succeeds automatically

### Real meeting ID fix
`SettingsPanel.handleStart()` now calls `POST /api/meetings` to create a real
server-side meeting before connecting Socket.IO. The `meetingId` returned is
used for all subsequent API calls and Socket.IO room membership.

### Socket.IO events (from server)
| Event | When | Payload |
|---|---|---|
| `response_start` | Answer generation begins | `{ displayQuestion }` |
| `answer` | Streaming chunk | `{ delta, requestId }` |
| `response_end` | Stream finished | `{ requestId, error? }` |
| `answer_cached` | Dedup hit | `{ answer, question }` |

### Global hotkey
`Ctrl+Shift+Z` — registered in Rust at startup via `tauri-plugin-global-shortcut`.
Toggles overlay show/hide from anywhere.

### Click-through mode
Toggle in overlay header (🖱 button). When enabled, `setIgnoreCursorEvents(true)`
is called — all mouse events pass through to windows below.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `error: linker 'link.exe' not found` | Install VS Build Tools with "Desktop C++" |
| `WebView2 not found` | Install WebView2 runtime from Microsoft |
| `SetWindowDisplayAffinity failed` | Windows version older than 10 v2004 |
| Azure STT "Mic error" | Grant microphone permission in Windows Settings → Privacy |
| Socket.IO not connecting | Check you're signed in — session cookie required |
| Build fails: icon not found | Run `npx tauri icon your-icon.png` |
