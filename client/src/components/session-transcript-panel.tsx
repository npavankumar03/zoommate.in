import { memo, type RefObject } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Eye,
  Loader2,
  MessageSquare,
  Mic,
  Send,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  detectQuestion,
  detectQuestionAdvanced,
  normalizeForDedup,
} from "@shared/questionDetection";

type SessionTranscriptPanelProps = {
  timerLabel: string;
  timerWarning: boolean;
  isListening: boolean;
  micGranted: boolean;
  sttStatus: "idle" | "connecting" | "connected" | "error";
  sttError: string;
  displayTranscriptSegments: string[];
  displayTranscriptSegmentKeys: string[];
  interimText: string;
  stagedTranscriptText: string;
  pendingTranscriptLine: string;
  showUpgradeBanner: boolean;
  freeResetText: string;
  lastSessionUsageMinutes: number | null;
  onUpgrade: () => void;
  onDismissUpgradeBanner: () => void;
  audioMode: "mic" | "system";
  onRequestMicPermission: () => void;
  onSendTranscript: () => void;
  onCopilotAsk: () => void;
  isStreaming: boolean;
  scrollRef: RefObject<HTMLDivElement>;
};

function SessionTranscriptPanelComponent({
  timerLabel,
  timerWarning,
  isListening,
  micGranted,
  sttStatus,
  sttError,
  displayTranscriptSegments,
  displayTranscriptSegmentKeys,
  interimText,
  stagedTranscriptText,
  pendingTranscriptLine,
  showUpgradeBanner,
  freeResetText,
  lastSessionUsageMinutes,
  onUpgrade,
  onDismissUpgradeBanner,
  audioMode,
  onRequestMicPermission,
  onSendTranscript,
  onCopilotAsk,
  isStreaming,
  scrollRef,
}: SessionTranscriptPanelProps) {
  const activeLiveText = [interimText || stagedTranscriptText]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const latestSegment = displayTranscriptSegments[0];
  const isStaleEcho = !!activeLiveText
    && !!latestSegment
    && normalizeForDedup(latestSegment) === normalizeForDedup(activeLiveText);
  const liveText = isStaleEcho ? "" : activeLiveText;
  const rows = liveText
    ? [liveText, ...displayTranscriptSegments.filter((segment) => normalizeForDedup(segment) !== normalizeForDedup(liveText))]
    : displayTranscriptSegments;
  const hasTranscriptContent = displayTranscriptSegments.length > 0 || interimText || stagedTranscriptText || pendingTranscriptLine;

  return (
    <div
      className="lg:w-[360px] xl:w-[400px] lg:min-w-[280px] lg:max-w-[640px] shrink-0 border-b lg:border-b-0 lg:border-r flex flex-col lg:resize-x lg:overflow-auto"
      style={{ minHeight: 0 }}
    >
      <div className="px-3 py-2 border-b shrink-0 flex items-center justify-between">
        <h3 className="text-xs font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wider">
          <Eye className="w-3 h-3" />
          Live Transcript
          {isListening && (
            <span
              className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${timerWarning ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}
            >
              {timerLabel}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-1.5">
          {isListening && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
              Listening
            </Badge>
          )}
          {displayTranscriptSegments.length > 0 && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
              {displayTranscriptSegments.length}
            </Badge>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2" ref={scrollRef} style={{ minHeight: 0 }}>
        {showUpgradeBanner && (
          <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-center space-y-2">
            <p className="text-xs font-semibold text-destructive">Free trial ended</p>
            <p className="text-xs text-muted-foreground">
              Your 6-minute free session is over.
              {freeResetText && <> Free trial resets in {freeResetText}.</>}
            </p>
            {lastSessionUsageMinutes !== null && (
              <p className="text-[11px] font-medium text-foreground/80">
                You used {lastSessionUsageMinutes} minute{lastSessionUsageMinutes === 1 ? "" : "s"} in the last session.
              </p>
            )}
            <Button size="sm" className="w-full" onClick={onUpgrade}>
              Upgrade for full access
            </Button>
            <Button size="sm" variant="ghost" className="w-full text-xs" onClick={onDismissUpgradeBanner}>
              Dismiss
            </Button>
          </div>
        )}

        {audioMode === "mic" && (
          <div className="mb-3 rounded-lg border bg-card p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium">Microphone Access</p>
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                {micGranted ? sttStatus : "required"}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {!micGranted
                ? "Allow microphone so Zoommate can capture your interview audio."
                : sttError
                  ? sttError
                  : "If the transcript stays empty, re-check microphone access and start listening again."}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs h-8"
              onClick={onRequestMicPermission}
              data-testid="button-grant-mic-inline"
            >
              <Mic className="w-3.5 h-3.5 mr-1.5" />
              {micGranted ? "Re-check Microphone Access" : "Grant Microphone Access"}
            </Button>
          </div>
        )}

        {hasTranscriptContent ? (
          <div className="space-y-1">
            {rows.map((segment, index) => {
              const advanced = detectQuestionAdvanced(segment);
              const isQuestion = detectQuestion(segment) || (advanced.isQuestion && advanced.confidence >= 0.5);
              return (
                <div
                  key={index === 0 && liveText ? "live-current" : (displayTranscriptSegmentKeys[liveText ? index - 1 : index] || `${segment}-${index}`)}
                  className={`text-sm leading-relaxed rounded px-2 py-1 ${isQuestion ? "text-foreground font-medium bg-primary/8 border-l-2 border-primary" : "text-foreground/80"}`}
                  data-testid={index === 0 && liveText ? "text-segment-live" : `text-segment-${index}`}
                >
                  {isQuestion && <MessageSquare className="w-3 h-3 text-primary inline mr-1.5 align-text-bottom" />}
                  {segment}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="relative mb-3">
              <Mic className="w-6 h-6 text-muted-foreground/20" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-8 h-8 rounded-full border border-primary/20 animate-ping" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {audioMode === "system" ? "Capturing system audio..." : "Listening for speech..."}
            </p>
          </div>
        )}
      </div>

      <div className="p-3 border-t space-y-2 shrink-0">
        <Button
          className="w-full h-10 text-sm"
          variant="secondary"
          onClick={onSendTranscript}
          disabled={isStreaming}
          data-testid="button-send-transcript"
        >
          <Sparkles className="w-3 h-3 mr-1.5" />
          Generate Answer from Transcript
        </Button>
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            className="h-10 w-10 shrink-0"
            onClick={onCopilotAsk}
            disabled={isStreaming}
            data-testid="button-ask"
          >
            {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground/70">
          <kbd className="px-1 py-0.5 border rounded font-mono bg-muted text-[10px]">Enter</kbd> to generate answer from live conversation
        </p>
      </div>
    </div>
  );
}

export const SessionTranscriptPanel = memo(SessionTranscriptPanelComponent);
