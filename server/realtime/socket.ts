import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import {
  getState,
  setPartial,
  addFinal,
  getSnapshotFromCursor,
  getRecentFinals,
  getRecentQuestions as getStoredRecentQuestions,
  getRecentAnswer,
  setAnswerStyle,
  getMeetingStore,
} from "./meetingStore";
import { orchestrate } from "../assist/orchestrator";
import { abortRealtimeStream, streamAnswer } from "./answerStreamer";
import { storage } from "../storage";
import type { AnswerStyle } from "@shared/schema";

const VALID_STYLES: AnswerStyle[] = ["brief", "standard", "deep", "concise", "star", "bullet", "talking_points", "direct_followup"];
const meetingCache = new Map<string, { value: any; expiresAt: number }>();
const MEETING_CACHE_TTL_MS = 5 * 60 * 1000;

async function getMeetingCached(meetingId: string): Promise<any | null> {
  const now = Date.now();
  const hit = meetingCache.get(meetingId);
  if (hit && now <= hit.expiresAt) {
    return hit.value;
  }
  const meeting = await storage.getMeeting(meetingId);
  if (!meeting) return null;
  meetingCache.set(meetingId, { value: meeting, expiresAt: now + MEETING_CACHE_TTL_MS });
  return meeting;
}

export function initSocket(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    console.log(`[socket.io] connect id=${socket.id} ip=${socket.handshake.address || "unknown"} role=stt-signals-and-ui-events`);
    const emitCachedAnswer = (
      meetingId: string,
      dedupeKey: string,
      answer: string,
      question?: string,
      existingResponseId?: string,
    ) => {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      io.to(meetingId).emit("answer_cached", {
        meetingId,
        ts: Date.now(),
        requestId,
        cached: true,
        dedupeKey,
        question: question || "",
        answer: answer || "",
        existingResponseId: existingResponseId || "",
      });
    };

    socket.on("join_meeting", ({ meetingId }: any) => {
      if (!meetingId || typeof meetingId !== "string") return;
      socket.join(meetingId);
      socket.emit("joined", { meetingId });
      console.log(`[socket.io] join_meeting id=${socket.id} meetingId=${meetingId}`);
    });

    socket.on("recognizing_item", ({ meetingId, text }: any) => {
      if (!meetingId || typeof meetingId !== "string") return;
      setPartial(meetingId, String(text || ""));
    });

    socket.on("recognized_item", ({ meetingId, text, ts }: any) => {
      if (!meetingId || typeof meetingId !== "string") return;
      const clean = String(text || "").trim();
      if (!clean) return;
      const now = typeof ts === "number" ? ts : Date.now();
      addFinal(meetingId, clean, now);
      // Broadcast candidate mic speech to web UI clients so they can detect
      // corrections in real time and auto-trigger answer rewrites.
      if (/^Candidate:\s/i.test(clean)) {
        io.to(meetingId).emit("candidate_speech", { meetingId, text: clean, ts: now });
      }
    });

    socket.on("barge_in", ({ meetingId }: any) => {
      if (!meetingId || typeof meetingId !== "string") return;
      const state = getState(meetingId);
      const cancelled = abortRealtimeStream(meetingId);
      state.isStreaming = false;
      if (cancelled) {
        io.to(meetingId).emit("response_end", { meetingId, ts: Date.now(), cancelled: true });
      }
    });

    socket.on("set_answer_style", ({ meetingId, style }: any) => {
      if (!meetingId || typeof meetingId !== "string") return;
      if (!VALID_STYLES.includes(style)) return;
      const updated = setAnswerStyle(meetingId, style);
      io.to(meetingId).emit("answer_style", { meetingId, style: updated });
    });

    socket.on("question", async ({ meetingId, mode, audioMode, overrideQuestion, quickMode, docsMode }: any) => {
      try {
        if (!meetingId || typeof meetingId !== "string") return;
        console.warn(`[socket.io] deprecated_answer_path id=${socket.id} meetingId=${meetingId} (preferred transport is /ws)`);
        const tRequestReceived = Date.now();
        const resolvedMode = mode === "enter" || mode === "pause" || mode === "final" ? mode : "enter";
        const resolvedAudio = audioMode === "mic" ? "mic" : "system";
        console.log(`[socket.io] question id=${socket.id} meetingId=${meetingId} mode=${resolvedMode} audio=${resolvedAudio} hasOverride=${!!String(overrideQuestion || "").trim()}`);

        const meeting = await getMeetingCached(meetingId);
        if (!meeting) return;

        const state = getState(meetingId);
        if (state.isStreaming && resolvedMode !== "enter") {
          return;
        }
        if (state.isStreaming) {
          abortRealtimeStream(meetingId);
          state.isStreaming = false;
        }
        const lookback = resolvedMode === "enter" ? 0 : 1;
        const snapshotText = overrideQuestion?.trim()
          ? String(overrideQuestion).trim()
          : getSnapshotFromCursor(meetingId, 3000, lookback);
        const recentFinals = getRecentFinals(meetingId, 6);

        const decision = await orchestrate({
          meetingId,
          mode: resolvedMode,
          audioMode: resolvedAudio,
          snapshotText,
          recentFinals,
          state,
          overrideQuestion: overrideQuestion ? String(overrideQuestion) : undefined,
        });

        if (decision.action === "ignore" && decision.dedupeKey) {
          const cached = getRecentAnswer(meetingId, decision.dedupeKey, 15000);
          if (cached && resolvedMode === "enter") {
            emitCachedAnswer(
              meetingId,
              decision.dedupeKey,
              cached.answer,
              cached.question,
              cached.responseId,
            );
            return;
          }
        }

        if (decision.action === "ignore" || decision.action === "wait" || !decision.llmPrompt) {
          state.isStreaming = false;
          io.to(meetingId).emit("orchestrate_result", { meetingId, decision });
          return;
        }

        // Atomic stream mutex: reserve before any async stream work starts.
        state.isStreaming = true;
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        state.currentStreamId = requestId;
        io.to(meetingId).emit("orchestrate_result", { meetingId, decision });
        await streamAnswer({
          io,
          meetingId,
          userId: meeting.userId,
          displayQuestion: decision.displayQuestion,
          llmPrompt: decision.llmPrompt,
          requestId,
          actionKey: decision.dedupeKey,
          questionNorms: decision.questionNorms,
          state,
          style: decision.style,
          requestReceivedAt: tRequestReceived,
          meeting,
          tier0LastTurn: recentFinals[recentFinals.length - 1] || "",
          quickMode: typeof quickMode === "boolean" ? quickMode : true,
          docsMode: docsMode === "always" || docsMode === "off" ? docsMode : "auto",
        });
      } catch (error: any) {
        if (meetingId && typeof meetingId === "string") {
          getState(meetingId).isStreaming = false;
        }
        socket.emit("response_end", { meetingId, ts: Date.now(), error: error?.message || "question failed" });
      }
    });

    socket.on("getRecentQuestions", ({ meetingId }: any) => {
      if (!meetingId || typeof meetingId !== "string") return;
      socket.emit("recentQuestions", {
        meetingId,
        questions: getStoredRecentQuestions(meetingId, 10),
      });
    });

    socket.on("disconnect", (reason) => {
      console.log(`[socket.io] disconnect id=${socket.id} reason=${reason}`);
    });
  });

  return { io, meetingStore: getMeetingStore() };
}
