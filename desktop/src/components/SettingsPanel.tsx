import { useState, useEffect } from "react";
import { bridge, type User } from "../lib/bridge";
import { Window, getCurrentWindow } from "@tauri-apps/api/window";

const DEFAULT_ASSISTANTS = [
  "General Meeting",
  "Python Engineer",
  "Frontend Engineer",
  "System Design",
  "Behavioral / HR",
  "Data Science",
];

interface Props {
  user: User | null;
  onStartSession: (meetingId: string, assistantName: string, opacity: number) => void;
  onLogout: () => void;
  onBackToOverlay?: () => void;
}

export function SettingsPanel({ user, onStartSession, onLogout, onBackToOverlay }: Props) {
  const [assistant, setAssistant]           = useState(DEFAULT_ASSISTANTS[0]);
  const [serverAssistants, setServerAssistants] = useState<string[]>([]);
  const [opacity, setOpacity]               = useState(85);
  const [theme, setTheme]                   = useState<"light" | "dark">("dark");
  const [stealth, setStealth]               = useState(false);
  const [starting, setStarting]             = useState(false);
  const [startError, setStartError]         = useState("");

  // Load server assistants
  useEffect(() => {
    bridge.getAssistants().then((list) => {
      if (list.length > 0) setServerAssistants(list.map((a) => a.name));
    }).catch(() => {});
  }, []);

  // Load saved settings
  useEffect(() => {
    bridge.getSettings().then((s) => {
      if (s.opacity != null)               setOpacity(Math.round(s.opacity * 100));
      if (s.assistant)                     setAssistant(s.assistant);
      if (s.theme === "light" || s.theme === "dark") setTheme(s.theme);
      if (s.stealth != null)               setStealth(s.stealth);
    }).catch(() => {});
  }, []);

  const allAssistants = serverAssistants.length > 0
    ? [...serverAssistants, ...DEFAULT_ASSISTANTS.filter((d) => !serverAssistants.includes(d))]
    : DEFAULT_ASSISTANTS;

  const handleStart = async () => {
    setStarting(true);
    setStartError("");
    try {
      await bridge.setOpacity(opacity / 100);
      const title = `${assistant} – ${new Date().toLocaleDateString()}`;
      const id    = await bridge.createMeeting(title, "interview");
      bridge.saveSettings({ opacity: opacity / 100, assistant, theme, stealth }).catch(() => {});
      onStartSession(id, assistant, opacity / 100);
    } catch (err: any) {
      setStartError(err?.message || "Failed to start session. Are you signed in?");
    } finally {
      setStarting(false);
    }
  };

  const handleOpacity = (v: number) => {
    setOpacity(v);
    bridge.setOpacity(v / 100).catch(() => {});
  };

  const handleStealth = (v: boolean) => {
    setStealth(v);
    bridge.setStealth(v).catch(() => {});
    bridge.saveSettings({ stealth: v }).catch(() => {});
  };

  // ── Colors ─────────────────────────────────────────────────────────────────
  const isDark  = theme === "dark";
  const bg      = isDark ? "#0f0f1a"                : "#f0f0f5";
  const panelBg = isDark ? "#18182a"                : "#fff";
  const rowBg   = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)";
  const rowBdr  = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.1)";
  const textClr = isDark ? "#e2e8f0"                : "#1a1a2e";
  const dimClr  = isDark ? "rgba(255,255,255,0.38)" : "rgba(0,0,0,0.4)";
  const sectionClr = isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)";
  const inputBg = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)";

  return (
    <div style={{
      height: "100vh",
      background: bg,
      display: "flex",
      flexDirection: "column",
      fontFamily: "sans-serif",
      overflow: "hidden",
    }}>

      {/* ── Header bar ──────────────────────────────────────────────────────── */}
      <div
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          e.preventDefault();
          getCurrentWindow().startDragging().catch(() => {});
        }}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px",
          borderBottom: `1px solid ${rowBdr}`,
          cursor: "grab",
          userSelect: "none",
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700, color: textClr }}>Settings</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {onBackToOverlay && (
            <HeaderBtn onClick={onBackToOverlay} title="Back to overlay" color="#6366f1">
              ← Session
            </HeaderBtn>
          )}
          <HeaderIconBtn onClick={onLogout} title="Sign out" color="#94a3b8">
            ↪
          </HeaderIconBtn>
          <HeaderIconBtn
            onClick={() => Window.getCurrent().close().catch(() => window.close())}
            title="Quit Zoommate"
            color="#ef4444"
          >
            ⏻
          </HeaderIconBtn>
        </div>
      </div>

      {/* ── Scrollable body ─────────────────────────────────────────────────── */}
      <div style={{
        flex: 1, overflowY: "auto", padding: "20px 20px 28px",
        display: "flex", flexDirection: "column", gap: 24,
        scrollbarWidth: "thin",
      }}>

        {/* User chip */}
        {user && (
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "6px 12px", borderRadius: 99,
            background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.25)",
            alignSelf: "flex-start",
          }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#fff", fontWeight: 700 }}>
              {user.username?.[0]?.toUpperCase() || "U"}
            </div>
            <span style={{ fontSize: 12, color: "#a5b4fc", fontWeight: 500 }}>{user.username}</span>
          </div>
        )}

        {/* ── ASSISTANT ─────────────────────────────────────────────────────── */}
        <Section label="ASSISTANT" desc="Pick the meeting assistant you want Zoommate to use" labelColor={sectionClr} textClr={textClr} dimClr={dimClr}>
          {/* Dropdown */}
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 14, opacity: 0.4, pointerEvents: "none" }}>🔍</span>
            <select
              value={assistant}
              onChange={(e) => setAssistant(e.target.value)}
              style={{
                width: "100%", padding: "12px 40px 12px 40px", borderRadius: 12, fontSize: 13,
                outline: "none", appearance: "none", cursor: "pointer", color: textClr,
                background: inputBg, border: `1px solid ${rowBdr}`,
              }}
            >
              {serverAssistants.length > 0 && (
                <optgroup label="Your Assistants">
                  {serverAssistants.map((a) => <option key={`s-${a}`} value={a}>{a}</option>)}
                </optgroup>
              )}
              <optgroup label={serverAssistants.length > 0 ? "Default Modes" : "Select Assistant"}>
                {DEFAULT_ASSISTANTS.map((a) => <option key={a} value={a}>{a}</option>)}
              </optgroup>
            </select>
            <span style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", opacity: 0.4, pointerEvents: "none", fontSize: 12 }}>▾</span>
          </div>

          {/* Start buttons */}
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button
              onClick={handleStart}
              disabled={starting}
              style={{
                flex: 1, padding: "13px 0", borderRadius: 12, border: "none",
                background: starting ? "rgba(99,102,241,0.6)" : "linear-gradient(135deg,#4f52d9,#6366f1)",
                color: "#fff", fontSize: 13, fontWeight: 700, cursor: starting ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                opacity: starting ? 0.7 : 1,
                transition: "opacity 0.2s ease, background 0.2s ease",
              }}
            >
              <span style={{ fontSize: 11 }}>▶</span>
              {starting ? "Starting…" : "Start Session"}
            </button>
          </div>

          {startError && (
            <p style={{ margin: 0, fontSize: 11, color: "#ef4444", textAlign: "center" }}>{startError}</p>
          )}

          {/* Create assistant link */}
          <button
            onClick={() => {
              // Open Zoommate web in browser to create assistant
              window.open("https://ai.zoommate.in/assistants", "_blank");
            }}
            style={{
              width: "100%", padding: "11px 0", borderRadius: 12, marginTop: 4,
              background: rowBg, border: `1px solid ${rowBdr}`,
              color: dimClr, fontSize: 12, fontWeight: 500, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = rowBg)}
          >
            ＋ Create Meeting Assistant in Zoommate ↗
          </button>
        </Section>

        {/* ── WINDOW OPACITY ────────────────────────────────────────────────── */}
        <Section label="WINDOW OPACITY" desc="Choose how transparent Zoommate appears over your other apps" labelColor={sectionClr} textClr={textClr} dimClr={dimClr}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input
              type="range" min={20} max={100} value={opacity}
              onChange={(e) => handleOpacity(Number(e.target.value))}
              style={{ flex: 1, accentColor: "#6366f1", height: 4, cursor: "pointer" }}
            />
            <span style={{ fontSize: 13, fontFamily: "monospace", color: dimClr, minWidth: 34, textAlign: "right" }}>
              {opacity}%
            </span>
          </div>
        </Section>

        {/* ── VISIBILITY ────────────────────────────────────────────────────── */}
        <Section label="VISIBILITY" desc="Control whether Zoommate appears when you share your screen" labelColor={sectionClr} textClr={textClr} dimClr={dimClr}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {/* Visible */}
            <VisibilityCard
              selected={!stealth}
              onClick={() => handleStealth(false)}
              icon="👁"
              label="Visible"
              desc="Display Zoommate to everyone viewing your screen"
              isDark={isDark}
            />
            {/* Invisible */}
            <VisibilityCard
              selected={stealth}
              onClick={() => handleStealth(true)}
              icon="🚫"
              label="Invisible"
              badge="RECOMMENDED"
              desc="Hide Zoommate from shared screens; only you see it"
              isDark={isDark}
            />
          </div>
        </Section>

        {/* ── THEME ─────────────────────────────────────────────────────────── */}
        <Section label="THEME" labelColor={sectionClr} textClr={textClr} dimClr={dimClr}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {(["dark", "light"] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTheme(t);
                  bridge.saveSettings({ theme: t }).catch(() => {});
                }}
                style={{
                  padding: "11px 0", borderRadius: 10, cursor: "pointer",
                  fontSize: 13, fontWeight: 500,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  background: theme === t ? "rgba(99,102,241,0.2)" : rowBg,
                  border: theme === t ? "1px solid rgba(99,102,241,0.55)" : `1px solid ${rowBdr}`,
                  color: theme === t ? "#a5b4fc" : textClr,
                  transition: "background 0.2s ease, border-color 0.2s ease, color 0.2s ease",
                }}
              >
                {t === "dark" ? "🌙" : "☀️"} {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </Section>

        {/* Version */}
        <p style={{ fontSize: 10, color: "rgba(255,255,255,0.12)", textAlign: "center", margin: 0 }}>
          Zoommate v1.0.0 · Tauri 2
        </p>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Section({
  label, desc, children, labelColor, textClr, dimClr,
}: {
  label: string; desc?: string; children?: React.ReactNode;
  labelColor: string; textClr: string; dimClr: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: labelColor }}>
          {label}
        </p>
        {desc && (
          <p style={{ margin: "3px 0 0", fontSize: 12, color: dimClr }}>{desc}</p>
        )}
      </div>
      {children}
    </div>
  );
}

function VisibilityCard({
  selected, onClick, icon, label, badge, desc, isDark,
}: {
  selected: boolean; onClick: () => void; icon: string;
  label: string; badge?: string; desc: string; isDark: boolean;
}) {
  const selBg  = isDark ? "rgba(59,130,246,0.15)"  : "rgba(59,130,246,0.08)";
  const defBg  = isDark ? "rgba(255,255,255,0.04)"  : "rgba(0,0,0,0.04)";
  const selBdr = "rgba(59,130,246,0.6)";
  const defBdr = isDark ? "rgba(255,255,255,0.1)"   : "rgba(0,0,0,0.1)";
  const textC  = isDark ? "#e2e8f0" : "#1a1a2e";
  const dimC   = isDark ? "rgba(255,255,255,0.38)" : "rgba(0,0,0,0.4)";

  return (
    <button
      onClick={onClick}
      style={{
        padding: "14px 12px", borderRadius: 12, cursor: "pointer", textAlign: "left",
        background: selected ? selBg : defBg,
        border: `1px solid ${selected ? selBdr : defBdr}`,
        display: "flex", flexDirection: "column", gap: 6,
        transition: "background 0.2s ease, border-color 0.2s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18, opacity: selected ? 1 : 0.5, transition: "opacity 0.2s ease" }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: textC }}>{label}</span>
        {badge && (
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
            padding: "2px 6px", borderRadius: 6,
            background: "rgba(99,102,241,0.2)", color: "#a5b4fc",
            border: "1px solid rgba(99,102,241,0.35)",
          }}>
            {badge}
          </span>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 11, color: dimC, lineHeight: 1.4 }}>{desc}</p>
    </button>
  );
}

function HeaderBtn({ children, onClick, title, color }: {
  children: React.ReactNode; onClick: () => void; title: string; color: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        fontSize: 11, padding: "5px 12px", borderRadius: 8, cursor: "pointer", border: "none",
        background: `${color}18`, color: color, fontWeight: 600,
      }}
    >
      {children}
    </button>
  );
}

function HeaderIconBtn({ children, onClick, title, color }: {
  children: React.ReactNode; onClick: () => void; title: string; color: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 30, height: 30, borderRadius: "50%", cursor: "pointer", border: "none",
        background: `${color}18`, color: color, fontSize: 16,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {children}
    </button>
  );
}
