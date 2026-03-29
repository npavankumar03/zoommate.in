import {
  computeWordOverlap,
  normalizeForDedup,
  levenshteinSimilarity,
  fingerprint,
  questionSupersedes,
  type QuestionAnswerability,
  type QuestionPatternLabel,
} from "@shared/questionDetection";
import type { AnswerStyle } from "@shared/schema";

type QueuedQuestion = {
  clean: string;
  norm: string;
  ts: number;
  answeredTs?: number;
  windowHash?: string;
  answerability?: QuestionAnswerability;
  labels?: QuestionPatternLabel[];
};

export type MeetingState = {
  phase: "IDLE" | "LISTENING" | "CANDIDATE" | "STREAMING_T0" | "REFINE_T1" | "DONE";
  partialText: string;
  finals: Array<{ text: string; ts: number }>;
  lastAnsweredFinalIndex: number;
  recentQuestions: Array<{ clean: string; ts: number }>;
  questionQueue: QueuedQuestion[];
  activeQuestion?: QueuedQuestion;
  recentAnswers: Array<{ key: string; question: string; answer: string; ts: number; responseId?: string }>;
  lastQuestionExtractTs?: number;
  lastTriggerAt?: number;
  lastAutoTriggerAt?: number;
  recentAskedFingerprints: Array<{ fp: string; ts: number }>;
  partialFingerprint?: string;
  partialFingerprintCount: number;
  partialFingerprintSinceTs: number;
  partialLastTs?: number;
  suppressions: Record<string, number>;
  feedbackGuardUntilTs?: number;
  isStreaming: boolean;
  currentStreamId?: string;
  lastAnswer?: string;
  lastAnswerAt?: number;
  lastPrompt?: string;
  lastAnsweredWindowHash?: string;
  lastStyleUsed?: AnswerStyle;
  answerStyle?: AnswerStyle;
  pendingMeta?: { type: "brief" | "deeper"; ts: number };
  recentActionKeys: Array<{ key: string; ts: number }>;
  codeContext?: {
    latestQuestion?: string;
    latestAnswer?: string;
    previousAnswer?: string;
    latestCapturedAt?: number;
    previousCapturedAt?: number;
  };
};

const store = new Map<string, MeetingState>();

function createState(): MeetingState {
  return {
    phase: "IDLE",
    partialText: "",
    finals: [],
    lastAnsweredFinalIndex: 0,
    recentQuestions: [],
    questionQueue: [],
    recentAnswers: [],
    recentAskedFingerprints: [],
    partialFingerprintCount: 0,
    partialFingerprintSinceTs: 0,
    suppressions: {},
    recentActionKeys: [],
    answerStyle: "standard",
    isStreaming: false,
  };
}

export function getState(meetingId: string): MeetingState {
  const existing = store.get(meetingId);
  if (existing) return existing;
  const created = createState();
  store.set(meetingId, created);
  return created;
}

export function setPartial(meetingId: string, text: string): void {
  const s = getState(meetingId);
  s.phase = "LISTENING";
  const clean = (text || "").trim();
  s.partialText = clean;
  const now = Date.now();
  s.partialLastTs = now;
  const fp = clean ? fingerprint(clean) : "";
  if (!fp) {
    s.partialFingerprint = undefined;
    s.partialFingerprintCount = 0;
    s.partialFingerprintSinceTs = 0;
  } else if (s.partialFingerprint === fp) {
    s.partialFingerprintCount += 1;
  } else {
    s.partialFingerprint = fp;
    s.partialFingerprintCount = 1;
    s.partialFingerprintSinceTs = now;
  }
  pruneOld(meetingId);
}

export function addFinal(meetingId: string, text: string, ts = Date.now()): void {
  const clean = (text || "").trim();
  if (!clean) return;
  const s = getState(meetingId);
  s.phase = "CANDIDATE";
  s.finals.push({ text: clean, ts });
  if (s.finals.length > 30) s.finals = s.finals.slice(-30);
  // Finalized chunk supersedes any stale interim text from STT partials.
  s.partialText = "";
  s.partialFingerprint = undefined;
  s.partialFingerprintCount = 0;
  s.partialFingerprintSinceTs = 0;
  s.partialLastTs = ts;
  pruneOld(meetingId);
}

export function getSnapshot(meetingId: string, maxChars = 3000): string {
  const s = getState(meetingId);
  const parts: string[] = [];
  let total = 0;

  const partial = (s.partialText || "").trim();
  if (partial) {
    parts.unshift(partial);
    total += partial.length + 1;
  }

  for (let i = s.finals.length - 1; i >= 0; i--) {
    const t = (s.finals[i]?.text || "").trim();
    if (!t) continue;
    if (total + t.length + 1 > maxChars) break;
    parts.unshift(t);
    total += t.length + 1;
  }

  return parts.join(" ").trim();
}

export function getSnapshotFromCursor(meetingId: string, maxChars = 3000, lookback = 2): string {
  const s = getState(meetingId);
  const start = Math.max(0, s.lastAnsweredFinalIndex - lookback);
  const finalsPart = s.finals.slice(start).map((x) => x.text).join(" ");
  const combined = `${finalsPart} ${(s.partialText || "").trim()}`.trim();
  if (combined.length <= maxChars) return combined;
  return combined.slice(-maxChars);
}

export function advanceCursor(meetingId: string): void {
  const s = getState(meetingId);
  s.lastAnsweredFinalIndex = s.finals.length;
}

export function getRecentFinals(meetingId: string, n = 6): string[] {
  const s = getState(meetingId);
  return s.finals.slice(-n).map((f) => f.text);
}

export function addRecentQuestion(meetingId: string, clean: string): void {
  enqueueQuestion(meetingId, clean);
}

export function normalizeQuestionKey(clean: string): string {
  return normalizeForDedup(clean || "");
}

export function enqueueQuestion(
  meetingId: string,
  clean: string,
  ts = Date.now(),
  meta?: {
    windowHash?: string;
    answerability?: QuestionAnswerability;
    labels?: QuestionPatternLabel[];
  },
): void {
  const value = (clean || "").trim();
  if (!value) return;
  const norm = normalizeQuestionKey(value);
  if (!norm) return;
  if (meta?.answerability === "fragment" || meta?.answerability === "no_question") return;

  const s = getState(meetingId);
  let suppressedByExisting = false;
  let replacedAny = false;
  const existing = s.questionQueue.find((q) => {
    if (ts - q.ts > 120000) return false;
    if (q.norm === norm) return true;
    if (questionSupersedes(value, q.clean)) {
      replacedAny = true;
      return true;
    }
    if (questionSupersedes(q.clean, value)) {
      suppressedByExisting = true;
      return true;
    }
    return computeWordOverlap(q.norm, norm) > 0.82 || computeWordOverlap(norm, q.norm) > 0.82;
  });
  if (suppressedByExisting && existing) {
    existing.ts = ts;
    return;
  }
  if (existing) {
    existing.ts = ts;
    if (!existing.clean || existing.clean.length < value.length || replacedAny) {
      existing.clean = value;
      existing.norm = norm;
    }
    if (meta?.windowHash) existing.windowHash = meta.windowHash;
    if (meta?.answerability) existing.answerability = meta.answerability;
    if (meta?.labels?.length) existing.labels = meta.labels;
  } else {
    s.questionQueue.push({
      clean: value,
      norm,
      ts,
      windowHash: meta?.windowHash,
      answerability: meta?.answerability,
      labels: meta?.labels,
    });
    if (s.questionQueue.length > 100) s.questionQueue = s.questionQueue.slice(-100);
  }

  s.recentQuestions = s.questionQueue
    .slice(-20)
    .map((q) => ({ clean: q.clean, ts: q.ts }));

  pruneOld(meetingId);
}

export function setActiveQuestion(
  meetingId: string,
  clean: string,
  ts = Date.now(),
  meta?: {
    windowHash?: string;
    answerability?: QuestionAnswerability;
    labels?: QuestionPatternLabel[];
  },
): void {
  const value = (clean || "").trim();
  if (!value) return;
  const norm = normalizeQuestionKey(value);
  if (!norm) return;
  if (meta?.answerability === "fragment" || meta?.answerability === "no_question") return;

  const s = getState(meetingId);
  const existing = s.activeQuestion;
  if (!existing) {
    s.activeQuestion = {
      clean: value,
      norm,
      ts,
      windowHash: meta?.windowHash,
      answerability: meta?.answerability,
      labels: meta?.labels,
    };
    return;
  }

  const suppressIncoming =
    existing.norm === norm
    || questionSupersedes(existing.clean, value)
    || computeWordOverlap(existing.norm, norm) > 0.88
    || computeWordOverlap(norm, existing.norm) > 0.88;

  if (suppressIncoming && !questionSupersedes(value, existing.clean)) {
    existing.ts = Math.max(existing.ts, ts);
    if (meta?.windowHash) existing.windowHash = meta.windowHash;
    if (meta?.labels?.length) existing.labels = meta.labels;
    if (meta?.answerability) existing.answerability = meta.answerability;
    return;
  }

  s.activeQuestion = {
    clean: value,
    norm,
    ts,
    windowHash: meta?.windowHash,
    answerability: meta?.answerability,
    labels: meta?.labels,
    answeredTs: questionSupersedes(value, existing.clean) ? undefined : existing.answeredTs,
  };
}

export function getActiveQuestion(
  meetingId: string,
): { clean: string; norm: string; ts: number; windowHash?: string; labels?: QuestionPatternLabel[] } | null {
  const active = getState(meetingId).activeQuestion;
  if (!active?.clean) return null;
  return {
    clean: active.clean,
    norm: active.norm,
    ts: active.ts,
    windowHash: active.windowHash,
    labels: active.labels,
  };
}

export function getRecentQuestions(meetingId: string, limit = 10): Array<{ clean: string; ts: number }> {
  const s = getState(meetingId);
  const unanswered = s.questionQueue.filter((q) => !q.answeredTs).sort((a, b) => b.ts - a.ts);
  return unanswered.slice(0, limit).map((q) => ({ clean: q.clean, ts: q.ts }));
}

export function getUnanswered(
  meetingId: string,
  max = 5,
): Array<{ clean: string; norm: string; ts: number }> {
  const s = getState(meetingId);
  return s.questionQueue
    .filter((q) => !q.answeredTs)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, max)
    .map((q) => ({ clean: q.clean, norm: q.norm, ts: q.ts }));
}

export function markAnswered(
  meetingId: string,
  norms: string[],
  answeredTs = Date.now(),
): void {
  if (!norms.length) return;
  const normSet = new Set(norms);
  const s = getState(meetingId);
  for (const item of s.questionQueue) {
    const matched = normSet.has(item.norm)
      || norms.some((norm) => questionSupersedes(norm, item.norm) || questionSupersedes(item.norm, norm))
      || norms.some((norm) => computeWordOverlap(item.norm, norm) > 0.82 || computeWordOverlap(norm, item.norm) > 0.82);
    if (matched) {
      item.answeredTs = answeredTs;
    }
  }
  const active = s.activeQuestion;
  if (active) {
    const matched = normSet.has(active.norm)
      || norms.some((norm) => questionSupersedes(norm, active.clean) || questionSupersedes(active.clean, norm))
      || norms.some((norm) => computeWordOverlap(active.norm, norm) > 0.82 || computeWordOverlap(norm, active.norm) > 0.82);
    if (matched) active.answeredTs = answeredTs;
  }
}

export function expireOldUnanswered(
  meetingId: string,
  olderThanMs = 45000,
  now = Date.now(),
): void {
  const s = getState(meetingId);
  for (const item of s.questionQueue) {
    if (!item.answeredTs && now - item.ts > olderThanMs) {
      item.answeredTs = now;
    }
  }
}

export function setLastAnsweredWindowHash(meetingId: string, windowHash: string): void {
  const s = getState(meetingId);
  s.lastAnsweredWindowHash = String(windowHash || "").trim() || undefined;
}

export function isDuplicateAction(meetingId: string, key: string, windowMs = 12000): boolean {
  const s = getState(meetingId);
  const now = Date.now();
  s.recentActionKeys = s.recentActionKeys.filter((x) => now - x.ts <= windowMs);
  if (s.recentActionKeys.some((x) => x.key === key)) return true;
  s.recentActionKeys.push({ key, ts: now });
  return false;
}

export function incrementSuppression(meetingId: string, reason: string): void {
  const s = getState(meetingId);
  s.suppressions[reason] = (s.suppressions[reason] || 0) + 1;
  console.log(`[orchestrator][suppress] meeting=${meetingId} reason=${reason} count=${s.suppressions[reason]}`);
}

export function canAutoTrigger(meetingId: string, now = Date.now(), windowMs = 5000): boolean {
  const s = getState(meetingId);
  if (!s.lastAutoTriggerAt) return true;
  return (now - s.lastAutoTriggerAt) >= windowMs;
}

export function markTriggered(
  meetingId: string,
  fp: string,
  source: "partial" | "final" | "manual",
  now = Date.now(),
): void {
  const s = getState(meetingId);
  s.lastTriggerAt = now;
  if (source !== "manual") s.lastAutoTriggerAt = now;
  if (fp) {
    s.recentAskedFingerprints = [{ fp, ts: now }, ...s.recentAskedFingerprints.filter((x) => x.fp !== fp)].slice(0, 20);
  }
}

export function isRecentFingerprintDuplicate(
  meetingId: string,
  fp: string,
  threshold = 0.85,
  windowMs = 12000,
): boolean {
  if (!fp) return false;
  const s = getState(meetingId);
  const now = Date.now();
  for (const item of s.recentAskedFingerprints) {
    if (now - item.ts > windowMs) continue;
    if (item.fp === fp) return true;
    const sim = levenshteinSimilarity(item.fp, fp);
    if (sim >= threshold) return true;
  }
  return false;
}

export function setRecentAnswer(
  meetingId: string,
  key: string,
  question: string,
  answer: string,
  responseId?: string,
  ts = Date.now(),
): void {
  if (!key || !answer.trim()) return;
  const s = getState(meetingId);
  const existing = s.recentAnswers.find((x) => x.key === key);
  if (existing) {
    existing.answer = answer;
    existing.question = question;
    existing.ts = ts;
    if (responseId) existing.responseId = responseId;
  } else {
    s.recentAnswers.push({ key, question, answer, ts, responseId });
    if (s.recentAnswers.length > 40) s.recentAnswers = s.recentAnswers.slice(-40);
  }
  s.lastAnswerAt = ts;
  s.phase = "DONE";
}

export function getRecentAnswer(
  meetingId: string,
  key: string,
  windowMs = 15000,
): { key: string; question: string; answer: string; ts: number; responseId?: string } | null {
  if (!key) return null;
  const s = getState(meetingId);
  const now = Date.now();
  const found = s.recentAnswers.find((x) => x.key === key && now - x.ts <= windowMs);
  return found || null;
}

export function getAnswerStyle(meetingId: string): AnswerStyle {
  const s = getState(meetingId);
  return s.answerStyle || "standard";
}

export function setAnswerStyle(meetingId: string, style: AnswerStyle): AnswerStyle {
  const s = getState(meetingId);
  s.answerStyle = style;
  return s.answerStyle;
}

export function setCodeContext(
  meetingId: string,
  next: { question?: string; answer?: string; capturedAt?: number },
): void {
  const s = getState(meetingId);
  const current = s.codeContext;
  const nextAnswer = String(next.answer || "").trim();
  const nextQuestion = String(next.question || "").trim();
  const nextCapturedAt = Number(next.capturedAt || Date.now());

  if (current?.latestAnswer && nextAnswer && current.latestAnswer !== nextAnswer) {
    s.codeContext = {
      previousAnswer: current.latestAnswer,
      previousCapturedAt: current.latestCapturedAt,
      latestAnswer: nextAnswer,
      latestQuestion: nextQuestion,
      latestCapturedAt: nextCapturedAt,
    };
    return;
  }

  s.codeContext = {
    previousAnswer: current?.previousAnswer,
    previousCapturedAt: current?.previousCapturedAt,
    latestAnswer: nextAnswer || current?.latestAnswer,
    latestQuestion: nextQuestion || current?.latestQuestion,
    latestCapturedAt: nextCapturedAt || current?.latestCapturedAt,
  };
}

export function getCodeContext(meetingId: string): MeetingState["codeContext"] {
  return getState(meetingId).codeContext;
}

export function pruneOld(meetingId: string): void {
  const s = getState(meetingId);
  const now = Date.now();
  s.finals = s.finals.filter((x) => now - x.ts <= 60000);
  if (s.lastAnsweredFinalIndex > s.finals.length) {
    s.lastAnsweredFinalIndex = s.finals.length;
  }
  s.questionQueue = s.questionQueue.filter((x) => now - x.ts <= 30 * 60 * 1000);
  s.recentQuestions = s.questionQueue.slice(-20).map((q) => ({ clean: q.clean, ts: q.ts }));
  s.recentActionKeys = s.recentActionKeys.filter((x) => now - x.ts <= 60000);
  s.recentAnswers = s.recentAnswers.filter((x) => now - x.ts <= 60000);
  s.recentAskedFingerprints = s.recentAskedFingerprints.filter((x) => now - x.ts <= 60000);
  if (s.activeQuestion && now - s.activeQuestion.ts > 30 * 60 * 1000) {
    s.activeQuestion = undefined;
  }

  // Soft cleanup for stale partial noise
  if (s.partialText && normalizeForDedup(s.partialText).length === 0) {
    s.partialText = "";
  }
}

export function getMeetingStore(): Map<string, MeetingState> {
  return store;
}
