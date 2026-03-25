import { memo, useMemo, type RefObject } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import type { Response } from "@shared/schema";
import { normalizeForDedup } from "@shared/questionDetection";
import {
  Loader2,
  Maximize2,
  Minimize2,
  Monitor,
  ScanSearch,
  Send,
} from "lucide-react";

type SessionSidebarPanelProps = {
  isScreenShareReady: boolean;
  isScreenPreviewPopupOpen: boolean;
  onTogglePreviewPopup: () => void;
  screenShareLabel: string;
  screenShareThumbnail: string;
  previewVideoRef: RefObject<HTMLVideoElement>;
  onToggleScreenShare: () => void;
  isScreenAnalyzing: boolean;
  onScreenCapture: () => void;
  recentQuestions: string[];
  selectedQuestionFilter: string;
  onSelectQuestion: (question: string) => void;
  onReanswerQuestion: (question: string) => void;
  reanswerDisabled: boolean;
  responses: Response[];
  formatHistoryAnswer: (question: string | null | undefined, answer: string) => string;
};

function SessionSidebarPanelComponent({
  isScreenShareReady,
  isScreenPreviewPopupOpen,
  onTogglePreviewPopup,
  screenShareLabel,
  screenShareThumbnail,
  previewVideoRef,
  onToggleScreenShare,
  isScreenAnalyzing,
  onScreenCapture,
  recentQuestions,
  selectedQuestionFilter,
  onSelectQuestion,
  onReanswerQuestion,
  reanswerDisabled,
  responses,
  formatHistoryAnswer,
}: SessionSidebarPanelProps) {
  const historyResponses = useMemo(
    () => selectedQuestionFilter
      ? responses.filter((response) => normalizeForDedup(response.question || "") === normalizeForDedup(selectedQuestionFilter))
      : [],
    [responses, selectedQuestionFilter],
  );

  return (
    <div
      className="lg:w-[300px] xl:w-[340px] lg:min-w-[260px] lg:max-w-[560px] shrink-0 border-l flex flex-col lg:resize-x lg:overflow-auto"
      style={{ minHeight: 0 }}
    >
      <div className="px-3 py-2 border-b space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Shared Screen</h3>
          <div className="flex items-center gap-2">
            {isScreenShareReady ? (
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={onTogglePreviewPopup}
                title={isScreenPreviewPopupOpen ? "Close popup preview" : "Open popup preview"}
              >
                {isScreenPreviewPopupOpen ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
              </Button>
            ) : null}
            <Badge variant={isScreenShareReady ? "default" : "secondary"} className="text-[10px] h-5 px-1.5">
              {isScreenShareReady ? "On" : "Off"}
            </Badge>
          </div>
        </div>
        {screenShareLabel && (
          <p className="text-[11px] text-muted-foreground truncate" title={screenShareLabel}>
            {screenShareLabel}
          </p>
        )}
        <div className="rounded-lg overflow-hidden border bg-black/95 aspect-video relative">
          {isScreenShareReady ? (
            <video
              ref={previewVideoRef}
              className="h-full w-full object-contain"
              muted
              playsInline
              autoPlay
            />
          ) : null}
          {!isScreenShareReady && screenShareThumbnail ? (
            <img
              src={screenShareThumbnail}
              alt="Shared screen snapshot"
              className="h-full w-full object-contain"
            />
          ) : null}
          {!isScreenShareReady && (
            <div className="absolute inset-0 flex items-center justify-center text-center px-4">
              <p className="text-xs text-white/70">Share a tab or screen to preview it here.</p>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={isScreenShareReady ? "default" : "outline"}
            className="h-8 text-xs flex-1"
            onClick={onToggleScreenShare}
            disabled={isScreenAnalyzing}
          >
            <Monitor className="w-3 h-3 mr-1.5" />
            {isScreenShareReady ? "Stop Sharing" : "Share Screen"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs flex-1"
            onClick={onScreenCapture}
            disabled={isScreenAnalyzing}
          >
            {isScreenAnalyzing ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <ScanSearch className="w-3 h-3 mr-1.5" />}
            Capture
          </Button>
        </div>
      </div>

      <div className="px-3 py-2 border-b">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent Questions</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2" style={{ minHeight: 0 }}>
        {recentQuestions.length === 0 ? (
          <p className="text-xs text-muted-foreground">Questions will appear here as you ask them.</p>
        ) : (
          recentQuestions.map((text, index) => (
            <div
              key={`${index}-${text.slice(0, 20)}`}
              className="flex items-start gap-1 group"
            >
              <button
                type="button"
                onClick={() => onSelectQuestion(text)}
                className={`flex-1 text-left text-xs leading-relaxed transition-colors ${
                  normalizeForDedup(text) === normalizeForDedup(selectedQuestionFilter)
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {text}
              </button>
              <button
                type="button"
                title="Re-answer this question"
                disabled={reanswerDisabled}
                onClick={() => onReanswerQuestion(text)}
                className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-primary hover:text-primary/80 disabled:opacity-30 mt-0.5"
              >
                <Send className="w-3 h-3" />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="border-t px-3 py-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">History</h4>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2" style={{ minHeight: 0 }}>
        {selectedQuestionFilter ? (
          historyResponses.map((response) => (
            <div key={response.id} className="text-xs text-muted-foreground leading-relaxed border rounded-md p-2 bg-muted/20">
              <MarkdownRenderer content={formatHistoryAnswer(response.question, response.answer)} />
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">Select a question to view its answer history.</p>
        )}
      </div>
    </div>
  );
}

export const SessionSidebarPanel = memo(SessionSidebarPanelComponent);
