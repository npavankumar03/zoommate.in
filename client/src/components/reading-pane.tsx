import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import type { AnswerStyle } from "@shared/schema";

// Opacity levels cycled by pressing H
const OPACITY_LEVELS = [0.97, 0.65, 0.28] as const;
type OpacityIdx = 0 | 1 | 2;

interface Props {
  question: string;
  answer: string;
  isStreaming: boolean;
  isAwaitingFirstChunk: boolean;
  isPaused: boolean;
  answerStyle: AnswerStyle;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  onSetStyle: (style: AnswerStyle) => void;
  onClose: () => void;
  onPopOut?: () => void;
}

// Minimal inline markdown: bold (**text**), bullet lines, numbered lines
function renderLine(line: string, key: number) {
  // Bold
  const parts = line.split(/\*\*(.+?)\*\*/g);
  const rendered = parts.map((p, i) =>
    i % 2 === 1 ? <strong key={i}>{p}</strong> : p,
  );
  return (
    <p key={key} className="leading-snug mb-1 last:mb-0">
      {rendered}
    </p>
  );
}

function MiniAnswer({ text }: { text: string }) {
  const lines = text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter(Boolean);
  return (
    <div className="space-y-0">
      {lines.map((line, i) => {
        if (/^#{1,3}\s/.test(line)) {
          return (
            <p key={i} className="font-semibold text-white/90 mt-1 mb-0.5 leading-snug">
              {line.replace(/^#+\s/, "")}
            </p>
          );
        }
        if (/^[-*]\s/.test(line)) {
          return (
            <p key={i} className="leading-snug mb-0.5 pl-3 relative before:content-['·'] before:absolute before:left-0.5 before:text-white/40">
              {line.replace(/^[-*]\s/, "")}
            </p>
          );
        }
        if (/^\d+[.)]\s/.test(line)) {
          const num = line.match(/^(\d+)/)?.[1];
          return (
            <p key={i} className="leading-snug mb-0.5 pl-5 relative">
              <span className="absolute left-0 text-white/40 text-[11px]">{num}.</span>
              {line.replace(/^\d+[.)]\s/, "")}
            </p>
          );
        }
        if (/^\*\*(.+?)\*\*:?$/.test(line.trim())) {
          return (
            <p key={i} className="font-semibold text-white/80 mt-1.5 mb-0.5 leading-snug text-[11px] uppercase tracking-wide">
              {line.replace(/\*\*/g, "")}
            </p>
          );
        }
        return renderLine(line, i);
      })}
    </div>
  );
}

const STYLE_LABELS: Record<AnswerStyle, string> = {
  concise: "Concise",
  star: "STAR",
  bullet: "Bullet",
  talking_points: "Points",
  direct_followup: "Direct+",
  standard: "Standard",
  brief: "Brief",
  deep: "Deep",
};

export function ReadingPane({
  question,
  answer,
  isStreaming,
  isAwaitingFirstChunk,
  isPaused,
  answerStyle,
  onPause,
  onResume,
  onRetry,
  onSetStyle,
  onClose,
  onPopOut,
}: Props) {
  const [opacityIdx, setOpacityIdx] = useState<OpacityIdx>(0);
  const opacity = OPACITY_LEVELS[opacityIdx];
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const pos = useRef({ x: typeof window !== "undefined" ? window.innerWidth - 460 : 800, y: 40 });
  const isBehavioral = answerStyle === "star";
  const isConcise = answerStyle === "concise";

  // Position on mount
  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.style.left = `${pos.current.x}px`;
      panelRef.current.style.top = `${pos.current.y}px`;
    }
  }, []);

  // Drag
  function onMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("button,select")) return;
    drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.current.x, oy: pos.current.y };
    e.preventDefault();
  }
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drag.current || !panelRef.current) return;
      pos.current = { x: drag.current.ox + (e.clientX - drag.current.sx), y: drag.current.oy + (e.clientY - drag.current.sy) };
      panelRef.current.style.left = `${pos.current.x}px`;
      panelRef.current.style.top = `${pos.current.y}px`;
    };
    const onUp = () => { drag.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  // Hotkeys owned by this component
  const handleKey = useCallback((e: KeyboardEvent) => {
    // Skip if user is typing in an input/textarea
    if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.key.toLowerCase()) {
      case "h":
        e.preventDefault();
        setOpacityIdx((i) => ((i + 1) % 3) as OpacityIdx);
        break;
      case "p":
        e.preventDefault();
        isPaused ? onResume() : onPause();
        break;
      case "r":
        e.preventDefault();
        onRetry();
        break;
      case "c":
        e.preventDefault();
        onSetStyle(isConcise ? "standard" : "concise");
        break;
      case "b":
        e.preventDefault();
        onSetStyle("star");
        break;
      case "t":
        e.preventDefault();
        onSetStyle("bullet");
        break;
      case "escape":
        e.preventDefault();
        onClose();
        break;
    }
  }, [isPaused, isConcise, onPause, onResume, onRetry, onSetStyle, onClose]);

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  const statusColor = isPaused
    ? "bg-amber-500"
    : isStreaming || isAwaitingFirstChunk
    ? "bg-blue-500 animate-pulse"
    : "bg-emerald-500";

  const statusLabel = isPaused
    ? "PAUSED"
    : isAwaitingFirstChunk
    ? "THINKING"
    : isStreaming
    ? "ANSWERING"
    : "READY";

  const dimText = opacityIdx === 2;

  return (
    <div
      ref={panelRef}
      className="fixed z-[9998] w-[420px] rounded-xl shadow-2xl select-none"
      style={{
        left: pos.current.x,
        top: pos.current.y,
        opacity,
        backgroundColor: "rgba(10,10,15,0.93)",
        border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(12px)",
        transition: "opacity 0.2s ease",
      }}
    >
      {/* Header bar — drag target + status */}
      <div
        className="flex items-center justify-between px-3 py-1.5 cursor-grab active:cursor-grabbing rounded-t-xl"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        onMouseDown={onMouseDown}
      >
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
          <span className="text-[10px] font-mono tracking-widest" style={{ color: "rgba(255,255,255,0.35)" }}>
            {statusLabel}
          </span>
          <span
            className="text-[9px] px-1.5 py-0.5 rounded-full font-mono tracking-wide"
            style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.45)" }}
          >
            {STYLE_LABELS[answerStyle] || answerStyle}
          </span>
        </div>
        {onPopOut && (
          <button
            onClick={onPopOut}
            title="Pop out to separate window"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "rgba(255,255,255,0.35)",
              fontSize: "12px",
              padding: "2px 4px",
              lineHeight: 1,
            }}
          >
            ⤢
          </button>
        )}
      </div>

      {/* Question */}
      {question && (
        <div
          className="px-4 pt-3 pb-1.5"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
        >
          <p
            className="text-[12px] leading-snug"
            style={{ color: dimText ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.45)" }}
          >
            {question}
          </p>
        </div>
      )}

      {/* Answer */}
      <div
        className="px-4 py-3 overflow-y-auto"
        style={{
          maxHeight: 340,
          minHeight: 60,
          fontSize: "13px",
          lineHeight: "1.55",
          color: dimText ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.88)",
        }}
      >
        {isAwaitingFirstChunk && !answer ? (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "rgba(255,255,255,0.3)" }} />
            <span style={{ color: "rgba(255,255,255,0.25)", fontSize: "12px" }}>Generating answer…</span>
          </div>
        ) : answer ? (
          <>
            <MiniAnswer text={answer} />
            {isStreaming && (
              <span
                className="inline-block w-0.5 h-3.5 ml-0.5 align-middle animate-pulse"
                style={{ background: "rgba(255,255,255,0.5)" }}
              />
            )}
          </>
        ) : (
          <p style={{ color: "rgba(255,255,255,0.18)", fontSize: "12px" }}>
            {isPaused ? "Detection paused — press Space to resume." : "Waiting for speaker question…"}
          </p>
        )}
      </div>

      {/* Hotkey bar */}
      <div
        className="px-4 py-1.5 flex items-center gap-3 rounded-b-xl"
        style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
      >
        {(
          [
            ["P", isPaused ? "resume" : "pause"],
            ["R", "retry"],
            ["C", "concise"],
            ["B", "behavioral"],
            ["T", "technical"],
            ["H", "dim"],
            ["Esc", "close"],
          ] as [string, string][]
        ).map(([key, label]) => (
          <span key={key} className="flex items-center gap-0.5">
            <kbd
              className="text-[8px] px-1 py-0.5 rounded font-mono"
              style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}
            >
              {key}
            </kbd>
            <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.22)" }}>{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
