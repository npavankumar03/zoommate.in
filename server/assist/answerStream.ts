import type { Response as ExpressResponse, Request as ExpressRequest } from "express";
import {
  streamAssistantAnswer as streamAssistantAnswerGenerator,
  abortSessionStream,
  hasActiveStream,
  type StreamAssistantAnswerOptions,
} from "./streamAssistantAnswer";

export { abortSessionStream, hasActiveStream };
export type { StreamAssistantAnswerOptions };

export async function streamAssistantAnswer(
  req: ExpressRequest,
  res: ExpressResponse,
  options: StreamAssistantAnswerOptions,
): Promise<void> {
  const { meetingId } = options;
  let aborted = false;
  let tSseHeadersSent = 0;

  const abortController = new AbortController();
  req.on("close", () => {
    aborted = true;
    abortController.abort();
    abortSessionStream(meetingId);
  });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
    "Content-Encoding": "none",
  });
  res.flushHeaders();
  tSseHeadersSent = Date.now();
  res.write(":ok\n\n");

  const keepaliveInterval = setInterval(() => {
    if (!aborted) res.write(":keepalive\n\n");
  }, 15000);

  let emitBuffer = "";
  let emitTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (!emitBuffer || aborted) {
      emitBuffer = "";
      emitTimer = null;
      return;
    }
    res.write("event: chunk\n");
    res.write(`data: ${JSON.stringify({ type: "chunk", chunk: emitBuffer, text: emitBuffer })}\n\n`);
    emitBuffer = "";
    emitTimer = null;
  };

  const scheduleFlush = (isFirstChunk = false) => {
    if (isFirstChunk) {
      flush();
      return;
    }
    if (emitTimer) return;
    emitTimer = setTimeout(flush, 20);
  };

  try {
    const generator = streamAssistantAnswerGenerator({
      ...options,
      transport: "sse",
      abortSignal: abortController.signal,
    });

    for await (const event of generator) {
      if (aborted) break;
      if (event.type === "start") {
        res.write("event: status\n");
        res.write(`data: ${JSON.stringify({ type: "status", state: "assistant_start", requestId: event.requestId, t_sse_headers_sent: tSseHeadersSent })}\n\n`);
        continue;
      }
      if (event.type === "chunk") {
        emitBuffer += event.text;
        scheduleFlush(!emitBuffer || emitBuffer === event.text);
        continue;
      }
      if (event.type === "end") {
        if (emitTimer) {
          clearTimeout(emitTimer);
          flush();
        }
        res.write("event: done\n");
        res.write(`data: ${JSON.stringify({ type: "done", requestId: event.requestId, response: event.response, cancelled: event.cancelled || false })}\n\n`);
        continue;
      }
      if (event.type === "error") {
        res.write("event: error\n");
        res.write(`data: ${JSON.stringify({ type: "error", requestId: event.requestId, message: event.message })}\n\n`);
      }
    }
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(500).json({ message: err.message || "Failed to stream assistant answer" });
    } else {
      res.write("event: error\n");
      res.write(`data: ${JSON.stringify({ type: "error", message: err.message || "stream failed" })}\n\n`);
    }
  } finally {
    clearInterval(keepaliveInterval);
    if (emitTimer) {
      clearTimeout(emitTimer);
      emitTimer = null;
    }
    if (!res.writableEnded) res.end();
  }
}
