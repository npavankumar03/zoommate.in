import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  Tray,
  Menu,
  nativeImage,
  shell,
  globalShortcut,
  safeStorage,
  net,
} from "electron";
import path from "path";
import http from "http";
import crypto from "crypto";
import fs from "fs";

const isDev = !app.isPackaged;
const SERVER_URL = "https://ai.zoommate.in";

let overlayWin: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let isCompactMode = false;

// ── Settings ──────────────────────────────────────────────────────────────────
interface AppSettings {
  windowBounds: { x: number; y: number; width: number; height: number } | null;
  alwaysOnTop: boolean;
  compactMode: boolean;
  launchOnStartup: boolean;
  trayEnabled: boolean;
  privacyBlur: boolean;
  autoHideBlurSeconds: number;
  opacity: number;
}

const DEFAULT_SETTINGS: AppSettings = {
  windowBounds: null,
  alwaysOnTop: true,
  compactMode: false,
  launchOnStartup: false,
  trayEnabled: true,
  privacyBlur: false,
  autoHideBlurSeconds: 0,
  opacity: 0.9,
};

function settingsFilePath(): string {
  return path.join(app.getPath("userData"), "zoommate-settings.json");
}

function loadSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(settingsFilePath(), "utf-8");
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(partial: Partial<AppSettings>): void {
  const current = loadSettings();
  const updated = { ...current, ...partial };
  try {
    fs.writeFileSync(settingsFilePath(), JSON.stringify(updated, null, 2), "utf-8");
  } catch (err) {
    console.error("[settings] Failed to save settings:", err);
  }
}

// ── Auth storage ──────────────────────────────────────────────────────────────
function authBinPath(): string {
  return path.join(app.getPath("userData"), "zoommate-auth.bin");
}

// ── PKCE helpers ──────────────────────────────────────────────────────────────
function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = http.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address() as { port: number };
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

// ── Create overlay window ─────────────────────────────────────────────────────
function createOverlayWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const settings = loadSettings();
  const bounds = settings.windowBounds;

  overlayWin = new BrowserWindow({
    width: bounds?.width ?? 420,
    height: bounds?.height ?? 600,
    x: bounds?.x ?? (width - 440),
    y: bounds?.y ?? 40,
    frame: false,
    transparent: true,
    alwaysOnTop: settings.alwaysOnTop,
    resizable: true,
    minWidth: 300,
    minHeight: 360,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWin.setAlwaysOnTop(settings.alwaysOnTop, "screen-saver");
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (isDev) {
    overlayWin.loadURL("http://localhost:5173");
  } else {
    overlayWin.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // Persist bounds on resize/move (debounced 500ms)
  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  const saveBounds = () => {
    if (!overlayWin) return;
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!overlayWin) return;
      const b = overlayWin.getBounds();
      saveSettings({ windowBounds: b });
    }, 500);
  };
  overlayWin.on("resize", saveBounds);
  overlayWin.on("move", saveBounds);

  overlayWin.on("closed", () => {
    overlayWin = null;
  });

  // Send saved auth on ready
  overlayWin.webContents.on("did-finish-load", () => {
    try {
      const binPath = authBinPath();
      if (fs.existsSync(binPath) && safeStorage.isEncryptionAvailable()) {
        const encrypted = fs.readFileSync(binPath);
        const username = safeStorage.decryptString(encrypted);
        overlayWin?.webContents.send("saved-auth", { username });
      }
    } catch (err) {
      console.error("[auth] Failed to read saved auth:", err);
    }
  });
}

// ── Create settings window ────────────────────────────────────────────────────
function createSettingsWindow() {
  if (settingsWin) {
    settingsWin.focus();
    return;
  }

  settingsWin = new BrowserWindow({
    width: 580,
    height: 560,
    title: "Zoommate Settings",
    frame: true,
    transparent: false,
    alwaysOnTop: false,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    settingsWin.loadURL("http://localhost:5173/#/settings");
  } else {
    settingsWin.loadFile(path.join(__dirname, "../dist/index.html"), { hash: "/settings" });
  }

  settingsWin.on("closed", () => {
    settingsWin = null;
  });
}

// ── System tray ───────────────────────────────────────────────────────────────
function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("Zoommate");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Zoommate", click: () => { overlayWin ? overlayWin.show() : createOverlayWindow(); } },
      {
        label: "Toggle Compact Mode",
        click: () => {
          if (!overlayWin) return;
          isCompactMode = !isCompactMode;
          if (isCompactMode) {
            overlayWin.setSize(320, 80);
            saveSettings({ compactMode: true });
          } else {
            const settings = loadSettings();
            const b = settings.windowBounds;
            overlayWin.setSize(b?.width ?? 420, b?.height ?? 600);
            saveSettings({ compactMode: false });
          }
        },
      },
      {
        label: "Toggle Always on Top",
        click: () => {
          if (!overlayWin) return;
          const settings = loadSettings();
          const newVal = !settings.alwaysOnTop;
          saveSettings({ alwaysOnTop: newVal });
          overlayWin.setAlwaysOnTop(newVal, "screen-saver");
        },
      },
      { type: "separator" },
      { label: "Account / Sign In", click: () => { overlayWin ? overlayWin.show() : createOverlayWindow(); } },
      { type: "separator" },
      { label: "Quit Zoommate", click: () => app.quit() },
    ])
  );
  tray.on("double-click", () => { overlayWin ? overlayWin.show() : createOverlayWindow(); });
}

// ── IPC handlers ──────────────────────────────────────────────────────────────
ipcMain.handle("get-server-url", () => SERVER_URL);

ipcMain.on("set-opacity", (_e, value: number) => {
  overlayWin?.setOpacity(value);
});

ipcMain.on("set-ignore-mouse", (_e, ignore: boolean) => {
  overlayWin?.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.on("move-window", (_e, x: number, y: number) => {
  if (!overlayWin) return;
  const bounds = overlayWin.getBounds();
  overlayWin.setBounds({ x: Math.round(x), y: Math.round(y), width: bounds.width, height: bounds.height });
});

ipcMain.on("hide-overlay", () => { overlayWin?.hide(); });
ipcMain.on("show-overlay", () => { overlayWin ? overlayWin.show() : createOverlayWindow(); });
ipcMain.on("open-settings", createSettingsWindow);
ipcMain.on("quit-app", () => app.quit());

// Toggle compact mode
ipcMain.on("toggle-compact-mode", () => {
  if (!overlayWin) return;
  isCompactMode = !isCompactMode;
  if (isCompactMode) {
    overlayWin.setSize(320, 80);
    saveSettings({ compactMode: true });
  } else {
    const settings = loadSettings();
    const b = settings.windowBounds;
    overlayWin.setSize(b?.width ?? 420, b?.height ?? 600);
    saveSettings({ compactMode: false });
  }
});

// Toggle always on top
ipcMain.on("toggle-always-on-top", () => {
  if (!overlayWin) return;
  const settings = loadSettings();
  const newVal = !settings.alwaysOnTop;
  saveSettings({ alwaysOnTop: newVal });
  overlayWin.setAlwaysOnTop(newVal, "screen-saver");
});

// Launch on startup
ipcMain.on("set-launch-on-startup", (_e, value: boolean) => {
  app.setLoginItemSettings({ openAtLogin: value });
  saveSettings({ launchOnStartup: value });
});

// Get / save settings
ipcMain.handle("get-settings", () => loadSettings());
ipcMain.handle("save-settings", (_e, partial: Partial<AppSettings>) => {
  saveSettings(partial);
  return true;
});

// Desktop OAuth
ipcMain.handle("desktop-auth-start", async () => {
  if (!overlayWin) return;

  const port = await findFreePort();
  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const authUrl = `${SERVER_URL}/oauth/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

  if (!authUrl.startsWith(SERVER_URL)) {
    overlayWin.webContents.send("auth-result", { success: false, error: "Invalid auth URL" });
    return;
  }

  let server: http.Server | null = null;
  const timeout = setTimeout(() => {
    server?.close();
    overlayWin?.webContents.send("auth-result", { success: false, error: "Sign-in timed out (5 minutes)." });
  }, 5 * 60 * 1000);

  server = http.createServer(async (req, res) => {
    if (!req.url?.startsWith("/callback")) {
      res.writeHead(404);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const returnedState = url.searchParams.get("state");
    const token = url.searchParams.get("token");
    const errorParam = url.searchParams.get("error");

    if (errorParam) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<html><body style='font-family:sans-serif;text-align:center;padding:60px'><h2>Sign-in cancelled.</h2><p>You can close this tab.</p></body></html>`);
      clearTimeout(timeout);
      server?.close();
      overlayWin?.webContents.send("auth-result", { success: false, error: "Sign-in was cancelled." });
      return;
    }

    if (returnedState !== state || !token) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(`<html><body>Invalid state or missing token.</body></html>`);
      clearTimeout(timeout);
      server?.close();
      overlayWin?.webContents.send("auth-result", { success: false, error: "OAuth state mismatch." });
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      `<html><body style='font-family:sans-serif;text-align:center;padding:60px'><h2>&#10003; Signed in to Zoommate</h2><p>You can close this tab.</p></body></html>`
    );
    clearTimeout(timeout);
    server?.close();

    try {
      // Exchange token for session
      const serverRes = await fetch(`${SERVER_URL}/api/auth/desktop-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token }),
      });

      if (!serverRes.ok) {
        const errData = await serverRes.json() as { message?: string };
        throw new Error(errData.message || "Server auth failed");
      }

      const userData = await serverRes.json() as { id: string; username: string };

      // Persist username encrypted
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(userData.username);
        fs.writeFileSync(authBinPath(), encrypted);
      }

      overlayWin?.webContents.send("auth-result", {
        success: true,
        user: { id: userData.id, username: userData.username },
      });
    } catch (err: any) {
      console.error("[desktop-auth] Error:", err.message);
      overlayWin?.webContents.send("auth-result", { success: false, error: err.message || "Sign-in failed" });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    shell.openExternal(authUrl);
  });
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createOverlayWindow();
  createTray();

  // Register global show/hide hotkey
  const registered = globalShortcut.register("CommandOrControl+Shift+Z", () => {
    if (!overlayWin) {
      createOverlayWindow();
      return;
    }
    if (overlayWin.isVisible()) {
      overlayWin.hide();
    } else {
      overlayWin.show();
    }
  });

  if (!registered) {
    // Hotkey registration failed — notify renderer when it's ready
    overlayWin?.webContents.on("did-finish-load", () => {
      overlayWin?.webContents.send("hotkey-failed");
    });
  }

  app.on("activate", () => {
    if (!overlayWin) createOverlayWindow();
  });
});

app.on("window-all-closed", () => {
  // Keep app running in tray on all platforms
  // Do NOT quit — tray keeps it alive
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
