import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useZoommateSocket } from "../hooks/useZoommateSocket";
import { useTypingPlayback, type PlaybackStatus } from "../hooks/useTypingPlayback";
import { bridge } from "../lib/bridge";
import { Window, getCurrentWindow } from "@tauri-apps/api/window";

// ── Inline markdown (light theme) ──────────────────────────────────────────────

function InlineMarkdown({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
  let last = 0, m: RegExpExecArray | null, key = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if      (m[2]) parts.push(<strong key={key++} style={{ color: "#111", fontWeight: 700 }}>{m[2]}</strong>);
    else if (m[3]) parts.push(<em     key={key++} style={{ color: "#333" }}>{m[3]}</em>);
    else if (m[4]) parts.push(<code   key={key++} style={{ background: "rgba(0,0,0,0.06)", borderRadius: 4, padding: "1px 5px", fontSize: "0.9em", fontFamily: "ui-monospace,monospace", color: "#4338ca" }}>{m[4]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function ProseBlock({ text, isStreaming, fontSize }: { text: string; isStreaming?: boolean; fontSize: number }) {
  const paras = text.split(/\n\n+/).filter(Boolean);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {paras.map((para, i) => (
        <p key={i} style={{ margin: 0, fontSize, color: "#1a1a1a", lineHeight: 1.75, fontFamily: "sans-serif" }}>
          <InlineMarkdown text={para.replace(/\n/g, " ")} />
          {isStreaming && i === paras.length - 1 && (
            <span style={{ display: "inline-block", width: 2, height: fontSize, marginLeft: 2, background: "rgba(0,0,0,0.35)", animation: "blink 1s infinite", verticalAlign: "middle" }} />
          )}
        </p>
      ))}
    </div>
  );
}

function AnswerDisplay({ answer, isStreaming, fontSize }: { answer: string; isStreaming: boolean; fontSize: number }) {
  if (!answer.includes("```")) {
    return <ProseBlock text={answer} isStreaming={isStreaming} fontSize={fontSize} />;
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
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {segments.map((seg, i) =>
        seg.type === "prose" ? (
          <ProseBlock key={i} text={seg.text} isStreaming={isStreaming && i === segments.length - 1} fontSize={fontSize} />
        ) : (
          <div key={i} style={{ borderRadius: 10, overflow: "hidden", border: "1px solid rgba(0,0,0,0.1)" }}>
            {seg.lang && (
              <div style={{ padding: "4px 12px", background: "rgba(67,56,202,0.07)", fontSize: 10, color: "#4338ca", fontFamily: "monospace", letterSpacing: "0.06em", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                {seg.lang}
              </div>
            )}
            <pre style={{ margin: 0, padding: "12px 14px", background: "#f8f9fb", fontSize: fontSize - 1, color: "#1e1b4b", fontFamily: "ui-monospace,monospace", lineHeight: 1.65, overflowX: "auto", whiteSpace: "pre" }}>
              {seg.text}
            </pre>
          </div>
        )
      )}
    </div>
  );
}

// ── Timer ───────────────────────────────────────────────────────────────────────

function useTimer() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
}

// ── Animated listening bars ─────────────────────────────────────────────────────

function ListeningBars({ active }: { active: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2.5, height: 15, paddingBottom: 1 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{
          width: 3, borderRadius: 2,
          background: active ? "#3b82f6" : "#d1d5db",
          height: "100%",
          animation: active ? `bar${i} 0.9s ${i * 0.18}s ease-in-out infinite` : "none",
          transformOrigin: "bottom",
          transition: "background 0.3s",
        }} />
      ))}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────────

interface Props {
  meetingId: string;
  onOpenSettings: () => void;
  assistantName?: string;
  opacity?: number;
}

export function OverlayWindow({ meetingId, onOpenSettings, assistantName, opacity = 0.92 }: Props) {
  const { state, requestAnswer, sendFollowUp, cancelStream, togglePause, retry, addSystemAudio } =
    useZoommateSocket(meetingId);

  // ── Typing Playback ─────────────────────────────────────────────────────────
  const {
    status:      typingStatus,
    countdown:   typingCountdown,
    displayed:   typingDisplayed,
    progress:    typingProgress,
    detectedCtx: typingDetectedCtx,
    start:       startTyping,
    pause:       pauseTyping,
    resume:      resumeTyping,
    cancel:      cancelTyping,
  } = useTypingPlayback();

  const [showTypingPanel, setShowTypingPanel] = useState(false);
  const [typingInject,    setTypingInject]    = useState(false);
  const [typingCodeOnly,  setTypingCodeOnly]  = useState(false);
  // lockedAnswer: the answer currently being typed — persists even when captureAnswer is cleared
  const [lockedAnswer,    setLockedAnswer]    = useState("");

  // ── Capture & Solve ─────────────────────────────────────────────────────────
  const [captureSolving,   setCaptureSolving]   = useState(false);
  const [captureCountdown, setCaptureCountdown] = useState(0);
  const [captureError,     setCaptureError]     = useState("");
  const [captureAnswer,    setCaptureAnswer]    = useState("");
  const [captureStreaming, setCaptureStreaming]  = useState(false);

  // Auto-pause typing when a new WS answer starts, and clear captureAnswer so
  // the right panel shows the new follow-up answer instead of the capture code
  useEffect(() => {
    if (state.isAwaitingFirstChunk) {
      if (typingStatus === "typing") pauseTyping();
      setCaptureAnswer("");   // let right panel show the incoming follow-up answer
      setCaptureError("");
    }
  }, [state.isAwaitingFirstChunk]);

  const captureAndSolve = useCallback(async () => {
    setCaptureSolving(true);
    setCaptureError("");
    setCaptureAnswer("");
    setLockedAnswer("");
    setShowTypingPanel(false);

    for (let i = 3; i >= 1; i--) {
      setCaptureCountdown(i);
      await new Promise((r) => setTimeout(r, 1000));
    }
    setCaptureCountdown(0);

    try {
      await invoke("hide_overlay");
      await new Promise((r) => setTimeout(r, 150));
      const base64 = await invoke<string>("capture_screen");
      await invoke("show_overlay");
      if (!base64) throw new Error("Screenshot returned empty — try again");

      setCaptureSolving(false);
      setCaptureStreaming(true);

      const liveTranscript = state.transcriptSegments.slice().reverse().join("\n") || undefined;

      const res = await fetch(`https://ai.zoommate.in/api/meetings/${meetingId}/analyze-screen-stream`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: `data:image/png;base64,${base64}`, liveTranscript }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Screen analysis failed" }));
        throw new Error(err.message || "Screen analysis failed");
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamed = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) continue;
          if (trimmed.startsWith("data: ")) {
            try {
              const json = JSON.parse(trimmed.slice(6));
              if (json.chunk) {
                streamed += json.chunk;
                setCaptureAnswer(streamed);
              } else if (json.message) {
                throw new Error(json.message);
              }
            } catch (parseErr: any) {
              if (parseErr?.message && !parseErr.message.includes("JSON")) throw parseErr;
            }
          }
        }
      }

      setCaptureStreaming(false);
      if (streamed) {
        setTypingCodeOnly(true);
        setTypingInject(true);
        setShowTypingPanel(true);
      }
    } catch (e: any) {
      console.error("[CaptureAndSolve]", e);
      setCaptureError(e.message || "Capture failed");
      await invoke("show_overlay").catch(() => {});
      setCaptureStreaming(false);
    } finally {
      setCaptureSolving(false);
    }
  }, [meetingId, state.transcriptSegments]);

  const [panelOpacity, setPanelOpacity] = useState(opacity);
  const [fontSize, setFontSize] = useState(14);
  const timer = useTimer();
  const [input, setInput] = useState("");
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const [leftPct, setLeftPct] = useState(30);
  const dividerDragRef = useRef<{ startX: number; startPct: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Timestamped transcript segments
  const [timedSegments, setTimedSegments] = useState<{ text: string; time: string }[]>([]);
  const prevSegCountRef = useRef(0);
  useEffect(() => {
    if (state.transcriptSegments.length > prevSegCountRef.current) {
      const now = new Date();
      const timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
      const newSegs = state.transcriptSegments.slice(prevSegCountRef.current).map(text => ({ text, time: timeStr }));
      setTimedSegments(prev => [...prev, ...newSegs]);
      prevSegCountRef.current = state.transcriptSegments.length;
    }
  }, [state.transcriptSegments]);

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dividerDragRef.current = { startX: e.clientX, startPct: leftPct };
    const onMove = (ev: MouseEvent) => {
      if (!dividerDragRef.current || !containerRef.current) return;
      const dx = ev.clientX - dividerDragRef.current.startX;
      const w = containerRef.current.getBoundingClientRect().width;
      const newPct = Math.min(60, Math.max(15, dividerDragRef.current.startPct + (dx / w) * 100));
      setLeftPct(newPct);
    };
    const onUp = () => {
      dividerDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [leftPct]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [timedSegments.length, state.transcript]);

  useEffect(() => {
    bridge.getSettings().then((s) => {
      if (s.stealth != null) bridge.setStealth(s.stealth).catch(() => {});
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const win = Window.getCurrent();
    let t: ReturnType<typeof setTimeout> | null = null;
    const save = () => {
      if (t) clearTimeout(t);
      t = setTimeout(async () => {
        try {
          const pos  = await win.outerPosition();
          const size = await win.outerSize();
          await bridge.saveWindowBounds(pos.x, pos.y, size.width, size.height);
        } catch {}
      }, 500);
    };
    win.onMoved(save);
    win.onResized(save);
    return () => { if (t) clearTimeout(t); };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "Enter")           { e.preventDefault(); requestAnswer(); }
      if (e.key.toLowerCase() === "p") { e.preventDefault(); togglePause(); }
      if (e.key.toLowerCase() === "r") { e.preventDefault(); retry(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [requestAnswer, togglePause, retry]);

  const handleSend = () => {
    if (!input.trim()) return;
    sendFollowUp(input.trim());
    setInput("");
  };

  const isRecording  = !state.isPaused && state.connected;
  const displayName  = assistantName || "General Meeting";
  const statusText   = !state.connected
    ? "Connecting…"
    : state.isPaused
    ? "Paused"
    : state.isStreaming
    ? "Generating…"
    : state.isAwaitingFirstChunk
    ? "Thinking…"
    : "Listening";

  return (
    <div style={{
      position: "fixed", inset: 0,
      display: "flex", flexDirection: "column",
      padding: "10px 12px 12px", gap: 8,
      pointerEvents: "none",
    }}>

      {/* ── Top pill bar ────────────────────────────────────────────────────────── */}
      <div
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("button,input")) return;
          e.preventDefault();
          getCurrentWindow().startDragging().catch(() => {});
        }}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 16px", height: 44,
          background: "rgba(20,20,24,0.96)",
          backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
          borderRadius: 99,
          border: "1px solid rgba(255,255,255,0.07)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
          cursor: "grab", pointerEvents: "all",
          flexShrink: 0, userSelect: "none",
          alignSelf: "center", width: "62%", minWidth: 480, maxWidth: 700,
        }}
      >
        {/* Left: shield + name + divider + sparkle + assistant */}
        <div style={{ display: "flex", alignItems: "center", gap: 9, pointerEvents: "none" }}>
          {/* Shield icon */}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <path d="M12 2L4 6v6c0 5.25 3.5 10.15 8 11.35C16.5 22.15 20 17.25 20 12V6L12 2z" fill="rgba(255,255,255,0.8)" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#fff", letterSpacing: "-0.01em" }}>Zoommate</span>
          <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.14)", flexShrink: 0 }} />
          {/* Sparkle icon */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="rgba(255,255,255,0.65)" style={{ flexShrink: 0 }}>
            <path d="M12 2l2.09 6.26L20.18 10l-6.09 1.74L12 18l-2.09-6.26L3.82 10l6.09-1.74z"/>
          </svg>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {displayName}
          </span>
        </div>

        {/* Center: record button + clock + timer */}
        <div style={{ display: "flex", alignItems: "center", gap: 7, pointerEvents: "none" }}>
          <div style={{
            width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
            background: isRecording ? "#ef4444" : "rgba(255,255,255,0.12)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: isRecording ? "0 0 0 4px rgba(239,68,68,0.18)" : "none",
            animation: isRecording ? "recPulse 1.5s ease-in-out infinite" : "none",
            transition: "background 0.3s",
          }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: "#fff" }} />
          </div>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" opacity={0.45}>
            <circle cx="12" cy="12" r="10" stroke="#fff" strokeWidth="2"/>
            <path d="M12 6v6l4 2" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <span style={{ fontSize: 12, fontFamily: "monospace", color: "rgba(255,255,255,0.7)", letterSpacing: "0.05em" }}>
            {timer}
          </span>
        </div>

        {/* Right: system audio + stop + settings */}
        <div style={{ display: "flex", alignItems: "center", gap: 2, pointerEvents: "all" }}>
          <button
            onClick={addSystemAudio}
            title={state.systemAudioConnected ? "System audio active" : "Mix system audio"}
            style={{
              background: state.systemAudioConnected ? "rgba(16,185,129,0.2)" : "transparent",
              border: "none", borderRadius: 7, padding: "4px 8px", cursor: "pointer",
              color: state.systemAudioConnected ? "#6ee7b7" : "rgba(255,255,255,0.45)",
              fontSize: 12,
            }}
          >🔊</button>

          {/* Opacity slider */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input
              type="range" min={20} max={100}
              value={Math.round(panelOpacity * 100)}
              onChange={(e) => setPanelOpacity(Number(e.target.value) / 100)}
              title={`Opacity: ${Math.round(panelOpacity * 100)}%`}
              style={{ width: 50, accentColor: "#6366f1", cursor: "pointer" }}
              onMouseDown={(e) => e.stopPropagation()}
            />
          </div>

          {state.isStreaming && (
            <PillBtn onClick={cancelStream} title="Stop">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
            </PillBtn>
          )}
          <PillBtn onClick={onOpenSettings} title="Settings">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="3" stroke="rgba(255,255,255,0.7)" strokeWidth="2"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="rgba(255,255,255,0.7)" strokeWidth="2"/>
            </svg>
          </PillBtn>
        </div>
      </div>

      {/* ── Content panel (white frosted glass) ─────────────────────────────────── */}
      <div style={{
        flex: 1,
        background: `rgba(255,255,255,${Math.max(0.72, panelOpacity * 0.9)})`,
        backdropFilter: "blur(28px) saturate(1.8)",
        WebkitBackdropFilter: "blur(28px) saturate(1.8)",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.6)",
        boxShadow: "0 8px 40px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.06)",
        display: "flex", flexDirection: "column",
        overflow: "hidden", pointerEvents: "all",
        minHeight: 0, color: "#1a1a1a",
        transition: "background 0.2s ease",
      }}>

        {/* ── Status strip ── */}
        <div style={{
          padding: "8px 14px",
          borderBottom: "1px solid rgba(0,0,0,0.07)",
          display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
        }}>
          <ListeningBars active={isRecording && !state.isStreaming && !state.isAwaitingFirstChunk} />
          <span style={{ fontSize: 13, fontWeight: 500, color: "#374151", fontFamily: "sans-serif" }}>
            {statusText}
          </span>
          {lockedAnswer && typingStatus !== "idle" && (
            <span style={{
              fontSize: 11, fontWeight: 600, color: "#6366f1",
              background: "rgba(99,102,241,0.08)", borderRadius: 6,
              padding: "2px 8px", border: "1px solid rgba(99,102,241,0.2)",
              fontFamily: "sans-serif", letterSpacing: "0.01em",
            }}>
              {typingStatus === "paused" ? "⏸ Code paused" : "🔒 Typing code"}
            </span>
          )}

          {/* Right icon row */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 1 }}>
            {/* Capture & Solve */}
            <IconBtn onClick={captureAndSolve} disabled={captureSolving} title={captureCountdown > 0 ? `${captureCountdown}…` : "Capture & Solve"}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="1.8"/>
              </svg>
              {captureCountdown > 0 && <span style={{ fontSize: 10, fontWeight: 700 }}>{captureCountdown}</span>}
            </IconBtn>

            {/* Typing panel */}
            {(lockedAnswer || captureAnswer || state.answer) && !state.isStreaming && !captureStreaming && !captureSolving && (
              <IconBtn onClick={() => setShowTypingPanel(p => !p)} title="Typing Playback" active={showTypingPanel || typingStatus !== "idle"}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              </IconBtn>
            )}

            {/* Retry */}
            {state.answer && !captureAnswer && !state.isStreaming && !state.isPaused && state.connected && (
              <IconBtn onClick={retry} title="Retry">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <polyline points="1 4 1 10 7 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M3.51 15a9 9 0 102.13-9.36L1 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </IconBtn>
            )}

            {/* Resume */}
            {state.isPaused && (
              <IconBtn onClick={togglePause} title="Resume">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
              </IconBtn>
            )}

            {/* Font size */}
            <div style={{ display: "flex", alignItems: "center", marginLeft: 4 }}>
              <IconBtn onClick={() => setFontSize(s => Math.min(20, s + 1))} title="Increase font size">
                <span style={{ fontSize: 11, fontWeight: 700, lineHeight: 1 }}>A<sup style={{ fontSize: 7, fontWeight: 900 }}>+</sup></span>
              </IconBtn>
              <IconBtn onClick={() => setFontSize(s => Math.max(10, s - 1))} title="Decrease font size">
                <span style={{ fontSize: 11, fontWeight: 700, lineHeight: 1 }}>A<sup style={{ fontSize: 7, fontWeight: 900 }}>−</sup></span>
              </IconBtn>
            </div>
          </div>
        </div>

        {/* ── Two-column body ── */}
        <div ref={containerRef} style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>

          {/* ── Left: Live Transcript ── */}
          <div style={{
            width: `${leftPct}%`, flexShrink: 0,
            display: "flex", flexDirection: "column", overflow: "hidden",
            borderRight: "1px solid rgba(0,0,0,0.07)",
          }}>
            <div style={{
              flex: 1, overflowY: "auto", padding: "14px 14px",
              scrollbarWidth: "thin", display: "flex", flexDirection: "column", gap: 16,
            }}>
              {state.sttError ? (
                <div style={{ background: "rgba(239,68,68,0.07)", borderRadius: 8, padding: "8px 10px", border: "1px solid rgba(239,68,68,0.18)" }}>
                  <span style={{ fontSize: 12, color: "#dc2626", fontFamily: "sans-serif" }}>⚠ {state.sttError}</span>
                </div>
              ) : timedSegments.length === 0 && !state.transcript ? (
                <span style={{ fontSize: 13, color: "#9ca3af", fontFamily: "sans-serif", fontStyle: "italic" }}>
                  {state.connected ? "Live transcription will appear here" : "Connecting…"}
                </span>
              ) : (
                <>
                  {timedSegments.map((seg, i) => (
                    <div key={i} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "ui-monospace,monospace" }}>{seg.time}</span>
                      <span style={{ fontSize: fontSize - 1, color: "#374151", fontFamily: "sans-serif", lineHeight: 1.55 }}>{seg.text}</span>
                    </div>
                  ))}
                  {state.transcript && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ fontSize: 10, color: "#d1d5db", fontFamily: "ui-monospace,monospace" }}>now</span>
                      <span style={{ fontSize: fontSize - 1, color: "#6b7280", fontFamily: "sans-serif", fontStyle: "italic", lineHeight: 1.55 }}>
                        {state.transcript}
                        <span style={{ display: "inline-block", width: 1, height: "0.85em", background: "#9ca3af", verticalAlign: "text-bottom", marginLeft: 2, animation: "blink 1s infinite" }} />
                      </span>
                    </div>
                  )}
                </>
              )}
              <div ref={transcriptEndRef} />
            </div>
          </div>

          {/* ── Drag divider ── */}
          <div
            onMouseDown={onDividerMouseDown}
            style={{ width: 4, flexShrink: 0, cursor: "col-resize", background: "transparent", transition: "background 0.15s", zIndex: 1 }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(59,130,246,0.35)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          />

          {/* ── Right: Answer + Typing Panel ── */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", scrollbarWidth: "thin", minHeight: 0 }}>
              {captureError ? (
                <div style={{ fontSize: 13, color: "#dc2626", fontFamily: "sans-serif" }}>⚠ {captureError}</div>
              ) : captureSolving ? (
                <ThinkingDots />
              ) : state.isAwaitingFirstChunk && !state.answer ? (
                // New follow-up question: show thinking (captureAnswer cleared by effect above)
                <ThinkingDots />
              ) : state.answer && state.answer !== lockedAnswer ? (
                // Fresh follow-up answer (different from what's being typed)
                <AnswerDisplay answer={state.answer} isStreaming={state.isStreaming} fontSize={fontSize} />
              ) : captureStreaming && !captureAnswer ? (
                <ThinkingDots />
              ) : captureAnswer ? (
                <AnswerDisplay answer={captureAnswer} isStreaming={captureStreaming} fontSize={fontSize} />
              ) : state.answer ? (
                <AnswerDisplay answer={state.answer} isStreaming={state.isStreaming} fontSize={fontSize} />
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: "#9ca3af", fontFamily: "sans-serif", lineHeight: 1.7 }}>
                  Press{" "}
                  <kbd style={{ background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 4, padding: "1px 6px", fontSize: 12, fontFamily: "monospace", color: "#374151" }}>Ctrl</kbd>
                  {" + "}
                  <kbd style={{ background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 4, padding: "1px 6px", fontSize: 12, fontFamily: "monospace", color: "#374151" }}>↵</kbd>
                  {" or click "}
                  <span style={{ color: "#6b7280", fontSize: 14 }}>✈</span>
                  {" anytime to generate response to the last question"}
                </p>
              )}
            </div>

            {/* Typing Playback Panel */}
            {(showTypingPanel || typingStatus !== "idle") && (
              <TypingPlaybackPanel
                answer={lockedAnswer || captureAnswer || state.answer}
                status={typingStatus}
                countdown={typingCountdown}
                displayed={typingDisplayed}
                progress={typingProgress}
                detectedCtx={typingDetectedCtx}
                inject={typingInject}
                onInjectChange={setTypingInject}
                codeOnly={typingCodeOnly}
                onCodeOnlyChange={setTypingCodeOnly}
                onStart={() => {
                  const ans = lockedAnswer || captureAnswer || state.answer;
                  setLockedAnswer(ans);
                  startTyping(ans, typingInject, typingCodeOnly);
                }}
                onPause={pauseTyping}
                onResume={resumeTyping}
                onCancel={() => { cancelTyping(); setLockedAnswer(""); }}
                onClose={() => { cancelTyping(); setLockedAnswer(""); setShowTypingPanel(false); }}
              />
            )}
          </div>
        </div>

        {/* ── Input bar ── */}
        <div style={{
          borderTop: "1px solid rgba(0,0,0,0.07)",
          display: "flex", alignItems: "center",
          padding: "10px 14px", gap: 10,
          background: "rgba(255,255,255,0.5)",
          flexShrink: 0,
        }}>
          {/* Camera / capture icon */}
          <button
            onClick={captureAndSolve}
            disabled={captureSolving}
            title="Capture screen and solve"
            style={{
              background: "none", border: "none", cursor: captureSolving ? "default" : "pointer",
              color: "#9ca3af", padding: "4px", borderRadius: 6,
              display: "flex", alignItems: "center", flexShrink: 0, transition: "color 0.15s",
            }}
            onMouseEnter={e => { if (!captureSolving) e.currentTarget.style.color = "#374151"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "#9ca3af"; }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="1.7"/>
            </svg>
          </button>

          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                input.trim() ? handleSend() : requestAnswer();
              }
            }}
            placeholder="Type your question and press Enter…"
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              fontSize: 13, color: "#1a1a1a", fontFamily: "sans-serif",
            }}
          />

          <button
            onClick={() => input.trim() ? handleSend() : requestAnswer()}
            style={{
              display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
              background: "rgba(255,255,255,0.95)", border: "1px solid rgba(0,0,0,0.12)",
              borderRadius: 9, padding: "7px 13px", cursor: "pointer",
              color: "#374151", fontSize: 12, fontWeight: 500,
              whiteSpace: "nowrap",
              boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
              transition: "background 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "#f9fafb")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.95)")}
          >
            Ctrl + ↵
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>

      <style>{`
        @keyframes blink    { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes bounce   { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
        @keyframes recPulse { 0%,100%{opacity:1} 50%{opacity:0.45} }
        @keyframes bar0 { 0%,100%{transform:scaleY(0.35)} 50%{transform:scaleY(1)} }
        @keyframes bar1 { 0%,100%{transform:scaleY(0.7)} 50%{transform:scaleY(0.25)} }
        @keyframes bar2 { 0%,100%{transform:scaleY(0.25)} 50%{transform:scaleY(0.85)} }
        ::-webkit-scrollbar       { width:4px; height:4px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:rgba(0,0,0,0.12); border-radius:2px; }
        input::placeholder { color:#9ca3af; }
      `}</style>
    </div>
  );
}

// ── Pill button (dark bar) ──────────────────────────────────────────────────────

function PillBtn({ children, onClick, title }: {
  children: React.ReactNode; onClick: () => void; title: string;
}) {
  return (
    <button
      onClick={onClick} title={title}
      style={{
        background: "none", border: "none", cursor: "pointer",
        color: "rgba(255,255,255,0.5)", padding: "5px 8px", borderRadius: 8,
        display: "flex", alignItems: "center", lineHeight: 1,
        transition: "color 0.15s, background 0.15s",
      }}
      onMouseEnter={e => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.background = "rgba(255,255,255,0.1)"; }}
      onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.5)"; e.currentTarget.style.background = "none"; }}
    >
      {children}
    </button>
  );
}

// ── Icon button (light panel) ───────────────────────────────────────────────────

function IconBtn({ children, onClick, title, disabled, active }: {
  children: React.ReactNode; onClick: () => void; title: string;
  disabled?: boolean; active?: boolean;
}) {
  return (
    <button
      onClick={onClick} title={title} disabled={disabled}
      style={{
        background: active ? "rgba(59,130,246,0.1)" : "none",
        border: "none", cursor: disabled ? "default" : "pointer",
        color: active ? "#3b82f6" : "#6b7280",
        padding: "5px 7px", borderRadius: 7, lineHeight: 1,
        display: "flex", alignItems: "center", gap: 3,
        transition: "color 0.15s, background 0.15s", fontSize: 11,
      }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.color = "#111"; e.currentTarget.style.background = "rgba(0,0,0,0.05)"; } }}
      onMouseLeave={e => { e.currentTarget.style.color = active ? "#3b82f6" : "#6b7280"; e.currentTarget.style.background = active ? "rgba(59,130,246,0.1)" : "none"; }}
    >
      {children}
    </button>
  );
}

// ── Typing Playback Panel (light theme) ────────────────────────────────────────

const STATUS_BADGE: Record<PlaybackStatus, { label: string; bg: string; color: string; border: string }> = {
  idle:      { label: "READY",     bg: "rgba(107,114,128,0.1)",  color: "#6b7280",  border: "rgba(107,114,128,0.25)" },
  countdown: { label: "COUNTDOWN", bg: "rgba(79,70,229,0.1)",    color: "#4f46e5",  border: "rgba(79,70,229,0.3)"    },
  reading:   { label: "SCANNING",  bg: "rgba(59,130,246,0.1)",   color: "#2563eb",  border: "rgba(59,130,246,0.3)"   },
  typing:    { label: "TYPING",    bg: "rgba(16,185,129,0.1)",   color: "#059669",  border: "rgba(16,185,129,0.3)"   },
  paused:    { label: "PAUSED",    bg: "rgba(245,158,11,0.1)",   color: "#d97706",  border: "rgba(245,158,11,0.3)"   },
  complete:  { label: "DONE",      bg: "rgba(16,185,129,0.1)",   color: "#059669",  border: "rgba(16,185,129,0.3)"   },
  failed:    { label: "FAILED",    bg: "rgba(239,68,68,0.1)",    color: "#dc2626",  border: "rgba(239,68,68,0.3)"    },
};

function actionBtn(accent: string): React.CSSProperties {
  return {
    padding: "4px 12px", fontSize: 12, fontWeight: 500, borderRadius: 7, cursor: "pointer",
    background: "#f9fafb", border: `1px solid ${accent}`, color: accent,
  };
}

interface PlaybackPanelProps {
  answer: string; status: PlaybackStatus; countdown: number; displayed: string;
  progress: number; detectedCtx: string; inject: boolean; codeOnly: boolean;
  onInjectChange: (v: boolean) => void; onCodeOnlyChange: (v: boolean) => void;
  onStart: () => void; onPause: () => void; onResume: () => void;
  onCancel: () => void; onClose: () => void;
}

function TypingPlaybackPanel({
  answer, status, countdown, displayed, progress, detectedCtx,
  inject, codeOnly, onInjectChange, onCodeOnlyChange,
  onStart, onPause, onResume, onCancel, onClose,
}: PlaybackPanelProps) {
  const previewRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = previewRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [displayed]);

  const isActive = status === "typing" || status === "paused";
  const isIdle   = status === "idle" || status === "complete" || status === "failed";
  const badge    = STATUS_BADGE[status];

  return (
    <div style={{
      borderTop: "1px solid rgba(0,0,0,0.07)",
      padding: "12px 16px",
      background: "rgba(249,250,251,0.9)",
      flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#374151", letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Typing Playback
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 5, fontFamily: "monospace", letterSpacing: "0.07em", background: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}>
            {badge.label}
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 12, padding: "2px 4px", borderRadius: 4 }}>✕</button>
        </div>
      </div>

      {/* Detected context */}
      {(detectedCtx || status === "reading") && (
        <div style={{ fontSize: 11, color: "#2563eb", marginBottom: 8, fontFamily: "monospace" }}>
          ⬡ {detectedCtx || "Scanning editor content…"}
        </div>
      )}

      {/* Settings */}
      {isIdle && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <button onClick={() => onCodeOnlyChange(!codeOnly)} style={{ padding: "3px 10px", fontSize: 11, fontWeight: 500, borderRadius: 6, cursor: "pointer", background: codeOnly ? "rgba(245,158,11,0.1)" : "#f3f4f6", border: `1px solid ${codeOnly ? "rgba(245,158,11,0.4)" : "#d1d5db"}`, color: codeOnly ? "#d97706" : "#6b7280" }}>
            {codeOnly ? "✓" : "○"} Code only
          </button>
          <button onClick={() => onInjectChange(!inject)} style={{ padding: "3px 10px", fontSize: 11, fontWeight: 500, borderRadius: 6, cursor: "pointer", background: inject ? "rgba(16,185,129,0.1)" : "#f3f4f6", border: `1px solid ${inject ? "rgba(16,185,129,0.35)" : "#d1d5db"}`, color: inject ? "#059669" : "#6b7280" }}>
            {inject ? "✓" : "○"} Inject to app
          </button>
        </div>
      )}

      {/* Countdown */}
      {status === "countdown" && (
        <div style={{ textAlign: "center", padding: "10px 0 8px" }}>
          <div style={{ fontSize: 52, fontWeight: 900, fontFamily: "monospace", lineHeight: 1, color: countdown <= 1 ? "#dc2626" : countdown === 2 ? "#d97706" : "#4f46e5" }}>
            {countdown}
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "#6b7280" }}>
            {inject ? "Switch focus to the target field now" : "Starting playback…"}
          </p>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 10 }}>
            <button onClick={onPause}  style={actionBtn("#d97706")}>⏸ Pause</button>
            <button onClick={onCancel} style={actionBtn("#9ca3af")}>✕ Cancel</button>
          </div>
        </div>
      )}

      {/* Progress + preview */}
      {isActive && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1, height: 3, background: "rgba(0,0,0,0.08)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ width: `${progress}%`, height: "100%", borderRadius: 2, background: status === "paused" ? "#d97706" : "#4f46e5", transition: "width 0.1s linear" }} />
            </div>
            <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "monospace", minWidth: 28, textAlign: "right" }}>{progress}%</span>
          </div>
          <pre ref={previewRef} style={{ margin: "0 0 10px", maxHeight: 100, overflowY: "auto", padding: "8px 10px", background: "#f8f9fb", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 8, fontSize: 11, color: "#1e1b4b", fontFamily: "ui-monospace,monospace", lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-all", scrollbarWidth: "thin" }}>
            {displayed}<span style={{ display: "inline-block", width: 1, height: "1em", background: status === "paused" ? "#d97706" : "#4f46e5", verticalAlign: "text-bottom", marginLeft: 1, animation: status === "typing" ? "blink 0.7s infinite" : "none" }} />
          </pre>
          <div style={{ display: "flex", gap: 6 }}>
            {status === "typing"
              ? <button onClick={onPause}  style={actionBtn("#d97706")}>⏸ Pause</button>
              : <button onClick={onResume} style={actionBtn("#4f46e5")}>▶ Resume</button>
            }
            <button onClick={onCancel} style={actionBtn("#9ca3af")}>✕ Cancel</button>
          </div>
        </>
      )}

      {/* Start button */}
      {status === "idle" && answer && (
        <button onClick={onStart} style={{ width: "100%", padding: "8px 0", borderRadius: 9, cursor: "pointer", background: "rgba(79,70,229,0.1)", border: "1px solid rgba(79,70,229,0.3)", color: "#4f46e5", fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "background 0.15s" }}
          onMouseEnter={e => (e.currentTarget.style.background = "rgba(79,70,229,0.18)")}
          onMouseLeave={e => (e.currentTarget.style.background = "rgba(79,70,229,0.1)")}
        >
          ▶ {inject ? "Start — focus target field within 3s" : "Start Playback"}
        </button>
      )}

      {/* Complete */}
      {status === "complete" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "#059669", fontWeight: 500 }}>✓ Typing complete</span>
          <button onClick={onStart} style={actionBtn("#4f46e5")}>↺ Replay</button>
        </div>
      )}

      {/* Failed */}
      {status === "failed" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "#dc2626" }}>✗ Failed{inject ? " — was the target field focused?" : ""}</span>
          <button onClick={onStart} style={actionBtn("#4f46e5")}>↺ Retry</button>
        </div>
      )}
    </div>
  );
}

// ── Thinking dots ───────────────────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {[0, 150, 300].map((d) => (
        <div key={d} style={{ width: 8, height: 8, borderRadius: "50%", background: "#3b82f6", animation: `bounce 0.9s ${d}ms infinite` }} />
      ))}
      <span style={{ fontSize: 13, color: "#6b7280", fontFamily: "sans-serif", marginLeft: 4 }}>Thinking…</span>
    </div>
  );
}
