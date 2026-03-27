import { useEffect, useState } from "react";
import type { AnswerStyle } from "@shared/schema";

const STYLE_LABELS: Record<string, string> = {
  concise: "Concise", star: "STAR", bullet: "Bullet",
  talking_points: "Points", direct_followup: "Direct+",
  standard: "Standard", brief: "Brief", deep: "Deep",
};

interface OverlayState {
  question: string;
  answer: string;
  isStreaming: boolean;
  isAwaitingFirstChunk: boolean;
  isPaused: boolean;
  answerStyle: AnswerStyle;
  statusLabel: string;
}

function renderLine(line: string, key: number) {
  const parts = line.split(/\*\*(.+?)\*\*/g);
  const rendered = parts.map((p, i) =>
    i % 2 === 1 ? <strong key={i}>{p}</strong> : p,
  );
  return <p key={key} style={{ margin: "0 0 4px", lineHeight: 1.5 }}>{rendered}</p>;
}

function MiniAnswer({ text }: { text: string }) {
  const lines = text.split("\n").map(l => l.trimEnd()).filter(Boolean);
  return (
    <div>
      {lines.map((line, i) => {
        if (/^#{1,3}\s/.test(line)) {
          return <p key={i} style={{ fontWeight: 600, color: "rgba(255,255,255,0.9)", margin: "6px 0 2px", lineHeight: 1.4 }}>{line.replace(/^#+\s/, "")}</p>;
        }
        if (/^[-*]\s/.test(line)) {
          return <p key={i} style={{ margin: "0 0 3px", paddingLeft: 12, position: "relative", lineHeight: 1.5 }}>· {line.replace(/^[-*]\s/, "")}</p>;
        }
        if (/^\d+[.)]\s/.test(line)) {
          const num = line.match(/^(\d+)/)?.[1];
          return <p key={i} style={{ margin: "0 0 3px", paddingLeft: 18, position: "relative", lineHeight: 1.5 }}><span style={{ position: "absolute", left: 0, color: "rgba(255,255,255,0.4)", fontSize: 11 }}>{num}.</span>{line.replace(/^\d+[.)]\s/, "")}</p>;
        }
        // code block lines
        if (line.startsWith("```")) return null;
        return renderLine(line, i);
      })}
    </div>
  );
}

export default function OverlayPopup() {
  const [state, setState] = useState<OverlayState>({
    question: "",
    answer: "",
    isStreaming: false,
    isAwaitingFirstChunk: false,
    isPaused: false,
    answerStyle: "standard",
    statusLabel: "READY",
  });

  useEffect(() => {
    // Set dark background on the popup window itself
    document.body.style.margin = "0";
    document.body.style.background = "rgba(10,10,15,0.97)";
    document.body.style.fontFamily = "ui-sans-serif, system-ui, sans-serif";
    document.title = "Zoommate Overlay";

    const ch = new BroadcastChannel("acemate-overlay");
    ch.onmessage = (e) => {
      if (e.data && typeof e.data === "object" && !e.data.type) {
        setState(prev => ({ ...prev, ...e.data }));
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
      if (e.key === "Enter") {
        e.preventDefault();
        ch.postMessage({ type: "command", action: "enter" });
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      ch.close();
    };
  }, []);

  const statusColor = state.isPaused
    ? "#f59e0b"
    : state.isStreaming || state.isAwaitingFirstChunk
    ? "#3b82f6"
    : "#10b981";

  return (
    <div style={{ minHeight: "100vh", color: "rgba(255,255,255,0.88)", fontSize: 13, lineHeight: 1.55 }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "6px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.03)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor }} />
          <span style={{ fontSize: 10, fontFamily: "monospace", letterSpacing: "0.1em", color: "rgba(255,255,255,0.35)" }}>
            {state.statusLabel}
          </span>
          <span style={{
            fontSize: 9, padding: "2px 6px", borderRadius: 99, fontFamily: "monospace",
            background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.45)",
          }}>
            {STYLE_LABELS[state.answerStyle] || state.answerStyle}
          </span>
        </div>
      </div>

      {/* Question */}
      {state.question && (
        <div style={{ padding: "10px 16px 6px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.4 }}>
            {state.question}
          </p>
        </div>
      )}

      {/* Answer */}
      <div style={{ padding: "12px 16px", maxHeight: 380, overflowY: "auto" }}>
        {state.isAwaitingFirstChunk && !state.answer ? (
          <p style={{ color: "rgba(255,255,255,0.25)", fontSize: 12, margin: 0 }}>Generating answer…</p>
        ) : state.answer ? (
          <MiniAnswer text={state.answer} />
        ) : (
          <p style={{ color: "rgba(255,255,255,0.18)", fontSize: 12, margin: 0 }}>
            {state.isPaused ? "Detection paused." : "Waiting for speaker question…"}
          </p>
        )}
      </div>

      {/* Footer shortcuts */}
      <div style={{
        padding: "6px 12px", borderTop: "1px solid rgba(255,255,255,0.06)",
        display: "flex", gap: 8, flexWrap: "wrap",
        fontSize: 10, color: "rgba(255,255,255,0.25)", fontFamily: "monospace",
      }}>
        {[["Enter", "answer"], ["P", "pause"], ["R", "retry"], ["C", "concise"], ["B", "behavioral"], ["T", "technical"], ["H", "dim"]].map(([k, label]) => (
          <span key={k}><span style={{ color: "rgba(255,255,255,0.5)" }}>{k}</span> {label}</span>
        ))}
      </div>
    </div>
  );
}
