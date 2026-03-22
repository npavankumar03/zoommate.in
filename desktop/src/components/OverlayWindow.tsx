import { useState, useRef, useCallback, useEffect } from "react";
import { useZoommateSocket } from "../hooks/useZoommateSocket";
import { bridge } from "../lib/bridge";
import { Window } from "@tauri-apps/api/window";

// ── Answer renderer ────────────────────────────────────────────────────────────

function AnswerDisplay({ answer, isStreaming }: { answer: string; isStreaming: boolean }) {
  if (!answer.includes("```")) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.9)", lineHeight: 1.65, fontFamily: "sans-serif", whiteSpace: "pre-wrap" }}>
        {answer}
        {isStreaming && <Cursor />}
      </p>
    );
  }

  const segments: { type: "prose" | "code"; lang: string; text: string }[] = [];
  const regex = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = regex.exec(answer)) !== null) {
    if (m.index > last) {
      const prose = answer.slice(last, m.index).trim();
      if (prose) segments.push({ type: "prose", lang: "", text: prose });
    }
    segments.push({ type: "code", lang: m[1] || "code", text: m[2] });
    last = m.index + m[0].length;
  }
  if (last < answer.length) {
    const trail = answer.slice(last).trim();
    if (trail) segments.push({ type: "prose", lang: "", text: trail });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {segments.map((seg, i) =>
        seg.type === "prose" ? (
          <p key={i} style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.88)", lineHeight: 1.65, fontFamily: "sans-serif", whiteSpace: "pre-wrap" }}>
            {seg.text}
          </p>
        ) : (
          <div key={i} style={{ borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>
            {seg.lang && (
              <div style={{ padding: "3px 10px", background: "rgba(99,102,241,0.2)", fontSize: 10, color: "#a5b4fc", fontFamily: "monospace", letterSpacing: "0.05em" }}>
                {seg.lang}
              </div>
            )}
            <pre style={{ margin: 0, padding: "10px 12px", background: "rgba(0,0,0,0.5)", fontSize: 12, color: "#e2e8f0", fontFamily: "ui-monospace,monospace", lineHeight: 1.6, overflowX: "auto", whiteSpace: "pre" }}>
              {seg.text}
            </pre>
          </div>
        )
      )}
      {isStreaming && <Cursor />}
    </div>
  );
}

const Cursor = () => (
  <span style={{ display: "inline-block", width: 2, height: 14, marginLeft: 2, background: "rgba(255,255,255,0.6)", animation: "pulse 1s infinite" }} />
);

// ── Privacy blur overlay ───────────────────────────────────────────────────────

function BlurOverlay({ label, onReveal }: { label: string; onReveal: () => void }) {
  return (
    <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", minHeight: 56, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", inset: 0, backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", background: "rgba(10,10,20,0.55)" }} />
      <button
        onClick={onReveal}
        style={{
          position: "relative", zIndex: 1,
          background: "rgba(99,102,241,0.75)", border: "none", borderRadius: 8,
          padding: "6px 14px", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer",
        }}
      >
        👁 Click to reveal {label}
      </button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

type Mode = "full" | "mini" | "hidden";

interface Props {
  meetingId: string;
  onOpenSettings: () => void;
}

export function OverlayWindow({ meetingId, onOpenSettings }: Props) {
  const { state, requestAnswer, sendFollowUp, cancelStream, togglePause, retry } =
    useZoommateSocket(meetingId);

  const [mode, setMode]             = useState<Mode>("full");
  const [input, setInput]           = useState("");
  const [privacyBlur, setPrivacyBlur]     = useState(false);
  const [transcriptRevealed, setTranscriptRevealed] = useState(false);
  const [answerRevealed, setAnswerRevealed]         = useState(false);
  const [clickThrough, setClickThrough] = useState(false);
  const [stealth, setStealth]       = useState(false);

  // Reset reveal when blur is re-enabled
  useEffect(() => {
    if (privacyBlur) {
      setTranscriptRevealed(false);
      setAnswerRevealed(false);
    }
  }, [privacyBlur]);

  // Save window bounds on unmount / window close
  useEffect(() => {
    const win = Window.getCurrent();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const saveBounds = async () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const pos  = await win.outerPosition();
          const size = await win.outerSize();
          await bridge.saveWindowBounds(pos.x, pos.y, size.width, size.height);
        } catch {}
      }, 500);
    };

    win.onMoved(saveBounds);
    win.onResized(saveBounds);
    return () => { if (timer) clearTimeout(timer); };
  }, []);

  // Keyboard shortcuts (only when not in input)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "Enter")           { e.preventDefault(); requestAnswer(); }
      if (e.key.toLowerCase() === "p") { e.preventDefault(); togglePause(); }
      if (e.key.toLowerCase() === "r") { e.preventDefault(); retry(); }
      if (e.key === "Escape")          { setMode((m) => m === "full" ? "mini" : "full"); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [requestAnswer, togglePause, retry]);

  // Drag: use Tauri window drag API
  const startDrag = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button,input,select,textarea")) return;
    e.preventDefault();
    Window.getCurrent().startDragging().catch(() => {});
  }, []);

  // Load saved stealth setting on mount
  useEffect(() => {
    bridge.getSettings().then((s) => {
      if (s.stealth != null) {
        setStealth(s.stealth);
        bridge.setStealth(s.stealth).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  const handleClickThrough = async (v: boolean) => {
    setClickThrough(v);
    await bridge.setIgnoreCursor(v).catch(() => {});
  };

  const handleStealth = async (v: boolean) => {
    setStealth(v);
    await bridge.setStealth(v).catch(() => {});
    await bridge.saveSettings({ stealth: v }).catch(() => {});
  };

  const handleSend = () => {
    if (!input.trim()) return;
    sendFollowUp(input.trim());
    setInput("");
  };

  // ── Status colours ────────────────────────────────────────────────────────
  const statusColor = state.isPaused ? "#f59e0b"
    : state.isStreaming || state.isAwaitingFirstChunk ? "#3b82f6"
    : "#10b981";

  const connDot = state.connected ? "#10b981" : "#ef4444";

  // ── Hidden mode: tiny floating dot ────────────────────────────────────────
  if (mode === "hidden") {
    return (
      <div
        onClick={() => setMode("full")}
        onMouseDown={startDrag}
        style={{
          position: "fixed", bottom: 24, right: 24,
          width: 44, height: 44, borderRadius: "50%",
          background: "rgba(99,102,241,0.85)",
          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          border: "1px solid rgba(255,255,255,0.2)",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", zIndex: 9999,
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        }}
        title="Show Zoommate"
      >
        <span style={{ fontSize: 20 }}>⚡</span>
      </div>
    );
  }

  // ── Mini chip ─────────────────────────────────────────────────────────────
  if (mode === "mini") {
    return (
      <div
        onMouseDown={startDrag}
        style={{
          position: "fixed", top: 20, right: 20,
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "6px 12px", borderRadius: 99,
          background: "rgba(10,10,20,0.85)",
          border: "1px solid rgba(255,255,255,0.1)",
          backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
          cursor: "grab", zIndex: 9999,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: statusColor }} />
        <span style={{ fontSize: 11, fontFamily: "monospace", color: "rgba(255,255,255,0.6)", letterSpacing: "0.06em" }}>
          {state.statusLabel}
        </span>
        {state.answer && (
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {state.answer.slice(0, 60)}
          </span>
        )}
        <button onClick={() => setMode("full")} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.4)", fontSize: 13, padding: "0 2px" }}>▲</button>
      </div>
    );
  }

  // ── Full overlay ──────────────────────────────────────────────────────────
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9999 }}>
      <div style={{
        position: "absolute", top: 20, right: 20,
        width: 400,
        background: "rgba(8,8,18,0.82)",
        border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        borderRadius: 18,
        boxShadow: "0 24px 80px rgba(0,0,0,0.65), 0 0 0 0.5px rgba(255,255,255,0.04) inset",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        pointerEvents: "all",
      }}>

        {/* ── Header bar ──────────────────────────────────────────────────── */}
        <div
          onMouseDown={startDrag}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 12px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            cursor: "grab",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: connDot }} title={state.connected ? "Connected" : "Reconnecting…"} />
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor }} />
            </div>
            <span style={{ fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em" }}>
              {state.statusLabel}
            </span>
            <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 99, background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>
              Zoommate
            </span>
          </div>

          <div style={{ display: "flex", gap: 1, alignItems: "center" }}>
            {/* Stealth — hide from Zoom/Teams/OBS */}
            <Btn title={stealth ? "Stealth ON — hidden from screen recorders" : "Stealth OFF — visible in Zoom/Teams"} onClick={() => handleStealth(!stealth)} active={stealth}>
              {stealth ? "🕵️" : "👀"}
            </Btn>
            {/* Privacy blur */}
            <Btn title={privacyBlur ? "Disable blur" : "Enable blur"} onClick={() => setPrivacyBlur((v) => !v)} active={privacyBlur}>
              {privacyBlur ? "🙈" : "👁"}
            </Btn>
            {/* Click-through */}
            <Btn title={clickThrough ? "Disable click-through" : "Enable click-through"} onClick={() => handleClickThrough(!clickThrough)} active={clickThrough}>
              {clickThrough ? "🖱️" : "🖱"}
            </Btn>
            <Btn title="Settings" onClick={onOpenSettings}>⚙</Btn>
            <Btn title="Minimise" onClick={() => setMode("mini")}>—</Btn>
            <Btn title="Hide" onClick={() => setMode("hidden")}>×</Btn>
          </div>
        </div>

        {/* ── Transcript ──────────────────────────────────────────────────── */}
        {(state.transcript || state.finalTranscript) && (
          <div style={{ padding: "8px 14px 4px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            {privacyBlur && !transcriptRevealed ? (
              <BlurOverlay label="transcript" onReveal={() => setTranscriptRevealed(true)} />
            ) : (
              <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.28)", lineHeight: 1.4, fontFamily: "sans-serif" }}>
                {state.transcript || state.finalTranscript}
              </p>
            )}
          </div>
        )}

        {/* ── Question ────────────────────────────────────────────────────── */}
        {state.question && (
          <div style={{ padding: "8px 14px 4px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.4, fontFamily: "sans-serif", fontStyle: "italic" }}>
              Q: {state.question}
            </p>
          </div>
        )}

        {/* ── Answer area ─────────────────────────────────────────────────── */}
        <div style={{ padding: "12px 14px", maxHeight: 320, overflowY: "auto", minHeight: 64, scrollbarWidth: "thin" }}>
          {privacyBlur && !answerRevealed ? (
            (state.answer || state.isAwaitingFirstChunk) ? (
              <BlurOverlay label="answer" onReveal={() => setAnswerRevealed(true)} />
            ) : (
              <Empty paused={state.isPaused} />
            )
          ) : state.isAwaitingFirstChunk && !state.answer ? (
            <ThinkingDots />
          ) : state.answer ? (
            <AnswerDisplay answer={state.answer} isStreaming={state.isStreaming} />
          ) : (
            <Empty paused={state.isPaused} />
          )}

          {state.sttError && (
            <p style={{ margin: "8px 0 0", fontSize: 11, color: "#f59e0b", background: "rgba(245,158,11,0.08)", borderRadius: 6, padding: "4px 8px" }}>
              ⚠ {state.sttError}
            </p>
          )}
        </div>

        {/* ── CTA row ─────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", gap: 6, padding: "8px 12px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <button
            onClick={requestAnswer}
            style={{
              flex: 1, padding: "8px 0", borderRadius: 12, border: "none",
              background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
              color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
              transition: "opacity 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            ⚡ Answer
          </button>

          {state.isStreaming ? (
            <SmallBtn onClick={cancelStream} title="Cancel stream">✕</SmallBtn>
          ) : (
            <SmallBtn onClick={togglePause} title={state.isPaused ? "Resume" : "Pause"}>
              {state.isPaused ? "▶" : "⏸"}
            </SmallBtn>
          )}
          <SmallBtn onClick={retry} title="Retry">↺</SmallBtn>
        </div>

        {/* ── Follow-up input ──────────────────────────────────────────────── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 12px 10px",
          borderTop: "1px solid rgba(255,255,255,0.04)",
        }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Ask a follow-up question…"
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              fontSize: 12, color: "rgba(255,255,255,0.75)", fontFamily: "sans-serif",
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            style={{
              background: input.trim() ? "rgba(99,102,241,0.65)" : "rgba(255,255,255,0.05)",
              border: "none", borderRadius: 8, padding: "5px 9px",
              cursor: "pointer", color: "rgba(255,255,255,0.8)", fontSize: 14,
              opacity: input.trim() ? 1 : 0.35, transition: "opacity 0.15s",
            }}
          >
            ➤
          </button>
        </div>

        {/* ── Hotkey hint bar ──────────────────────────────────────────────── */}
        <div style={{
          display: "flex", gap: 14, padding: "0 12px 8px",
          fontSize: 10, color: "rgba(255,255,255,0.18)", fontFamily: "monospace",
        }}>
          {[["Enter", "answer"], ["P", "pause"], ["R", "retry"], ["Esc", "mini"]].map(([k, l]) => (
            <span key={k}>
              <span style={{ color: "rgba(255,255,255,0.35)" }}>{k}</span> {l}
            </span>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
        @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:0.25} }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }
      `}</style>
    </div>
  );
}

// ── Tiny sub-components ────────────────────────────────────────────────────────

function Btn({ children, title, onClick, active }: {
  children: React.ReactNode; title: string; onClick: () => void; active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: active ? "rgba(99,102,241,0.2)" : "none",
        border: "none", cursor: "pointer",
        color: active ? "rgba(165,180,252,0.9)" : "rgba(255,255,255,0.3)",
        fontSize: 13, padding: "2px 6px", borderRadius: 6, transition: "color 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.85)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = active ? "rgba(165,180,252,0.9)" : "rgba(255,255,255,0.3)")}
    >
      {children}
    </button>
  );
}

function SmallBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: "8px 12px", borderRadius: 12,
        background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)",
        color: "rgba(255,255,255,0.55)", fontSize: 13, cursor: "pointer",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.12)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
    >
      {children}
    </button>
  );
}

function ThinkingDots() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {[0, 120, 240].map((d) => (
        <div key={d} style={{ width: 7, height: 7, borderRadius: "50%", background: "#6366f1", animation: `bounce 0.8s ${d}ms infinite` }} />
      ))}
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", fontFamily: "sans-serif" }}>Thinking…</span>
    </div>
  );
}

function Empty({ paused }: { paused: boolean }) {
  return (
    <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.18)", fontFamily: "sans-serif" }}>
      {paused ? "Listening paused. Press P to resume." : "Listening… Press Enter to get an answer."}
    </p>
  );
}
