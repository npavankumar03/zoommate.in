import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("acemate", {
  getServerUrl: () => ipcRenderer.invoke("get-server-url"),
  setOpacity: (v: number) => ipcRenderer.send("set-opacity", v),
  moveWindow: (x: number, y: number) => ipcRenderer.send("move-window", x, y),
  hideOverlay: () => ipcRenderer.send("hide-overlay"),
  showOverlay: () => ipcRenderer.send("show-overlay"),
  openSettings: () => ipcRenderer.send("open-settings"),
  quitApp: () => ipcRenderer.send("quit-app"),
  setIgnoreMouse: (ignore: boolean) => ipcRenderer.send("set-ignore-mouse", ignore),

  // Desktop OAuth
  launchDesktopAuth: () => ipcRenderer.invoke("desktop-auth-start"),
  onAuthResult: (cb: (result: { success: boolean; user?: { id: string; username: string }; error?: string }) => void) => {
    ipcRenderer.on("auth-result", (_e, result) => cb(result));
  },

  // Compact mode / always on top
  toggleCompactMode: () => ipcRenderer.send("toggle-compact-mode"),
  toggleAlwaysOnTop: () => ipcRenderer.send("toggle-always-on-top"),

  // Settings persistence
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (partial: Record<string, unknown>) => ipcRenderer.invoke("save-settings", partial),

  // Launch on startup
  setLaunchOnStartup: (v: boolean) => ipcRenderer.send("set-launch-on-startup", v),

  // Hotkey failure notification
  onHotkeyFailed: (cb: () => void) => ipcRenderer.on("hotkey-failed", cb),

  // Saved auth on startup
  onSavedAuth: (cb: (data: { username: string }) => void) => {
    ipcRenderer.on("saved-auth", (_e, data) => cb(data));
  },
});
