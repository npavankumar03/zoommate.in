/**
 * bridge.ts — single point of contact between React components and Tauri.
 *
 * All window.acemate.* calls from the old Electron build are replaced here.
 * Components import from this file only — never call invoke() directly.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

const SERVER = "https://ai.zoommate.in";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AppSettings {
  opacity?: number;
  alwaysOnTop?: boolean;
  launchOnStartup?: boolean;
  privacyBlur?: boolean;
  autoHideBlurSeconds?: number;
  compactMode?: boolean;
  theme?: string;
  assistant?: string;
  stealth?: boolean;
}

export interface User {
  id: string;
  username: string;
}

// ── Auth (REST — runs in WebView2 so cookies land in WebView2 jar) ─────────────

export const bridge = {
  // ── OAuth ─────────────────────────────────────────────────────────────────
  /** Starts the Rust OAuth loopback server and opens the browser. */
  startOAuth(): Promise<void> {
    return invoke("start_oauth");
  },

  /** Listen for the oauth-callback event emitted by Rust. */
  onOAuthCallback(
    cb: (payload: { success: boolean; token?: string; error?: string }) => void
  ): Promise<UnlistenFn> {
    return listen<{ success: boolean; token?: string; error?: string }>(
      "oauth-callback",
      (e) => cb(e.payload)
    );
  },

  // ── Session (cookies handled by WebView2 automatically) ───────────────────
  async checkAuth(): Promise<User | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const r = await fetch(`${SERVER}/api/auth/me`, {
        credentials: "include",
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!r.ok) return null;
      return r.json();
    } catch {
      clearTimeout(timer);
      return null;
    }
  },

  async exchangeToken(token: string): Promise<User> {
    const r = await fetch(`${SERVER}/api/auth/desktop-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token }),
    });
    if (!r.ok) throw new Error("Session exchange failed");
    return r.json();
  },

  async logout(): Promise<void> {
    await fetch(`${SERVER}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    }).catch(() => {});
  },

  // ── Meeting ───────────────────────────────────────────────────────────────
  async createMeeting(title: string, type = "interview"): Promise<string> {
    const r = await fetch(`${SERVER}/api/meetings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ title, type, responseFormat: "concise" }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({})) as { message?: string };
      throw new Error(err.message || "Failed to create meeting");
    }
    const data = await r.json() as { id: string };
    return data.id;
  },

  // ── Azure STT token ───────────────────────────────────────────────────────
  async getAzureToken(): Promise<{ token: string; region: string }> {
    const r = await fetch(`${SERVER}/api/speech/azure/token`, {
      credentials: "include",
    });
    if (!r.ok) throw new Error("Failed to get Azure STT token");
    return r.json();
  },

  // ── Window controls (Tauri IPC) ────────────────────────────────────────────
  /** Opacity is handled via CSS on the overlay element; no Rust command needed. */
  setOpacity(_value: number): Promise<void> {
    return Promise.resolve();
  },

  setIgnoreCursor(ignore: boolean): Promise<void> {
    return invoke("set_ignore_cursor", { ignore });
  },

  hideOverlay(): Promise<void> {
    return invoke("hide_overlay");
  },

  showOverlay(): Promise<void> {
    return invoke("show_overlay");
  },

  toggleAlwaysOnTop(): Promise<boolean> {
    return invoke("toggle_always_on_top");
  },

  setLaunchOnStartup(value: boolean): Promise<void> {
    return invoke("set_launch_on_startup", { value });
  },

  saveWindowBounds(x: number, y: number, w: number, h: number): Promise<void> {
    return invoke("save_window_bounds", { x, y, w, h });
  },

  /** Enable/disable WDA_EXCLUDEFROMCAPTURE (hides from Zoom/Teams/OBS/remote desktop). */
  setStealth(enabled: boolean): Promise<void> {
    return invoke("set_stealth", { enabled });
  },

  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings(): Promise<AppSettings> {
    return invoke("get_settings");
  },

  saveSettings(settings: AppSettings): Promise<void> {
    return invoke("save_settings", { settings });
  },
};
