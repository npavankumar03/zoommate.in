import type { Server as SocketIOServer } from "socket.io";
import { streamLLM, callLLM, resolveAutomaticInterviewModel } from "../llmRouter2";
import { buildSystemPrompt, buildTier0Prompt, getMaxTokensForFormat, buildStrictInterviewTurnUserPrompt } from "../prompt";
import { formatMemorySlotsForPrompt, processPostAnswerMemory } from "../memoryExtractor";
import { storage } from "../storage";
import { advanceCursor, markAnswered } from "./meetingStore";
import { setRecentAnswer } from "./meetingStore";
import type { MeetingState } from "./meetingStore";
import type { AnswerStyle } from "@shared/schema";
import { extractCandidateSpan, normalizeForDedup } from "@shared/questionDetection";
import type { Meeting } from "@shared/schema";
import { shouldRetrieveDocs, type DocsRetrievalMode } from "../assist/retrievalGate";
import { retrieveDocumentContext } from "../rag";
import { enqueuePersistRetry } from "../assist/persistRetry";
import { buildInterviewerIntelligenceBlock, recordAssistantAnswer, recordUserQuestion } from "../assist/sessionState";
import {
  defaultHotPathMetrics,
  getOrLoadConversationSummary,
  getOrLoadDocRetrieval,
  getOrLoadPromptTemplate,
  getOrLoadSettings,
  logHotPathMetrics,
} from "../cache/hotPathCache";

const activeSocketStreams = new Map<string, AbortController>();
const ttftSamplesSocket: number[] = [];
const memoryContextCache = new Map<string, { value: string; expiresAt: number }>();
const MEMORY_CACHE_TTL_MS = 90 * 1000;

// Periodically evict expired entries so memoryContextCache doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryContextCache) {
    if (now > entry.expiresAt) memoryContextCache.delete(key);
  }
}, 5 * 60 * 1000).unref();
const TIER0_MIN_TOKENS = 220;
const TIER0_MAX_TOKENS = 320;
const TIER0_CUSTOM_INSTRUCTIONS_CHARS = 1200;

interface MeetingSettings {
  responseFormat: string;
  customInstructions: string;
  type: string;
  conversationContext: string;
  documentIds: string[];
  rollingSummary: string;
  interviewStyle?: unknown;
}

function getCached<T>(cache: Map<string, { value: T; expiresAt: number }>, key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function setCached<T>(cache: Map<string, { value: T; expiresAt: number }>, key: string, value: T, ttlMs: number): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function toMeetingSettings(meeting: Meeting | null | undefined): MeetingSettings {
  return {
    responseFormat: meeting?.responseFormat || "concise",
    customInstructions: meeting?.customInstructions || "",
    type: meeting?.type || "interview",
    conversationContext: String(meeting?.conversationContext || ""),
    documentIds: Array.isArray(meeting?.documentIds) ? meeting!.documentIds as string[] : [],
    rollingSummary: meeting?.rollingSummary || "",
    interviewStyle: (meeting as any)?.interviewStyle,
  };
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function resolveRealtimeAnswerModel(meeting: Meeting | null | undefined, question: string): string | undefined {
  const candidate = meeting?.model || undefined;
  if (!candidate || candidate === "automatic") {
    return resolveAutomaticInterviewModel(question, { sessionMode: meeting?.sessionMode });
  }
  return candidate;
}

function buildCompanyAndJdKnowledgeBlock(question: string, source: string): string {
  const text = String(source || "");
  if (!text.trim()) return "";
  const qTokens = normalizeForDedup(question)
    .split(/\s+/)
    .filter((token) => token.length >= 3);
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 6 && line.length <= 220);
  const scored = lines
    .map((line) => {
      const lower = line.toLowerCase();
      let score = 0;
      for (const token of qTokens) {
        if (lower.includes(token)) score += 1;
      }
      if (/\b(company|client|organization|responsibilit|qualification|must|required|skills|experience)\b/i.test(line)) {
        score += 0.5;
      }
      return { line, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((item) => item.line);
  if (!scored.length) return "";
  return ["COMPANY / JD KNOWLEDGE:", ...scored.map((line) => `- ${line}`)].join("\n");
}

function enforceStrictQaFormat(question: string, answer: string): string {
  const cleanQuestion = String(question || "").replace(/^\s*(Interviewer\s*:)?\s*/i, "").trim();
  let cleanAnswer = String(answer || "").trim();
  if (!cleanQuestion || !cleanAnswer) return cleanAnswer;

  cleanAnswer = cleanAnswer
    .replace(/\r\n/g, "\n")
    .replace(/^\s*\*+\s*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (/Interviewer\s*:/i.test(cleanAnswer) && /Candidate\s*:/i.test(cleanAnswer)) {
    return cleanAnswer
      .replace(/\s*Interviewer:\s*/gi, "\n\nInterviewer: ")
      .replace(/\s*Candidate:\s*/gi, "\n\nCandidate: ")
      .replace(/^\s+/, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  const normalizedQuestion = normalizeForDedup(cleanQuestion);
  const normalizedAnswer = normalizeForDedup(cleanAnswer);
  if (normalizedAnswer.startsWith(normalizedQuestion)) {
    cleanAnswer = cleanAnswer.slice(cleanQuestion.length).trim();
  }

  cleanAnswer = cleanAnswer
    .replace(/^(Interviewer|Candidate)\s*:\s*/i, "")
    .replace(/^\*+\s*$/, "")
    .trim();

  if (!cleanAnswer) return `Interviewer: ${cleanQuestion}\n\nCandidate:`;
  return `Interviewer: ${cleanQuestion}\n\nCandidate: ${cleanAnswer}`;
}

function recordSocketTtft(ttftMs: number): void {
  if (!Number.isFinite(ttftMs) || ttftMs < 0) return;
  ttftSamplesSocket.push(ttftMs);
  if (ttftSamplesSocket.length > 250) {
    ttftSamplesSocket.splice(0, ttftSamplesSocket.length - 250);
  }
  const p50 = percentile(ttftSamplesSocket, 50);
  const p90 = percentile(ttftSamplesSocket, 90);
  console.log(`[perf][server][socket] ttft_p50=${Math.round(p50)}ms ttft_p90=${Math.round(p90)}ms samples=${ttftSamplesSocket.length}`);
}

export function abortRealtimeStream(meetingId: string): boolean {
  const controller = activeSocketStreams.get(meetingId);
  if (!controller) return false;
  controller.abort();
  activeSocketStreams.delete(meetingId);
  return true;
}

export async function streamAnswer({
  io,
  meetingId,
  userId,
  displayQuestion,
  llmPrompt,
  requestId,
  actionKey,
  questionNorms,
  state,
  style,
  requestReceivedAt,
  meeting,
  tier0LastTurn,
  quickMode,
  docsMode,
}: {
  io: SocketIOServer;
  meetingId: string;
  userId: string;
  displayQuestion: string;
  llmPrompt: string;
  requestId: string;
  actionKey?: string;
  questionNorms?: string[];
  state: MeetingState;
  style: AnswerStyle;
  requestReceivedAt?: number;
  meeting?: Meeting | null;
  tier0LastTurn?: string;
  quickMode?: boolean;
  docsMode?: DocsRetrievalMode;
}): Promise<{ answer: string }> {
  const tRequestReceived = requestReceivedAt || Date.now();
  const MAX_DOC_CHARS = 6000;
  const MAX_MEMORY_CHARS = 2000;
  const MAX_CONVO_CHARS = 2000;
  const MAX_TURNS_CHARS = 2000;
  abortRealtimeStream(meetingId);
  let activeController = new AbortController();
  activeSocketStreams.set(meetingId, activeController);

  state.isStreaming = true;
  state.phase = "STREAMING_T0";
  state.currentStreamId = requestId;

  io.to(meetingId).emit("response_start", {
    meetingId,
    ts: Date.now(),
    requestId,
    t_request_received: tRequestReceived,
  });
  console.log(`[socket.io] response_start meetingId=${meetingId} requestId=${requestId}`);

  const resolvedMeeting = meeting;

  if (!resolvedMeeting || resolvedMeeting.userId !== userId) {
    io.to(meetingId).emit("response_end", { meetingId, ts: Date.now(), error: "Meeting not found" });
    return { answer: "" };
  }

  const cacheMetrics = defaultHotPathMetrics();
  const settingsProbe = await getOrLoadSettings<MeetingSettings>(
    userId,
    meetingId,
    async () => toMeetingSettings(resolvedMeeting),
  );
  cacheMetrics.settings = settingsProbe.hit ? "hit" : "miss";
  const meetingSettings = toMeetingSettings(settingsProbe.value as any);

  const responseFormat = meetingSettings.responseFormat || "concise";
  const formatForAI = responseFormat === "custom" ? "concise" : responseFormat;
  const rawCustomInstructions = meetingSettings.customInstructions || "";
  const strictCustomPromptMode = Boolean(rawCustomInstructions.trim());
  const effectiveInstructions = rawCustomInstructions.trim();
  recordUserQuestion(meetingId, displayQuestion || llmPrompt);
  const useQuickMode = quickMode !== false;
  const resolvedDocsMode: DocsRetrievalMode = docsMode === "always" || docsMode === "off" ? docsMode : "auto";
  const tier0QuestionSpan = (extractCandidateSpan(displayQuestion || llmPrompt) || (displayQuestion || llmPrompt)).split(/\s+/).slice(-40).join(" ").slice(0, 480).trim();
  const docQuestionFingerprint = normalizeForDedup(tier0QuestionSpan || displayQuestion || llmPrompt).slice(0, 240) || "q";
  const retrieveDocsForTier1 = shouldRetrieveDocs(tier0QuestionSpan || displayQuestion || llmPrompt, resolvedDocsMode);
  const summaryProbe = getOrLoadConversationSummary(meetingId, () => meetingSettings.rollingSummary || "");
  cacheMetrics.conversationSummary = summaryProbe.hit ? "hit" : "miss";
  const cachedSummary = summaryProbe.value;

  const tier0TurnContext = tier0LastTurn ? `[Speaker]: ${tier0LastTurn}` : "";
  const promptTemplateKey = `${formatForAI}::${meetingSettings.type || "interview"}::${responseFormat}::${useQuickMode ? "q1" : "q0"}`;
  const promptTemplateProbe = getOrLoadPromptTemplate(promptTemplateKey, () => {
    const interviewShape = (meetingSettings.type || "").toLowerCase().includes("interview")
      ? "Interview response shape: 1) direct answer (1-2 sentences), 2) concrete example, 3) impact/result, 4) optional brief follow-up. Keep total concise. Exception: for direct technical definition/comparison questions, answer directly in 1-3 short sentences without anecdotes unless explicitly asked."
      : "";
    const quickSkeletonAllowed = useQuickMode && responseFormat === "technical";
    const guideByFormat: Record<string, string> = {
      short: "Short: 2-4 tight sentences total, plus up to 2 bullets if needed. No extra sections.",
      concise: "Concise: 2-3 sentences, then 2-3 bullets max if helpful.",
      detailed: "Detailed: Keep concise but structured: 1) Direct answer, 2) Key details, 3) Example, 4) Impact/Wrap-up.",
      star: "STAR: Provide 4 labeled lines only: S: ... T: ... A: ... R: ...",
      bullet: "Bullets: 4-6 clear bullets. Each bullet should be a complete, concrete point.",
      technical: "Technical: Brief overview, then 3-5 bullets, then steps and tradeoffs. Include code only if requested.",
      automatic: "Automatic: Choose the best format for the question; keep it concise.",
      code_example: "Code example: Short intro, code block, then 2-4 key points.",
      custom: "Custom format: keep concise and follow any provided custom instructions.",
    };
    const baseGuide = guideByFormat[responseFormat] || guideByFormat.concise;
    const skeletonRule = quickSkeletonAllowed
      ? "QuickMode + Technical: you may respond as a fast skeleton (3-5 bullets), but still include steps and tradeoffs."
      : "Do not respond as bullets-only skeleton unless explicitly requested.";

    return [
      buildTier0Prompt(formatForAI, meetingSettings.type),
      interviewShape,
      "Tier-0 mode: minimal context for speed, but must follow the selected format.",
      baseGuide,
      skeletonRule,
    ].filter(Boolean).join("\n\n");
  });
  cacheMetrics.promptTemplate = promptTemplateProbe.hit ? "hit" : "miss";
  const tier0IntelligenceBlock = buildInterviewerIntelligenceBlock(meetingId, displayQuestion || llmPrompt, 5);
  const tier0SystemPrompt = [
    promptTemplateProbe.value,
    effectiveInstructions ? `Custom instructions (highest priority, follow strictly unless they conflict with no-invention/safety rules): ${effectiveInstructions.slice(0, TIER0_CUSTOM_INSTRUCTIONS_CHARS)}` : "",
    tier0TurnContext ? `Last turn:\n${tier0TurnContext}` : "",
    tier0IntelligenceBlock || "",
  ].filter(Boolean).join("\n\n");

  const buildTier1Prompt = async (): Promise<string> => {
    const memCacheKey = `mem:${userId}`;
    const cachedMem = getCached(memoryContextCache, memCacheKey);
    const memoryPromise = cachedMem
      ? Promise.resolve(cachedMem)
      : formatMemorySlotsForPrompt(userId, meetingId).then((v) => {
          setCached(memoryContextCache, memCacheKey, v || "", MEMORY_CACHE_TTL_MS);
          return v;
        });
    const [rawMemoryContext, recentTurns] = await Promise.all([
      memoryPromise,
      storage.getRecentTranscriptTurns(meetingId, 8),
      ]);
    const memoryContext = (rawMemoryContext || "").slice(0, MAX_MEMORY_CHARS);
    let documentContext = "";
    const docIds = meetingSettings.documentIds as string[] | null;
    if (retrieveDocsForTier1 && docIds && docIds.length > 0) {
      const docsProbe = await getOrLoadDocRetrieval(
        meetingId,
        docQuestionFingerprint,
        docIds.slice().sort().join(","),
        async () => {
          return retrieveDocumentContext(userId, displayQuestion || llmPrompt, docIds);
        },
      );
      cacheMetrics.docRetrieval = docsProbe.hit ? "hit" : "miss";
      documentContext = docsProbe.value.slice(0, MAX_DOC_CHARS);
    }
    const turnContext = recentTurns.reverse().map((t) => `[Speaker]: ${t.text}`).join("\n");
    const convoContext = String(meetingSettings.conversationContext || "").slice(-MAX_CONVO_CHARS);
    const mergedContext = [convoContext, turnContext ? turnContext.slice(-MAX_TURNS_CHARS) : ""]
      .filter(Boolean)
      .join("\n");
    return buildSystemPrompt(
      formatForAI,
      meetingSettings.type,
      effectiveInstructions || undefined,
      documentContext || undefined,
      mergedContext || undefined,
      memoryContext || undefined,
      cachedSummary || undefined,
      meetingSettings.interviewStyle || undefined,
      [buildInterviewerIntelligenceBlock(meetingId, displayQuestion || llmPrompt, 5), buildCompanyAndJdKnowledgeBlock(displayQuestion || llmPrompt, effectiveInstructions || "")]
        .filter(Boolean)
        .join("\n\n") || undefined,
    );
  };

  // Commit stream start: avoid replaying already-consumed finalized turns.
  advanceCursor(meetingId);

  let fullAnswer = "";
  let emitBuffer = "";
  let emitTimer: ReturnType<typeof setTimeout> | null = null;
  let tFirstTokenFromProvider = 0;
  let tFirstChunkSent = 0;
  let tLlmRequestStarted = 0;
  let tStreamEnd = 0;
  let tPersistStart = 0;
  let tPersistEnd = 0;
  let streamMode: "tier0" | "tier1" = "tier0";
  let emittedChunkCount = 0;
  let emittedCharCount = 0;

  const flush = () => {
    if (!emitBuffer) return;
    if (!tFirstChunkSent) {
      tFirstChunkSent = Date.now();
      console.log(`[perf][server] meeting=${meetingId} t_request_received=${tRequestReceived} t_first_token_sent=${tFirstChunkSent} t_first_chunk_sent=${tFirstChunkSent} ttft=${tFirstChunkSent - tRequestReceived}ms`);
      recordSocketTtft(tFirstChunkSent - tRequestReceived);
    }
    emittedChunkCount += 1;
    emittedCharCount += emitBuffer.length;
    io.to(meetingId).emit("answer", { meetingId, delta: emitBuffer, requestId });
    console.log(`[socket.io] answer_chunk meetingId=${meetingId} requestId=${requestId} chunk=${emittedChunkCount} chars=${emitBuffer.length}`);
    emitBuffer = "";
    emitTimer = null;
  };

  const scheduleFlush = () => {
    if (emitTimer) return;
    emitTimer = setTimeout(flush, 20);
  };

  try {
    const baselinePrompt = buildSystemPrompt(
      formatForAI,
      meetingSettings.type,
      effectiveInstructions || undefined,
      undefined,
      String(meetingSettings.conversationContext || "").slice(-MAX_CONVO_CHARS) || undefined,
      undefined,
      cachedSummary || undefined,
      meetingSettings.interviewStyle || undefined,
      [buildInterviewerIntelligenceBlock(meetingId, displayQuestion || llmPrompt, 5), buildCompanyAndJdKnowledgeBlock(displayQuestion || llmPrompt, effectiveInstructions || "")]
        .filter(Boolean)
        .join("\n\n") || undefined,
    );
    const promptToUse = useQuickMode ? tier0SystemPrompt : baselinePrompt;
    const rawQuestionForPrompt = useQuickMode ? (tier0QuestionSpan || displayQuestion || llmPrompt) : (displayQuestion || llmPrompt);
    const userPromptToUse = strictCustomPromptMode
      ? buildStrictInterviewTurnUserPrompt({ question: rawQuestionForPrompt })
      : rawQuestionForPrompt;
    const resolvedModel = resolveRealtimeAnswerModel(resolvedMeeting, userPromptToUse);
    const tier0Cap = style === "brief" || responseFormat === "short" ? TIER0_MIN_TOKENS : 300;
    const maxTokens = useQuickMode
      ? Math.max(
          TIER0_MIN_TOKENS,
          Math.min(TIER0_MAX_TOKENS, Math.min(tier0Cap, getMaxTokensForFormat(formatForAI, resolvedModel, true))),
        )
      : getMaxTokensForFormat(formatForAI, resolvedModel);
    tLlmRequestStarted = Date.now();

    const generator = streamLLM(
      "LIVE_INTERVIEW_ANSWER",
      promptToUse,
      userPromptToUse,
      meetingId,
      { maxTokens, cacheUserId: userId, model: resolvedModel },
      activeController.signal,
    );

    for await (const chunk of generator) {
      if (!chunk) continue;
      if (!tFirstTokenFromProvider) {
        tFirstTokenFromProvider = Date.now();
        console.log(`[perf][server] meeting=${meetingId} t_request_received=${tRequestReceived} t_llm_request_started=${tLlmRequestStarted} t_first_token_from_provider=${tFirstTokenFromProvider} provider_ttft=${tFirstTokenFromProvider - tRequestReceived}ms mode=${streamMode}`);
      }
      fullAnswer += chunk;
      emitBuffer += chunk;
      scheduleFlush();
    }

    if (emitTimer) {
      clearTimeout(emitTimer);
      flush();
    }

    if (!activeController.signal.aborted) {
      tStreamEnd = Date.now();
      io.to(meetingId).emit("response_end", { meetingId, ts: Date.now(), requestId });
      console.log(`[socket.io] response_end meetingId=${meetingId} requestId=${requestId} total_chunks=${emittedChunkCount} total_chars=${emittedCharCount}`);
    }

    let finalAnswerForStorage = strictCustomPromptMode
      ? enforceStrictQaFormat(displayQuestion || llmPrompt, fullAnswer)
      : fullAnswer;
    if (fullAnswer.trim()) {
      try {
        const tier1Prompt = await buildTier1Prompt();
        const refined = await callLLM(
          "LIVE_INTERVIEW_ANSWER",
          tier1Prompt,
          [
            "Improve this draft answer using available context.",
            "Keep same facts, improve precision and interview quality.",
            strictCustomPromptMode
              ? "Preserve strict custom-prompt formatting, including Interviewer / Candidate separation when requested."
              : "",
            "Return only the improved final answer.",
            "",
            `Question: ${displayQuestion || llmPrompt}`,
            "",
            "Draft answer:",
            fullAnswer,
          ].join("\n"),
          meetingId,
          { maxTokens: 700, temperature: 0.2, cacheUserId: userId, model: resolvedModel },
        );
        const cleanRefined = strictCustomPromptMode
          ? enforceStrictQaFormat(displayQuestion || llmPrompt, (refined || "").trim())
          : (refined || "").trim();
        if (
          cleanRefined
          && normalizeForDedup(cleanRefined) !== normalizeForDedup(fullAnswer)
          && cleanRefined.length > Math.floor(fullAnswer.length * 0.6)
        ) {
          finalAnswerForStorage = cleanRefined;
        }
      } catch {
        // Best-effort refinement only; streaming path is already completed.
      }
    }

    state.lastAnswer = finalAnswerForStorage;
    state.lastPrompt = llmPrompt;
    state.lastStyleUsed = style;
    recordAssistantAnswer(meetingId, displayQuestion || llmPrompt, finalAnswerForStorage, requestId);
    if (questionNorms && questionNorms.length > 0) {
      markAnswered(meetingId, questionNorms, Date.now());
    }

    if (actionKey) {
      setRecentAnswer(
        meetingId,
        actionKey,
        displayQuestion || llmPrompt,
        finalAnswerForStorage,
        undefined,
      );
    }

    const persistTask = async () => {
      tPersistStart = Date.now();
      const savedResponse = await storage.createResponse({
        meetingId,
        question: displayQuestion,
        answer: finalAnswerForStorage,
        responseType: responseFormat,
      });
      tPersistEnd = Date.now();

      if (actionKey) {
        setRecentAnswer(
          meetingId,
          actionKey,
          displayQuestion || llmPrompt,
          finalAnswerForStorage,
          savedResponse?.id,
        );
      }

      io.to(meetingId).emit("response_saved", {
        meetingId,
        requestId,
        dedupeKey: actionKey || "",
        response: savedResponse,
      });

      processPostAnswerMemory(
        userId,
        meetingId,
        displayQuestion,
        finalAnswerForStorage,
        savedResponse?.id,
        {
          incognito: resolvedMeeting.incognito,
          saveFacts: resolvedMeeting.saveFacts,
          rollingSummary: resolvedMeeting.rollingSummary,
          turnCount: resolvedMeeting.turnCount,
          conversationContext: resolvedMeeting.conversationContext,
        },
      ).catch((err: any) => console.error(`[memory][${requestId}] Post-answer failed:`, err?.message || err));

      const totalLatency = Date.now() - tRequestReceived;
      console.log(
        `[perf][server] meeting=${meetingId} requestId=${requestId} t_request_received=${tRequestReceived} t_llm_request_started=${tLlmRequestStarted || 0} t_first_token_from_provider=${tFirstTokenFromProvider || 0} t_first_chunk_sent=${tFirstChunkSent || 0} t_stream_end=${tStreamEnd || Date.now()} t_persist_start=${tPersistStart} t_persist_end=${tPersistEnd} total_latency=${totalLatency}ms mode=${streamMode}`,
      );
    };

    void persistTask().catch((err: any) => {
      console.error(`[answerStreamer][${requestId}] Persist failed:`, err?.message || err);
      enqueuePersistRetry(`socket:${meetingId}`, requestId, async () => {
        await persistTask();
      });
    });
    logHotPathMetrics(requestId, "socket", cacheMetrics);

    return { answer: finalAnswerForStorage };
  } catch (error: any) {
    if (emitTimer) clearTimeout(emitTimer);
    if (error?.name === "AbortError" || activeController.signal.aborted) {
      io.to(meetingId).emit("response_end", { meetingId, ts: Date.now(), requestId, cancelled: true });
      return { answer: fullAnswer };
    }
    io.to(meetingId).emit("response_end", { meetingId, ts: Date.now(), requestId, error: error?.message || "stream failed" });
    return { answer: fullAnswer };
  } finally {
    activeSocketStreams.delete(meetingId);
    state.isStreaming = false;
    state.phase = "DONE";
    if (state.currentStreamId === requestId) {
      state.currentStreamId = undefined;
    }
  }
}
