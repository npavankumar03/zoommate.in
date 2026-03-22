import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useCallback, useEffect } from "react";
import { useZoommateSocket } from "../hooks/useZoommateSocket";
import { bridge } from "../lib/bridge";
import { Window } from "@tauri-apps/api/window";
// ── Answer renderer ────────────────────────────────────────────────────────────
function AnswerDisplay({ answer, isStreaming }) {
    if (!answer.includes("```")) {
        return (_jsxs("p", { style: { margin: 0, fontSize: 13, color: "rgba(255,255,255,0.9)", lineHeight: 1.65, fontFamily: "sans-serif", whiteSpace: "pre-wrap" }, children: [answer, isStreaming && _jsx(Cursor, {})] }));
    }
    const segments = [];
    const regex = /```(\w*)\n?([\s\S]*?)```/g;
    let last = 0, m;
    while ((m = regex.exec(answer)) !== null) {
        if (m.index > last) {
            const prose = answer.slice(last, m.index).trim();
            if (prose)
                segments.push({ type: "prose", lang: "", text: prose });
        }
        segments.push({ type: "code", lang: m[1] || "code", text: m[2] });
        last = m.index + m[0].length;
    }
    if (last < answer.length) {
        const trail = answer.slice(last).trim();
        if (trail)
            segments.push({ type: "prose", lang: "", text: trail });
    }
    return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 10 }, children: [segments.map((seg, i) => seg.type === "prose" ? (_jsx("p", { style: { margin: 0, fontSize: 13, color: "rgba(255,255,255,0.88)", lineHeight: 1.65, fontFamily: "sans-serif", whiteSpace: "pre-wrap" }, children: seg.text }, i)) : (_jsxs("div", { style: { borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }, children: [seg.lang && (_jsx("div", { style: { padding: "3px 10px", background: "rgba(99,102,241,0.2)", fontSize: 10, color: "#a5b4fc", fontFamily: "monospace", letterSpacing: "0.05em" }, children: seg.lang })), _jsx("pre", { style: { margin: 0, padding: "10px 12px", background: "rgba(0,0,0,0.5)", fontSize: 12, color: "#e2e8f0", fontFamily: "ui-monospace,monospace", lineHeight: 1.6, overflowX: "auto", whiteSpace: "pre" }, children: seg.text })] }, i))), isStreaming && _jsx(Cursor, {})] }));
}
const Cursor = () => (_jsx("span", { style: { display: "inline-block", width: 2, height: 14, marginLeft: 2, background: "rgba(255,255,255,0.6)", animation: "pulse 1s infinite" } }));
// ── Privacy blur overlay ───────────────────────────────────────────────────────
function BlurOverlay({ label, onReveal }) {
    return (_jsxs("div", { style: { position: "relative", borderRadius: 10, overflow: "hidden", minHeight: 56, display: "flex", alignItems: "center", justifyContent: "center" }, children: [_jsx("div", { style: { position: "absolute", inset: 0, backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", background: "rgba(10,10,20,0.55)" } }), _jsxs("button", { onClick: onReveal, style: {
                    position: "relative", zIndex: 1,
                    background: "rgba(99,102,241,0.75)", border: "none", borderRadius: 8,
                    padding: "6px 14px", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer",
                }, children: ["\uD83D\uDC41 Click to reveal ", label] })] }));
}
export function OverlayWindow({ meetingId, onOpenSettings }) {
    const { state, requestAnswer, sendFollowUp, cancelStream, togglePause, retry } = useZoommateSocket(meetingId);
    const [mode, setMode] = useState("full");
    const [input, setInput] = useState("");
    const [privacyBlur, setPrivacyBlur] = useState(false);
    const [transcriptRevealed, setTranscriptRevealed] = useState(false);
    const [answerRevealed, setAnswerRevealed] = useState(false);
    const [clickThrough, setClickThrough] = useState(false);
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
        let timer = null;
        const saveBounds = async () => {
            if (timer)
                clearTimeout(timer);
            timer = setTimeout(async () => {
                try {
                    const pos = await win.outerPosition();
                    const size = await win.outerSize();
                    await bridge.saveWindowBounds(pos.x, pos.y, size.width, size.height);
                }
                catch { }
            }, 500);
        };
        win.onMoved(saveBounds);
        win.onResized(saveBounds);
        return () => { if (timer)
            clearTimeout(timer); };
    }, []);
    // Keyboard shortcuts (only when not in input)
    useEffect(() => {
        const handler = (e) => {
            if (e.target.tagName === "INPUT")
                return;
            if (e.key === "Enter") {
                e.preventDefault();
                requestAnswer();
            }
            if (e.key.toLowerCase() === "p") {
                e.preventDefault();
                togglePause();
            }
            if (e.key.toLowerCase() === "r") {
                e.preventDefault();
                retry();
            }
            if (e.key === "Escape") {
                setMode((m) => m === "full" ? "mini" : "full");
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [requestAnswer, togglePause, retry]);
    // Drag: use Tauri window drag API
    const startDrag = useCallback((e) => {
        if (e.target.closest("button,input,select,textarea"))
            return;
        e.preventDefault();
        Window.getCurrent().startDragging().catch(() => { });
    }, []);
    const handleClickThrough = async (v) => {
        setClickThrough(v);
        await bridge.setIgnoreCursor(v).catch(() => { });
    };
    const handleSend = () => {
        if (!input.trim())
            return;
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
        return (_jsx("div", { onClick: () => setMode("full"), onMouseDown: startDrag, style: {
                position: "fixed", bottom: 24, right: 24,
                width: 44, height: 44, borderRadius: "50%",
                background: "rgba(99,102,241,0.85)",
                backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                border: "1px solid rgba(255,255,255,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", zIndex: 9999,
                boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
            }, title: "Show Zoommate", children: _jsx("span", { style: { fontSize: 20 }, children: "\u26A1" }) }));
    }
    // ── Mini chip ─────────────────────────────────────────────────────────────
    if (mode === "mini") {
        return (_jsxs("div", { onMouseDown: startDrag, style: {
                position: "fixed", top: 20, right: 20,
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "6px 12px", borderRadius: 99,
                background: "rgba(10,10,20,0.85)",
                border: "1px solid rgba(255,255,255,0.1)",
                backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
                cursor: "grab", zIndex: 9999,
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            }, children: [_jsx("div", { style: { width: 7, height: 7, borderRadius: "50%", background: statusColor } }), _jsx("span", { style: { fontSize: 11, fontFamily: "monospace", color: "rgba(255,255,255,0.6)", letterSpacing: "0.06em" }, children: state.statusLabel }), state.answer && (_jsx("span", { style: { fontSize: 11, color: "rgba(255,255,255,0.35)", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: state.answer.slice(0, 60) })), _jsx("button", { onClick: () => setMode("full"), style: { background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.4)", fontSize: 13, padding: "0 2px" }, children: "\u25B2" })] }));
    }
    // ── Full overlay ──────────────────────────────────────────────────────────
    return (_jsxs("div", { style: { position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9999 }, children: [_jsxs("div", { style: {
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
                }, children: [_jsxs("div", { onMouseDown: startDrag, style: {
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "8px 12px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            cursor: "grab",
                        }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 7 }, children: [_jsxs("div", { style: { display: "flex", gap: 4, alignItems: "center" }, children: [_jsx("div", { style: { width: 6, height: 6, borderRadius: "50%", background: connDot }, title: state.connected ? "Connected" : "Reconnecting…" }), _jsx("div", { style: { width: 6, height: 6, borderRadius: "50%", background: statusColor } })] }), _jsx("span", { style: { fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em" }, children: state.statusLabel }), _jsx("span", { style: { fontSize: 9, padding: "1px 6px", borderRadius: 99, background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }, children: "Zoommate" })] }), _jsxs("div", { style: { display: "flex", gap: 1, alignItems: "center" }, children: [_jsx(Btn, { title: privacyBlur ? "Disable blur" : "Enable blur", onClick: () => setPrivacyBlur((v) => !v), active: privacyBlur, children: privacyBlur ? "🙈" : "👁" }), _jsx(Btn, { title: clickThrough ? "Disable click-through" : "Enable click-through", onClick: () => handleClickThrough(!clickThrough), active: clickThrough, children: clickThrough ? "🖱️" : "🖱" }), _jsx(Btn, { title: "Settings", onClick: onOpenSettings, children: "\u2699" }), _jsx(Btn, { title: "Minimise", onClick: () => setMode("mini"), children: "\u2014" }), _jsx(Btn, { title: "Hide", onClick: () => setMode("hidden"), children: "\u00D7" })] })] }), (state.transcript || state.finalTranscript) && (_jsx("div", { style: { padding: "8px 14px 4px", borderBottom: "1px solid rgba(255,255,255,0.04)" }, children: privacyBlur && !transcriptRevealed ? (_jsx(BlurOverlay, { label: "transcript", onReveal: () => setTranscriptRevealed(true) })) : (_jsx("p", { style: { margin: 0, fontSize: 11, color: "rgba(255,255,255,0.28)", lineHeight: 1.4, fontFamily: "sans-serif" }, children: state.transcript || state.finalTranscript })) })), state.question && (_jsx("div", { style: { padding: "8px 14px 4px", borderBottom: "1px solid rgba(255,255,255,0.04)" }, children: _jsxs("p", { style: { margin: 0, fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.4, fontFamily: "sans-serif", fontStyle: "italic" }, children: ["Q: ", state.question] }) })), _jsxs("div", { style: { padding: "12px 14px", maxHeight: 320, overflowY: "auto", minHeight: 64, scrollbarWidth: "thin" }, children: [privacyBlur && !answerRevealed ? ((state.answer || state.isAwaitingFirstChunk) ? (_jsx(BlurOverlay, { label: "answer", onReveal: () => setAnswerRevealed(true) })) : (_jsx(Empty, { paused: state.isPaused }))) : state.isAwaitingFirstChunk && !state.answer ? (_jsx(ThinkingDots, {})) : state.answer ? (_jsx(AnswerDisplay, { answer: state.answer, isStreaming: state.isStreaming })) : (_jsx(Empty, { paused: state.isPaused })), state.sttError && (_jsxs("p", { style: { margin: "8px 0 0", fontSize: 11, color: "#f59e0b", background: "rgba(245,158,11,0.08)", borderRadius: 6, padding: "4px 8px" }, children: ["\u26A0 ", state.sttError] }))] }), _jsxs("div", { style: { display: "flex", gap: 6, padding: "8px 12px", borderTop: "1px solid rgba(255,255,255,0.05)" }, children: [_jsx("button", { onClick: requestAnswer, style: {
                                    flex: 1, padding: "8px 0", borderRadius: 12, border: "none",
                                    background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
                                    color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
                                    transition: "opacity 0.15s",
                                }, onMouseEnter: (e) => (e.currentTarget.style.opacity = "0.8"), onMouseLeave: (e) => (e.currentTarget.style.opacity = "1"), children: "\u26A1 Answer" }), state.isStreaming ? (_jsx(SmallBtn, { onClick: cancelStream, title: "Cancel stream", children: "\u2715" })) : (_jsx(SmallBtn, { onClick: togglePause, title: state.isPaused ? "Resume" : "Pause", children: state.isPaused ? "▶" : "⏸" })), _jsx(SmallBtn, { onClick: retry, title: "Retry", children: "\u21BA" })] }), _jsxs("div", { style: {
                            display: "flex", alignItems: "center", gap: 8,
                            padding: "6px 12px 10px",
                            borderTop: "1px solid rgba(255,255,255,0.04)",
                        }, children: [_jsx("input", { value: input, onChange: (e) => setInput(e.target.value), onKeyDown: (e) => { if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                } }, placeholder: "Ask a follow-up question\u2026", style: {
                                    flex: 1, background: "transparent", border: "none", outline: "none",
                                    fontSize: 12, color: "rgba(255,255,255,0.75)", fontFamily: "sans-serif",
                                } }), _jsx("button", { onClick: handleSend, disabled: !input.trim(), style: {
                                    background: input.trim() ? "rgba(99,102,241,0.65)" : "rgba(255,255,255,0.05)",
                                    border: "none", borderRadius: 8, padding: "5px 9px",
                                    cursor: "pointer", color: "rgba(255,255,255,0.8)", fontSize: 14,
                                    opacity: input.trim() ? 1 : 0.35, transition: "opacity 0.15s",
                                }, children: "\u27A4" })] }), _jsx("div", { style: {
                            display: "flex", gap: 14, padding: "0 12px 8px",
                            fontSize: 10, color: "rgba(255,255,255,0.18)", fontFamily: "monospace",
                        }, children: [["Enter", "answer"], ["P", "pause"], ["R", "retry"], ["Esc", "mini"]].map(([k, l]) => (_jsxs("span", { children: [_jsx("span", { style: { color: "rgba(255,255,255,0.35)" }, children: k }), " ", l] }, k))) })] }), _jsx("style", { children: `
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
        @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:0.25} }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }
      ` })] }));
}
// ── Tiny sub-components ────────────────────────────────────────────────────────
function Btn({ children, title, onClick, active }) {
    return (_jsx("button", { onClick: onClick, title: title, style: {
            background: active ? "rgba(99,102,241,0.2)" : "none",
            border: "none", cursor: "pointer",
            color: active ? "rgba(165,180,252,0.9)" : "rgba(255,255,255,0.3)",
            fontSize: 13, padding: "2px 6px", borderRadius: 6, transition: "color 0.15s",
        }, onMouseEnter: (e) => (e.currentTarget.style.color = "rgba(255,255,255,0.85)"), onMouseLeave: (e) => (e.currentTarget.style.color = active ? "rgba(165,180,252,0.9)" : "rgba(255,255,255,0.3)"), children: children }));
}
function SmallBtn({ children, onClick, title }) {
    return (_jsx("button", { onClick: onClick, title: title, style: {
            padding: "8px 12px", borderRadius: 12,
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.55)", fontSize: 13, cursor: "pointer",
            transition: "background 0.15s",
        }, onMouseEnter: (e) => (e.currentTarget.style.background = "rgba(255,255,255,0.12)"), onMouseLeave: (e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)"), children: children }));
}
function ThinkingDots() {
    return (_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [[0, 120, 240].map((d) => (_jsx("div", { style: { width: 7, height: 7, borderRadius: "50%", background: "#6366f1", animation: `bounce 0.8s ${d}ms infinite` } }, d))), _jsx("span", { style: { fontSize: 11, color: "rgba(255,255,255,0.2)", fontFamily: "sans-serif" }, children: "Thinking\u2026" })] }));
}
function Empty({ paused }) {
    return (_jsx("p", { style: { margin: 0, fontSize: 12, color: "rgba(255,255,255,0.18)", fontFamily: "sans-serif" }, children: paused ? "Listening paused. Press P to resume." : "Listening… Press Enter to get an answer." }));
}
