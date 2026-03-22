import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export interface DebugPanelData {
  sttMode: string;
  sttProvider: string;
  sttStatus: string;
  lastPartial: string;
  lastFinal: string;
  questionConf: number | null;
  ragChunks: number | null;
  model: string;
  provider: string;
  tier: string;
  maxTokens: number | null;
  ttfb: number | null;
  totalLatency: number | null;
  sessionState: string;
  answerStyle: string;
  isStreaming: boolean;
  isDualStream: boolean;
}

interface Props {
  data: DebugPanelData;
  onClose: () => void;
}

function Row({ label, value, highlight }: { label: string; value: string | number | null | undefined; highlight?: boolean }) {
  const display = value === null || value === undefined ? "—" : String(value);
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span className="text-[10px] text-zinc-500 shrink-0 w-[120px] text-right">{label}</span>
      <span className={`text-[11px] font-mono truncate ${highlight ? "text-emerald-400" : "text-zinc-200"}`}>{display}</span>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-zinc-700/50 my-1" />;
}

export function DebugPanel({ data, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Drag support
  const drag = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const pos = useRef<{ x: number; y: number }>({ x: 16, y: 80 });

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    el.style.left = `${pos.current.x}px`;
    el.style.top = `${pos.current.y}px`;
  }, []);

  function onMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { startX: e.clientX, startY: e.clientY, origX: pos.current.x, origY: pos.current.y };
    e.preventDefault();
  }

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!drag.current || !panelRef.current) return;
      pos.current = {
        x: drag.current.origX + (e.clientX - drag.current.startX),
        y: drag.current.origY + (e.clientY - drag.current.startY),
      };
      panelRef.current.style.left = `${pos.current.x}px`;
      panelRef.current.style.top = `${pos.current.y}px`;
    }
    function onUp() { drag.current = null; }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const stateColor =
    data.sessionState === "answering" ? "text-blue-400" :
    data.sessionState === "cooldown" ? "text-amber-400" :
    data.sessionState === "partial_detected" ? "text-yellow-400" :
    "text-emerald-400";

  const confColor =
    data.questionConf === null ? "" :
    data.questionConf >= 0.8 ? "text-emerald-400" :
    data.questionConf >= 0.6 ? "text-yellow-400" :
    "text-red-400";

  return (
    <div
      ref={panelRef}
      className="fixed z-[9999] w-[280px] rounded-lg border border-zinc-700 bg-zinc-900/95 shadow-2xl backdrop-blur select-none"
      style={{ left: 16, top: 80 }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-700 cursor-grab active:cursor-grabbing"
        onMouseDown={onMouseDown}
      >
        <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">Debug Panel</span>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-0.5">

        {/* STT */}
        <Row label="STT mode" value={`${data.sttMode} / ${data.sttProvider}`} />
        <Row label="STT status" value={data.sttStatus} highlight={data.sttStatus === "connected"} />
        <Row label="Dual stream" value={data.isDualStream ? "ON (interviewer+mic)" : "off"} highlight={data.isDualStream} />

        <Divider />

        {/* Transcript */}
        <div className="flex items-start gap-2 min-w-0">
          <span className="text-[10px] text-zinc-500 shrink-0 w-[120px] text-right mt-0.5">last partial</span>
          <span className="text-[11px] font-mono text-zinc-400 leading-tight line-clamp-2 break-all">
            {data.lastPartial || "—"}
          </span>
        </div>
        <div className="flex items-start gap-2 min-w-0">
          <span className="text-[10px] text-zinc-500 shrink-0 w-[120px] text-right mt-0.5">last final</span>
          <span className="text-[11px] font-mono text-zinc-200 leading-tight line-clamp-2 break-all">
            {data.lastFinal || "—"}
          </span>
        </div>

        <Divider />

        {/* Detection */}
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-[10px] text-zinc-500 shrink-0 w-[120px] text-right">Q confidence</span>
          <span className={`text-[11px] font-mono ${confColor}`}>
            {data.questionConf !== null ? `${(data.questionConf * 100).toFixed(0)}%` : "—"}
          </span>
        </div>
        <Row label="RAG chunks" value={data.ragChunks ?? "—"} />

        <Divider />

        {/* Model */}
        <Row label="model" value={data.model || "—"} />
        <Row label="provider" value={data.provider || "—"} />
        <Row label="tier" value={data.tier || "—"} />
        <Row label="max tokens" value={data.maxTokens ?? "—"} />
        <Row label="answer style" value={data.answerStyle} />

        <Divider />

        {/* Latency */}
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-[10px] text-zinc-500 shrink-0 w-[120px] text-right">TTFB</span>
          <span className={`text-[11px] font-mono ${data.ttfb !== null && data.ttfb < 800 ? "text-emerald-400" : data.ttfb !== null && data.ttfb < 1500 ? "text-yellow-400" : "text-red-400"}`}>
            {data.ttfb !== null ? `${data.ttfb}ms` : "—"}
          </span>
        </div>
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-[10px] text-zinc-500 shrink-0 w-[120px] text-right">total latency</span>
          <span className={`text-[11px] font-mono ${data.totalLatency !== null && data.totalLatency < 2000 ? "text-emerald-400" : data.totalLatency !== null && data.totalLatency < 4000 ? "text-yellow-400" : "text-red-400"}`}>
            {data.totalLatency !== null ? `${data.totalLatency}ms` : "—"}
          </span>
        </div>

        <Divider />

        {/* Session state */}
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-[10px] text-zinc-500 shrink-0 w-[120px] text-right">session state</span>
          <span className={`text-[11px] font-mono font-semibold uppercase ${stateColor}`}>
            {data.sessionState}
          </span>
        </div>
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-[10px] text-zinc-500 shrink-0 w-[120px] text-right">streaming</span>
          <span className={`text-[11px] font-mono ${data.isStreaming ? "text-blue-400" : "text-zinc-500"}`}>
            {data.isStreaming ? "YES" : "no"}
          </span>
        </div>
      </div>

      <div className="px-3 pb-2 pt-0">
        <p className="text-[9px] text-zinc-600">Ctrl+Shift+D to toggle</p>
      </div>
    </div>
  );
}
