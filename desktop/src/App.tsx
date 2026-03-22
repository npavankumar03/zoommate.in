import { useState, useEffect } from "react";
import { LoginScreen } from "./components/LoginScreen";
import { SettingsPanel } from "./components/SettingsPanel";
import { OverlayWindow } from "./components/OverlayWindow";
import { bridge, type User } from "./lib/bridge";

type View = "login" | "settings" | "overlay";

export default function App() {
  const [view, setView]       = useState<View>("login");
  const [user, setUser]       = useState<User | null>(null);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [checking, setChecking]  = useState(true);

  // On startup check if we still have a valid session (WebView2 cookie persists)
  useEffect(() => {
    bridge.checkAuth()
      .then((u) => {
        if (u?.id) {
          setUser(u);
          setView("settings");
        } else {
          setView("login");
        }
      })
      .catch(() => setView("login"))
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(8,8,18,0.92)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
      }}>
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
        }}>
          <span style={{ fontSize: 28, fontWeight: 700, color: "#a5b4fc", letterSpacing: "0.05em" }}>Z</span>
          <div style={{ display: "flex", gap: 6 }}>
            {[0, 120, 240].map((d) => (
              <div
                key={d}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#6366f1",
                  animation: `bounce 0.8s ${d}ms infinite`,
                }}
              />
            ))}
          </div>
        </div>
        <style>{`@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}`}</style>
      </div>
    );
  }

  if (view === "login") {
    return (
      <LoginScreen
        onLogin={(u) => {
          setUser(u);
          setView("settings");
        }}
      />
    );
  }

  if (view === "settings" || !meetingId) {
    return (
      <SettingsPanel
        user={user}
        onStartSession={(id) => {
          setMeetingId(id);
          setView("overlay");
        }}
        onLogout={async () => {
          await bridge.logout();
          setUser(null);
          setMeetingId(null);
          setView("login");
        }}
        onBackToOverlay={meetingId ? () => setView("overlay") : undefined}
      />
    );
  }

  return (
    <OverlayWindow
      meetingId={meetingId}
      onOpenSettings={() => setView("settings")}
    />
  );
}
