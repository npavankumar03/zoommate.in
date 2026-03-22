import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { LoginScreen } from "./components/LoginScreen";
import { SettingsPanel } from "./components/SettingsPanel";
import { OverlayWindow } from "./components/OverlayWindow";
import { bridge } from "./lib/bridge";
export default function App() {
    const [view, setView] = useState("login");
    const [user, setUser] = useState(null);
    const [meetingId, setMeetingId] = useState(null);
    const [checking, setChecking] = useState(true);
    // On startup check if we still have a valid session (WebView2 cookie persists)
    useEffect(() => {
        bridge.checkAuth()
            .then((u) => {
            if (u?.id) {
                setUser(u);
                setView("settings");
            }
            else {
                setView("login");
            }
        })
            .catch(() => setView("login"))
            .finally(() => setChecking(false));
    }, []);
    if (checking) {
        return (_jsxs("div", { style: {
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(8,8,18,0.92)",
                backdropFilter: "blur(24px)",
                WebkitBackdropFilter: "blur(24px)",
            }, children: [_jsxs("div", { style: {
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 16,
                    }, children: [_jsx("span", { style: { fontSize: 28, fontWeight: 700, color: "#a5b4fc", letterSpacing: "0.05em" }, children: "Z" }), _jsx("div", { style: { display: "flex", gap: 6 }, children: [0, 120, 240].map((d) => (_jsx("div", { style: {
                                    width: 8,
                                    height: 8,
                                    borderRadius: "50%",
                                    background: "#6366f1",
                                    animation: `bounce 0.8s ${d}ms infinite`,
                                } }, d))) })] }), _jsx("style", { children: `@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}` })] }));
    }
    if (view === "login") {
        return (_jsx(LoginScreen, { onLogin: (u) => {
                setUser(u);
                setView("settings");
            } }));
    }
    if (view === "settings" || !meetingId) {
        return (_jsx(SettingsPanel, { user: user, onStartSession: (id) => {
                setMeetingId(id);
                setView("overlay");
            }, onLogout: async () => {
                await bridge.logout();
                setUser(null);
                setMeetingId(null);
                setView("login");
            }, onBackToOverlay: meetingId ? () => setView("overlay") : undefined }));
    }
    return (_jsx(OverlayWindow, { meetingId: meetingId, onOpenSettings: () => setView("settings") }));
}
