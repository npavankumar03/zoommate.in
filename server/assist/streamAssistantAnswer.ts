import crypto from "crypto";
import { streamLLM, callLLM, getUseCaseConfigWithScope, resolveAutomaticInterviewModel } from "../llmRouter2";
import { buildSystemPrompt, buildTier0Prompt, buildMessages, getMaxTokensForFormat, buildStrictInterviewTurnUserPrompt } from "../prompt";
import { formatMemorySlotsForPrompt, processPostAnswerMemory } from "../memoryExtractor";
import { formatSessionReviewsForPrompt } from "../sessionReview";
import { storage } from "../storage";
import { getAnswerStyle, getCodeContext, setCodeContext } from "../realtime/meetingStore";
import { applyAnswerStyle } from "./orchestrator";
import { extractCandidateSpan, normalizeForDedup } from "@shared/questionDetection";
import type { Meeting } from "@shared/schema";
import { shouldRetrieveDocs, type DocsRetrievalMode } from "./retrievalGate";
import { retrieveDocumentContext } from "../rag";
import { enqueuePersistRetry } from "./persistRetry";
import { getHeuristicAnswer } from "./heuristicAnswerCache";
import { isFollowUp, resolveAnchorTurn, type CodeTransitionType } from "@shared/followup";
import { detectTechnicalSubtype, type TechnicalSubtype } from "@shared/technicalSubtype";
import { classifyTechnicalIntent } from "@shared/technicalIntent";
import { resolveFollowUp } from "./followupResolver";
import { buildCodingContextBlock, buildInterviewerIntelligenceBlock, getCodingProblemState, getRecentSpokenReplies, getSessionState, recordAssistantAnswer, recordUserQuestion, selectRelevantQAPairs, isVagueQuestion, updateCodingProblemState } from "./sessionState";
import {
  defaultHotPathMetrics,
  getOrLoadConversationSummary,
  getOrLoadDocRetrieval,
  getOrLoadPromptTemplate,
  getOrLoadSettings,
  logHotPathMetrics,
} from "../cache/hotPathCache";

const activeStreams = new Map<string, AbortController>();
const memoryContextCache = new Map<string, { value: string; expiresAt: number }>();
const ttftSamplesByTransport: Record<"ws" | "sse", number[]> = { ws: [], sse: [] };
const MEMORY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — survives long gaps between questions
const TIER0_MIN_TOKENS = 220;
const TIER0_MAX_TOKENS = 950; // enough for explanation + full code block without truncation
const TIER0_CUSTOM_INSTRUCTIONS_CHARS = 24000;
const MAX_RESUME_CONTEXT_CHARS = 10000; // reduced from 24k — enough for name, skills, 2-3 jobs
const MAX_JOB_DESCRIPTION_CHARS = 6000;  // reduced from 12k — key requirements fit in 6k
const FOLLOWUP_MAX_CHARS = 2000;
const FIRST_TOKEN_TIMEOUT_MS = 3500;
const MAX_FIRST_TOKEN_RETRIES = 0;
const STRICT_NO_INVENT_RULE = [
  "CRITICAL NO-INVENTION RULES:",
  "- Do NOT invent employers, companies, project names, years, metrics, or seniority.",
  "- Use only transcript, session memory, resume/materials, and provided job description.",
  "- If a detail is missing, give a truthful generalized answer without fabricated specifics.",
].join("\n");
const RESPONSE_STYLE_RULE = [
  "PROMPT-FIRST RULES:",
  "- Follow the user's custom instructions exactly when they are provided.",
  "- Use job description and resume/profile context as primary personalization sources.",
  "- Strict interview mode: answer only the selected interviewer question for this turn; ignore unrelated transcript fragments.",
  "- CURRENT BATCH ONLY: Answer ONLY the question(s) passed in this turn's user message. Do NOT answer or re-answer any Interviewer questions you see in the conversation history — those were already handled in prior turns. If you see an Interviewer line in history without a matching Candidate reply, still ignore it — it is outside your current batch.",
  "- MANDATORY OUTPUT: candidate answer must be first-person singular in natural spoken style.",
  "- Default to paragraph format unless the user explicitly asks for bullets, numbered steps, or another structure.",
  "- Use **bold markdown** to emphasize key technical terms, role titles, company names, skills, and important phrases within paragraphs.",
  "- Start with a direct answer sentence, then add concise supporting detail unless the user requests another structure.",
  "- NEVER begin a response with 'Certainly', 'Sure', 'Of course', 'Great question', 'Absolutely', 'Here is', or 'Here's a'. Start directly with the substance.",
  "- NEVER re-introduce yourself or repeat your name at the start of an answer unless the interviewer explicitly asked for your name in THIS question. If a previous turn already provided your name or background, do not repeat it — jump straight to answering the current question.",
  "- Never invent facts, companies, years, or metrics.",
  "- Never mention being an AI assistant.",
  "- Answer directly without refusal/meta preambles.",
  "- NEVER refuse to answer. NEVER say 'I can't provide a response', 'I'm sorry', or 'that doesn't relate to my experience'. Always find a way to answer as the candidate.",
  "- NEVER ask for clarification. If the question is vague, incomplete, or contains a speech-to-text error, infer the most likely interview intent and answer directly.",
  "- If the transcript contains a garbled word (e.g. 'youth' instead of 'use case'), correct it contextually and answer the most plausible question.",
  "- If the transcript is ambiguous, bind your answer to the most recent interviewer topic and respond as if that topic was asked.",
  "- If the question uses pronouns or vague references ('which code', 'that project', 'what you said', 'that thing', 'which one', 'differentiate it', 'explain it', 'compare it'), FIRST check the live transcript for the most recent topic being discussed — that is what 'it/that/this' refers to. Only fall back to the last Q&A answer if the transcript gives no clue. Never answer about an older topic when the transcript shows a newer one.",
  "- When there is no explicit context, always scan the live transcript and Q&A history and produce the best possible answer from what is available. An imperfect answer is always better than a refusal.",
  "- SCENARIO QUESTIONS: If the interviewer described a scenario or hypothetical ('if you create X', 'suppose Y', 'imagine Z') and then asks a follow-up ('how would you differentiate it', 'what would happen', 'how do you handle it'), the answer must be about that scenario — not about a previous unrelated topic.",
  "- MULTI-PART QUESTIONS (MANDATORY): If the question has multiple distinct parts — joined by 'and', 'also', newlines, or otherwise — answer EVERY part in sequence without skipping. This includes mixed-type questions where a coding task and a behavioral/other question are combined (e.g. 'Write a Python calculator and how do you handle stress while coding?' → provide the code FIRST, then in a new paragraph answer the behavioral question). If you completed a code task and the question also asks something else, do NOT stop — continue and answer the remaining part(s). Never skip any part of a compound question.",
].join("\n");

function extractPromptProfileContext(raw: string): { resume: string; jobDescription: string } {
  const text = String(raw || "").replace(/\r\n/g, "\n");
  if (!text.trim()) return { resume: "", jobDescription: "" };

  const lines = text.split("\n");
  const jdLines: string[] = [];
  const resumeLines: string[] = [];
  let current: "jd" | "resume" | null = null;

  const jdHeader = /^\s*(?:the following is\s+)?(?:job\s*description|jd)\s*[:\-]?\s*(.*)$/i;
  const resumeHeader = /^\s*(?:below is my\s+)?resume\s*[:\-]?\s*(.*)$/i;
  const stopHeader = /^\s*(?:instructions?|rules?|important|note|example|context|enhanced prompt|final key points|your response should)\b/i;

  for (const line of lines) {
    const jdMatch = line.match(jdHeader);
    if (jdMatch) {
      current = "jd";
      const tail = (jdMatch[1] || "").trim();
      if (tail) jdLines.push(tail);
      continue;
    }

    const resumeMatch = line.match(resumeHeader);
    if (resumeMatch) {
      current = "resume";
      const tail = (resumeMatch[1] || "").trim();
      if (tail) resumeLines.push(tail);
      continue;
    }

    if (stopHeader.test(line)) {
      current = null;
      continue;
    }

    if (current === "jd") jdLines.push(line);
    if (current === "resume") resumeLines.push(line);
  }

  const normalizeBlock = (value: string) =>
    value
      .replace(/[{}]/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  return {
    jobDescription: normalizeBlock(jdLines.join("\n")),
    resume: normalizeBlock(resumeLines.join("\n")),
  };
}

type EmploymentFact = { company: string; from: string; to: string };

function extractEmploymentFacts(raw: string): EmploymentFact[] {
  const text = String(raw || "").replace(/\r\n/g, "\n");
  if (!text.trim()) return [];
  const month = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
  const re = new RegExp(
    `([A-Z][A-Za-z0-9&'.,\\- ]{2,})\\s*\\n\\s*${month}\\s+\\d{4}\\s*-\\s*(Present|${month}\\s+\\d{4})`,
    "gmi",
  );
  const out: EmploymentFact[] = [];
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(text)) !== null) {
    const full = m[0];
    const company = String(m[1] || "").trim();
    const rangeMatch = full.match(new RegExp(`${month}\\s+\\d{4}\\s*-\\s*(Present|${month}\\s+\\d{4})`, "i"));
    if (!company || !rangeMatch) continue;
    const [from, to] = rangeMatch[0].split(/\s*-\s*/);
    out.push({ company, from: String(from || "").trim(), to: String(to || "").trim() });
    if (out.length >= 10) break;
  }
  return out;
}

function extractCoreProfileFacts(raw: string): { name?: string; experienceYears?: string; employments: EmploymentFact[] } {
  const text = String(raw || "").replace(/\r\n/g, "\n");
  if (!text.trim()) return { employments: [] };

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let name: string | undefined;
  for (const line of lines.slice(0, 12)) {
    if (/@/.test(line) || /\+?\d[\d\s().-]{6,}/.test(line)) continue;
    if (/^(summary|skills|experience|education|certification|job description|resume)\b/i.test(line)) continue;
    if (/^[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,3}$/.test(line)) {
      name = line;
      break;
    }
  }

  const yearsMatch =
    text.match(/(\d+\+?\s+years?)\s+(?:of\s+)?experience/i) ||
    text.match(/with\s+(\d+\+?\s+years?)/i);
  const experienceYears = yearsMatch ? String(yearsMatch[1]).trim() : undefined;

  return {
    name,
    experienceYears,
    employments: extractEmploymentFacts(text),
  };
}

function buildFactPriorityHint(question: string, profileSource: string): string {
  const q = String(question || "").toLowerCase();
  if (!q.trim()) return "";
  const facts = extractCoreProfileFacts(profileSource);
  const hints: string[] = [];

  if (/\b(name|what'?s your name|who are you)\b/.test(q) && facts.name) {
    hints.push(`Exact candidate name from profile: ${facts.name}`);
  }
  if (/\b(experience|how many years|years)\b/.test(q) && facts.experienceYears) {
    hints.push(`Exact experience from profile: ${facts.experienceYears}`);
  }
  if (/\b(month|date|when|from what month|to what month|worked|tenure)\b/.test(q)) {
    const companyHit = facts.employments.find((e) => q.includes(e.company.toLowerCase().slice(0, 18)));
    if (companyHit) {
      hints.push(`Exact employment range for ${companyHit.company}: ${companyHit.from} - ${companyHit.to}`);
    } else if (facts.employments.length) {
      hints.push(
        `Known employment ranges from profile: ${facts.employments
          .slice(0, 3)
          .map((e) => `${e.company}: ${e.from} - ${e.to}`)
          .join(" | ")}`,
      );
    }
  }

  if (!hints.length) return "";
  return [
    "FACT PRIORITY MODE:",
    "- For this question, answer with exact profile facts first (no paraphrased guess).",
    ...hints.map((h) => `- ${h}`),
  ].join("\n");
}

function buildPromptMemoryEvidenceHint(question: string, profileSource: string): string {
  const q = String(question || "").toLowerCase().trim();
  const src = String(profileSource || "");
  if (!q || !src) return "";

  const stop = new Set([
    "the", "a", "an", "is", "are", "was", "were", "to", "of", "in", "on", "for", "and", "or", "with",
    "do", "does", "did", "have", "has", "had", "you", "your", "me", "my", "it", "that", "this", "from",
    "what", "when", "where", "why", "how", "which", "who",
  ]);
  const qTokens = Array.from(
    new Set(
      q
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3 && !stop.has(t)),
    ),
  );
  if (!qTokens.length) return "";

  const lines = src
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 4 && l.length <= 260);

  const scored = lines
    .map((line) => {
      const lower = line.toLowerCase();
      let score = 0;
      for (const t of qTokens) {
        if (lower.includes(t)) score += 1;
      }
      return { line, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.line.length - a.line.length)
    .slice(0, 5);

  if (!scored.length) return "";
  return [
    "PROMPT MEMORY EVIDENCE:",
    "- Use these profile lines as source-of-truth for this answer.",
    ...scored.map((s) => `- ${s.line}`),
  ].join("\n");
}

function buildCompanyAndJdKnowledgeBlock(question: string, jobDescription: string, extraContext?: string): string {
  const source = [String(jobDescription || ""), String(extraContext || "")]
    .filter(Boolean)
    .join("\n");
  if (!source.trim()) return "";

  const qTokens = Array.from(
    new Set(
      normalizeForDedup(question)
        .split(/\s+/)
        .filter((token) => token.length >= 3),
    ),
  );
  const lines = source
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 6 && line.length <= 220);

  let companyLine = lines.find((line) => /^(company|client|organization|about|role)\s*[:\-]/i.test(line));
  if (!companyLine) {
    companyLine = lines.find((line) => /\b(apple|amazon|google|microsoft|meta|anthem|blue cross|walmart|bank|insurance|healthcare)\b/i.test(line));
  }

  const scored = lines
    .map((line) => {
      const lower = line.toLowerCase();
      let score = 0;
      for (const token of qTokens) {
        if (lower.includes(token)) score += 1;
      }
      if (/\b(must|required|responsibilit|qualification|experience|skills|stack|team|domain)\b/i.test(line)) score += 0.5;
      return { line, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((item) => item.line);

  const uniqueLines = Array.from(new Set([companyLine, ...scored].filter(Boolean) as string[])).slice(0, 5);
  if (!uniqueLines.length) return "";

  return [
    "COMPANY / JD KNOWLEDGE:",
    ...uniqueLines.map((line) => `- ${line}`),
  ].join("\n");
}

interface MeetingSettings {
  responseFormat: string;
  customInstructions: string;
  type: string;
  conversationContext: string;
  documentIds: string[];
  rollingSummary: string;
  interviewStyle?: unknown;
}

export type StreamAssistantAnswerTransport = "ws" | "sse";

export interface StreamAssistantAnswerOptions {
  meetingId: string;
  userId: string;
  question: string;
  format?: string;
  customFormatPrompt?: string;
  quickMode?: boolean;
  docsMode?: DocsRetrievalMode;
  meeting?: Meeting;
  model?: string;
  transport?: StreamAssistantAnswerTransport;
  abortSignal?: AbortSignal;
  maxTokensOverride?: number;
  temperatureOverride?: number;
  requestIdOverride?: string;
  submitSource?: string;
  lastInterviewerQuestion?: string;
  recentSpokenReply?: string;
  sessionJobDescription?: string;
  sessionSystemPrompt?: string;
  liveTranscript?: string;
  conversationHistory?: Array<{ q: string; a: string }>;
  sessionContext?: string;  // in-memory "Interviewer: ...\nCandidate: ..." log sent directly from client to bypass DB persist delay
  refineContext?: string;   // typed rubric block injected at end of tier-0 prompt during refinement pass
}

function sanitizeDisplayQuestion(raw: string): string {
  const text = String(raw || "").trim();
  if (!text) return "";
  const parts = text
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return text;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (/\?/.test(p) || /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|tell|walk|explain)\b/i.test(p)) {
      return p;
    }
  }
  return parts[parts.length - 1];
}

export type StreamAssistantAnswerEvent =
  | { type: "start"; requestId: string }
  | { type: "chunk"; requestId: string; text: string }
  | { type: "end"; requestId: string; response: { question: string; answer: string; responseType: string }; cancelled?: boolean }
  | { type: "error"; requestId: string; message: string }
  | { type: "debug_meta"; requestId: string; model: string; provider: string; style: string; tier: string; maxTokens: number; ragChunks: number; tReqReceived: number };

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

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function recordTtft(transport: StreamAssistantAnswerTransport, ttftMs: number): void {
  if (!Number.isFinite(ttftMs) || ttftMs < 0) return;
  const samples = ttftSamplesByTransport[transport] || ttftSamplesByTransport.sse;
  samples.push(ttftMs);
  if (samples.length > 250) samples.splice(0, samples.length - 250);
  const p50 = percentile(samples, 50);
  const p90 = percentile(samples, 90);
  console.log(`[perf][server][${transport}] ttft_p50=${Math.round(p50)}ms ttft_p90=${Math.round(p90)}ms samples=${samples.length}`);
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

export function abortSessionStream(meetingId: string): boolean {
  const controller = activeStreams.get(meetingId);
  if (controller) {
    controller.abort();
    activeStreams.delete(meetingId);
    return true;
  }
  return false;
}

export function hasActiveStream(meetingId: string): boolean {
  return activeStreams.has(meetingId);
}

function computeQuestionHash(meetingId: string, cleanQuestion: string): string {
  const normalized = cleanQuestion.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
  return crypto.createHash("sha256").update(`${meetingId}:${normalized}`).digest("hex").substring(0, 16);
}

// Per-subtype answer shape instructions.
// These define the required answer structure when no more-specific transition policy applies.
// The model receives this as a numbered order it must follow — not a suggestion.
function buildSubtypeAnswerShape(subtype: TechnicalSubtype): string {
  switch (subtype) {
    case "dsa":
      return [
        "DSA ANSWER STRUCTURE (follow this order exactly):",
        "1. Approach — 1-2 sentences: name the data structure/algorithm and the core insight.",
        "2. Code — complete fenced block (e.g. ```python). Every solution MUST have a code block.",
        "3. Complexity — state Time and Space complexity with a one-line justification for each.",
        "4. Edge cases — list 2-3 inputs that need special handling (empty, single element, negatives, duplicates, overflow).",
        "RULE: Never skip the code block. Never skip complexity. Answer in first person.",
      ].join("\n");

    case "system_design":
      return [
        "SYSTEM DESIGN ANSWER STRUCTURE (follow this order):",
        "1. Clarify scale — state the assumed load (requests/sec, data volume, users) before designing.",
        "2. Core components — list the key services/layers (load balancer, API layer, DB, cache, queue, CDN, etc.).",
        "3. Data flow — describe a single request end-to-end through the system.",
        "4. Data model — key entities and storage choices (SQL vs NoSQL, why).",
        "5. Trade-offs — explicitly name what was sacrificed (consistency vs availability, latency vs throughput).",
        "6. Bottlenecks — identify the hardest scaling challenge and how to address it.",
        "RULE: Keep each section concise (2-4 sentences). No bullet walls. Speak as the architect, first person.",
      ].join("\n");

    case "backend":
      return [
        "BACKEND/API ANSWER STRUCTURE (follow this order):",
        "1. Concept — explain what it is and why it exists (1-2 sentences).",
        "2. How it works — describe the request/data flow or mechanism in concrete terms.",
        "3. Code example — fenced block showing implementation or usage (if applicable).",
        "4. Gotchas — 1-2 real-world pitfalls or common mistakes.",
        "RULE: Be concrete. Name actual HTTP status codes, headers, or library methods. First person.",
      ].join("\n");

    case "frontend":
      return [
        "FRONTEND ANSWER STRUCTURE (follow this order):",
        "1. Mental model — 1 sentence explaining the core concept in plain language.",
        "2. How it works — the mechanism (reconciliation, event loop, render cycle, etc.).",
        "3. Code example — fenced block (e.g. ```jsx or ```typescript) showing real usage.",
        "4. When to use / common mistakes — when this applies and one mistake to avoid.",
        "RULE: Prefer concrete runnable snippets over abstract descriptions. First person.",
      ].join("\n");

    case "sql":
      return [
        "SQL ANSWER STRUCTURE (follow this order):",
        "1. Brief explanation — what the query does or what the concept means (1-2 sentences).",
        "2. SQL block — fenced with ```sql. Always include a working query, even for conceptual questions.",
        "3. Clause breakdown — explain each non-obvious clause (WHERE, JOIN condition, GROUP BY, HAVING, etc.).",
        "4. Performance note — mention indexes, query plan considerations, or when to avoid this pattern.",
        "RULE: Always fence SQL as ```sql. Use realistic table/column names. First person.",
      ].join("\n");

    case "debugging":
      return [
        "DEBUGGING ANSWER STRUCTURE (follow this order):",
        "1. Root cause — name the exact reason the code fails (1 sentence, direct).",
        "2. Why it happens — explain the mechanism that causes the bug.",
        "3. Fix — fenced code block with the corrected code. Mark every changed line with `// ← fixed`.",
        "4. Prevention — 1 sentence on how to avoid this class of bug in future.",
        "RULE: Lead with the root cause, not symptoms. Never say 'it might be' — be definitive. First person.",
      ].join("\n");

    case "code_modification":
      return [
        "CODE MODIFICATION ANSWER STRUCTURE (follow this order):",
        "1. What changes and why — 1-2 sentences explaining the modification.",
        "2. Full modified code — complete fenced block (not a diff, not a snippet — the entire function/class). Mark every changed line with an inline comment: `// ← changed` for JS/TS/Java/Go, `# ← changed` for Python.",
        "3. What changed list — bullet list of each modification and the reason.",
        "RULE: Return the FULL code, not a partial snippet. Never omit unchanged lines. First person.",
      ].join("\n");

    case "code_explanation":
      return [
        "CODE EXPLANATION ANSWER STRUCTURE (follow this order):",
        "1. Quote the relevant snippet — fenced block of the exact lines being explained.",
        "2. Step-by-step walkthrough — explain each meaningful line or block in plain English.",
        "3. Design rationale — why this approach was chosen over simpler alternatives.",
        "RULE: Walk through in the same order the code executes. No hand-waving. First person.",
      ].join("\n");

    case "optimization":
      return [
        "OPTIMIZATION ANSWER STRUCTURE (follow this order):",
        "1. Current bottleneck — identify exactly what makes the current solution slow/memory-heavy.",
        "2. Better approach — name the technique and explain why it's faster/leaner (1-2 sentences).",
        "3. Optimized code — complete fenced block. Mark changed lines with `// ← optimized`.",
        "4. Complexity comparison — state Time and Space for both old and new approach.",
        "RULE: Always show the full optimized code, not just the changed part. First person.",
      ].join("\n");

    default:
      // General implementation / fresh-code question (e.g. "write a Python calculator")
      return [
        "IMPLEMENTATION ANSWER STRUCTURE (follow this order exactly):",
        "1. Approach — 1-2 sentences: state what you will build and the key design decision.",
        "2. Code — complete fenced block in the requested language. Every implementation answer MUST have a fenced code block.",
        "3. Key points — 2-3 bullets explaining the most important parts of the code.",
        "RULE: NEVER start with 'Certainly', 'Sure', 'Of course', 'Here is', or 'Here's a'. Start directly with the approach sentence. Answer in first person.",
      ].join("\n");
  }
}

// Per code-transition-type AI instructions.
// Each case tells the model exactly what kind of code operation to perform so it
// doesn't fall back to a generic "follow-up" answer that might lose the code context.
function buildCodeTransitionPolicy(
  transition: CodeTransitionType | undefined,
  prevAnswerHasCode: boolean,
  isContinuationRequest: boolean,
  isCodeFollowUpQuestion: boolean,
  anchorCodeBlock: string,
  meetingId?: string,
): string {
  const codeRule = "RULE: Every answer MUST include BOTH a plain-text explanation AND a complete fenced code block. Never explanation-only. Never code-only.";
  const firstPerson = "Stay in first person as a candidate explaining your own solution.";
  const noBackground = "DO NOT give a generic experience/background answer.";
  const fullCode = "Return the FULL complete code — every line, not just the changed part.";
  const changeMarker = "Mark every changed or newly added line with an inline comment: `// ← changed` for JS/TS/Java/C#/Go/Rust, `# ← changed` for Python/Ruby/Shell.";

  // Code continuation: user said "more" / "continue" near a code answer
  if (!transition && prevAnswerHasCode && isContinuationRequest) {
    return [
      "CODE CONTINUATION POLICY:",
      "- The previous answer contained code. Extend it — do NOT give a background/experience answer.",
      "- Answer order: 1) 1-sentence intro of what is being added, 2) complete extended code block (fenced), 3) brief 'What was added:' notes.",
      codeRule,
    ].join("\n");
  }

  switch (transition) {
    case "optimize":
      return [
        "OPTIMIZATION FOLLOW-UP POLICY:",
        "- The interviewer wants a faster / more efficient version of the current solution.",
        "- Answer order: 1) Explain why the current approach is suboptimal (1-2 sentences), 2) Describe the optimized approach and its new time/space complexity, 3) Full optimized code block (fenced), 4) 'What changed:' bullet list.",
        fullCode,
        changeMarker,
        codeRule, noBackground, firstPerson,
      ].join("\n");

    case "space":
      return [
        "SPACE-OPTIMIZATION FOLLOW-UP POLICY:",
        "- The interviewer wants an in-place or O(1)-space version.",
        "- Answer order: 1) Identify what extra memory the current solution uses, 2) Explain the in-place strategy, 3) Full in-place code block (fenced), 4) New space complexity.",
        fullCode, changeMarker, codeRule, noBackground, firstPerson,
      ].join("\n");

    case "language_switch": {
      const state = meetingId ? getCodingProblemState(meetingId) : null;
      const algorithmNote = state?.activeApproach
        ? `Preserve the algorithm: "${state.activeApproach}".`
        : "Preserve the algorithm exactly — only syntax changes, not logic.";
      const complexityNote = (state?.currentComplexity.time || state?.currentComplexity.space)
        ? `Maintain complexity: Time ${state.currentComplexity.time || "same"}, Space ${state.currentComplexity.space || "same"}.`
        : "Maintain the same time and space complexity.";
      return [
        "LANGUAGE-SWITCH FOLLOW-UP POLICY:",
        "- The interviewer wants the solution rewritten in a different language.",
        `- ${algorithmNote}`,
        `- ${complexityNote}`,
        "- Watch for O(n) traps: Java ArrayList.contains() is O(n) not O(1) — use HashSet. Python dict → Java HashMap. JS Map vs plain object.",
        "- Answer order: 1) Note language-specific differences (1-2 sentences), 2) Full code block fenced with the correct language tag, 3) Highlight API/idiom changes.",
        codeRule, noBackground, firstPerson,
      ].join("\n");
    }

    case "constraint_change":
      return [
        "CONSTRAINT-CHANGE FOLLOW-UP POLICY:",
        "- The interviewer has changed an assumption (e.g. sorted input, duplicates allowed, streamed input).",
        "- Answer order: 1) State the new constraint and how it changes the approach, 2) Updated code block (fenced), 3) New complexity if it changed.",
        fullCode, changeMarker, codeRule, noBackground, firstPerson,
      ].join("\n");

    case "thread_safety":
      return [
        "THREAD-SAFETY FOLLOW-UP POLICY:",
        "- The interviewer wants a concurrent-safe version.",
        "- Answer order: 1) Identify the race condition or shared state in the current solution, 2) Explain the synchronization strategy (lock, atomic, immutable copy, etc.), 3) Thread-safe code block (fenced), 4) Tradeoffs.",
        fullCode, changeMarker, codeRule, noBackground, firstPerson,
      ].join("\n");

    case "testing":
      return [
        "TESTING FOLLOW-UP POLICY:",
        "- The interviewer wants test cases or a testing strategy for the current solution.",
        "- Answer order: 1) State what behaviors to test (happy path, edge cases, error cases), 2) Code block with unit tests (fenced, using a standard framework for the language), 3) Brief note on coverage.",
        codeRule, noBackground, firstPerson,
      ].join("\n");

    case "error_handling":
      return [
        "ERROR-HANDLING FOLLOW-UP POLICY:",
        "- The interviewer wants null-safety, input validation, or exception handling added.",
        "- Answer order: 1) List the failure modes being handled, 2) Full code block with guards/try-catch/assertions added (fenced), 3) 'What was added:' bullet list.",
        fullCode, changeMarker, codeRule, noBackground, firstPerson,
      ].join("\n");

    case "scale":
      return [
        "SCALING FOLLOW-UP POLICY:",
        "- The interviewer is asking how the solution behaves at large scale or in production.",
        "- Answer order: 1) Identify the bottleneck at scale, 2) Propose architectural changes (pagination, streaming, distributed processing, caching), 3) Code sketch or pseudocode if relevant (fenced), 4) Trade-offs.",
        noBackground, firstPerson,
      ].join("\n");

    case "explain_part":
      return [
        "EXPLAIN-CODE FOLLOW-UP POLICY:",
        "- The interviewer wants a line-by-line or block-level explanation of the current code.",
        "- Answer order: 1) Quote the relevant code snippet (fenced), 2) Walk through it step by step in plain English, 3) Explain why this design choice was made.",
        firstPerson, noBackground,
      ].join("\n");

    case "refactor":
      return [
        "REFACTOR FOLLOW-UP POLICY:",
        "- The interviewer wants a cleaner, more readable version of the current solution.",
        "- Answer order: 1) State what structural issues the refactor addresses, 2) Full refactored code block (fenced), 3) 'What changed:' bullet list.",
        fullCode, changeMarker, codeRule, noBackground, firstPerson,
      ].join("\n");

    case "complexity":
      return [
        "COMPLEXITY-ANALYSIS FOLLOW-UP POLICY:",
        "- The interviewer wants time and space complexity analysis.",
        "- Answer order: 1) State time complexity with justification (e.g. 'O(n log n) because of the sort'), 2) State space complexity, 3) If asked to improve, show the optimized approach + code block (fenced), 4) Compare before vs after complexities.",
        firstPerson, noBackground,
      ].join("\n");

    case "alternative":
      return [
        "ALTERNATIVE-APPROACH FOLLOW-UP POLICY:",
        "- The interviewer wants a different algorithm or data structure.",
        "- Answer order: 1) Name the alternative and explain why it fits, 2) Compare time/space vs current approach, 3) Full code block using the alternative (fenced), 4) When you'd prefer one vs the other.",
        codeRule, noBackground, firstPerson,
      ].join("\n");

    default:
      // Fallback: generic code follow-up when code is in anchor but no specific transition
      if (prevAnswerHasCode && isCodeFollowUpQuestion) {
        return [
          "CODE FOLLOW-UP POLICY:",
          "- The previous answer contained code. Answer the follow-up in this EXACT order:",
          "  1. Plain-text explanation (2-3 sentences) — why this approach, what this line/block does, or what changed.",
          "  2. Code block — complete, fenced (e.g. ```python). NEVER skip it.",
          "  3. 'What changed:' section if this is a modification request.",
          codeRule, firstPerson, noBackground,
        ].join("\n");
      }
      // Non-code follow-up
      return [
        "FOLLOW-UP POLICY:",
        "- Start by referencing the prior answer in 1 sentence (e.g., \"On the caching point I mentioned...\").",
        "- Then expand naturally based on the user's requested format and style.",
        "- End with one concrete example or next step if technical.",
        "- If the follow-up is ambiguous, infer the most likely intent from recent context and answer directly — never ask for clarification.",
      ].join("\n");
  }
}

function buildTier0FormatGuide(format: string, customFormatPrompt?: string, quickMode?: boolean): string {
  const formatKey = format || "concise";
  const quickSkeletonAllowed = quickMode && formatKey === "technical";

  const guideByFormat: Record<string, string> = {
    short: "Short: 2-4 tight sentences total.",
    concise: "Concise: 2-4 sentences.",
    detailed: "Detailed: Keep concise but structured: 1) Direct answer, 2) Key details, 3) Example, 4) Impact/Wrap-up.",
    star: "STAR: Provide 4 labeled lines only: S: ... T: ... A: ... R: ...",
    bullet: "Bullets: 4-6 clear bullets. Each bullet should be concrete and complete.",
    technical: "Technical: concise answer with clear steps/tradeoffs. Include code only if requested.",
    automatic: "Automatic: Choose the best format for the question; keep it concise.",
    code_example: "Code example: Short intro, code block, then 2-4 key points.",
  };

  const baseGuide = formatKey === "custom"
    ? (customFormatPrompt ? `Custom format: ${customFormatPrompt}` : "Custom format: keep concise and follow any provided custom instructions.")
    : (guideByFormat[formatKey] || guideByFormat.concise);

  const skeletonRule = quickSkeletonAllowed
    ? "QuickMode + Technical: keep it fast and concrete."
    : "Follow the selected format.";

  return [
    "Tier-0 mode: minimal context for speed, but must follow the selected format.",
    baseGuide,
    skeletonRule,
  ].join("\n");
}

function getTier0Template(formatForAI: string, responseFormat: string, meetingType: string, customFormatPrompt?: string, quickMode?: boolean): string {
  const interviewShape = (meetingType || "").toLowerCase().includes("interview")
    ? "Interview response shape: 1) direct answer (1-2 sentences), 2) concrete example, 3) impact/result, 4) optional brief follow-up. Keep total concise."
    : "";
  return [
    buildTier0Prompt(formatForAI, meetingType || "interview"),
    interviewShape,
    buildTier0FormatGuide(responseFormat, customFormatPrompt, quickMode),
  ].filter(Boolean).join("\n\n");
}

function normalizeInterviewStyleNoBullets(style: any): any {
  return style;
}

function resolveRequestedModel(
  explicitModel: string | undefined,
  meeting: Meeting | null | undefined,
  question: string,
  options?: { multiQuestionCount?: number; isComplexTurn?: boolean },
): string | undefined {
  const candidate = explicitModel || meeting?.model || undefined;
  if (!candidate || candidate === "automatic") {
    return resolveAutomaticInterviewModel(question, {
      sessionMode: meeting?.sessionMode,
      multiQuestionCount: options?.multiQuestionCount,
      isComplexTurn: options?.isComplexTurn,
    });
  }
  return candidate;
}

function normalizeParagraphOutput(text: string): string {
  if (!text) return "";
  return text
    .replace(/\r\n/g, "\n")
    .replace(/^\s*sorry,?\s*but\s*i\s*can'?t\s*provide\s*a\s*response\s*in\s*that\s*format\.?\s*/i, "")
    .replace(/^\s*i'?m\s*sorry,?\s*but\s*i\s*can'?t\s*[^.]*\.\s*/i, "")
    .replace(/^\s*however,?\s*/i, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

function flattenBulletFormatting(text: string): string {
  if (!text) return "";
  return text
    .replace(/^[\t ]*[-*•]\s+/gm, "")
    .replace(/^[\t ]*\d+\.\s+/gm, "")
    .replace(/^[\t ]*\d+\)\s+/gm, "")
    .replace(/\s+-\s+/g, ". ")
    .replace(/\s+\d+\)\s+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeReadableOutput(text: string): string {
  if (!text) return "";
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u2026/g, "...")
    .replace(/^\s*\.\.\.\s*/, "")
    .replace(/^[\s,;:.-]+/, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?])([A-Za-z])/g, "$1 $2")
    .replace(/\b(\w+)\s+\1\b/gi, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function expandSingleLineCode(code: string, language: string): string {
  const lang = (language || "").toLowerCase();
  let out = code.trim();
  if (!out) return out;

  // If it's already multi-line, keep as-is.
  if (out.includes("\n")) return out;

  // Light normalization to break long single-line code into readable lines.
  if (lang.includes("python") || lang === "py") {
    out = out
      .replace(/\s+(def|class)\s+/g, "\n\n$1 ")
      .replace(/\s+(if|elif|else|for|while|try|except|with)\b/gi, "\n$1")
      .replace(/:\s*/g, ":\n    ")
      .replace(/;\s*/g, "\n");
  } else {
    out = out
      .replace(/;\s*/g, ";\n")
      .replace(/\{\s*/g, "{\n")
      .replace(/\}\s*/g, "\n}\n")
      .replace(/\s+(if|else if|else|for|while|try|catch|finally)\b/gi, "\n$1");
  }

  out = out
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return out;
}

function normalizeCodeBlocks(text: string): string {
  if (!text) return text;
  const fenceRe = /```(\w+)?\s*([\s\S]*?)```/g;
  return text.replace(fenceRe, (_m, langRaw, codeRaw) => {
    const lang = String(langRaw || "").trim();
    let code = String(codeRaw || "").trim();
    if (!code) return "```" + lang + "```";
    // Strip text/plain/plaintext fences — AI sometimes wraps prose in these; output as normal text
    if (/^(text|plain|plaintext)$/i.test(lang)) return code;
    code = expandSingleLineCode(code, lang);
    return `\`\`\`${lang}\n${code}\n\`\`\``;
  });
}

function detectLanguageFromQuestion(question: string): string {
  const q = String(question || "").toLowerCase();
  if (q.includes("python")) return "python";
  if (q.includes("java") && !q.includes("javascript")) return "java";
  if (q.includes("javascript") || q.includes("js")) return "javascript";
  if (q.includes("typescript") || q.includes("ts")) return "typescript";
  if (q.includes("c#") || q.includes("dotnet") || q.includes(".net")) return "csharp";
  if (q.includes("c++")) return "cpp";
  if (q.includes("sql")) return "sql";
  if (q.includes("bash") || q.includes("shell")) return "bash";
  return "";
}

function looksLikeCodeSnippet(text: string): boolean {
  const t = String(text || "");
  if (!t) return false;
  if (t.includes("```")) return true;
  if (/^\s*(def|class|function|import|from|public|private|const|let|var|#include|using|SELECT|INSERT|UPDATE|DELETE)\b/m.test(t)) return true;
  if (/[;{}]=|\breturn\b/.test(t)) return true;
  return false;
}

function wrapAsCodeBlockIfNeeded(question: string, answer: string): string {
  const hasFence = /```/.test(answer);
  const qAsksForCode = /\b(write|build|implement|code|program|function|script|example)\b/i.test(question);
  if (hasFence || !qAsksForCode) return answer;
  if (!looksLikeCodeSnippet(answer)) return answer;
  const lang = detectLanguageFromQuestion(question);
  return `\`\`\`${lang}\n${answer.trim()}\n\`\`\``;
}

function isAmbiguousInterviewQuestion(raw: string): boolean {
  const q = String(raw || "").toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
  if (!q) return true;
  const words = q.split(" ").filter(Boolean);
  if (words.length <= 4) return true;
  if (/^(do you have experience in|experience in|tell me about|can you explain)\s*$/.test(q)) return true;
  return false;
}

function postprocessFinalAnswer(question: string, answer: string, enforceNoBullets = false): string {
  let out = normalizeParagraphOutput(answer);
  if (!out) return out;

  // Keep prompt-chosen formatting. Minimal cleanup only.
  const _unused = question;
  void _unused;

  // If question asks for code and model didn't fence, wrap it so UI renders a code box.
  out = wrapAsCodeBlockIfNeeded(question, out);

  // Normalize fenced code blocks to ensure proper line breaks.
  out = normalizeCodeBlocks(out);

  // If caller wants no bullets, flatten bullet formatting into prose.
  if (enforceNoBullets) {
    out = flattenBulletFormatting(out);
  }

  // Preserve Interviewer/Candidate labels when present.
  // Ensure a blank line between Interviewer and Candidate blocks for readability.
  out = out.replace(/(Interviewer\s*:[^\n]*)(\n+)(Candidate\s*:)/gi, "$1\n\n$3");

  // If model still emits Q1/Q2-style sections, flatten them into normal prose.
  out = out
    .replace(/(^|\s)q\d+\s*:\s*/gi, "$1")
    .replace(/(^|\n)\s*question\s*\d+\s*:\s*/gi, "$1");

  // Keep first-person singular voice where possible.
  out = out
    .replace(/(^|[.!?]\s+)we\s+/gi, "$1I ")
    .replace(/(^|[.!?]\s+)we've\s+/gi, "$1I've ")
    .replace(/(^|[.!?]\s+)we're\s+/gi, "$1I'm ");

  // Remove leading punctuation artifacts from streaming/cleanup.
  out = out.replace(/^[\s,;:.-]+/, "");

  out = normalizeReadableOutput(out);
  return out;
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

function buildImmediateLead(question: string): string {
  const q = String(question || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!q) return "…";
  if (/^rewrite\b/.test(q)) return "";
  return "…";
}

function extractInterviewerQuestions(raw: string): string[] {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  const normalizeQuestionCandidate = (input: string): string => {
    let s = String(input || "").trim();
    if (!s) return "";
    s = s
      .replace(/^interviewer\s*:\s*/i, "")
      .replace(/^\s*(and also|also|so|okay|ok)\s+/i, "")
      .replace(/\s+/g, " ")
      .trim();
    // Remove immediate repeated words from noisy ASR.
    const words = s.split(" ").filter(Boolean);
    const dedup: string[] = [];
    for (const w of words) {
      if (!dedup.length || dedup[dedup.length - 1].toLowerCase() !== w.toLowerCase()) {
        dedup.push(w);
      }
    }
    s = dedup.join(" ").trim();
    if (!s) return "";
    if (!/[?]$/.test(s) && /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|is|are|tell|walk|explain)\b/i.test(s)) {
      s = `${s}?`;
    }
    return s.slice(0, 280).trim();
  };

  // Primary path: explicit question punctuation.
  const punctParts = text
    .split(/\?+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (punctParts.length > 1) {
    return punctParts
      .map((p) => normalizeQuestionCandidate(p))
      .filter((p) => p.split(/\s+/).filter(Boolean).length >= 2)
      .slice(0, 6);
  }

  // Fallback: detect multiple question starters in one sentence.
  const starterRe = /\b(do you|have you|can you|could you|would you|what|why|how|when|where|which|who|tell me|walk me through|explain)\b/gi;
  const matches: number[] = [];
  let m: RegExpExecArray | null = null;
  while ((m = starterRe.exec(text)) !== null) {
    matches.push(m.index);
    if (matches.length >= 6) break;
  }
  if (matches.length <= 1) return [];

  const parts: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1] : text.length;
    const part = text.slice(start, end).trim().replace(/[,.]\s*$/g, "");
    const normalizedPart = normalizeQuestionCandidate(part);
    if (normalizedPart && normalizedPart.split(/\s+/).filter(Boolean).length >= 2) parts.push(normalizedPart);
  }
  return parts.slice(0, 6);
}

function extractExplicitNumberedQuestions(raw: string): string[] {
  const text = String(raw || "").replace(/\r\n/g, "\n");
  if (!text.trim()) return [];
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:\d+[\).]\s*)(.+?)(?=(?:\n\s*\d+[\).]\s*)|$)/gms;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(text)) !== null) {
    const q = String(m[1] || "").replace(/\s+/g, " ").trim();
    if (!q) continue;
    if (/^answer all interviewer questions/i.test(q)) continue;
    out.push(q.endsWith("?") ? q : `${q}?`);
    if (out.length >= 6) break;
  }
  return out;
}

function pickPrimaryInterviewerQuestion(questions: string[]): string {
  if (!Array.isArray(questions) || questions.length === 0) return "";
  const cleaned = questions.map((q) => String(q || "").trim()).filter(Boolean);
  if (!cleaned.length) return "";

  // Prefer the latest explicit question-like clause in the transcript turn.
  for (let i = cleaned.length - 1; i >= 0; i--) {
    const q = cleaned[i];
    if (/\?/.test(q) || /\b(do you|have you|can you|could you|would you|what|why|how|when|where|which|who|tell me|walk me through|explain)\b/i.test(q)) {
      return q;
    }
  }
  return cleaned[cleaned.length - 1];
}

function buildScenarioAnswerHint(rawQuestion: string): string {
  const text = String(rawQuestion || "");
  if (!text) return "";
  const lower = text.toLowerCase();
  const scenarioSignals = [
    "flow:",
    "now the problem",
    "during peak load",
    "be concrete",
    "walk me through exactly",
    "what happens if",
    "how do you",
    "would you use",
    "double charge",
    "regulated",
  ];
  const hits = scenarioSignals.filter((s) => lower.includes(s)).length;
  if (text.length < 180 && hits < 2) return "";

  return [
    "Scenario-answer requirements:",
    "- Treat this as a production incident/system-design interview scenario.",
    "- Answer in clear ordered sections: design, request flow, failure handling, retry safety, and exact HTTP behaviors.",
    "- Explicitly cover idempotency key lifecycle, persistence schema, timeout/retry behavior, and duplicate replay handling.",
    "- If multiple sub-questions exist, answer each in order and avoid skipping any.",
  ].join("\n");
}

function logPromptHash(params: {
  transport: StreamAssistantAnswerTransport;
  provider: string;
  model: string;
  format: string;
  style: string;
  maxTokens: number;
  temperature: number;
  systemPrompt: string;
  userPrompt: string;
}): void {
  if (process.env.DEBUG_PROMPT_HASH !== "1") return;
  const messages = buildMessages(params.systemPrompt, params.userPrompt);
  const hash = crypto.createHash("sha256").update(JSON.stringify(messages)).digest("hex");
  console.log(
    `[prompt_hash] transport=${params.transport} provider=${params.provider} model=${params.model} format=${params.format} style=${params.style} max_tokens=${params.maxTokens} temperature=${params.temperature} prompt_hash=${hash}`,
  );
}

export async function* streamAssistantAnswer(
  options: StreamAssistantAnswerOptions,
): AsyncGenerator<StreamAssistantAnswerEvent> {
  const {
    meetingId,
    userId,
    question,
    format,
    customFormatPrompt,
    quickMode,
    docsMode,
    meeting: meetingHint,
    model: requestedModel,
    transport = "sse",
    abortSignal,
    maxTokensOverride,
    temperatureOverride,
    submitSource,
    lastInterviewerQuestion,
    recentSpokenReply,
    sessionJobDescription,
    sessionSystemPrompt,
    liveTranscript,
    conversationHistory,
    sessionContext,
    refineContext,
  } = options;
  const effectiveQuestion = sanitizeDisplayQuestion(question);
  const requestId = options.requestIdOverride || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tReqReceived = Date.now();
  let tLlmStarted = 0;
  let tFirstTokenReceived = 0;
  let tFirstChunkSent = 0;
  let tStreamEnd = 0;
  let tPersistStart = 0;
  let tPersistEnd = 0;
  let totalChars = 0;
  let totalChunks = 0;
  const MAX_DOC_CHARS = 6000;
  const MAX_MEMORY_CHARS = 2000;
  const MAX_CONVO_CHARS = 2000;
  const MAX_TURNS_CHARS = 1200;

  abortSessionStream(meetingId);

  const abortController = new AbortController();
  let activeController = abortController;
  activeStreams.set(meetingId, abortController);

  let aborted = false;
  const onAbort = () => {
    aborted = true;
    activeController.abort();
    activeStreams.delete(meetingId);
  };
  if (abortSignal) {
    if (abortSignal.aborted) onAbort();
    abortSignal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    yield { type: "start", requestId };

    // Stream-first: do not await DB before first token.
    const meeting = meetingHint || null;
    const cacheMetrics = defaultHotPathMetrics();
    const settingsProbe = await getOrLoadSettings<MeetingSettings>(
      userId,
      meetingId,
      async () => {
        if (meeting) return toMeetingSettings(meeting);
        const fetched = await storage.getMeeting(meetingId);
        return toMeetingSettings(fetched || null);
      },
    );
    cacheMetrics.settings = settingsProbe.hit ? "hit" : "miss";
    const meetingSettings = toMeetingSettings(settingsProbe.value as any);
    if (meeting && meeting.userId !== userId) {
      yield { type: "error", requestId, message: "Not authorized" };
      return;
    }

    // Turbo first token: emit an immediate short lead so UI starts rendering instantly.
    const immediateLead = buildImmediateLead(effectiveQuestion);
    if (immediateLead) {
      totalChunks += 1;
      totalChars += immediateLead.length;
      if (!tFirstChunkSent) {
        tFirstChunkSent = Date.now();
        recordTtft(transport, tFirstChunkSent - tReqReceived);
      }
      yield { type: "chunk", requestId, text: immediateLead };
    }

    // ── Heuristic fast-path ─────────────────────────────────────────────────────
    // For common predictable questions (tell me about yourself, strengths, etc.)
    // serve a pre-generated cached answer — no LLM round-trip needed.
    const heuristicAnswer = getHeuristicAnswer(meetingId, effectiveQuestion);
    if (heuristicAnswer) {
      console.log(`[heuristic] cache_hit meeting=${meetingId} question="${effectiveQuestion.slice(0, 60)}"`);
      // Stream in small word-groups for natural appearance
      const words = heuristicAnswer.split(" ");
      for (let i = 0; i < words.length; i += 4) {
        if (aborted) break;
        const chunk = words.slice(i, i + 4).join(" ") + (i + 4 < words.length ? " " : "");
        totalChunks++;
        totalChars += chunk.length;
        if (!tFirstChunkSent) {
          tFirstChunkSent = Date.now();
          recordTtft(transport, tFirstChunkSent - tReqReceived);
        }
        yield { type: "chunk", requestId, text: chunk };
      }
      yield { type: "end", requestId, response: { question: effectiveQuestion, answer: heuristicAnswer, responseType: "automatic" } };
      void storage.createResponse({
        meetingId,
        question: effectiveQuestion,
        answer: heuristicAnswer,
        responseType: "automatic",
        questionHash: computeQuestionHash(meetingId, effectiveQuestion),
      }).catch((err: any) => console.error("[heuristic] persist failed:", err?.message));
      return;
    }
    // ── End heuristic fast-path ─────────────────────────────────────────────────

    const style = getAnswerStyle(meetingId);
    recordUserQuestion(meetingId, effectiveQuestion || question);
    console.log(`[assist] stream_start meeting=${meetingId} transport=${transport} source=${submitSource || "unknown"}`);
    const sessionState = getSessionState(meetingId);
    const useQuickMode = quickMode !== false;
    // Detect candidate-correction rewrite requests (generated by resolveEnterSeed on the client
    // when the candidate speaks a correction after seeing the AI answer).
    const isCandidateCorrectionRewrite = /^The candidate just said:/i.test(effectiveQuestion.trim());
    const resolvedDocsMode: DocsRetrievalMode = docsMode === "always" || docsMode === "off" ? docsMode : "auto";
    const candidateSpan = isCandidateCorrectionRewrite
      ? (recentSpokenReply || effectiveQuestion.split("\n")[0]).trim()
      : (extractCandidateSpan(effectiveQuestion) || effectiveQuestion.trim());
    const boundedQuestionSpan = candidateSpan.split(/\s+/).slice(-40).join(" ").slice(0, 480).trim() || question.trim();
    const questionHash = computeQuestionHash(meetingId, `${style}:${question}`);
    const docQuestionFingerprint = normalizeForDedup(boundedQuestionSpan).slice(0, 240) || questionHash;
    // Use smart retrieval gate for both Tier-0 and Tier-1.
    // Previously Tier-0 only retrieved when mode="always" — meaning behavioral/
    // experience questions never got STAR stories or resume context in fast answers.
    const retrieveDocsForTier1 = shouldRetrieveDocs(boundedQuestionSpan, resolvedDocsMode);
    const ackReplyNorm = String(recentSpokenReply || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    const ackOnly = !isCandidateCorrectionRewrite && /^(yes|yeah|yep|yup|correct|right|sure|i do|i did|absolutely|of course|exactly)$/.test(ackReplyNorm);
    const followUpQuestionBase = ackOnly && lastInterviewerQuestion
      ? lastInterviewerQuestion
      : effectiveQuestion;
    const hasCodingContext = Boolean(sessionState.codingProblemState);
    const followUp = isFollowUp(followUpQuestionBase, { lastAssistantAt: sessionState.lastAssistantAt, hasCodingContext });
    const subtypeResult = detectTechnicalSubtype(effectiveQuestion, hasCodingContext);
    const technicalIntent = classifyTechnicalIntent(followUp.codeTransition, subtypeResult?.subtype);
    const followUpResolution = followUp.isFollowUp
      ? resolveFollowUp(effectiveQuestion, sessionState.codingProblemState ?? null, followUp.codeTransition, technicalIntent)
      : null;
    const anchor = resolveAnchorTurn(sessionState);
    const vagueQuestion = isVagueQuestion(effectiveQuestion);
    const relevantPairs = followUp.isFollowUp
      ? selectRelevantQAPairs(meetingId, effectiveQuestion, 4, FOLLOWUP_MAX_CHARS)
      : vagueQuestion
        ? selectRelevantQAPairs(meetingId, effectiveQuestion, useQuickMode ? 3 : 8, useQuickMode ? 1200 : 3200) // quick mode: smaller scan to reduce latency
        : selectRelevantQAPairs(meetingId, effectiveQuestion, 2, 800);
    const recentSpokenReplies = getRecentSpokenReplies(meetingId, 10, 2000);
    const spokenRepliesBlock = recentSpokenReplies.length
      ? recentSpokenReplies
          .slice()
          .reverse()
          .map((r) => `- ${r.text}`)
          .join("\n")
      : "";
    const styleAppliedQuestion = effectiveQuestion.startsWith("Answer style:")
      ? effectiveQuestion
      : applyAnswerStyle(style, effectiveQuestion);
    const tier0StyledQuestion = applyAnswerStyle(style, boundedQuestionSpan);

    const validFormats = ["automatic", "concise", "detailed", "star", "bullet", "technical", "short", "custom", "code_example"];
    const responseFormat = (format && validFormats.includes(format)) ? format : meetingSettings.responseFormat;
    const formatForAI = responseFormat === "custom" ? "concise" : responseFormat;
    const safeInterviewStyle = normalizeInterviewStyleNoBullets(meetingSettings.interviewStyle as any);

    const extractedContext = extractPromptProfileContext(meetingSettings.customInstructions || "");
    const extractedResume = extractedContext.resume;
    const extractedJobDescription = extractedContext.jobDescription;
    const profileSourceForFacts = extractedResume || meetingSettings.customInstructions || "";
    const factPriorityHint = buildFactPriorityHint(question, profileSourceForFacts);
    const promptMemoryEvidenceHint = buildPromptMemoryEvidenceHint(question, profileSourceForFacts);
    const effectiveJobDescription = (sessionJobDescription || extractedJobDescription || "").trim();
    const interviewerIntelligenceBlock = buildInterviewerIntelligenceBlock(meetingId, effectiveQuestion, 5);
    const companyAndJdKnowledgeBlock = buildCompanyAndJdKnowledgeBlock(
      effectiveQuestion,
      effectiveJobDescription,
      meetingSettings.customInstructions || "",
    );
    const sessionIntelligenceBlock = [interviewerIntelligenceBlock, companyAndJdKnowledgeBlock]
      .filter(Boolean)
      .join("\n\n");
    const enforceNoBulletsFromPrompt = /(?:no|without)\s+bullet|not\s+bullet|paragraph\s+only|no\s+bullet\s+points?/i.test(meetingSettings.customInstructions || "");
    const hasCustomPrompt = Boolean(meetingSettings.customInstructions && meetingSettings.customInstructions.trim());

    // When a custom prompt is active, skip RESPONSE_STYLE_RULE — the custom prompt IS the style rule.
    // STRICT_NO_INVENT_RULE always stays as a hard guardrail regardless.
    const hasActiveCustomPrompt = hasCustomPrompt || Boolean(sessionSystemPrompt?.trim());
    let effectiveInstructions = hasActiveCustomPrompt
      ? STRICT_NO_INVENT_RULE
      : [STRICT_NO_INVENT_RULE, RESPONSE_STYLE_RULE].join("\n\n");
    if (hasCustomPrompt) {
      effectiveInstructions = `${effectiveInstructions}\n\n=== CUSTOM INSTRUCTIONS (follow these exactly for format, tone, style, length) ===\n${meetingSettings.customInstructions.trim()}\n===`;
    }
    if (sessionSystemPrompt && sessionSystemPrompt.trim()) {
      effectiveInstructions = effectiveInstructions
        ? `${effectiveInstructions}\n\n=== SESSION INSTRUCTIONS (highest priority — override everything except hard guardrails) ===\n${sessionSystemPrompt.trim()}\n===`
        : `=== SESSION INSTRUCTIONS (highest priority — override everything except hard guardrails) ===\n${sessionSystemPrompt.trim()}\n===`;
    }
    if (responseFormat === "custom" && customFormatPrompt) {
      effectiveInstructions = effectiveInstructions
        ? effectiveInstructions + "\n\nCustom format instructions:\n" + customFormatPrompt
        : "Custom format instructions:\n" + customFormatPrompt;
    }

    const customPromptHash = customFormatPrompt
      ? crypto.createHash("sha1").update(customFormatPrompt).digest("hex").slice(0, 8)
      : "none";
    const promptTemplateKey = `${formatForAI}::${meetingSettings.type || "interview"}::${responseFormat}::${useQuickMode ? "q1" : "q0"}::${customPromptHash}`;
    const promptTemplateProbe = getOrLoadPromptTemplate(promptTemplateKey, () =>
      getTier0Template(formatForAI, responseFormat, meetingSettings.type, customFormatPrompt, useQuickMode),
    );
    cacheMetrics.promptTemplate = promptTemplateProbe.hit ? "hit" : "miss";
    const tier0BaseTemplate = promptTemplateProbe.value;
    const summaryProbe = getOrLoadConversationSummary(meetingId, () => meetingSettings.rollingSummary || "");
    cacheMetrics.conversationSummary = summaryProbe.hit ? "hit" : "miss";
    const cachedSummary = summaryProbe.value;

    // Load resume/docs/memory for Tier-0 (before first token)
    // Run memory + session insights in parallel to cut pre-LLM latency
    const memCacheKey = `mem:${userId}`;
    const cachedMem = getCached(memoryContextCache, memCacheKey);
    const [tier0MemoryContext, sessionInsights] = await Promise.all([
      cachedMem
        ? Promise.resolve(cachedMem)
        : formatMemorySlotsForPrompt(userId, meetingId).then((v) => {
            setCached(memoryContextCache, memCacheKey, v || "", MEMORY_CACHE_TTL_MS);
            return v || "";
          }),
      // Skip expensive session insights in quick mode — saves ~100-300ms
      useQuickMode ? Promise.resolve("") : formatSessionReviewsForPrompt(userId).catch(() => ""),
    ]);

    let tier0DocumentContext = "";
    const docIds = meetingSettings.documentIds;
    if (retrieveDocsForTier1 && docIds && docIds.length > 0) {
      const docsProbe = await getOrLoadDocRetrieval(
        meetingId,
        docQuestionFingerprint,
        docIds.slice().sort().join(","),
        async () => {
          return retrieveDocumentContext(userId, question, docIds);
        },
      );
      cacheMetrics.docRetrieval = docsProbe.hit ? "hit" : "miss";
      tier0DocumentContext = docsProbe.value.slice(0, MAX_DOC_CHARS);
    }
    const tier0TurnContext = meetingSettings.conversationContext
      .split("\n")
      .slice(-120)
      .join("\n")
      .slice(-1800);
    const prevAnswerHasCode = /```/.test(anchor.lastAssistantAnswer || "");
    const isContinuationRequest = /^(more|more\?|and more|show more|continue|expand|go on|keep going|proceed|what else|more code|more example|give more|elaborate|say more|next|next step|what next|more detail|more details|show me more|give me more|can you expand|can you give more|can you show more|add more|extend|extended|complete|full|full code|complete code)\??$/i.test(effectiveQuestion.trim());
    const isCodeFollowUpQuestion = /\b(why|why did|why did you|why use|why used|why are you using|what is|what does|what are|how does|how do|how is|explain|explain this|explain the|walk me through|line by line|this line|this block|this function|this method|this approach|this algorithm|what approach|which approach|modify|change|update|fix|optimize|refactor|add|remove|alternative|difference|better|instead|improve|when to use|trade off|tradeoff)\b/i.test(effectiveQuestion);

    // Extract code block from anchor answer for injection into follow-up context
    const anchorCodeMatch = (anchor.lastAssistantAnswer || "").match(/```[\w]*\n?([\s\S]*?)```/);
    const anchorCodeBlock = anchorCodeMatch ? anchorCodeMatch[0] : "";

    const followUpPolicy = followUp.isFollowUp
      ? buildCodeTransitionPolicy(followUp.codeTransition, prevAnswerHasCode, isContinuationRequest, isCodeFollowUpQuestion, anchorCodeBlock, meetingId)
      : "";


    const capturedCodeContext = getCodeContext(meetingId);
    const codeFollowUpBlock = capturedCodeContext?.latestAnswer
      ? (() => {
          // Always inject captured code if there is any — the interviewer may ask about
          // any part of it using vague references like "why did you use else" or "is there a better way".
          // Only skip if the question is clearly unrelated to code (behavioural, salary, etc.)
          const isExplicitlyNonCode = /\b(tell me about yourself|walk me through your background|why do you want|salary|compensation|culture|team|behavioural|behavioral|strength|weakness|outside of work)\b/i.test(effectiveQuestion);
          if (isExplicitlyNonCode) return "";

          const parts = [
            "=== CAPTURED CODE CONTEXT ===",
            "The following code was captured from the user's screen. This is the ACTIVE code in this interview session.",
            `Original capture question: "${capturedCodeContext.latestQuestion || "screen capture"}"`,
            "Captured code/answer:",
            capturedCodeContext.latestAnswer.slice(0, 3000),
          ];
          if (capturedCodeContext.previousAnswer) {
            parts.push("Previous version (before the last change):");
            parts.push(capturedCodeContext.previousAnswer.slice(0, 1500));
          }
          // Inject recent interviewer question to anchor which part of the code is being asked about
          const interviewerAnchor = lastInterviewerQuestion || effectiveQuestion;
          parts.push(
            "===",
            `INTERVIEWER IS NOW ASKING: "${interviewerAnchor}"`,
            "IMPORTANT: Read the interviewer's question carefully and find the SPECIFIC part of the captured code they are referring to (e.g. a specific if/else branch, a specific variable, a specific loop). Answer about that specific part — do NOT give a generic answer.",
          );

          const isModifyRequest = /\b(modify|fix|change|update|optimize|refactor|improve|convert|extend|add|remove|replace|rewrite|redo|rewrite|make it|can you make|can you change|can you add|can you remove)\b/i.test(effectiveQuestion);
          const isExplainRequest = !isModifyRequest;

          parts.push(
            "CODE FOLLOW-UP FORMAT (always follow this exact order):",
            "1. Plain-text explanation first (2-3 sentences) — directly answer what the interviewer asked, referencing the specific line/block/construct they asked about. Speak in first person. NO code block here.",
            "2. Code block — include the complete relevant code in a fenced block (e.g. ```python). NEVER skip the code block.",
            isExplainRequest
              ? "3. Point to the exact lines — after the code block, call out the specific line numbers or blocks that answer the question."
              : "3. 'What changed:' section — list each modified line and why.",
            "4. Keep it natural, spoken, first person — as if explaining to the interviewer directly.",
            "RULE: Always include both explanation AND code block. Never generic — always specific to the captured code.",
          );
          if (isModifyRequest) {
            parts.push(
              "MODIFICATION RULE: Return the FULL complete code — every line, not just the changed part. Mark every changed or newly added line with an inline comment: `// ← changed` for JS/TS/Java/C#/Go/Rust, `# ← changed` for Python/Ruby/Shell, `-- ← changed` for SQL.",
            );
          }
          return parts.join("\n");
        })()
      : "";

    // Subtype answer shape — fires only when no more-specific policy is active.
    // Code transitions and captured code provide their own numbered order instructions,
    // so the subtype shape is suppressed when either is present.
    const subtypeAnswerShape = !followUp.codeTransition && !codeFollowUpBlock && subtypeResult
      ? buildSubtypeAnswerShape(subtypeResult.subtype)
      : "";

    const tier0SystemPrompt = [
          tier0BaseTemplate,
          effectiveJobDescription ? `Job description:\n${effectiveJobDescription.slice(0, MAX_JOB_DESCRIPTION_CHARS)}` : "",
          extractedResume ? `Resume/Profile:\n${extractedResume.slice(0, MAX_RESUME_CONTEXT_CHARS)}` : "",
          tier0DocumentContext ? `Documents:\n${tier0DocumentContext.slice(0, 1000)}` : "",
          // Live transcript placed early so LLM has full session context before answer shaping.
          // Critical for thin follow-ups ("elaborate", "why") — LLM must see what was said.
          liveTranscript ? `Live interview transcript (full session so far, oldest first — use this to understand the full question and context before answering):\n${liveTranscript}` : "",
          tier0MemoryContext ? `Key facts (employer, role, stack, achievements — use these when relevant):\n${tier0MemoryContext.slice(0, 1600)}` : "",
          sessionInsights ? sessionInsights : "",
          sessionIntelligenceBlock ? sessionIntelligenceBlock : "",
          spokenRepliesBlock ? `Recent candidate spoken answers (what I already said — stay consistent):\n${spokenRepliesBlock}` : "",
    effectiveInstructions ? `Custom instructions (highest priority, follow strictly unless they conflict with no-invention/safety rules): ${effectiveInstructions.slice(0, TIER0_CUSTOM_INSTRUCTIONS_CHARS)}` : "",
          // sessionContext is the in-memory labeled log sent directly from the client,
          // bypassing the 1.2s DB persist delay. It includes the candidate's most recent
          // spoken words (e.g. "Candidate: no I don't have direct experience in React")
          // so the LLM can answer consistently with what the candidate just said.
          sessionContext ? `Live session log (most recent — includes candidate's own spoken responses, use to stay consistent with what candidate already said):\n${sessionContext.slice(0, 4000)}` : "",
          tier0TurnContext ? `Recent conversation (from DB):\n${tier0TurnContext}` : "",
          conversationHistory?.length ? `Recent Q&A history (use for follow-up context, do not repeat these answers verbatim):\n${conversationHistory.map((p, i) => `Q${i + 1}: ${p.q}\nA${i + 1}: ${p.a}`).join("\n\n")}` : "",
          subtypeAnswerShape,
          followUpPolicy,
          codeFollowUpBlock,
          // Only inject coding state when question is actually code-related — avoids
          // bloating behavioral/experience prompts with 1500+ chars of code context.
          (() => {
            if (!hasCodingContext) return "";
            const isCodeRelatedForContext =
              Boolean(followUp.codeTransition) ||
              Boolean(codeFollowUpBlock) ||
              (prevAnswerHasCode && isCodeFollowUpQuestion) ||
              isContinuationRequest;
            return buildCodingContextBlock(meetingId, isCodeRelatedForContext);
          })(),
          // Refinement rubric — appended last so it has final authority over answer structure.
          // Present only during the second pass; empty string on the fast pass.
          refineContext || "",
        ].filter(Boolean).join("\n\n");

    const buildTier1Prompt = async (): Promise<string> => {
      const meetingForTier1 = meeting;
      const tier1Settings = meetingForTier1 ? toMeetingSettings(meetingForTier1) : meetingSettings;
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
        storage.getRecentTranscriptTurns(meetingId, 4),
      ]);
      const memoryContext = (rawMemoryContext || "").slice(0, MAX_MEMORY_CHARS);
      let documentContext = "";
      const docIds = tier1Settings.documentIds;
      if (retrieveDocsForTier1 && docIds && docIds.length > 0) {
        const docsProbe = await getOrLoadDocRetrieval(
          meetingId,
          docQuestionFingerprint,
          docIds.slice().sort().join(","),
          async () => {
            return retrieveDocumentContext(userId, question, docIds);
          },
        );
        cacheMetrics.docRetrieval = docsProbe.hit ? "hit" : "miss";
        documentContext = docsProbe.value.slice(0, MAX_DOC_CHARS);
      }
      const turnContext = recentTurns.reverse().map((t) => `[Speaker]: ${t.text}`).join("\n");
      const convoContext = tier1Settings.conversationContext.slice(-MAX_CONVO_CHARS);
      const mergedContext = [convoContext, turnContext ? turnContext.slice(-MAX_TURNS_CHARS) : ""]
        .filter(Boolean)
        .join("\n");
      return buildSystemPrompt(
        formatForAI,
        tier1Settings.type,
        effectiveInstructions || undefined,
        [extractedResume ? `Resume/Profile:\n${extractedResume.slice(0, MAX_RESUME_CONTEXT_CHARS)}` : "", documentContext || ""].filter(Boolean).join("\n\n") || undefined,
        [effectiveJobDescription ? `Job description:\n${effectiveJobDescription.slice(0, MAX_JOB_DESCRIPTION_CHARS)}` : "", spokenRepliesBlock ? `Recent candidate spoken answers:\n${spokenRepliesBlock}` : "", sessionInsights || "", mergedContext].filter(Boolean).join("\n\n") || undefined,
        memoryContext || undefined,
        cachedSummary || undefined,
        normalizeInterviewStyleNoBullets(tier1Settings.interviewStyle as any),
        sessionIntelligenceBlock || undefined,
      );
    };

    let fullAnswer = "";
    const baselinePrompt = buildSystemPrompt(
          formatForAI,
          meetingSettings.type,
          effectiveInstructions || undefined,
          undefined,
          meetingSettings.conversationContext.slice(-MAX_CONVO_CHARS) || undefined,
          undefined,
          cachedSummary || undefined,
          safeInterviewStyle,
          sessionIntelligenceBlock || undefined,
        );
    const baselineWithFollowUp = followUp.isFollowUp && (followUpPolicy || codeFollowUpBlock)
      ? [baselinePrompt, followUpPolicy, codeFollowUpBlock].filter(Boolean).join("\n\n")
      : codeFollowUpBlock
        ? `${baselinePrompt}\n\n${codeFollowUpBlock}`
        : baselinePrompt;
    const promptToUse = useQuickMode ? tier0SystemPrompt : baselineWithFollowUp;
    let followUpPack = "";
    if (ackOnly && lastInterviewerQuestion) {
      followUpPack = [
        "=== FOLLOW-UP CONTEXT (affirmative short spoken reply) ===",
        `Interviewer question: ${lastInterviewerQuestion.slice(0, 400)}`,
        `Candidate short spoken reply: ${String(recentSpokenReply || "").slice(0, 120)}`,
        "Treat this as follow-up confirmation and provide a complete interview-ready answer.",
      ].join("\n");
    }
    if (followUp.isFollowUp) {
      // Fallback: extract last Candidate answer from persisted conversationContext when
      // in-memory sessionState is empty (e.g. after a server restart).
      let fallbackAnchorA = "";
      if (!anchor.lastAssistantAnswer && !relevantPairs[0]?.a) {
        const ctxLines = meetingSettings.conversationContext.split("\n");
        // Walk backwards to find the last "Candidate:" block (may span multiple lines)
        const candidateLines: string[] = [];
        for (let i = ctxLines.length - 1; i >= 0; i--) {
          if (/^Candidate:\s*/i.test(ctxLines[i])) {
            candidateLines.unshift(ctxLines[i].replace(/^Candidate:\s*/i, ""));
            break;
          }
        }
        fallbackAnchorA = candidateLines.join(" ").trim();
      }
      const anchorQ = (anchor.lastUserQuestion || relevantPairs[0]?.q || "").slice(0, 500);
      const anchorA = (anchor.lastAssistantAnswer || relevantPairs[0]?.a || fallbackAnchorA || "").slice(0, 2000);
      // When captured screen code is active, suppress the Q&A anchor answer so it doesn't
      // override the captured code context. The codeFollowUpBlock in the system prompt is the
      // authoritative source — old Q&A code answers must not bleed in here.
      const suppressAnchorAnswer = Boolean(codeFollowUpBlock);
      const extraPairs = relevantPairs.filter((p) => p.q !== anchorQ || p.a !== anchorA).slice(0, 3);
      const extraBlocks = suppressAnchorAnswer
        ? "" // skip old Q&A pairs too when captured code is active
        : extraPairs
            .map((p, i) => `Earlier Q${i + 1}: ${p.q.slice(0, 800)}\nEarlier A${i + 1}: ${p.a.slice(0, 1500)}`)
            .join("\n\n");
      const hasAnchor = Boolean(anchorQ || (!suppressAnchorAnswer && anchorA) || extraPairs.length);
      if (hasAnchor) {
        followUpPack = [
          "=== FOLLOW-UP CONTEXT (stay consistent with what was already said; do NOT contradict or repeat) ===",
          anchorQ ? `Most recent question: ${anchorQ}` : "",
          !suppressAnchorAnswer && anchorA ? `Most recent answer: ${anchorA}` : "",
          // Inject extracted code block separately so AI always has the actual code even if anchorA is long
          !suppressAnchorAnswer && anchorCodeBlock && prevAnswerHasCode && isCodeFollowUpQuestion
            ? `\nCode from previous answer (use this as reference for the follow-up):\n${anchorCodeBlock}`
            : "",
          extraBlocks ? `\nEarlier conversation:\n${extraBlocks}` : "",
          suppressAnchorAnswer
            ? "The user has captured a new screen. Answer ONLY based on the captured code in the system prompt — ignore prior code answers."
            : prevAnswerHasCode && isCodeFollowUpQuestion
              ? "Answer as a candidate explaining your own code — explanation first, then code, then what changed if applicable."
              : "Answer as a real candidate would — build naturally on the prior answer, add new detail, and stay first-person.",
        ].filter(Boolean).join("\n");
      }
    }
    // Extract the full current topic from the in-memory session log.
    // Only injected for vague/pronoun questions ("differentiate it", "explain that")
    // so it does NOT suppress multi-question answers where all questions must be addressed.
    const recentInterviewerTopicBlock = (() => {
      if (!vagueQuestion || !sessionContext) return "";
      const lines = sessionContext.split("\n").filter(Boolean);
      // Find the index of the last Candidate line (last AI answer boundary)
      let lastCandidateIdx = -1;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (/^Candidate:/i.test(lines[i])) { lastCandidateIdx = i; break; }
      }
      // Take everything after the last Candidate line — this is the current topic
      const topicLines = lines.slice(lastCandidateIdx + 1).filter(Boolean);
      if (!topicLines.length) {
        // No new lines after last answer — fall back to last 10 lines of full log
        const fallback = lines.slice(-10);
        if (!fallback.length) return "";
        return [
          "=== CURRENT INTERVIEW CONTEXT (most recent session log — use to resolve what 'it/that/this' refers to) ===",
          fallback.join("\n"),
        ].join("\n");
      }
      return [
        "=== CURRENT INTERVIEW TOPIC (everything since the last answer — use this to resolve what 'it/that/this/that scenario' refers to) ===",
        topicLines.join("\n"),
        "If the question uses a pronoun ('it', 'that', 'this'), it refers to the above context. Answer all parts of the question.",
      ].join("\n");
    })();

    const userPromptToUse = useQuickMode
      ? [recentInterviewerTopicBlock, followUpPack, tier0StyledQuestion].filter(Boolean).join("\n\n")
      : [recentInterviewerTopicBlock, followUpPack, styleAppliedQuestion].filter(Boolean).join("\n\n");

    const explicitListQuestions = extractExplicitNumberedQuestions(effectiveQuestion);
    const extractedQuestions = explicitListQuestions.length >= 2
      ? explicitListQuestions
      : extractInterviewerQuestions(effectiveQuestion);
    const primaryQuestion = pickPrimaryInterviewerQuestion(extractedQuestions);
    const questionWordCount = effectiveQuestion.split(/\s+/).filter(Boolean).length;
    const isComplexTurn =
      extractedQuestions.length > 1
      || followUp.isFollowUp
      || questionWordCount >= 18
      || /\b(walk me through|explain|design|architecture|tradeoff|idempotency|circuit breaker|saga|outbox|atomic)\b/i.test(effectiveQuestion);
    const scenarioHint = buildScenarioAnswerHint(effectiveQuestion);
    const multiQuestionBlock = extractedQuestions.length > 1
      ? [
          "MULTI-QUESTION MODE:",
          "Silently auto-correct obvious transcript/ASR errors in each question before answering.",
          "Answer EVERY question below in order. Do not skip any question.",
          "Return ONE natural first-person candidate response (no Q1/Q2 labels).",
          "Do NOT use bullet points or numbered sections.",
          "Keep it concise, interview-ready, and easy to speak.",
          "Questions:",
          ...extractedQuestions.map((q) => q),
        ].join("\n")
      : "";

    const finalUserPrompt = (hasCustomPrompt || (sessionSystemPrompt && sessionSystemPrompt.trim()))
      ? [recentInterviewerTopicBlock, buildStrictInterviewTurnUserPrompt({
          question: effectiveQuestion,
          followUpContext: followUpPack,
          scenarioHint,
          multiQuestionBlock,
          factPriorityHint,
          promptMemoryEvidenceHint,
        })].filter(Boolean).join("\n\n")
      : [recentInterviewerTopicBlock, factPriorityHint, promptMemoryEvidenceHint, scenarioHint, multiQuestionBlock, userPromptToUse]
          .filter(Boolean)
          .join("\n\n");
    const isCodeWritingQuestion = /\b(write|implement|build|create|develop)\b/i.test(effectiveQuestion)
      || /\b(snippet|leetcode|pseudocode)\b/i.test(effectiveQuestion);
    // Per-subtype token budgets — answer shapes differ significantly in required length.
    // system_design needs room for 6 sections; sql/explanation need far less.
    const subtypeTokenCap: Partial<Record<TechnicalSubtype, number>> = {
      system_design:    950,  // 6 sections, trade-offs, data model
      dsa:              950,  // approach + code + complexity + edge cases
      optimization:     950,  // bottleneck + approach + full code + before/after complexity
      code_modification:950,  // full modified code required
      backend:          700,  // concept + flow + code + gotchas
      frontend:         700,  // mental model + code + when-to-use
      debugging:        700,  // root cause + fix code + prevention
      sql:              500,  // explanation + SQL block + breakdown
      code_explanation: 420,  // quote + walkthrough + rationale
    };
    const tier0Cap = responseFormat === "short" || style === "brief"
      ? TIER0_MIN_TOKENS
      : codeFollowUpBlock
        ? TIER0_MAX_TOKENS  // code follow-ups always need full token budget for code block + explanation
        : subtypeResult
          ? (subtypeTokenCap[subtypeResult.subtype] ?? (isComplexTurn ? 360 : 280))
          : isCodeWritingQuestion
            ? TIER0_MAX_TOKENS
            : (isComplexTurn ? 360 : 280);
    const resolvedModel = resolveRequestedModel(requestedModel, meeting, effectiveQuestion, {
      multiQuestionCount: extractedQuestions.length,
      isComplexTurn,
    });
    let maxTokens = useQuickMode
      ? Math.max(
          TIER0_MIN_TOKENS,
          Math.min(TIER0_MAX_TOKENS, Math.min(tier0Cap, getMaxTokensForFormat(formatForAI, resolvedModel, true))),
        )
      : getMaxTokensForFormat(formatForAI, resolvedModel);
    if (typeof maxTokensOverride === "number" && Number.isFinite(maxTokensOverride)) {
      maxTokens = Math.max(50, Math.floor(maxTokensOverride));
    }

    const useCaseConfig = await getUseCaseConfigWithScope("LIVE_INTERVIEW_ANSWER", userId, resolvedModel);
    const temperature = typeof temperatureOverride === "number" && Number.isFinite(temperatureOverride)
      ? temperatureOverride
      : useCaseConfig.temperature;
    logPromptHash({
      transport,
      provider: useCaseConfig.provider,
      model: useCaseConfig.model,
      format: responseFormat,
      style,
      maxTokens,
      temperature,
      systemPrompt: promptToUse,
      userPrompt: finalUserPrompt,
    });

    // Emit debug metadata to client for live session visibility panel
    const ragChunkCount = (tier0DocumentContext.match(/^\[/gm) || []).length;
    yield {
      type: "debug_meta",
      requestId,
      model: useCaseConfig.model,
      provider: useCaseConfig.provider,
      style,
      tier: useQuickMode ? "tier0" : "tier1",
      maxTokens,
      ragChunks: ragChunkCount,
      tReqReceived,
    };

    let attempt = 0;
    let streamCompleted = false;
    let attemptMaxTokens = maxTokens;
    while (!streamCompleted && attempt <= MAX_FIRST_TOKEN_RETRIES) {
      const attemptController = new AbortController();
      activeController = attemptController;
      let firstTokenTimeout = false;
      let sawModelToken = false;
      const timeoutHandle = setTimeout(() => {
        if (!sawModelToken && !aborted && !attemptController.signal.aborted) {
          firstTokenTimeout = true;
          attemptController.abort();
        }
      }, FIRST_TOKEN_TIMEOUT_MS);

      try {
        tLlmStarted = Date.now();
        const generator = streamLLM(
          "LIVE_INTERVIEW_ANSWER",
          promptToUse,
          finalUserPrompt,
          meetingId,
          { maxTokens: attemptMaxTokens, cacheUserId: userId, model: resolvedModel, temperature },
          attemptController.signal,
        );

        for await (const chunk of generator) {
          if (!chunk || aborted || attemptController.signal.aborted) break;
          sawModelToken = true;
          if (!tFirstTokenReceived) {
            tFirstTokenReceived = Date.now();
            console.log(`[perf][server][${transport}] meeting=${meetingId} t_req_received=${tReqReceived} t_llm_started=${tLlmStarted} t_first_token_received=${tFirstTokenReceived}`);
          }
          if (!tFirstChunkSent) {
            tFirstChunkSent = Date.now();
            console.log(`[perf][server][${transport}] meeting=${meetingId} t_req_received=${tReqReceived} t_first_token_sent=${tFirstChunkSent} t_first_chunk_sent=${tFirstChunkSent} ttft=${tFirstChunkSent - tReqReceived}ms`);
            recordTtft(transport, tFirstChunkSent - tReqReceived);
          }
          const normalizedChunk = normalizeParagraphOutput(chunk);
          if (!normalizedChunk) continue;
          fullAnswer += normalizedChunk;
          totalChars += normalizedChunk.length;
          totalChunks += 1;
          yield { type: "chunk", requestId, text: normalizedChunk };
        }

        clearTimeout(timeoutHandle);
        if (firstTokenTimeout && !sawModelToken && attempt < MAX_FIRST_TOKEN_RETRIES && !aborted) {
          attempt += 1;
          attemptMaxTokens = Math.max(120, Math.floor(attemptMaxTokens * 0.7));
          console.warn(
            `[assist] first_token_timeout meeting=${meetingId} requestId=${requestId} retry=${attempt} maxTokens=${attemptMaxTokens}`,
          );
          continue;
        }
        streamCompleted = true;
      } catch (err: any) {
        clearTimeout(timeoutHandle);
        if ((err?.name === "AbortError" || attemptController.signal.aborted) && firstTokenTimeout && !sawModelToken && attempt < MAX_FIRST_TOKEN_RETRIES && !aborted) {
          attempt += 1;
          attemptMaxTokens = Math.max(120, Math.floor(attemptMaxTokens * 0.7));
          console.warn(
            `[assist] first_token_timeout_abort meeting=${meetingId} requestId=${requestId} retry=${attempt} maxTokens=${attemptMaxTokens}`,
          );
          continue;
        }
        throw err;
      }
    }

    if (aborted || activeController.signal.aborted) {
      yield { type: "end", requestId, response: { question, answer: fullAnswer, responseType: responseFormat }, cancelled: true };
      return;
    }

    fullAnswer = postprocessFinalAnswer(effectiveQuestion, fullAnswer, enforceNoBulletsFromPrompt);
    // Only run enforceStrictQaFormat when there is NO custom prompt active —
    // custom prompts define their own format and enforceStrictQaFormat would strip it.
    if (!hasActiveCustomPrompt) {
      fullAnswer = enforceStrictQaFormat(effectiveQuestion, fullAnswer);
    }

    if (!fullAnswer.trim()) {
      fullAnswer = "Based on our discussion so far, let me continue with what I was explaining.";
      totalChunks += 1;
      totalChars += fullAnswer.length;
      if (!tFirstChunkSent) {
        tFirstChunkSent = Date.now();
        recordTtft(transport, tFirstChunkSent - tReqReceived);
      }
      yield { type: "chunk", requestId, text: fullAnswer };
    }

    tStreamEnd = Date.now();
    yield { type: "end", requestId, response: { question: effectiveQuestion, answer: fullAnswer, responseType: responseFormat } };

    let finalAnswerForStorage = fullAnswer;
    if (fullAnswer.trim()) {
      try {
        const tier1Prompt = await buildTier1Prompt();
        const refined = await callLLM(
          "LIVE_INTERVIEW_ANSWER",
          tier1Prompt,
          [
            "Improve this draft answer using available context.",
            "Keep same facts, improve precision and interview quality.",
            "Preserve and follow the user's custom instructions exactly when present.",
            (hasCustomPrompt || (sessionSystemPrompt && sessionSystemPrompt.trim()))
              ? "Return the final answer in exact Interviewer / Candidate format if the custom instructions require it. Preserve first-person candidate voice and requested styling."
              : "Return first-person singular candidate answer only.",
            (hasCustomPrompt || (sessionSystemPrompt && sessionSystemPrompt.trim()))
              ? "Do not collapse the Interviewer and Candidate sections into one paragraph."
              : "Return paragraph-only format (no bullet points / numbered lists).",
            "Keep interview-ready tone and avoid assistant/meta wording.",
            "Return only the improved final answer.",
            "",
            `Question: ${effectiveQuestion}`,
            "",
            "Draft answer:",
            fullAnswer,
          ].join("\n"),
          meetingId,
          { maxTokens: isComplexTurn ? 360 : 220, temperature: 0.2, cacheUserId: userId, model: resolvedModel },
        );
        let cleanRefined = postprocessFinalAnswer(effectiveQuestion, (refined || "").trim(), enforceNoBulletsFromPrompt);
        if (hasCustomPrompt || (sessionSystemPrompt && sessionSystemPrompt.trim())) {
          cleanRefined = enforceStrictQaFormat(effectiveQuestion, cleanRefined);
        }
        if (
          cleanRefined
          && normalizeForDedup(cleanRefined) !== normalizeForDedup(fullAnswer)
          && cleanRefined.length > Math.floor(fullAnswer.length * 0.6)
        ) {
          finalAnswerForStorage = cleanRefined;
        }
      } catch {
        // Best-effort refine only.
      }
    }

    recordAssistantAnswer(meetingId, effectiveQuestion, finalAnswerForStorage, requestId);
    updateCodingProblemState(meetingId, effectiveQuestion, finalAnswerForStorage);

    // Auto-store code answers into codeContext so follow-up questions always have
    // the actual code available — even without a new screen capture.
    if (/```/.test(finalAnswerForStorage)) {
      setCodeContext(meetingId, {
        question: effectiveQuestion,
        answer: finalAnswerForStorage,
        capturedAt: Date.now(),
      });
    }

    const persistTask = async () => {
      tPersistStart = Date.now();
      const savedResponse = await storage.createResponse({
        meetingId,
        question: effectiveQuestion,
        answer: finalAnswerForStorage,
        responseType: responseFormat,
        questionHash,
      });
      tPersistEnd = Date.now();
      const meetingForPersist = meeting;
      processPostAnswerMemory(
        userId,
        meetingId,
        effectiveQuestion,
        finalAnswerForStorage,
        savedResponse?.id,
        {
          incognito: meetingForPersist?.incognito ?? false,
          saveFacts: meetingForPersist?.saveFacts ?? false,
          rollingSummary: meetingForPersist?.rollingSummary ?? "",
          turnCount: meetingForPersist?.turnCount ?? 0,
          conversationContext: meetingForPersist?.conversationContext ?? "",
        },
      ).catch((err: any) => console.error(`[memory][${requestId}] Post-answer failed:`, err.message));
      console.log(
        `[perf][server][${transport}] meeting=${meetingId} requestId=${requestId} t_req_received=${tReqReceived} t_llm_started=${tLlmStarted} t_first_token_received=${tFirstTokenReceived || 0} t_first_chunk_sent=${tFirstChunkSent || 0} t_stream_end=${tStreamEnd || Date.now()} t_persist_start=${tPersistStart} t_persist_end=${tPersistEnd} total_latency=${Date.now() - tReqReceived}ms quick=${useQuickMode} chunks=${totalChunks} chars=${totalChars} persisted_len=${finalAnswerForStorage.length}`,
      );
    };

    void persistTask().catch((err: any) => {
      console.error(`[streamAssistantAnswer][${requestId}] Persist failed:`, err?.message || err);
      enqueuePersistRetry(`${transport}:${meetingId}`, requestId, async () => {
        await persistTask();
      });
    });
    logHotPathMetrics(requestId, transport, cacheMetrics);
  } catch (err: any) {
    if (err.name === "AbortError" || activeController.signal.aborted) return;
    console.error(`[streamAssistantAnswer][${requestId}] Error:`, err.message);
    yield { type: "error", requestId, message: err.message };
  } finally {
    if (abortSignal) abortSignal.removeEventListener("abort", onAbort as any);
    activeStreams.delete(meetingId);
  }
}
