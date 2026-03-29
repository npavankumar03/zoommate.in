import { WebSocket, WebSocketServer } from "ws";
import type { Server, IncomingMessage } from "http";
import { URL } from "url";
import { storage } from "../storage";
import { streamAssistantAnswer, abortSessionStream, hasActiveStream } from "../assist/streamAssistantAnswer";
import { getLastUnansweredInterviewerQuestion, getLatestSpokenReply, markInterviewerQuestionAnswered, recordUserQuestion, getCodingProblemState, buildInterviewerIntelligenceBlock } from "../assist/sessionState";
import {
  getState as getMeetingState,
  getSnapshotFromCursor,
  advanceCursor,
  markAnswered as markAnsweredInStore,
  normalizeQuestionKey,
  getActiveQuestion,
  setActiveQuestion,
  getUnanswered as getUnansweredInStore,
  setLastAnsweredWindowHash,
} from "./meetingStore";
import {
  detectQuestion,
  extractQuestionFromSegment,
  buildQuestionWindowHash,
  likelyContainsQuestion,
  levenshteinSimilarity,
  normalizeQuestionForSimilarity,
  normalizeText,
  questionSupersedes,
  resolveActiveQuestionWindow,
} from "@shared/questionDetection";
import { getRefineConfig, buildRefineContext } from "../assist/refinePass";
import { parseResponse } from "../assist/responseParser";
import { streamLLM, resolveAutomaticInterviewModel } from "../llmRouter2";
import { buildTier0Prompt } from "../prompt";
import type { Meeting } from "@shared/schema";

// ── Speculative answer buffer ─────────────────────────────────────────────────
interface SpeculativeEntry {
  question: string;
  norm: string;
  chunks: string[];
  done: boolean;
  ts: number;
  abortCtrl: AbortController;
  // Set when a question handler adopts an in-progress stream
  onChunk?: (chunk: string) => void;
  onDone?: () => void;
}
const speculativeStreams = new Map<string, SpeculativeEntry>();

function buildSpeculativePrompt(question: string, meeting: Meeting | null, sessionId: string): string {
  const format = (meeting?.responseFormat === "custom" ? "concise" : meeting?.responseFormat) || "concise";
  const meetingType = meeting?.type || "interview";
  const tier0 = buildTier0Prompt(format, meetingType);
  const intel = buildInterviewerIntelligenceBlock(sessionId, question, 3);
  const instructions = meeting?.customInstructions
    ? `Custom instructions: ${String(meeting.customInstructions).slice(0, 800)}`
    : "";
  return [tier0, instructions, intel].filter(Boolean).join("\n\n");
}

async function runSpeculativeStream(sessionId: string, question: string, meeting: Meeting | null): Promise<void> {
  const existing = speculativeStreams.get(sessionId);
  if (existing) {
    const norm = normalizeQuestionForSimilarity(question);
    const existingSimilarity = norm ? levenshteinSimilarity(existing.norm, norm) : 0;
    if (existingSimilarity >= 0.80 && !existing.done) {
      // Close enough — keep the existing stream running so chunks keep accumulating.
      // Do NOT update existing.norm: the Enter similarity check must compare against
      // what speculative was actually generated for (the original fragment), not the
      // final question. If the norm were updated to the final question, Enter would
      // always get similarity≈1.0 and replay a wrong fragment-based answer.
      console.log(`[speculative] reuse_existing sessionId=${sessionId} similarity=${existingSimilarity.toFixed(2)} chunks=${existing.chunks.length}`);
      return;
    }
    existing.abortCtrl.abort();
    speculativeStreams.delete(sessionId);
  }
  const norm = normalizeQuestionForSimilarity(question);
  if (!norm) return;
  const abortCtrl = new AbortController();
  const entry: SpeculativeEntry = { question, norm, chunks: [], done: false, ts: Date.now(), abortCtrl };
  speculativeStreams.set(sessionId, entry);

  try {
    const systemPrompt = buildSpeculativePrompt(question, meeting, sessionId);
    const model = (meeting?.model && meeting.model !== "automatic")
      ? meeting.model
      : resolveAutomaticInterviewModel(question, { sessionMode: (meeting as any)?.sessionMode });
    const isCodeQuestion = /\b(write|implement|build|create|code|function|class|algorithm|program|script|def |solution)\b/i.test(question);
    const speculativeMaxTokens = isCodeQuestion ? 1200 : 320;
    const generator = streamLLM(
      "LIVE_INTERVIEW_ANSWER",
      systemPrompt,
      question,
      sessionId,
      { maxTokens: speculativeMaxTokens, model, cacheUserId: meeting?.userId },
      abortCtrl.signal,
    );
    for await (const chunk of generator) {
      if (!chunk) continue;
      if (speculativeStreams.get(sessionId) !== entry) break; // evicted
      entry.chunks.push(chunk);
      entry.onChunk?.(chunk); // deliver live to adopted consumer if any
    }
    entry.done = true;
    entry.onDone?.(); // signal completion to adopted consumer
  } catch {
    // best-effort only
  }
}

interface AnswerSession {
  ws: WebSocket;
  userId: string;
  sessionId: string;
  requestId: string;
}

// Known substantive follow-up phrases — keep these answerable/anchorable, but
// do not treat generic acknowledgements like "okay" or "yeah" as follow-ups.
const KNOWN_FOLLOWUP_RE = /^(why|how so|how come|how|what about(?:\s+\w.*)?|elaborate|explain|tell me more|go on|continue|and then|what next|what else|can you explain|can you elaborate|give me an example|show me|keep going|proceed|expand|clarify|summarize|repeat|example|further|detail|go ahead|dive deeper|dig deeper|break it down|zoom in|say more|one more|more detail)\??$/i;
const STRICT_ANCHORABLE_FOLLOWUP_RE = /^(why|how so|how come|how|elaborate|explain|tell me more|go on|continue|expand|clarify|what next|what else|more detail|give me an example|show me|keep going|proceed|summarize|repeat|example|further|detail|go ahead|dive deeper|dig deeper|break it down|zoom in|say more|one more|what about(?:\s+\w.*)?|how about(?:\s+\w.*)?)\??$/i;
const CONNECTOR_PREFIX_RE = /^(and\s+also|and|also|plus|as\s+well\s+as|or)\s+/i;
const PERSONAL_OR_BEHAVIORAL_Q_RE = /\b(yourself|tell me about|time when|situation|challenge|strength|weakness|career|background|hobby)\b/i;
const TOPIC_APPENDABLE_Q_RE = /\b(experience|worked with|worked on|used|use|familiar with|comfortable with|background in|knowledge of|exposure to|skills?|stack|technolog(?:y|ies)|tools?)\b/i;

// Detects incomplete questions that end with a dangling preposition/article (sentence cut off mid-ask)
function isDanglingStub(q: string): boolean {
  const words = q.split(" ").filter(Boolean);
  if (words.length > 12) return false; // long enough to be real
  if (q.includes("?")) return false;   // has question mark = complete enough
  return /\b(in|with|at|for|on|about|of|from|to|by|and|or|the|a|an|any|some|your|our|their|its|this|that|these|those)\s*$/.test(q);
}

function extractSharedQuestionCandidate(text: string): string {
  return extractQuestionFromSegment(String(text || "")) || "";
}

function hasSharedQuestionSignal(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) return false;
  return detectQuestion(raw) || likelyContainsQuestion(raw) || Boolean(extractSharedQuestionCandidate(raw));
}

function isVagueQuestion(text: string): boolean {
  const q = normalizeText(String(text || ""));
  if (!q) return true;
  if (KNOWN_FOLLOWUP_RE.test(q)) return false;
  const extracted = extractSharedQuestionCandidate(text);
  if (extracted && !isDanglingStub(normalizeText(extracted))) return false;
  const words = q.split(" ").filter(Boolean);
  if (words.length <= 1 && !q.includes("?")) return true;
  // Partial/cut-off question stubs — interviewer didn't finish speaking
  if (isDanglingStub(q)) return true;
  if (hasSharedQuestionSignal(text) && words.length >= 2) return false;
  if (/^(do you have experience|do you have experience in|have you worked on|tell me about)\??$/.test(q)) return true;
  return false;
}

function looksLikeInterviewNoise(text: string): boolean {
  const q = normalizeText(String(text || ""));
  if (!q) return true;
  // Known follow-ups are never noise
  if (KNOWN_FOLLOWUP_RE.test(q)) return false;
  if (KNOWN_TECH_TERM_RE.test(q.trim())) return false;
  if (hasSharedQuestionSignal(text)) return false;
  const words = q.split(" ").filter(Boolean);
  if (words.length < 2 && !q.includes("?")) return true;

  const hasInterviewCue = /\b(experience|project|api|apis|react|python|fastapi|fast api|fast apis|django|backend|frontend|system|design|challenge|work|role|aws|azure|gcp|cloud|kubernetes|docker|microservice|database|sql|nosql|java|typescript|golang|rust|spring|node|angular|vue)\b/.test(q);
  const hasFollowUpCue = /^(show me|keep going|one more|go on|go ahead|tell me more|explain more|elaborate more|more detail|what else|what next|and then|say more|dive deeper|dig deeper|expand on|break it down|walk me through that)\b/.test(q);
  if (!hasInterviewCue && !hasFollowUpCue && words.length <= 12) return true;

  const randomNoisePattern = /\b(call mum|road closed|downtown|island|laguna|nokia)\b/;
  if (randomNoisePattern.test(q) && !hasInterviewCue) return true;

  return false;
}

function chooseBestQuestionSeed(candidates: Array<string | undefined | null>): string {
  const cleaned = candidates
    .map((c) => String(c || "").trim())
    .filter(Boolean)
    .map((text) => extractSharedQuestionCandidate(text) || text)
    .filter((text) => !looksLikeInterviewNoise(text));
  if (!cleaned.length) return "[Continue]";

  const scored = cleaned.map((text, idx) => {
    const vague = isVagueQuestion(text);
    const hasQuestionMark = text.includes("?");
    const sharedSignal = hasSharedQuestionSignal(text);
    const score = (vague ? 0 : 1000) + (sharedSignal ? 120 : 0) + (hasQuestionMark ? 80 : 0) + Math.min(text.length, 400) - idx;
    return { text, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].text;
}

function extractLatestMergedSegment(raw: string): string {
  const text = String(raw || "").trim();
  if (!text) return "";
  const parts = text
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return text;

  // Prefer last explicit question-like segment.
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    const extracted = extractSharedQuestionCandidate(p);
    if (extracted) return extracted;
    if (hasSharedQuestionSignal(p)) {
      return p;
    }
  }
  return parts[parts.length - 1];
}

// Tech terms that alone constitute a valid implicit interview question
const KNOWN_TECH_TERM_RE = /^(flask|django|fastapi|react|angular|vue|python|java|javascript|typescript|nodejs|node\.?js|aws|azure|gcp|docker|kubernetes|redis|kafka|mongodb|postgres|postgresql|mysql|spring|terraform|ansible|graphql|microservices?|devops|git|linux|bash|celery|rabbitmq|elasticsearch|nginx|jenkins|airflow|spark|hadoop|pandas|numpy|pytorch|tensorflow|scikit|langchain|openai|llm|rag|pinecone|weaviate|next\.?js|tailwind|redux|webpack|vite|jest|pytest|junit|maven|gradle|intellij|pycharm|jupyter|postman|jira|confluence|bitbucket|github|gitlab|agile|scrum|kanban|ci.?cd|rest|soap|grpc|jwt|oauth|saml|ldap|ssl|tls|tcp|http|websocket|sql|nosql|orm|crud|solid|mvp|mvc|mvvm|tdd|bdd|ddd|design pattern|system design|data structure|algorithm|leetcode|hackerrank)s?\b$/i;

function looksLikeNoiseSegment(text: string): boolean {
  const q = normalizeText(String(text || ""));
  if (!q) return true;
  if (KNOWN_FOLLOWUP_RE.test(q)) return false;
  // Known tech terms alone are never noise — treat as implicit "do you have experience in X"
  if (KNOWN_TECH_TERM_RE.test(q.trim())) return false;
  if (hasSharedQuestionSignal(text)) return false;
  const words = q.split(" ").filter(Boolean);
  if (words.length <= 1 && !q.includes("?")) return true;

  // Hard noise patterns — background audio, accidental activations
  if (/\b(hey cortana|hey siri|ok google|alexa|open internet explorer|call mom|call dad|call mum|play music|road closed|downtown|laguna|nokia|mumbai|sundar pichai|breaking news|weather today|stock market)\b/.test(q)) return true;

  // Pure filler with no substance
  const fillerOnly = /^(um+|uh+|hmm+|ah+|oh+|er+|so+|like|okay|ok|yeah|yes|no|right|sure|well|alright|got it|i see|mhm|mm+|yep|nope)\s*$/.test(q);
  if (fillerOnly) return true;

  // Repetitive single-word noise (e.g. "the the the" or "and and and")
  const uniqueWords = new Set(words);
  if (uniqueWords.size === 1 && words.length > 1) return true;

  // Interview cue — must be a meaningful tech/interview term, not just any common word
  const hasInterviewCue = /\b(experience|react|python|fastapi|flask|django|api|apis|project|worked|aws|azure|gcp|cloud|kubernetes|docker|microservice|database|sql|nosql|java|typescript|golang|spring|node|angular|vue|devops|agile|scrum|architecture|system design|algorithm|data structure|machine learning|ci cd|deployment|testing|optimization)\b/.test(q);

  // Short segments (≤6 words) with no question cue AND no interview cue → noise
  if (!hasInterviewCue && words.length <= 6) return true;

  // Medium segments (7–12 words) also need at least one signal
  if (!hasInterviewCue && words.length <= 12) return true;

  return false;
}

function normalizeQuestionFragment(text: string): string {
  return String(text || "").toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
}

function isBehavioralOrPersonalQuestion(question: string): boolean {
  return PERSONAL_OR_BEHAVIORAL_Q_RE.test(question);
}

function isTopicAppendableQuestion(question: string): boolean {
  if (!question) return false;
  if (isBehavioralOrPersonalQuestion(question)) return false;
  return TOPIC_APPENDABLE_Q_RE.test(question) || /\b(do|does|did|have|has|are|is|can|could|would)\s+you\b/i.test(question);
}

function isSafeTopicTail(fragment: string): boolean {
  const normalized = normalizeQuestionFragment(fragment);
  if (!normalized) return false;
  if (looksLikeInterviewNoise(fragment) || isDanglingStub(normalized)) return false;

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 5) return false;

  if (KNOWN_TECH_TERM_RE.test(normalized)) return true;
  return /\b(api|backend|frontend|cloud|database|sql|nosql|devops|microservices?|system design|project|architecture|testing|security|scalability|performance)\b/i.test(normalized);
}

function extractStrictInterviewerQuestion(raw: string): string {
  const input = String(raw || "").trim();
  if (!input) return "";

  const normalized = input.replace(/\r\n/g, "\n");
  const segments = normalized
    .split(/\n+/)
    .flatMap((line) => line.split("|"))
    .map((s) => s.trim())
    .filter(Boolean);

  if (!segments.length) return "";

  let best = "";
  let bestScore = -1e9;
  for (let i = 0; i < segments.length; i++) {
    let s = segments[i];
    const isInterviewerLine = /^interviewer\s*:/i.test(s);
    const isCandidateLine = /^candidate\s*:/i.test(s);
    if (isCandidateLine) continue;
    s = s.replace(/^interviewer\s*:\s*/i, "").trim();
    if (!s) continue;
    const extracted = extractSharedQuestionCandidate(s);
    const candidate = extracted || s;
    if (looksLikeNoiseSegment(candidate)) continue;

    const q = normalizeText(candidate);
    const words = q.split(" ").filter(Boolean).length;
    const hasQMark = candidate.includes("?");
    const hasQuestionSignal = detectQuestion(candidate) || likelyContainsQuestion(candidate) || Boolean(extracted);
    const directWhDefinition = /^(what is|what's|define|explain)\b/.test(q);
    const hasInterviewCue = /\b(experience|project|worked|role|responsibility|domain|process|stakeholder|analysis|business|technical|start date|end date|month|year)\b/.test(q);
    const qTokens = q.split(/\s+/).filter((w) => w.length >= 4);
    const uniqueTokenCount = new Set(qTokens).size;
    const hasCompoundJoiner = /\b(and|also|as well as)\b/.test(q);
    const punctuationSplitCount = candidate.split(/[?,]/).map((p) => p.trim()).filter(Boolean).length;
    const multiClauseBonus = punctuationSplitCount >= 2 ? Math.min(40, (punctuationSplitCount - 1) * 12) : 0;
    const partialStub = /^(when did you|do you have|what was your|have you worked with|tell me about)\s*$/.test(q)
      || isDanglingStub(q);

    // #6: candidate self-talk penalty — these patterns are almost never interviewer questions
    const isCandidateSelfTalk = /^(i have|i worked|i built|i implemented|i used|i developed|i created|i led|i managed|in my experience|at my previous|at my last|we built|we used|we implemented|my role|my project|my team|my experience)\b/.test(q);
    // #8: cased tech term boost — post-ASR correction, cased terms signal real interview content
    const hasCasedTechTerm = /\b(AWS|Azure|GCP|React|Python|Java|TypeScript|Docker|Kubernetes|Redis|Kafka|Flask|Django|FastAPI|GraphQL|PostgreSQL|MongoDB|Spring|Terraform|Ansible|Jenkins|Node\.?js|Angular|Vue)\b/.test(candidate);
    // #3: standalone tech entity — 1-3 word segment with just a tech name = implicit "tell me about X"
    const isImplicitTechQuestion = words <= 3 && hasCasedTechTerm && !isCandidateSelfTalk;

    let score = 0;
    score += hasQMark ? 80 : 0;
    score += hasQuestionSignal ? 60 : 0;
    score += (directWhDefinition && words >= 3 && words <= 8) ? 85 : 0;
    score += hasInterviewCue ? 35 : 0;
    score += Math.min(50, Math.floor(uniqueTokenCount / 2) * 6);
    score += (hasCompoundJoiner && words >= 6) ? 30 : 0;
    score += multiClauseBonus;
    score += isInterviewerLine ? 40 : 0;
    score += Math.max(0, 30 - Math.abs(words - 14));
    score += i * 8; // stronger recency bias: later segments are newer
    score += hasCasedTechTerm ? 25 : 0; // #8: cased tech term boost
    score += isImplicitTechQuestion ? 60 : 0; // #3: standalone tech entity = implicit question
    score -= partialStub ? 120 : 0;
    score -= isCandidateSelfTalk ? 150 : 0; // #6: penalise candidate self-talk heavily
    // Keep short direct questions (e.g. "what is mvcc?") from getting buried.
    const isKnownFollowUpPhrase = KNOWN_FOLLOWUP_RE.test(q) || /^(elaborate|explain|show me|tell me more|go on|keep going|more detail|give an example|can you expand|can you clarify|walk me through that|break it down|expand on that|zoom in|dig deeper)\b/i.test(q);
    if (words <= 3 && !(hasQMark || hasQuestionSignal) && !isKnownFollowUpPhrase && !isImplicitTechQuestion) score -= 80;
    if (words <= 2 && !hasQMark && !isKnownFollowUpPhrase && !isImplicitTechQuestion) score -= 50;

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  // Reject the best candidate if it's still a dangling stub — return "" so the caller
  // falls back to the last unanswered interviewer question instead.
  if (best && isDanglingStub(normalizeText(best))) {
    return "";
  }
  if (best) {
    // Expand standalone tech term to a full question so the LLM has clear intent
    const bestNorm = normalizeText(best).replace(/\?/g, "").trim();
    if (KNOWN_TECH_TERM_RE.test(bestNorm)) {
      return `Do you have experience in ${best}?`;
    }
    return best;
  }

  // Fallback 1: latest explicit question-like segment.
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i].replace(/^interviewer\s*:\s*/i, "").trim();
    const candidate = extractSharedQuestionCandidate(s) || s;
    if (!candidate || looksLikeNoiseSegment(candidate)) continue;
    const q = normalizeText(candidate);
    if (isDanglingStub(q)) continue; // skip dangling stubs in fallback too
    if (hasSharedQuestionSignal(candidate)) {
      return candidate;
    }
  }

  // Fallback 2: latest non-noise segment.
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i].replace(/^interviewer\s*:\s*/i, "").trim();
    const candidate = extractSharedQuestionCandidate(s) || s;
    if (!candidate || looksLikeNoiseSegment(candidate)) continue;
    return candidate;
  }

  return "";
}

function safeSend(ws: WebSocket, payload: unknown) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch (err: any) {
    console.error("[ws/answer] send failed:", err.message);
  }
}

function getUnansweredBackendQuestions(sessionId: string, maxItems = 3, maxAgeMs = 90_000): string[] {
  const now = Date.now();
  const seen = new Set<string>();
  return getUnansweredInStore(sessionId, maxItems * 3)
    .filter((item) => (now - item.ts) <= maxAgeMs)
    .slice()
    .sort((a, b) => b.ts - a.ts)
    .map((item) => String(item.clean || "").trim())
    .filter(Boolean)
    .filter((question) => {
      const norm = normalizeQuestionForSimilarity(question);
      if (!norm || seen.has(norm)) return false;
      seen.add(norm);
      return true;
    })
    .slice(0, maxItems);
}

function buildQueuedQuestionPrompt(questions: string[]): string {
  if (questions.length <= 1) return questions[0] || "";
  return `Answer these interviewer questions separately in order:\n${questions.map((question, index) => `${index + 1}. ${question}`).join("\n")}`;
}

type EnterWindowResolution = {
  prompt: string;
  displayQuestion: string;
  answeredQuestions: string[];
  questionNorms: string[];
  advanceCursorOnSuccess: boolean;
  windowHash: string;
  reusedPreviousQuestion: boolean;
  reason?: "cooldown" | "no_active_question" | "insufficient_context";
};

const GENERATE_COOLDOWN_MS = 5000;

async function resolveEnterWindowQuestion(
  sessionId: string,
  audioMode: "mic" | "system",
  fallbackText = "",
  liveTranscript = "",
): Promise<EnterWindowResolution> {
  const state = getMeetingState(sessionId);
  const now = Date.now();
  const hasPendingTranscript = state.finals.length > state.lastAnsweredFinalIndex || Boolean((state.partialText || "").trim());
  const snapshotText = hasPendingTranscript ? getSnapshotFromCursor(sessionId, 3000, 0) : "";
  const fallbackTranscript = String(liveTranscript || "").trim();
  const windowSource = snapshotText || fallbackTranscript;
  const currentWindowHash = buildQuestionWindowHash(windowSource);
  const previousQuestion =
    getActiveQuestion(sessionId)?.clean
    || state.lastPrompt
    || getLastUnansweredInterviewerQuestion(sessionId)?.text
    || fallbackText.trim();

  if (windowSource) {
    const framedWindow = resolveActiveQuestionWindow(windowSource, { previousQuestion });
    if (framedWindow.answerability === "complete" && framedWindow.questions.length > 0) {
      const activeQuestion = getActiveQuestion(sessionId);
      const activeSupersedesWindow = Boolean(
        activeQuestion?.clean
        && framedWindow.cleanQuestion
        && questionSupersedes(activeQuestion.clean, framedWindow.cleanQuestion),
      );
      const answeredQuestions = activeSupersedesWindow
        ? [String(activeQuestion?.clean || "").trim()].filter(Boolean)
        : framedWindow.questions.map((item) => item.text).filter(Boolean);
      const questionNorms = activeSupersedesWindow
        ? [String(activeQuestion?.norm || "").trim()].filter(Boolean)
        : framedWindow.questions.map((item) => item.norm).filter(Boolean);
      const displayQuestion = answeredQuestions.length > 1
        ? answeredQuestions.map((question, index) => `${index + 1}. ${question}`).join("\n")
        : (answeredQuestions[0] || framedWindow.cleanQuestion);
      const prompt = answeredQuestions.length > 1
        ? buildQueuedQuestionPrompt(answeredQuestions)
        : (answeredQuestions[0] || framedWindow.cleanQuestion);
      const repeatedWindow = Boolean(currentWindowHash && state.lastAnsweredWindowHash && currentWindowHash === state.lastAnsweredWindowHash);
      if (repeatedWindow && state.lastAnswerAt && (now - state.lastAnswerAt) < GENERATE_COOLDOWN_MS) {
        return {
          prompt: "",
          displayQuestion: "",
          answeredQuestions: [],
          questionNorms: [],
          advanceCursorOnSuccess: false,
          windowHash: currentWindowHash,
          reusedPreviousQuestion: false,
          reason: "cooldown",
        };
      }
      return {
        prompt,
        displayQuestion,
        answeredQuestions,
        questionNorms,
        advanceCursorOnSuccess: true,
        windowHash: activeQuestion?.windowHash || currentWindowHash,
        reusedPreviousQuestion: false,
      };
    }
    if (currentWindowHash && state.lastAnsweredWindowHash && currentWindowHash === state.lastAnsweredWindowHash && previousQuestion) {
      if (state.lastAnswerAt && (now - state.lastAnswerAt) < GENERATE_COOLDOWN_MS) {
        return {
          prompt: "",
          displayQuestion: "",
          answeredQuestions: [],
          questionNorms: [],
          advanceCursorOnSuccess: false,
          windowHash: currentWindowHash,
          reusedPreviousQuestion: false,
          reason: "cooldown",
        };
      }
      return {
        prompt: previousQuestion,
        displayQuestion: previousQuestion,
        answeredQuestions: [],
        questionNorms: [],
        advanceCursorOnSuccess: false,
        windowHash: currentWindowHash,
        reusedPreviousQuestion: true,
      };
    }

    return {
      prompt: "",
      displayQuestion: "",
      answeredQuestions: [],
      questionNorms: [],
      advanceCursorOnSuccess: false,
      windowHash: currentWindowHash,
      reusedPreviousQuestion: false,
      reason: "insufficient_context",
    };
  }

  const fallbackQuestion = previousQuestion || "";

  if (fallbackQuestion) {
    if (state.lastAnswerAt && (now - state.lastAnswerAt) < GENERATE_COOLDOWN_MS) {
      return {
        prompt: "",
        displayQuestion: "",
        answeredQuestions: [],
        questionNorms: [],
        advanceCursorOnSuccess: false,
        windowHash: state.lastAnsweredWindowHash || buildQuestionWindowHash(fallbackQuestion),
        reusedPreviousQuestion: false,
        reason: "cooldown",
      };
    }
    return {
      prompt: fallbackQuestion,
      displayQuestion: fallbackQuestion,
      answeredQuestions: [],
      questionNorms: [],
      advanceCursorOnSuccess: false,
      windowHash: state.lastAnsweredWindowHash || buildQuestionWindowHash(fallbackQuestion),
      reusedPreviousQuestion: true,
    };
  }

  return {
    prompt: "",
    displayQuestion: "",
    answeredQuestions: [],
    questionNorms: [],
    advanceCursorOnSuccess: false,
    windowHash: "",
    reusedPreviousQuestion: false,
    reason: "no_active_question",
  };
}

async function resolveUserId(req: IncomingMessage): Promise<string> {
  try {
    const cookieHeader = req.headers.cookie || "";
    const sessionMatch = cookieHeader.match(/connect\.sid=([^;]+)/);
    if (!sessionMatch) return "";
    const sid = decodeURIComponent(sessionMatch[1]);
    const rawSid = sid.startsWith("s:") ? sid.slice(2).split(".")[0] : sid;
    const { pool } = await import("../db");
    const result = await pool.query("SELECT sess FROM session WHERE sid = $1", [rawSid]);
    if (result.rows.length === 0) return "";
    const sess = typeof result.rows[0].sess === "string" ? JSON.parse(result.rows[0].sess) : result.rows[0].sess;
    return sess.userId || "";
  } catch {
    return "";
  }
}


export function setupWsAnswer(httpServer: Server): void {
  const wss = new WebSocketServer({ noServer: true });
  const activeBySession = new Map<string, AnswerSession>();
  const recentQuestionFingerprints = new Map<string, Array<{ fp: string; ts: number }>>();
  const lastQuestionBySession = new Map<string, string>(); // for continuation stitching

  const TECH_TOKEN_RE = /\b(react|python|java|javascript|typescript|aws|azure|gcp|docker|kubernetes|redis|kafka|flask|django|fastapi|sql|nosql|mongodb|postgres|spring|node|angular|vue|terraform|ansible|graphql|microservice|devops|agile|scrum|ci.?cd|git|linux|bash)\b/gi;
  const extractTechTokens = (s: string): Set<string> =>
    new Set((s.match(TECH_TOKEN_RE) || []).map((t) => t.toLowerCase()));

  // Tracks the last raw transcript submitted per session, so new interviewer speech always wins
  const lastRawTranscriptBySession = new Map<string, string>();

  const isRecentDuplicate = (sessionId: string, fingerprint: string, rawTranscript: string, now = Date.now()): boolean => {
    const list = recentQuestionFingerprints.get(sessionId) || [];
    const newTech = extractTechTokens(fingerprint);

    // If the raw transcript has changed since last submission, new interviewer content is present — always allow
    const lastRaw = lastRawTranscriptBySession.get(sessionId) || "";
    if (rawTranscript && rawTranscript !== lastRaw) return false;

    // Short-window exact dedup (12s) — only applies when transcript hasn't changed
    for (const item of list) {
      if ((now - item.ts) > 12000) continue;
      if (levenshteinSimilarity(fingerprint, item.fp) < 0.85) continue;
      // Same text fingerprint — but if tech topics are completely different, allow it through
      const oldTech = extractTechTokens(item.fp);
      if (newTech.size > 0 && oldTech.size > 0) {
        const overlap = [...newTech].filter((t) => oldTech.has(t)).length;
        if (overlap === 0) continue; // different topics — not a true duplicate
      }
      return true;
    }

    return false;
  };

  const rememberFingerprint = (sessionId: string, fingerprint: string, rawTranscript: string, now = Date.now()) => {
    const current = recentQuestionFingerprints.get(sessionId) || [];
    const next = [{ fp: fingerprint, ts: now }, ...current.filter((x) => x.fp !== fingerprint)]
      .filter((x, idx) => idx < 20 && (now - x.ts) <= 12000);
    recentQuestionFingerprints.set(sessionId, next);
    lastRawTranscriptBySession.set(sessionId, rawTranscript);
  };

  httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname !== "/ws") return;
    wss.handleUpgrade(req, socket as any, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    const userId = await resolveUserId(req);
    if (!userId) {
      ws.close(4001, "Not authenticated");
      return;
    }

    const socketState: {
      userId: string;
      sessionId: string;
      requestId: string;
      cachedMeeting: Meeting | null;
      cachedMeetingAt: number;
    } = { userId, sessionId: "", requestId: "", cachedMeeting: null, cachedMeetingAt: 0 };
    const MEETING_CACHE_TTL_MS = 30_000;

    const getCachedMeeting = async (sessionId: string): Promise<Meeting | null> => {
      const now = Date.now();
      if (socketState.cachedMeeting && (now - socketState.cachedMeetingAt) < MEETING_CACHE_TTL_MS) {
        return socketState.cachedMeeting;
      }
      const meeting = await storage.getMeeting(sessionId);
      if (meeting && meeting.userId === socketState.userId) {
        socketState.cachedMeeting = meeting;
        socketState.cachedMeetingAt = now;
      }
      return meeting ?? null;
    };

    ws.on("message", async (raw: Buffer | string) => {
      try {
        const text = typeof raw === "string" ? raw : raw.toString("utf8");
        const msg = JSON.parse(text);
        const type = String(msg?.type || "");

        if (type === "session_start") {
          const sessionId = String(msg?.sessionId || "").trim();
          if (!sessionId) {
            safeSend(ws, { type: "error", sessionId: "", requestId: "", message: "Missing sessionId" });
            return;
          }
          if (msg?.userId && String(msg.userId) !== userId) {
            safeSend(ws, { type: "error", sessionId, requestId: "", message: "Unauthorized userId" });
            return;
          }
          const meeting = await storage.getMeeting(sessionId);
          if (!meeting || meeting.userId !== userId) {
            safeSend(ws, { type: "error", sessionId, requestId: "", message: "Unauthorized session" });
            return;
          }
          socketState.sessionId = sessionId;
          socketState.cachedMeeting = meeting;
          socketState.cachedMeetingAt = Date.now();
          safeSend(ws, { type: "session_started", sessionId });
          return;
        }

        if (type === "cancel") {
          const sessionId = String(msg?.sessionId || socketState.sessionId || "").trim();
          if (!sessionId) return;
          abortSessionStream(sessionId);
          // Do NOT clear the speculative stream here — a new question message may immediately
          // follow this cancel and needs the pre-generated chunks for instant replay.
          return;
        }

        if (type === "speculative_question") {
          const sessionId = String(msg?.sessionId || socketState.sessionId || "").trim();
          const question = String(msg?.text || "").trim();
          if (!sessionId || !question) return;
          const meeting = await getCachedMeeting(sessionId);
          if (!meeting || meeting.userId !== userId) return;
          void runSpeculativeStream(sessionId, question, meeting);
          return;
        }

        if (type === "question") {
          const sessionId = String(msg?.sessionId || socketState.sessionId || "").trim();
          const rawQuestionText = String(msg?.text || "");
          const questionText = rawQuestionText.trim();
          const force = msg?.force === true;
          if (!sessionId) {
            safeSend(ws, { type: "error", sessionId, requestId: "", message: "Missing sessionId or text" });
            return;
          }

          const meeting = await getCachedMeeting(sessionId);
          if (!meeting || meeting.userId !== userId) {
            safeSend(ws, { type: "error", sessionId, requestId: "", message: "Unauthorized session" });
            return;
          }

          if (hasActiveStream(sessionId)) {
            console.log(`[ws/answer] replacing_active_stream sessionId=${sessionId} force=${force}`);
            abortSessionStream(sessionId);
          }

          const metadata = (msg?.metadata && typeof msg.metadata === "object") ? msg.metadata : {};
          const submitSource = typeof metadata.submitSource === "string" ? metadata.submitSource : "unknown";
          const multiQuestionMode = metadata.multiQuestionMode === true;
          const requestMode = typeof metadata.mode === "string" ? metadata.mode : "enter";
          const audioMode = metadata.audioMode === "mic" ? "mic" : "system";
          const useBackendEnterWindow = requestMode === "enter" && submitSource === "enter_window";
          const lastUnanswered = getLastUnansweredInterviewerQuestion(sessionId);
          const latestSpokenReply = getLatestSpokenReply(sessionId);
          let questionForStream = "";
          let displayQuestionForUi = "";
          let backendAnsweredQuestions: string[] = [];
          let backendQuestionNorms: string[] = [];
          let advanceBackendCursorOnSuccess = false;
          let queuedBackendQuestions: string[] = [];
          let resolvedWindowHash = "";
          let reusedPreviousQuestion = false;
          let enterIgnoredReason: EnterWindowResolution["reason"];

          if (useBackendEnterWindow) {
            const enterResolution = await resolveEnterWindowQuestion(
              sessionId,
              audioMode,
              questionText,
              typeof metadata?.liveTranscript === "string" ? metadata.liveTranscript : "",
            );
            questionForStream = enterResolution.prompt;
            displayQuestionForUi = enterResolution.displayQuestion;
            backendAnsweredQuestions = enterResolution.answeredQuestions.slice();
            backendQuestionNorms = enterResolution.questionNorms.slice();
            advanceBackendCursorOnSuccess = enterResolution.advanceCursorOnSuccess;
            queuedBackendQuestions = backendAnsweredQuestions.slice();
            resolvedWindowHash = enterResolution.windowHash;
            reusedPreviousQuestion = enterResolution.reusedPreviousQuestion;
            enterIgnoredReason = enterResolution.reason;
          } else {
            queuedBackendQuestions = requestMode === "enter" && submitSource !== "interpreted"
              ? getUnansweredBackendQuestions(sessionId, 3)
              : [];
            const primarySeed =
              (multiQuestionMode
                ? questionText.trim()
                : (extractStrictInterviewerQuestion(questionText.trim()) || extractLatestMergedSegment(questionText.trim())));
            questionForStream = primarySeed
              ? primarySeed
              : chooseBestQuestionSeed([lastUnanswered?.text, latestSpokenReply?.text, "[Continue]"]);
            backendAnsweredQuestions = queuedBackendQuestions.slice();
            if (queuedBackendQuestions.length > 0) {
              questionForStream = buildQueuedQuestionPrompt(queuedBackendQuestions);
              backendQuestionNorms = queuedBackendQuestions.map((question) => normalizeQuestionKey(question)).filter(Boolean);
              advanceBackendCursorOnSuccess = true;
            }
          }

          if (useBackendEnterWindow && !questionForStream.trim()) {
            safeSend(ws, {
              type: "request_ignored",
              sessionId,
              requestId: "",
              reason: enterIgnoredReason || "insufficient_context",
            });
            return;
          }

          const QUESTION_WORD_RE = /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|is|are|tell|walk|explain)\b/i;
          const normalizedQuestionForStream = normalizeQuestionFragment(questionForStream);

          // #1b: Only anchor genuine follow-up cues, not generic acknowledgements or every single-word fragment.
          const shouldAnchorShortFollowup =
            queuedBackendQuestions.length === 0 &&
            !KNOWN_TECH_TERM_RE.test(normalizedQuestionForStream)
            && STRICT_ANCHORABLE_FOLLOWUP_RE.test(questionForStream.trim());
          if (shouldAnchorShortFollowup) {
            const prevQ = lastQuestionBySession.get(sessionId);
            if (prevQ && prevQ !== "[Continue]") {
              questionForStream = `${questionForStream.trim()} (follow-up to: "${prevQ}")`;
              console.log(`[ws/answer] anchored_short_utterance sessionId=${sessionId}`, { expanded: questionForStream });
            }
          }

          // #2: Continuation stitching — only append onto prior questions when the previous
          // question is actually a topic-appendable one like experience/background/used-with.
          const connectorMatch = CONNECTOR_PREFIX_RE.exec(questionForStream);
          if (connectorMatch && queuedBackendQuestions.length === 0) {
            const tail = questionForStream.slice(connectorMatch[0].length).trim();
            const prevQ = lastQuestionBySession.get(sessionId);
            if (prevQ && prevQ !== "[Continue]" && isTopicAppendableQuestion(prevQ) && isSafeTopicTail(tail)) {
              const prevNoQ = prevQ.replace(/\?\s*$/, "").trim();
              questionForStream = `${prevNoQ} and also ${tail}?`;
              console.log(`[ws/answer] stitched continuation sessionId=${sessionId}`, { prevQ, tail, result: questionForStream });
            }
          }

          // #2b: Bare tech-topic stitching — only for appendable topic questions, not arbitrary prior asks.
          const bareTopicOnly =
            !connectorMatch
            && !QUESTION_WORD_RE.test(questionForStream.trim())
            && !questionForStream.includes("?")
            && questionForStream.trim().split(/\s+/).filter(Boolean).length <= 4;
          if (bareTopicOnly && queuedBackendQuestions.length === 0) {
            const prevQ = lastQuestionBySession.get(sessionId);
            if (prevQ && prevQ !== "[Continue]" && isTopicAppendableQuestion(prevQ) && isSafeTopicTail(questionForStream)) {
              const prevNoQ = prevQ.replace(/\?\s*$/, "").trim();
              questionForStream = `${prevNoQ} and also ${questionForStream.trim()}?`;
              console.log(`[ws/answer] stitched bare topic sessionId=${sessionId}`, { prevQ, topic: questionForStream });
            }
          }

          // #3: Incomplete/empty transcript — anchor to last known question so answer is always contextual
          if (!useBackendEnterWindow && (questionForStream === "[Continue]" || questionForStream.trim().length === 0)) {
            const prevQ = lastQuestionBySession.get(sessionId);
            if (prevQ && prevQ !== "[Continue]") {
              questionForStream = `Continue answering: "${prevQ}"`;
              console.log(`[ws/answer] anchored_incomplete sessionId=${sessionId}`, { anchor: questionForStream });
            }
          }

          // #4: Be conservative with ambiguous transcript.
          // Auto-triggered vague/noisy fragments should not be force-expanded into an invented question.
          // Manual submits may still pass through literally so the user can explicitly choose to answer them.
          const isExplicitQuestion = hasSharedQuestionSignal(questionForStream)
            || /^(write|implement|build|create|design)\b/i.test(questionForStream.trim());
          const isAmbiguousImplicit =
            !isExplicitQuestion
            && questionForStream !== "[Continue]"
            && !questionForStream.startsWith("Continue answering:")
            && !questionForStream.startsWith("[Continue")
            && questionForStream.trim().length > 0
            && (isVagueQuestion(questionForStream) || looksLikeInterviewNoise(questionForStream));
          if (queuedBackendQuestions.length === 0 && isAmbiguousImplicit && !force) {
            console.log(`[ws/answer] suppressed_ambiguous_auto sessionId=${sessionId}`, {
              raw: questionForStream,
            });
            safeSend(ws, {
              type: "request_ignored",
              sessionId,
              requestId: "",
              reason: "ambiguous_question",
            });
            return;
          }
          if (queuedBackendQuestions.length === 0
            && !isExplicitQuestion
            && !isAmbiguousImplicit
            && questionForStream !== "[Continue]"
            && !questionForStream.startsWith("Continue answering:")
            && !questionForStream.startsWith("[Continue")
            && questionForStream.trim().length > 0) {
            questionForStream = `Interview topic or prompt: "${questionForStream.trim()}". Answer only what is directly supported here. Do not infer a more specific question than this text supports.`;
            console.log(`[ws/answer] grounded_topic_prompt sessionId=${sessionId} wrapped="${questionForStream.slice(0, 120)}"`);
          }

          // #5: Recency amplification — boost detection of topic that appeared in last answer
          lastQuestionBySession.set(sessionId, displayQuestionForUi || questionForStream);

          // If questionForStream normalized to empty, anchor to last known question so Enter always answers
          if (!useBackendEnterWindow && (!questionForStream.trim() || normalizeQuestionForSimilarity(questionForStream) === "")) {
            const prevQ = lastQuestionBySession.get(sessionId);
            questionForStream = prevQ && prevQ !== "[Continue]"
              ? `Continue answering: "${prevQ}"`
              : "[Continue with latest interviewer context]";
            lastQuestionBySession.set(sessionId, questionForStream);
          }
          if (!displayQuestionForUi.trim()) {
            if (queuedBackendQuestions.length > 0) {
              displayQuestionForUi = queuedBackendQuestions.length === 1
                ? queuedBackendQuestions[0]
                : queuedBackendQuestions.map((question, index) => `${index + 1}. ${question}`).join("\n");
            } else {
              displayQuestionForUi = questionForStream
                .replace(/^Answer these interviewer questions separately in order:\s*/i, "")
                .replace(/^Interview topic or prompt:\s*/i, "")
                .replace(/^Continue answering:\s*/i, "")
                .replace(/^["[]|["\]]$/g, "")
                .trim();
            }
          }
          const plainDisplayQuestion = displayQuestionForUi
            .replace(/^Answer these interviewer questions separately in order:\s*/i, "")
            .replace(/^Interview topic or prompt:\s*/i, "")
            .replace(/^Continue answering:\s*/i, "")
            .replace(/^["[]|["\]]$/g, "")
            .trim()
            .split(/\n+/)
            .map((line) => line.replace(/^\d+\.\s*/, "").trim())
            .filter(Boolean)
            .slice(-1)[0] || "";
          if (plainDisplayQuestion && !/^Continue answering:/i.test(questionForStream)) {
            const activeState = getMeetingState(sessionId);
            activeState.lastPrompt = plainDisplayQuestion;
            setActiveQuestion(sessionId, plainDisplayQuestion, Date.now(), {
              windowHash: resolvedWindowHash || buildQuestionWindowHash(plainDisplayQuestion),
            });
          }
          const fp = normalizeQuestionForSimilarity(questionForStream) || "continue";
          if (!force && !useBackendEnterWindow && isRecentDuplicate(sessionId, fp, questionText)) {
            console.log(`[ws/answer] duplicate suppressed sessionId=${sessionId} fp="${fp.slice(0, 60)}"`);
            safeSend(ws, {
              type: "request_ignored",
              sessionId,
              requestId: "",
              reason: "duplicate_question",
            });
            return;
          }
          rememberFingerprint(sessionId, fp, questionText);
          recordUserQuestion(sessionId, displayQuestionForUi || questionForStream);
          console.log(
            `[ws/answer] question sessionId=${sessionId} userId=${userId} chars=${questionForStream.length} force=${force} source=${submitSource} multi=${multiQuestionMode}`,
            {
              preview: questionForStream.slice(0, 160),
              transport: "ws",
            },
          );

          const docsModeRaw = typeof msg?.docsMode === "string"
            ? msg.docsMode
            : (typeof msg?.metadata?.docsMode === "string" ? msg.metadata.docsMode : "");
          const docsMode = docsModeRaw === "always" || docsModeRaw === "off" ? docsModeRaw : "auto";
          socketState.sessionId = sessionId;

          const wsAbortController = new AbortController();
          const onSocketClose = () => {
            wsAbortController.abort();
            abortSessionStream(sessionId);
          };
          let onSocketCloseRemoved = false;
          const removeOnSocketClose = () => {
            if (!onSocketCloseRemoved) {
              onSocketCloseRemoved = true;
              ws.removeListener("close", onSocketClose);
            }
          };
          ws.once("close", onSocketClose);

          const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          socketState.requestId = requestId;
          activeBySession.set(sessionId, { ws, userId, sessionId, requestId });
          safeSend(ws, { type: "assistant_start", sessionId, requestId, question: displayQuestionForUi || questionForStream });
          console.log(`[ws/answer] assistant_start sessionId=${sessionId} requestId=${requestId}`);

          // ── Speculative replay ────────────────────────────────────────────
          // If a background speculative stream was running for a similar question,
          // flush its buffered chunks immediately so the answer appears instantly.
          let speculativeHit = false;
          const spec = speculativeStreams.get(sessionId);
          if (spec && (spec.chunks.length > 0 || !spec.done)) {
            const specNorm = spec.norm;
            // Compare against raw questionText (before follow-up anchoring / stitching enrichment)
            // because the speculative stream was started with the raw client-side question text.
            const rawNorm = normalizeQuestionForSimilarity(questionText);
            const realNorm = rawNorm || normalizeQuestionForSimilarity(questionForStream);
            const similarity = realNorm ? levenshteinSimilarity(specNorm, realNorm) : 0;
            const isRecent = (Date.now() - spec.ts) <= 15000;
            if (similarity >= 0.70 && isRecent) {
              console.log(`[ws/answer] speculative_hit sessionId=${sessionId} similarity=${similarity.toFixed(2)} chunks=${spec.chunks.length} done=${spec.done}`);
              // Flush all chunks buffered so far
              for (const chunk of spec.chunks) {
                safeSend(ws, { type: "assistant_chunk", sessionId, requestId, text: chunk });
              }
              if (spec.done) {
                // Stream already finished — send end immediately
                speculativeStreams.delete(sessionId);
                safeSend(ws, { type: "assistant_end", sessionId, requestId, cancelled: false });
                removeOnSocketClose();
              } else {
                // Stream still in progress — adopt it: pipe remaining chunks as they arrive
                spec.onChunk = (chunk: string) => {
                  safeSend(ws, { type: "assistant_chunk", sessionId, requestId, text: chunk });
                };
                spec.onDone = () => {
                  speculativeStreams.delete(sessionId);
                  safeSend(ws, { type: "assistant_end", sessionId, requestId, cancelled: false });
                  removeOnSocketClose();
                };
              }
              speculativeHit = true;
            }
          }
          if (!speculativeHit) {
            speculativeStreams.get(sessionId)?.abortCtrl.abort();
            speculativeStreams.delete(sessionId);
          }
          // ── End speculative replay ────────────────────────────────────────

          if (speculativeHit) return;

          const generator = streamAssistantAnswer({
            meetingId: sessionId,
            userId,
            question: questionForStream,
            format: typeof msg?.format === "string" ? msg.format : undefined,
            customFormatPrompt: typeof msg?.metadata?.customFormatPrompt === "string" ? msg.metadata.customFormatPrompt : undefined,
            quickMode: typeof msg?.quickMode === "boolean" ? msg.quickMode : undefined,
            docsMode,
            meeting,
            model: typeof msg?.model === "string" ? msg.model : undefined,
            transport: "ws",
            abortSignal: wsAbortController.signal,
            maxTokensOverride: (msg?.format === "code_example" || msg?.format === "technical") ? undefined : 500,
            temperatureOverride: 0.65,
            requestIdOverride: requestId,
            submitSource,
            lastInterviewerQuestion: typeof metadata?.lastInterviewerQuestion === "string" ? metadata.lastInterviewerQuestion : undefined,
            recentSpokenReply: typeof metadata?.recentSpokenReply === "string" ? metadata.recentSpokenReply : undefined,
            sessionJobDescription: typeof metadata?.jobDescription === "string" ? metadata.jobDescription : undefined,
            sessionSystemPrompt: typeof metadata?.systemPrompt === "string" ? metadata.systemPrompt : undefined,
            liveTranscript: typeof metadata?.liveTranscript === "string" ? metadata.liveTranscript : undefined,
            conversationHistory: Array.isArray(metadata?.conversationHistory) ? metadata.conversationHistory : undefined,
          });

          let emittedChunkCount = 0;
          let emittedCharCount = 0;
          let activeRequestId = requestId;
          let fastCancelled = false;
          // Accumulate fast answer text so the refinement pass can check it against the rubric
          let fastAnswerText = "";
          try {
          for await (const event of generator) {
            if (event.type === "start") {
              activeRequestId = event.requestId;
              continue;
            }
            if (event.type === "chunk") {
              emittedChunkCount += 1;
              const chunkText = String(event.text || "");
              emittedCharCount += chunkText.length;
              fastAnswerText += chunkText;
              safeSend(ws, { type: "assistant_chunk", sessionId, requestId: event.requestId, text: chunkText });
              console.log(`[ws/answer] assistant_chunk sessionId=${sessionId} requestId=${event.requestId} chunk=${emittedChunkCount} chars=${chunkText.length}`);
              continue;
            }
            if (event.type === "end") {
              fastCancelled = !!event.cancelled;
              if (emittedChunkCount === 0) {
                const fallbackText = String(event.response?.answer || "").trim()
                  || "Based on our discussion so far, let me continue with what I was explaining.";
                emittedChunkCount += 1;
                emittedCharCount += fallbackText.length;
                fastAnswerText += fallbackText;
                safeSend(ws, { type: "assistant_chunk", sessionId, requestId: event.requestId, text: fallbackText });
                console.warn(
                  `[ws/answer] forced_fallback_chunk sessionId=${sessionId} requestId=${event.requestId} chars=${fallbackText.length}`,
                );
              }
              safeSend(ws, { type: "assistant_end", sessionId, requestId: event.requestId, cancelled: !!event.cancelled });
              console.log(`[ws/answer] assistant_end sessionId=${sessionId} requestId=${event.requestId} total_chunks=${emittedChunkCount} total_chars=${emittedCharCount} cancelled=${!!event.cancelled}`);
              continue;
            }
            if (event.type === "error") {
              safeSend(ws, { type: "error", sessionId, requestId: event.requestId, message: event.message || "stream failed" });
            }
          }

          if (!fastCancelled && emittedChunkCount > 0) {
            getMeetingState(sessionId).lastAnswerAt = Date.now();
          }

          if (!fastCancelled && emittedChunkCount > 0 && backendAnsweredQuestions.length > 0) {
            const answeredAt = Date.now();
            for (const backendQuestion of backendAnsweredQuestions) {
              markInterviewerQuestionAnswered(sessionId, backendQuestion, answeredAt);
            }
            if (backendQuestionNorms.length > 0) {
              markAnsweredInStore(sessionId, backendQuestionNorms, answeredAt);
            }
            if (advanceBackendCursorOnSuccess) {
              advanceCursor(sessionId);
            }
            if (resolvedWindowHash) {
              setLastAnsweredWindowHash(sessionId, resolvedWindowHash);
            }
          } else if (!fastCancelled && emittedChunkCount > 0 && advanceBackendCursorOnSuccess) {
            advanceCursor(sessionId);
            if (resolvedWindowHash) {
              setLastAnsweredWindowHash(sessionId, resolvedWindowHash);
            }
          } else if (!fastCancelled && emittedChunkCount > 0 && reusedPreviousQuestion && resolvedWindowHash) {
            setLastAnsweredWindowHash(sessionId, resolvedWindowHash);
          }

          // --- TYPED REFINEMENT PASS ---
          // Classify the question into a technical subtype and fire a second full-context
          // stream with a subtype-specific rubric checklist. The rubric tells the model exactly
          // what is required for that question type (complexity for DSA, trade-offs for system
          // design, change markers for code modification, etc.) so the final answer is complete
          // against the same criteria the interviewer is mentally evaluating.
          const hasCodingContext = Boolean(getCodingProblemState(sessionId));
          const refineConfig = !fastCancelled && ws.readyState === WebSocket.OPEN
            ? getRefineConfig(questionForStream, hasCodingContext)
            : null;

          if (refineConfig) {
            const refineId = `${requestId}-r`;
            safeSend(ws, { type: "assistant_refine_start", sessionId, requestId: refineId });
            console.log(`[ws/answer] refine_start sessionId=${sessionId} refineId=${refineId} subtype=${refineConfig.subtype}`);

            const refineContext = buildRefineContext(refineConfig.subtype, fastAnswerText, sessionId);

            const refineGenerator = streamAssistantAnswer({
              meetingId: sessionId,
              userId,
              question: questionForStream,
              format: typeof msg?.format === "string" ? msg.format : undefined,
              customFormatPrompt: typeof msg?.metadata?.customFormatPrompt === "string" ? msg.metadata.customFormatPrompt : undefined,
              quickMode: false,
              docsMode,
              meeting,
              model: typeof msg?.model === "string" ? msg.model : undefined,
              transport: "ws",
              abortSignal: wsAbortController.signal,
              maxTokensOverride: refineConfig.maxTokens,
              temperatureOverride: refineConfig.temperature,
              requestIdOverride: refineId,
              submitSource,
              lastInterviewerQuestion: typeof metadata?.lastInterviewerQuestion === "string" ? metadata.lastInterviewerQuestion : undefined,
              recentSpokenReply: typeof metadata?.recentSpokenReply === "string" ? metadata.recentSpokenReply : undefined,
              sessionJobDescription: typeof metadata?.jobDescription === "string" ? metadata.jobDescription : undefined,
              sessionSystemPrompt: typeof metadata?.systemPrompt === "string" ? metadata.systemPrompt : undefined,
              liveTranscript: typeof metadata?.liveTranscript === "string" ? metadata.liveTranscript : undefined,
              conversationHistory: Array.isArray(metadata?.conversationHistory) ? metadata.conversationHistory : undefined,
              refineContext,
            });

            let refineChunks = 0;
            for await (const event of refineGenerator) {
              if (ws.readyState !== WebSocket.OPEN) break;
              if (event.type === "chunk") {
                refineChunks += 1;
                safeSend(ws, { type: "assistant_refine_chunk", sessionId, requestId: refineId, text: String(event.text || "") });
              }
              if (event.type === "end") {
                safeSend(ws, { type: "assistant_refine_end", sessionId, requestId: refineId, cancelled: !!event.cancelled });
                console.log(`[ws/answer] refine_end sessionId=${sessionId} refineId=${refineId} subtype=${refineConfig.subtype} chunks=${refineChunks} cancelled=${!!event.cancelled}`);
              }
            }
          }
          // --- END TYPED REFINEMENT ---

          // Emit structured_response so the client can use pre-parsed sections
          // instead of re-parsing the raw text client-side.
          if (ws.readyState === WebSocket.OPEN && fastAnswerText) {
            try {
              const structured = parseResponse(fastAnswerText);
              if (structured.meta.hasCode || structured.sections.length > 1) {
                safeSend(ws, {
                  type: "structured_response",
                  sessionId,
                  requestId,
                  data: structured,
                });
              }
            } catch {
              // non-fatal — client falls back to raw text parsing
            }
          }

          } finally {
            removeOnSocketClose();
          }
          const current = activeBySession.get(sessionId);
          if (current?.requestId === activeRequestId) {
            activeBySession.delete(sessionId);
          }
          socketState.requestId = "";
          return;
        }
      } catch (err: any) {
        safeSend(ws, {
          type: "error",
          sessionId: socketState.sessionId || "",
          requestId: socketState.requestId || "",
          message: err?.message || "Invalid message",
        });
      }
    });

    ws.on("close", () => {
      const sessionId = socketState.sessionId;
      if (sessionId) {
        const current = activeBySession.get(sessionId);
        if (current && current.ws === ws) {
          activeBySession.delete(sessionId);
        }
        // Clean up session-scoped Maps to prevent memory leak
        lastQuestionBySession.delete(sessionId);
        recentQuestionFingerprints.delete(sessionId);
        lastRawTranscriptBySession.delete(sessionId);
      }
    });
  });
}
