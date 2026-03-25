import { memo, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import type { Response } from "@shared/schema";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import {
  Brain,
  Check,
  Copy,
  Images,
  Loader2,
  Monitor,
  Plus,
  ScanSearch,
  Send,
  Sparkles,
  Square,
  X,
  Zap,
} from "lucide-react";

type SessionInsightsPanelProps = {
  isScreenShareReady: boolean;
  onToggleScreenShare: () => void;
  isScreenAnalyzing: boolean;
  onScreenCapture: () => void;
  isMultiAnalyzing: boolean;
  onAddToMultiCapture: () => void;
  multiCaptureQueueLength: number;
  onSubmitMultiScreenAnalysis: () => void;
  onClearMultiCapture: () => void;
  onGenerate: () => void;
  generateDisabled: boolean;
  shouldShowStreamingCard: boolean;
  isStreaming: boolean;
  isAwaitingFirstChunk: boolean;
  streamingQuestion: string;
  streamingAnswer: string;
  streamingRenderAsCode: boolean;
  isRefining: boolean;
  onCancelStream: () => void;
  selectedResponse: Response | null;
  selectedResponseRenderedAnswer: string;
  copiedId: string | null;
  onDeepRerun: (question: string) => void;
  onCopyResponse: (text: string, responseId: string) => void;
  scrollRef: RefObject<HTMLDivElement>;
  manualQuestion: string;
  onManualQuestionChange: (value: string) => void;
  onSubmitManualQuestion: () => void;
  manualQuestionDisabled: boolean;
};

function SessionInsightsPanelComponent({
  isScreenShareReady,
  onToggleScreenShare,
  isScreenAnalyzing,
  onScreenCapture,
  isMultiAnalyzing,
  onAddToMultiCapture,
  multiCaptureQueueLength,
  onSubmitMultiScreenAnalysis,
  onClearMultiCapture,
  onGenerate,
  generateDisabled,
  shouldShowStreamingCard,
  isStreaming,
  isAwaitingFirstChunk,
  streamingQuestion,
  streamingAnswer,
  streamingRenderAsCode,
  isRefining,
  onCancelStream,
  selectedResponse,
  selectedResponseRenderedAnswer,
  copiedId,
  onDeepRerun,
  onCopyResponse,
  scrollRef,
  manualQuestion,
  onManualQuestionChange,
  onSubmitManualQuestion,
  manualQuestionDisabled,
}: SessionInsightsPanelProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="shrink-0 border-b px-4 py-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">AI Insights</h3>
          <Button
            size="sm"
            variant={isScreenShareReady ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={onToggleScreenShare}
            disabled={isScreenAnalyzing}
            data-testid="button-screen-share"
          >
            <Monitor className="w-3 h-3 mr-1.5" />
            {isScreenShareReady ? "Screen On" : "Share Screen"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={onScreenCapture}
            disabled={isStreaming || isScreenAnalyzing || isMultiAnalyzing}
            data-testid="button-screen-capture"
          >
            {isScreenAnalyzing ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <ScanSearch className="w-3 h-3 mr-1.5" />}
            Capture
          </Button>
          <div className="relative">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={onAddToMultiCapture}
              disabled={isStreaming || isScreenAnalyzing || isMultiAnalyzing || !isScreenShareReady}
              title="Add to multi-capture queue"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add
            </Button>
            {multiCaptureQueueLength > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {multiCaptureQueueLength}
              </span>
            )}
          </div>
          {multiCaptureQueueLength > 0 && (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs"
                onClick={onSubmitMultiScreenAnalysis}
                disabled={isMultiAnalyzing || isScreenAnalyzing}
              >
                {isMultiAnalyzing ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Images className="w-3 h-3 mr-1.5" />}
                Analyze All ({multiCaptureQueueLength})
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={onClearMultiCapture}
                title="Clear queue"
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          )}
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 text-xs"
          onClick={onGenerate}
          disabled={generateDisabled}
        >
          <Zap className="w-3 h-3 mr-1.5" />
          Generate
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3" ref={scrollRef}>
        {shouldShowStreamingCard ? (
          <div className="py-2" data-testid="card-streaming-response">
            {isStreaming && (
              <div className="flex justify-end mb-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 h-6 text-xs text-destructive hover:text-destructive"
                  onClick={onCancelStream}
                  data-testid="button-cancel-stream"
                >
                  <Square className="w-3 h-3 mr-1" /> Stop
                </Button>
              </div>
            )}
            {(streamingAnswer || isAwaitingFirstChunk) ? (
              <div className="text-sm leading-relaxed">
                {streamingQuestion && (
                  <div className="font-bold mb-2 text-foreground/90 pb-2 border-b border-primary/10">
                    Q: {streamingQuestion}
                  </div>
                )}
                {streamingAnswer ? (
                  streamingRenderAsCode ? (
                    <MarkdownRenderer content={streamingAnswer} />
                  ) : (
                    <pre className="whitespace-pre-wrap text-sm font-sans">{streamingAnswer}</pre>
                  )
                ) : (
                  <div className="flex items-center gap-1.5 py-1" data-testid="badge-streaming-status">
                    <span className="inline-block w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="inline-block w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "120ms" }} />
                    <span className="inline-block w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "240ms" }} />
                    <span className="text-xs text-muted-foreground ml-1">Thinking...</span>
                  </div>
                )}
                {streamingAnswer && (
                  isRefining
                    ? <span className="text-[10px] text-muted-foreground ml-1 animate-pulse">Refining...</span>
                    : <span className="inline-block w-0.5 h-4 bg-primary animate-pulse ml-0.5 align-text-bottom" />
                )}
              </div>
            ) : null}
          </div>
        ) : selectedResponse ? (
          <div className="py-2" data-testid={`card-response-${selectedResponse.id}`}>
            <div className="flex justify-end gap-0.5 mb-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => onDeepRerun(selectedResponse.question || "")}
                disabled={isStreaming || !selectedResponse.question}
                title="Re-run with GPT-5"
                data-testid={`button-deep-${selectedResponse.id}`}
              >
                <Brain className="w-2.5 h-2.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => onCopyResponse(selectedResponse.answer, selectedResponse.id)}
                data-testid={`button-copy-${selectedResponse.id}`}
              >
                {copiedId === selectedResponse.id ? <Check className="w-2.5 h-2.5 text-chart-3" /> : <Copy className="w-2.5 h-2.5" />}
              </Button>
            </div>
            <div className="text-sm leading-relaxed">
              {selectedResponse.question && (
                <div className="font-bold mb-2 text-foreground/90 pb-2 border-b border-primary/10">
                  Q: {selectedResponse.question}
                </div>
              )}
              <MarkdownRenderer content={selectedResponseRenderedAnswer} />
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground/50">
              {selectedResponse.createdAt ? new Date(selectedResponse.createdAt).toLocaleTimeString() : ""}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-12 h-12 rounded-full bg-primary/5 flex items-center justify-center mb-3">
              <Sparkles className="w-6 h-6 text-primary/20" />
            </div>
            <p className="text-xs text-muted-foreground max-w-[200px]" data-testid="text-ready-state">
              Press Enter to answer the latest interviewer question
            </p>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t px-3 py-2 flex items-center gap-2">
        <input
          type="text"
          value={manualQuestion}
          onChange={(event) => onManualQuestionChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && manualQuestion.trim() && !isStreaming) {
              event.preventDefault();
              onSubmitManualQuestion();
            }
          }}
          placeholder="Type a question and press Enter..."
          disabled={isStreaming}
          className="flex-1 h-8 rounded-md border border-input bg-background px-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        />
        <Button
          size="sm"
          className="h-8 px-3"
          disabled={manualQuestionDisabled}
          onClick={onSubmitManualQuestion}
        >
          <Send className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

export const SessionInsightsPanel = memo(SessionInsightsPanelComponent);
