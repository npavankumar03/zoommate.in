import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { bridge } from "../lib/bridge";
const ASSISTANTS = [
    "General Interview",
    "Python Engineer",
    "Frontend Engineer",
    "System Design",
    "Behavioral / HR",
    "Data Science",
];
const ASSISTANT_TYPE_MAP = {
    "General Interview": "interview",
    "Python Engineer": "interview",
    "Frontend Engineer": "interview",
    "System Design": "interview",
    "Behavioral / HR": "interview",
    "Data Science": "interview",
};
export function SettingsPanel({ user, onStartSession, onLogout, onBackToOverlay }) {
    // ── State ──────────────────────────────────────────────────────────────────
    const [assistant, setAssistant] = useState(ASSISTANTS[0]);
    const [opacity, setOpacity] = useState(85);
    const [theme, setTheme] = useState("dark");
    const [alwaysOnTop, setAlwaysOnTop] = useState(true);
    const [launchOnStartup, setLaunchOnStartup] = useState(false);
    const [privacyBlur, setPrivacyBlur] = useState(false);
    const [autoHideBlurSec, setAutoHideBlurSec] = useState(0);
    const [clickThrough, setClickThrough] = useState(false);
    const [stealth, setStealth] = useState(false);
    const [starting, setStarting] = useState(false);
    const [startError, setStartError] = useState("");
    // ── Load persisted settings on mount ──────────────────────────────────────
    useEffect(() => {
        bridge.getSettings().then((s) => {
            if (s.opacity != null)
                setOpacity(Math.round(s.opacity * 100));
            if (s.alwaysOnTop != null)
                setAlwaysOnTop(s.alwaysOnTop);
            if (s.launchOnStartup != null)
                setLaunchOnStartup(s.launchOnStartup);
            if (s.privacyBlur != null)
                setPrivacyBlur(s.privacyBlur);
            if (s.autoHideBlurSeconds != null)
                setAutoHideBlurSec(s.autoHideBlurSeconds);
            if (s.assistant)
                setAssistant(s.assistant);
            if (s.theme === "light" || s.theme === "dark")
                setTheme(s.theme);
            if (s.stealth != null)
                setStealth(s.stealth);
        }).catch(() => { });
    }, []);
    // ── Handlers ──────────────────────────────────────────────────────────────
    const persist = (partial) => bridge.saveSettings(partial).catch(() => { });
    const handleStart = async () => {
        setStarting(true);
        setStartError("");
        try {
            await bridge.setOpacity(opacity / 100);
            const title = `${assistant} – ${new Date().toLocaleDateString()}`;
            const type = ASSISTANT_TYPE_MAP[assistant] ?? "interview";
            const id = await bridge.createMeeting(title, type);
            persist({ opacity: opacity / 100, assistant, theme });
            onStartSession(id);
        }
        catch (err) {
            setStartError(err?.message || "Failed to start session. Are you signed in?");
        }
        finally {
            setStarting(false);
        }
    };
    const handleOpacity = (v) => {
        setOpacity(v);
        bridge.setOpacity(v / 100).catch(() => { });
    };
    const handleAlwaysOnTop = async (v) => {
        setAlwaysOnTop(v);
        await bridge.toggleAlwaysOnTop().catch(() => { });
        persist({ alwaysOnTop: v });
    };
    const handleLaunchOnStartup = (v) => {
        setLaunchOnStartup(v);
        bridge.setLaunchOnStartup(v).catch(() => { });
    };
    const handlePrivacyBlur = (v) => {
        setPrivacyBlur(v);
        persist({ privacyBlur: v });
    };
    const handleClickThrough = (v) => {
        setClickThrough(v);
        bridge.setIgnoreCursor(v).catch(() => { });
    };
    const handleStealth = (v) => {
        setStealth(v);
        bridge.setStealth(v).catch(() => { });
        persist({ stealth: v });
    };
    // ── Colours ────────────────────────────────────────────────────────────────
    const isDark = theme === "dark";
    const bg = isDark ? "#0d0d18" : "#f5f5f7";
    const cardBg = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)";
    const cardBdr = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
    const mutedClr = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";
    const dimClr = isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.3)";
    const textClr = isDark ? "#e2e8f0" : "#1a1a2e";
    // ── Sub-component ──────────────────────────────────────────────────────────
    const Toggle = ({ checked, onChange }) => (_jsx("button", { onClick: () => onChange(!checked), style: {
            width: 40, height: 22, borderRadius: 11, border: "none", flexShrink: 0,
            background: checked ? "#6366f1" : (isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.15)"),
            cursor: "pointer", position: "relative", transition: "background 0.2s",
        }, children: _jsx("span", { style: {
                position: "absolute", top: 3,
                left: checked ? 21 : 3,
                width: 16, height: 16, borderRadius: "50%",
                background: "#fff",
                transition: "left 0.2s",
                boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
            } }) }));
    const SettingRow = ({ label, desc, checked, onChange, }) => (_jsxs("div", { style: {
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginTop: 8, padding: "10px 14px",
            background: cardBg, borderRadius: 12, border: `1px solid ${cardBdr}`,
        }, children: [_jsxs("div", { children: [_jsx("p", { style: { margin: 0, fontSize: 13, fontWeight: 600, color: textClr }, children: label }), _jsx("p", { style: { margin: "2px 0 0", fontSize: 11, color: dimClr }, children: desc })] }), _jsx(Toggle, { checked: checked, onChange: onChange })] }));
    // ── Render ─────────────────────────────────────────────────────────────────
    return (_jsx("div", { style: {
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            background: isDark ? "rgba(13,13,24,0.92)" : "rgba(245,245,247,0.92)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
        }, children: _jsxs("div", { style: {
                width: "100%",
                maxWidth: 480,
                borderRadius: 20,
                padding: 24,
                background: isDark ? "rgba(18,18,32,0.97)" : "rgba(255,255,255,0.97)",
                border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
                boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
                display: "flex",
                flexDirection: "column",
                gap: 20,
                color: textClr,
                maxHeight: "90vh",
                overflowY: "auto",
            }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10 }, children: [_jsx("div", { style: {
                                        width: 32, height: 32, borderRadius: 10,
                                        background: "rgba(99,102,241,0.15)",
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        fontSize: 18, fontWeight: 700, color: "#6366f1",
                                    }, children: "Z" }), _jsxs("div", { children: [_jsx("h1", { style: { margin: 0, fontSize: 15, fontWeight: 700 }, children: "Zoommate" }), _jsx("p", { style: { margin: 0, fontSize: 11, color: dimClr }, children: user ? `Signed in as ${user.username}` : "AI Interview Copilot" })] })] }), _jsxs("div", { style: { display: "flex", gap: 8 }, children: [onBackToOverlay && (_jsx("button", { onClick: onBackToOverlay, style: {
                                        fontSize: 11, padding: "5px 10px", borderRadius: 8, cursor: "pointer", border: "none",
                                        background: "rgba(99,102,241,0.12)", color: "#a5b4fc",
                                    }, children: "\u2190 Overlay" })), _jsx("button", { onClick: onLogout, style: {
                                        fontSize: 11, padding: "5px 10px", borderRadius: 8, cursor: "pointer", border: "none",
                                        background: "rgba(239,68,68,0.1)", color: "#f87171",
                                    }, children: "Sign out" })] })] }), _jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: [_jsx("label", { style: { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: mutedClr }, children: "Assistant Mode" }), _jsxs("div", { style: { position: "relative" }, children: [_jsx("select", { value: assistant, onChange: (e) => setAssistant(e.target.value), style: {
                                        width: "100%", padding: "10px 14px", borderRadius: 12, fontSize: 13,
                                        outline: "none", appearance: "none", cursor: "pointer", color: textClr,
                                        background: cardBg, border: `1px solid ${cardBdr}`,
                                    }, children: ASSISTANTS.map((a) => _jsx("option", { value: a, children: a }, a)) }), _jsx("span", { style: { position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", opacity: 0.4, pointerEvents: "none" }, children: "\u25BE" })] })] }), _jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: [_jsx("button", { onClick: handleStart, disabled: starting, style: {
                                width: "100%", padding: "12px 0", borderRadius: 14, border: "none", cursor: starting ? "not-allowed" : "pointer",
                                background: starting ? "rgba(99,102,241,0.6)" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
                                color: "#fff", fontSize: 14, fontWeight: 700,
                                transition: "opacity 0.15s",
                                opacity: starting ? 0.7 : 1,
                            }, children: starting ? "Starting…" : "▶ Start Session" }), startError && (_jsx("p", { style: { margin: 0, fontSize: 11, color: "#ef4444", textAlign: "center" }, children: startError }))] }), _jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [_jsx("label", { style: { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: mutedClr }, children: "Window Opacity" }), _jsxs("span", { style: { fontSize: 12, fontFamily: "monospace", color: mutedClr }, children: [opacity, "%"] })] }), _jsx("input", { type: "range", min: 20, max: 100, value: opacity, onChange: (e) => handleOpacity(Number(e.target.value)), style: { width: "100%", accentColor: "#6366f1" } })] }), _jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: [_jsx("label", { style: { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: mutedClr }, children: "Theme" }), _jsx("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }, children: ["dark", "light"].map((t) => (_jsxs("button", { onClick: () => setTheme(t), style: {
                                    padding: "9px 0", borderRadius: 10, cursor: "pointer", fontSize: 13,
                                    fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                                    background: theme === t ? "rgba(99,102,241,0.2)" : cardBg,
                                    border: theme === t ? "1px solid rgba(99,102,241,0.5)" : `1px solid ${cardBdr}`,
                                    color: theme === t ? "#a5b4fc" : textClr,
                                }, children: [t === "dark" ? "🌙" : "☀️", " ", t.charAt(0).toUpperCase() + t.slice(1)] }, t))) })] }), _jsxs("div", { style: { borderTop: `1px solid ${cardBdr}`, paddingTop: 16 }, children: [_jsx("label", { style: { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: mutedClr }, children: "App Settings" }), _jsx(SettingRow, { label: "Launch on startup", desc: "Start Zoommate when you log in", checked: launchOnStartup, onChange: handleLaunchOnStartup }), _jsx(SettingRow, { label: "Always on top", desc: "Keep overlay above all other windows", checked: alwaysOnTop, onChange: handleAlwaysOnTop }), _jsx(SettingRow, { label: "Privacy blur", desc: "Blur content until you click to reveal", checked: privacyBlur, onChange: handlePrivacyBlur }), _jsx(SettingRow, { label: "Click-through mode", desc: "Mouse clicks pass through to windows below", checked: clickThrough, onChange: handleClickThrough }), _jsx(SettingRow, { label: "Stealth mode", desc: "Hide from Zoom, Teams, OBS & screen recorders", checked: stealth, onChange: handleStealth }), privacyBlur && (_jsx("div", { style: { marginTop: 8, padding: "10px 14px", background: cardBg, borderRadius: 12, border: `1px solid ${cardBdr}` }, children: _jsxs("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" }, children: [_jsxs("div", { children: [_jsx("p", { style: { margin: 0, fontSize: 13, fontWeight: 600, color: textClr }, children: "Auto-hide delay (seconds)" }), _jsx("p", { style: { margin: "2px 0 0", fontSize: 11, color: dimClr }, children: "Re-blur after N seconds (0 = never)" })] }), _jsx("input", { type: "number", min: 0, max: 300, value: autoHideBlurSec, onChange: (e) => {
                                            const v = Number(e.target.value);
                                            setAutoHideBlurSec(v);
                                            persist({ autoHideBlurSeconds: v });
                                        }, style: {
                                            width: 64, padding: "4px 8px", borderRadius: 8, fontSize: 13,
                                            background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                                            border: `1px solid ${cardBdr}`,
                                            color: textClr, outline: "none", textAlign: "center",
                                        } })] }) })), _jsxs("div", { style: { marginTop: 8, padding: "10px 14px", background: cardBg, borderRadius: 12, border: `1px solid ${cardBdr}`, display: "flex", alignItems: "center", gap: 10 }, children: [_jsx("span", { style: { fontSize: 16 }, children: "\u2328\uFE0F" }), _jsxs("div", { children: [_jsx("p", { style: { margin: 0, fontSize: 13, fontWeight: 600, color: textClr }, children: "Global Hotkey" }), _jsxs("p", { style: { margin: "2px 0 0", fontSize: 11, color: mutedClr }, children: [_jsx("kbd", { style: {
                                                        padding: "1px 6px", borderRadius: 4, fontFamily: "monospace", fontSize: 11,
                                                        background: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)",
                                                        border: `1px solid ${cardBdr}`,
                                                    }, children: "Ctrl+Shift+Z" }), " ", "show / hide overlay"] })] })] })] }), _jsx("p", { style: { fontSize: 10, opacity: 0.2, textAlign: "center", margin: 0 }, children: "Zoommate v1.0.0 \u2014 Tauri 2" })] }) }));
}
