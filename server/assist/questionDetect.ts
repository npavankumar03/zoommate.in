import { callLLM } from "../llmRouter2";
import {
  detectQuestion,
  likelyContainsQuestion,
  classifyQuestion,
  extractQuestionFromSegment,
  normalizeForDedup,
  computeWordOverlap,
  applyAsrCorrections,
  INTERVIEW_SIGNAL_RE,
  STANDALONE_TECH_RE,
} from "@shared/questionDetection";

export interface ClassifierResult {
  isQuestion: boolean;
  type: "behavioral" | "technical" | "clarification" | "other";
  confidence: number;
  questionSpan: string;
}

export interface NormalizerResult {
  cleanQuestion: string;
  notes: string;
}

export interface ExtractedQuestion {
  text: string;
  confidence: number;
}

export interface ComposeQuestionResult {
  finalQuestion: string;
  isIncomplete: boolean;
}

export interface ResolvedInterviewTurn {
  latestAsk: string;
  kind: "new_question" | "follow_up" | "instruction" | "commentary" | "noise";
  shouldAnswerNow: boolean;
  unresolvedPriorAsk: string;
  notes: string;
}

const sessionDedupMap = new Map<string, Array<{ norm: string; ts: number }>>();
const DEDUP_WINDOW_MS = 12000;
let dedupChecks = 0;

function pruneSessionDedup(now = Date.now()): void {
  sessionDedupMap.forEach((list, sessionId) => {
    const filtered = list.filter((x: { norm: string; ts: number }) => now - x.ts <= DEDUP_WINDOW_MS * 2);
    if (filtered.length === 0) {
      sessionDedupMap.delete(sessionId);
    } else {
      sessionDedupMap.set(sessionId, filtered);
    }
  });
}

export function isDuplicateQuestion(sessionId: string | undefined, normalizedQuestion: string): boolean {
  if (!sessionId || !normalizedQuestion) return false;
  const now = Date.now();
  dedupChecks++;
  if (dedupChecks % 20 === 0) {
    pruneSessionDedup(now);
  }

  const existing = sessionDedupMap.get(sessionId) || [];
  const fresh = existing.filter((x) => now - x.ts <= DEDUP_WINDOW_MS);

  const duplicate = fresh.some((x) => x.norm === normalizedQuestion || computeWordOverlap(normalizedQuestion, x.norm) > 0.82);
  if (duplicate) {
    sessionDedupMap.set(sessionId, fresh);
    return true;
  }

  fresh.push({ norm: normalizedQuestion, ts: now });
  sessionDedupMap.set(sessionId, fresh.slice(-20));
  return false;
}

export function ruleGateQuestion(turnText: string): boolean {
  const trimmed = (turnText || "").trim();
  if (!trimmed) return false;

  const normalized = trimmed.toLowerCase().replace(/[^\w\s?]/g, "").replace(/\s+/g, " ").trim();
  const words = normalized.split(" ").filter(Boolean);
  if (!words.length) return false;
  if (words.length > 40 && !normalized.includes("?")) return false;

  const fillerOnly = /^(um|uh|hmm|okay|ok|yes|no|yeah|yep|nope|right|sure|well|alright|got it|i see|thanks|thank you)$/i;
  if (fillerOnly.test(normalized)) return false;

  const nonInterviewNoise = /\b(call mum|road closed|downtown|island|laguna|nokia|mumbai|sundar)\b/i;
  if (nonInterviewNoise.test(normalized) && !/\b(experience|project|role|api|react|python|design)\b/i.test(normalized)) {
    return false;
  }

  if (words.length <= 2) {
    return detectQuestion(trimmed);
  }

  const startsAsCandidateAnswer = /^(i|im|i'm|ive|i've|my|we|our)\b/i.test(normalized);
  const hasSecondPerson = /\b(you|your)\b/i.test(normalized);
  const startsAsQuestionVerb = /^(what|why|how|when|where|who|which|can|could|would|should|do|does|did|are|is|have|has|tell|describe|explain|walk|share|give|talk|any|familiar|comfortable|thoughts|experience|background|your)\b/i.test(normalized);
  if (startsAsCandidateAnswer && !hasSecondPerson && !normalized.includes("?") && !startsAsQuestionVerb) {
    return false;
  }

  // Broader interview signal patterns that detectQuestion might miss
  if (INTERVIEW_SIGNAL_RE.test(normalized)) return true;

  // Standalone tech term in short segment — "Flask", "React and Vue"
  if (words.length <= 5 && STANDALONE_TECH_RE.test(normalized)) return true;

  return detectQuestion(trimmed);
}

const CLASSIFIER_PROMPT = `You are a precision interview-question classifier for a real-time speech-to-text pipeline.
Return ONLY valid JSON:
{"is_question": boolean, "type": "behavioral"|"technical"|"clarification"|"other", "confidence": 0.0-1.0, "question_span": "..."}

Classification Rules:
- Determine if interviewer asked candidate a question in this turn.
- If yes: set is_question=true and return the best complete actionable ask in question_span (clean and concise).
- If multiple tightly-related questions exist in the same turn, preserve all actionable parts in order inside one concise combined question_span instead of dropping earlier parts.
- If is_question=false then question_span must be an empty string.
- Explicitly allow missing punctuation and very short follow-ups ("Why?", "How so?", "Which one?").
- is_question=true ONLY for questions asked BY the interviewer TO the candidate.

Type guidance:
- behavioral: Tell me about a time..., Describe a situation..., Walk me through..., Give me an example...
- technical: algorithms, system design, coding, architecture, technologies
- clarification: Can you elaborate?, What do you mean by...?
- other: Any other genuine question directed at candidate.`;

const EXTRACTOR_PROMPT = `You extract interviewer questions from messy speech-to-text text.
Return ONLY valid JSON in this shape:
{"questions":[{"text":"...","confidence":0.0}]}

Rules:
- Return 0..5 questions.
- Dedupe repeats/restarts in the raw text — the same phrase repeated is ONE question.
- Keep OR-questions as one unless clearly separate questions.
- Extract nested follow-ups like "If so, what's your plan..." as separate questions.
- Fix light grammar/punctuation only. Do not invent facts.
- Treat "you have experience with X" as equivalent to "Do you have experience with X?".
- Treat "hit me with..." as an interviewer request/question to the candidate.
- CRITICAL: Preserve action verbs. If the question says "write", "build", "implement", "code", "create", "design" — the extracted question MUST keep that verb. Never reduce "Can you write a calculator in .NET?" to just ".NET".
- Output concise interviewer-facing question text only.`;

const COMPOSER_PROMPT = `You compose a best-complete interviewer question from a rough live draft.
Return ONLY valid JSON:
{"final_question":"...","is_incomplete":false}

Rules:
- If draft ends with dangling joiners like and/or/also, drop dangling joiner and produce best complete question without adding new facts.
- If draft is second-person declarative ("you have experience in X"), rewrite as a direct question.
- If draft starts with "hit me with", rewrite to "Tell me about ...".
- Keep intent exactly; do not add new entities.`;

const NORMALIZER_PROMPT = `You clean up speech-to-text recognition errors in interview questions for a real-time assistant.
Return ONLY valid JSON: {"clean_question": "...", "notes": "..."}

Rules:
- Fix obvious ASR errors and malformed casing/spelling.
- Use context turns and session facts to resolve ambiguity.
- Strip filler prefixes/trailing fillers.
- Remove filler connectors like "also", "and also", "and then also" that appear between items (e.g. "Python and also React" → "Python and React", "experience in also React" → "experience in React").
- Do NOT invent new meaning.
- Preserve original intent.`;

const TURN_RESOLVER_PROMPT = `You are a real-time interview turn resolver.
Return ONLY valid JSON in this exact shape:
{"latest_ask":"...","kind":"new_question|follow_up|instruction|commentary|noise","should_answer_now":true,"unresolved_prior_ask":"...","notes":"..."}

Rules:
- Read the latest transcript and recent interview state.
- Decide what the interviewer most recently wants answered or responded to right now.
- The transcript may contain multiple recent chunks from the same still-unanswered interviewer turn. Merge those recent related chunks into one clean latest_ask before answering.
- Work from the most recent transcript content outward. Merge contiguous recent chunks only while they clearly belong to the same current interviewer turn. Stop when the topic changes.
- Use the full latest interviewer speech, not just the strongest sub-question or last sentence fragment.
- "latest_ask" can be a question, follow-up, instruction, scenario, challenge, or actionable interviewer request.
- Do not require explicit question words. Imperative prompts, coding requests, scenario setups, and continued interviewer speech without question punctuation can still be answerable.
- Preserve multi-part asks when the interviewer asked multiple things in one latest turn.
- If the interviewer makes a statement and then challenges, reframes, narrows scope, or asks for reasoning, include that actionable intent in latest_ask.
- If the latest turn is a follow-up, set kind="follow_up" and resolve it against the prior ask.
- If the latest turn is a direct instruction/scenario/prompt that should still be answered, set kind="instruction" and should_answer_now=true.
- If the latest turn is interviewer commentary, feedback, praise, challenge, or acknowledgment that still calls for a natural candidate response, set kind="commentary" and should_answer_now=true.
- Use should_answer_now=false only for obvious noise, broken cut-off fragments, or content that truly does not need any candidate response.
- If an older interviewer ask is still open and should remain pending, put it in unresolved_prior_ask.
- Do not invent new content. Keep latest_ask concise but complete.`;

/**
 * Collapses repetitive STT artifacts where the same phrase is captured
 * multiple times, e.g. "X and also X and also X and also X..."
 */
function collapseRepetitiveText(text: string): string {
  let trimmed = (text || "").trim();
  if (!trimmed) return trimmed;

  // STT self-restart: "can you write it can you write a code" → "can you write a code"
  // Pattern: PHRASE "it" PHRASE  (speaker restarted mid-sentence)
  trimmed = trimmed.replace(/\b((?:\w+\s+){1,5}\w+)\s+it\s+\1\b/gi, "$1");

  // STT stutter: direct phrase repeat without joiner "can you can you" → "can you"
  trimmed = trimmed.replace(/\b((?:\w+\s+){1,3}\w+)\s+\1\b/gi, "$1");

  // Remove trailing restart fragments: "tell me about X tell me" → "tell me about X"
  trimmed = trimmed.replace(/\s+(tell me|can you|could you|do you|have you|are you|what is|how do|walk me|describe)$/i, "").trim();

  // Split on common speech-loop joiners
  const parts = trimmed.split(/\s+(?:and also|and then|and|or)\s+/i).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 2) return trimmed;

  // Keep first occurrence of each unique segment (word overlap > 0.65)
  const unique: string[] = [];
  for (const seg of parts) {
    const segNorm = seg.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
    const isDup = unique.some((u) => {
      const uNorm = u.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
      return computeWordOverlap(segNorm, uNorm) > 0.65;
    });
    if (!isDup) unique.push(seg);
  }

  // Only collapse if we actually removed significant repetition
  if (unique.length < parts.length * 0.7) {
    return unique.join(" and ");
  }

  return trimmed;
}

// ---------------------------------------------------------------------------
// Local heuristic extraction — runs before any LLM call.
// Returns a result when the transcript is clean and matches a known pattern
// with high confidence (≥ 0.87). Falls through to null for messy/ambiguous
// turns so the 3-LLM pipeline handles them as before.
// ---------------------------------------------------------------------------
interface HeuristicResult {
  question: string;
  type: "behavioral" | "technical" | "clarification" | "other";
  confidence: number;
}

function tryHeuristicExtraction(rawText: string): HeuristicResult | null {
  const text = rawText.trim();
  const words = text.split(/\s+/).filter(Boolean);
  const wc = words.length;
  if (wc < 2 || wc > 22) return null;

  const lower = text.toLowerCase().replace(/[?.!]+$/, "").trim();

  // Cleanliness guard — repetition artifacts mean LLM should handle it
  if (/\b(\w{3,})\s+\1\b/i.test(text)) return null;

  // Helper: capitalise first letter and ensure trailing "?"
  const q = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/[?.!]*$/, "") + "?";

  // ── Behavioral staples ──────────────────────────────────────────────────
  if (/^tell\s+me\s+about\s+yourself$/.test(lower))
    return { question: "Tell me about yourself?", type: "behavioral", confidence: 0.97 };

  if (/^why\s+(do\s+you\s+want\s+(to\s+)?)?(this\s+)?(role|job|position|company|join\s+us|work\s+here)/.test(lower))
    return { question: "Why do you want this role?", type: "behavioral", confidence: 0.95 };

  if (/^where\s+do\s+you\s+see\s+yourself/.test(lower))
    return { question: q(text), type: "behavioral", confidence: 0.94 };

  if (/^what\s+are\s+your\s+(greatest\s+)?(strengths?|weaknesses?)/.test(lower))
    return { question: q(text), type: "behavioral", confidence: 0.94 };

  if (/^(tell\s+me\s+about|describe|walk\s+me\s+through|talk\s+me\s+through)\s+a\s+(time|situation|project|challenge|example)/.test(lower))
    return { question: q(text), type: "behavioral", confidence: 0.92 };

  if (/^(what|how)\s+(was|were|did)\s+you\s+.{4,}/.test(lower) && wc <= 14)
    return { question: q(text), type: "behavioral", confidence: 0.87 };

  // ── Experience / familiarity signals ────────────────────────────────────
  const expMatch = lower.match(
    /^(?:do\s+you\s+have|have\s+you\s+(?:used|worked\s+with|dealt\s+with)|any)\s+(?:experience|background|knowledge|exposure|familiarity)\s+(?:with|in|using|on)\s+(.+)$/,
  ) || lower.match(
    /^(?:are\s+you\s+)?(?:familiar|comfortable|experienced|proficient)\s+(?:with|in|using|on)\s+(.+)$/,
  ) || lower.match(
    /^(?:your\s+(?:thoughts?|opinion|take|view)\s+on)\s+(.+)$/,
  );
  if (expMatch && wc <= 15) {
    const subject = expMatch[1].trim();
    return { question: `Do you have experience with ${subject}?`, type: "technical", confidence: 0.90 };
  }

  // ── Technical explanations ───────────────────────────────────────────────
  const explainMatch = lower.match(
    /^(?:can\s+you\s+)?(?:explain|describe|walk\s+me\s+through|talk\s+me\s+through)\s+(.{3,})$/,
  );
  if (explainMatch && wc <= 16) {
    const verb = lower.startsWith("can you") ? lower.split(/\s+/)[2] : lower.split(/\s+/)[0];
    return { question: `Can you ${verb} ${explainMatch[1].trim()}?`, type: "technical", confidence: 0.90 };
  }

  const whatIsMatch = lower.match(/^what\s+(?:is|are|does|do)\s+(.{3,})$/);
  if (whatIsMatch && wc <= 12)
    return { question: q(text), type: "technical", confidence: 0.90 };

  const howMatch = lower.match(/^how\s+(?:does|do|would|can|could)\s+(.{3,})$/);
  if (howMatch && wc <= 14)
    return { question: q(text), type: "technical", confidence: 0.88 };

  // ── Code writing requests ─────────────────────────────────────────────────
  const codeMatch = lower.match(
    /^(?:can\s+you\s+)?(?:write|implement|build|create|code|develop)\s+(.{3,})$/,
  );
  if (codeMatch && wc <= 20) {
    const body = lower.startsWith("can you") ? text.replace(/^can\s+you\s+/i, "") : text;
    return { question: `Can you ${body.charAt(0).toLowerCase() + body.slice(1).replace(/[?.!]*$/, "")}?`, type: "technical", confidence: 0.92 };
  }

  // ── Clear "Can/Could you…" questions ─────────────────────────────────────
  if (/^(?:can|could|would)\s+you\s+.{5,}/.test(lower) && wc <= 18)
    return { question: q(text), type: "other", confidence: 0.87 };

  return null;
}

// ---------------------------------------------------------------------------
// selectBestQuestion — post-extraction question selector.
// Applies the 7 rules on top of already-detected candidates.
// Does NOT change detection logic — purely selects / merges the best result.
// ---------------------------------------------------------------------------
const CONTINUATION_RE = /^(?:and|also|plus|or|what about|how about|along with|as well as)\s+(.+)/i;
const FILLER_PREFIX_RE = /^(?:um+|uh+|hmm+|so|well|right|yeah|you know|i mean)\s+/gi;

function extractLastQuestionFromFacts(sessionFacts: string): string | null {
  const match = sessionFacts.match(/Last interviewer question:\s*(.+?)(?:\n|$)/i);
  return match ? match[1].trim() : null;
}

function isCompatibleForMerge(prevQuestion: string, continuation: string): boolean {
  // Never merge onto a behavioral / personal question
  if (/\b(yourself|tell me about|time when|situation|challenge|strength|weakness|career|background|hobby)\b/i.test(prevQuestion)) return false;
  // Continuation must be short (≤ 5 words) — longer = new question
  if (continuation.split(/\s+/).filter(Boolean).length > 5) return false;
  return true;
}

function buildMergedQuestion(prevQuestion: string, continuation: string): string {
  const base = prevQuestion.replace(/[?.!]+$/, "").trim();
  return `${base} and ${continuation}?`;
}

function selectBestQuestion(
  candidates: ExtractedQuestion[],
  rawText: string,
  sessionFacts?: string,
): string {
  // Rule 7: strip leading fillers for continuation check only
  const cleanRaw = rawText.replace(FILLER_PREFIX_RE, "").trim();
  const words = cleanRaw.split(/\s+/).filter(Boolean);

  // Rule 2: short continuation ("and AWS", "also FastAPI", "plus React")
  // Merge with last interviewer question only when topic is compatible
  if (words.length <= 6 && sessionFacts) {
    const contMatch = cleanRaw.match(CONTINUATION_RE);
    if (contMatch) {
      const prevQ = extractLastQuestionFromFacts(sessionFacts);
      if (prevQ && isCompatibleForMerge(prevQ, contMatch[1])) {
        const merged = buildMergedQuestion(prevQ, contMatch[1].trim());
        console.log(`[questionDetect] continuation merge: "${prevQ}" + "${contMatch[1]}" → "${merged}"`);
        return merged;
      }
    }
  }

  // Rule 1 + 3: prefer latest clear question from extracted candidates
  // extractor already returns candidates ordered oldest→newest, last = latest
  if (candidates.length > 0) {
    return candidates[candidates.length - 1].text;
  }

  // Fallback: cleaned raw text
  return cleanRaw;
}

function combineExtractedQuestions(questions: ExtractedQuestion[]): string {
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const item of questions) {
    const text = String(item?.text || "").trim();
    const norm = normalizeForDedup(text);
    if (!text || !norm || seen.has(norm)) continue;
    seen.add(norm);
    deduped.push(text.endsWith("?") ? text : `${text}?`);
    if (deduped.length >= 5) break;
  }
  if (!deduped.length) return "";
  if (deduped.length === 1) return deduped[0];
  return deduped.map((q, i) => `${i + 1}) ${q}`).join("\n");
}

// ---------------------------------------------------------------------------
// Stage 3 — quick confidence scorer.
// Runs after ruleGateQuestion passes. If score ≥ 0.70 the question is clear
// enough to skip the LLM classifier + normalizer entirely.
// Only genuinely uncertain/messy turns fall through to the LLM.
// ---------------------------------------------------------------------------
function computeQuickConfidence(candidate: string): {
  score: number;
  type: "behavioral" | "technical" | "clarification" | "other";
} {
  const text = candidate.trim();
  const lower = text.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  const wc = words.length;
  let score = 0;

  // ── Question starters ────────────────────────────────────────────────────
  if (/^(?:what|why|how|when|where|who|which)\b/i.test(lower)) score += 0.25;
  else if (/^(?:can|could|would|should|do|does|did|are|is|have|has)\s+you\b/i.test(lower)) score += 0.20;
  else if (/^(?:tell|explain|describe|walk|give|share|talk)\b/i.test(lower)) score += 0.20;

  // ── Punctuation ──────────────────────────────────────────────────────────
  if (text.endsWith("?")) score += 0.15;

  // ── Known interview phrase ────────────────────────────────────────────────
  if (INTERVIEW_SIGNAL_RE.test(lower)) score += 0.20;

  // ── Word count in typical interview question range ────────────────────────
  if (wc >= 4 && wc <= 15) score += 0.15;
  else if (wc >= 3 && wc <= 20) score += 0.08;

  // ── Clean text (no filler words) ─────────────────────────────────────────
  if (!/\b(um+|uh+|hmm+|like|you know|i mean|sort of|kind of)\b/i.test(lower)) score += 0.10;

  // ── Penalties ────────────────────────────────────────────────────────────
  if (wc > 25) score -= 0.15;                              // too long → likely messy
  if (/\b(\w{3,})\s+\1\b/i.test(text)) score -= 0.10;    // repeated word → STT artifact

  // ── Type inference ───────────────────────────────────────────────────────
  let type: "behavioral" | "technical" | "clarification" | "other" = "other";
  if (/\b(tell me about|time when|situation|describe a|walk me through your|background|strength|weakness)\b/i.test(lower))
    type = "behavioral";
  else if (/\b(explain|what is|what are|how does|how do|write|implement|build|code|algorithm|system|api|database|design|architecture)\b/i.test(lower))
    type = "technical";
  else if (INTERVIEW_SIGNAL_RE.test(lower))
    type = "technical";
  else if (/^(?:what|why|how)\b/i.test(lower))
    type = "technical";

  return { score: Math.max(0, Math.min(1, score)), type };
}

function extractJsonObject(raw: string): any | null {
  let jsonStr = (raw || "").trim();
  if (!jsonStr) return null;

  const fenced = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) jsonStr = fenced[1].trim();

  const objMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (objMatch) jsonStr = objMatch[0];

  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

export async function classifyWithLLM(
  turnTextRaw: string,
  candidateQuestionSpan: string,
  recentContext?: string,
  sessionId?: string,
): Promise<ClassifierResult> {
  try {
    const userMsg = recentContext
      ? `Recent context:\n${recentContext}\n\nRaw STT turn:\n"${turnTextRaw}"\n\nCandidate question span:\n"${candidateQuestionSpan}"`
      : `Raw STT turn:\n"${turnTextRaw}"\n\nCandidate question span:\n"${candidateQuestionSpan}"`;

    const raw = await callLLM("QUESTION_CLASSIFIER", CLASSIFIER_PROMPT, userMsg, sessionId);
    const parsed = extractJsonObject(raw) || {};

    return {
      isQuestion: !!parsed.is_question,
      type: parsed.type || "other",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      questionSpan: typeof parsed.question_span === "string" ? parsed.question_span.trim() : "",
    };
  } catch (err: any) {
    console.error("[questionDetect] Classifier LLM failed:", err.message);
    const ruleType = classifyQuestion(candidateQuestionSpan || turnTextRaw);
    return {
      isQuestion: ruleGateQuestion(candidateQuestionSpan || turnTextRaw),
      type: ruleType,
      confidence: 0.6,
      questionSpan: candidateQuestionSpan || turnTextRaw,
    };
  }
}

export async function normalizeQuestion(rawQuestion: string, recentTurns?: string, sessionFacts?: string, sessionId?: string): Promise<NormalizerResult> {
  try {
    const corrected = applyAsrCorrections(rawQuestion);
    let userMsg = `Raw question: "${corrected}"`;
    if (recentTurns) userMsg += `\n\nRecent turns:\n${recentTurns}`;
    if (sessionFacts) userMsg += `\n\nSession facts:\n${sessionFacts}`;

    const raw = await callLLM("QUESTION_NORMALIZER", NORMALIZER_PROMPT, userMsg, sessionId);
    const parsed = extractJsonObject(raw) || {};
    return {
      cleanQuestion: parsed.clean_question || rawQuestion,
      notes: parsed.notes || "",
    };
  } catch (err: any) {
    console.error("[questionDetect] Normalizer LLM failed:", err.message);
    return { cleanQuestion: rawQuestion, notes: "" };
  }
}

function fallbackExtractQuestions(rawText: string): ExtractedQuestion[] {
  const candidate = (extractQuestionFromSegment(rawText) || rawText || "").trim();
  if (!candidate || !detectQuestion(candidate)) return [];
  return [{ text: candidate, confidence: 0.7 }];
}

export async function extractQuestionsWithLLM(
  rawText: string,
  recentContext?: string,
  sessionId?: string,
): Promise<ExtractedQuestion[]> {
  const text = (rawText || "").trim();
  if (!text) return [];

  try {
    const userMsg = recentContext
      ? `Recent context:\n${recentContext}\n\nRaw STT:\n"${text}"`
      : `Raw STT:\n"${text}"`;

    const raw = await callLLM("QUESTION_EXTRACTOR", EXTRACTOR_PROMPT, userMsg, sessionId);
    const parsed = extractJsonObject(raw) || {};
    const questions = Array.isArray(parsed.questions) ? parsed.questions : [];

    const out: ExtractedQuestion[] = [];
    for (const item of questions) {
      const qText = typeof item?.text === "string" ? item.text.trim() : "";
      const conf = typeof item?.confidence === "number" ? item.confidence : 0.5;
      if (!qText) continue;
      out.push({ text: qText, confidence: Math.max(0, Math.min(1, conf)) });
      if (out.length >= 5) break;
    }

    if (!out.length) return fallbackExtractQuestions(text);

    const deduped: ExtractedQuestion[] = [];
    for (const q of out) {
      const qNorm = normalizeForDedup(q.text);
      if (!qNorm) continue;
      if (deduped.some((d) => normalizeForDedup(d.text) === qNorm || computeWordOverlap(qNorm, normalizeForDedup(d.text)) > 0.82)) {
        continue;
      }
      deduped.push(q);
    }

    return deduped;
  } catch (err: any) {
    console.error("[questionDetect] Extractor LLM failed:", err.message);
    return fallbackExtractQuestions(text);
  }
}

export async function composeQuestionWithLLM(
  draftText: string,
  recentContext?: string,
  sessionId?: string,
): Promise<ComposeQuestionResult> {
  const draft = (draftText || "").trim();
  if (!draft) return { finalQuestion: "", isIncomplete: true };

  try {
    const userMsg = recentContext
      ? `Recent context:\n${recentContext}\n\nDraft:\n"${draft}"`
      : `Draft:\n"${draft}"`;
    const raw = await callLLM("QUESTION_COMPOSER", COMPOSER_PROMPT, userMsg, sessionId);
    const parsed = extractJsonObject(raw) || {};

    const finalQuestion = typeof parsed.final_question === "string" ? parsed.final_question.trim() : draft;
    const isIncomplete = !!parsed.is_incomplete;

    return {
      finalQuestion: finalQuestion || draft,
      isIncomplete,
    };
  } catch (err: any) {
    console.error("[questionDetect] Composer LLM failed:", err.message);

    let fallback = draft.replace(/\b(and|or|also)\s*$/i, "").trim();
    if (/^you\s+have\s+experience\b/i.test(fallback)) {
      fallback = fallback.replace(/^you\s+have\s+experience\b/i, "Do you have experience");
    }
    if (/^hit me with\b/i.test(fallback)) {
      fallback = fallback.replace(/^hit me with\b/i, "Tell me about");
    }
    if (fallback && !/[?.!]$/.test(fallback)) fallback += "?";

    return {
      finalQuestion: fallback || draft,
      isIncomplete: /\b(and|or|also)\s*$/i.test(draft),
    };
  }
}

export async function resolveInterviewTurnWithLLM(
  latestTranscript: string,
  recentContext?: string,
  sessionFacts?: string,
  sessionId?: string,
): Promise<ResolvedInterviewTurn> {
  const transcript = (latestTranscript || "").trim();
  if (!transcript) {
    return { latestAsk: "", kind: "noise", shouldAnswerNow: false, unresolvedPriorAsk: "", notes: "Empty transcript" };
  }

  try {
    const parts = [
      `Latest transcript:\n"${transcript}"`,
      recentContext ? `Recent context:\n${recentContext}` : "",
      sessionFacts ? `Session facts:\n${sessionFacts}` : "",
    ].filter(Boolean);
    const raw = await callLLM("QUESTION_EXTRACTOR", TURN_RESOLVER_PROMPT, parts.join("\n\n"), sessionId);
    const parsed = extractJsonObject(raw) || {};
    const kindRaw = String(parsed.kind || "noise").trim();
    const kind = (
      kindRaw === "new_question"
      || kindRaw === "follow_up"
      || kindRaw === "instruction"
      || kindRaw === "commentary"
      || kindRaw === "noise"
    ) ? kindRaw : "noise";

    return {
      latestAsk: typeof parsed.latest_ask === "string" ? parsed.latest_ask.trim() : "",
      kind,
      shouldAnswerNow: Boolean(parsed.should_answer_now),
      unresolvedPriorAsk: typeof parsed.unresolved_prior_ask === "string" ? parsed.unresolved_prior_ask.trim() : "",
      notes: typeof parsed.notes === "string" ? parsed.notes.trim() : "",
    };
  } catch (err: any) {
    console.error("[questionDetect] Turn resolver LLM failed:", err.message);
    const fallback = await extractQuestionsWithLLM(transcript, recentContext, sessionId);
    const latestAsk = fallback[fallback.length - 1]?.text || "";
    return {
      latestAsk,
      kind: latestAsk ? "new_question" : "noise",
      shouldAnswerNow: Boolean(latestAsk),
      unresolvedPriorAsk: "",
      notes: "fallback",
    };
  }
}

export interface DetectionPipelineResult {
  isQuestion: boolean;
  rawText: string;
  questionSpan: string;
  cleanQuestion: string;
  type: "behavioral" | "technical" | "clarification" | "other";
  confidence: number;
  notes: string;
  passedRuleGate: boolean;
  passedLLMClassifier: boolean;
}

export async function runDetectionPipeline(
  turnText: string,
  recentTurns?: string,
  sessionFacts?: string,
  sessionId?: string,
  confidenceThreshold = 0.65,
): Promise<DetectionPipelineResult> {
  const rawText = applyAsrCorrections(collapseRepetitiveText((turnText || "").trim()));
  if (!rawText) {
    return {
      isQuestion: false,
      rawText,
      questionSpan: "",
      cleanQuestion: "",
      type: "other",
      confidence: 0,
      notes: "Empty turn",
      passedRuleGate: false,
      passedLLMClassifier: false,
    };
  }

  if (!likelyContainsQuestion(rawText)) {
    return {
      isQuestion: false,
      rawText,
      questionSpan: "",
      cleanQuestion: "",
      type: "other",
      confidence: 0,
      notes: "No likely question signal",
      passedRuleGate: false,
      passedLLMClassifier: false,
    };
  }

  // Fast-path: standalone tech term (≤3 words, no other question structure)
  // LLM classifier cannot reliably classify "Flask" alone — bypass all 3 LLM calls.
  const rawWords = rawText.trim().split(/\s+/).filter(Boolean);
  if (rawWords.length <= 3 && STANDALONE_TECH_RE.test(rawText) && !INTERVIEW_SIGNAL_RE.test(rawText.toLowerCase())) {
    const cleanQuestion = `Do you have experience with ${rawText}?`;
    const normalizedForDedup = normalizeForDedup(cleanQuestion);
    if (isDuplicateQuestion(sessionId, normalizedForDedup)) {
      return {
        isQuestion: false, rawText, questionSpan: rawText, cleanQuestion,
        type: "technical", confidence: 0.75, notes: "Duplicate suppressed",
        passedRuleGate: true, passedLLMClassifier: true,
      };
    }
    return {
      isQuestion: true, rawText, questionSpan: rawText, cleanQuestion,
      type: "technical", confidence: 0.75, notes: "Standalone tech term fast-path",
      passedRuleGate: true, passedLLMClassifier: true,
    };
  }

  // Heuristic fast-path: clean transcript matching a known interview pattern.
  // Bypasses all 3 LLM calls — falls through to null for anything messy/ambiguous.
  const heuristic = tryHeuristicExtraction(rawText);
  if (heuristic && heuristic.confidence >= 0.87) {
    const normalizedForDedup = normalizeForDedup(heuristic.question);
    if (isDuplicateQuestion(sessionId, normalizedForDedup)) {
      return {
        isQuestion: false, rawText, questionSpan: rawText, cleanQuestion: heuristic.question,
        type: heuristic.type, confidence: heuristic.confidence, notes: "Duplicate suppressed",
        passedRuleGate: true, passedLLMClassifier: true,
      };
    }
    console.log(`[questionDetect] heuristic fast-path (${heuristic.confidence.toFixed(2)}): "${heuristic.question}"`);
    return {
      isQuestion: true, rawText, questionSpan: rawText, cleanQuestion: heuristic.question,
      type: heuristic.type, confidence: heuristic.confidence, notes: "Heuristic fast-path",
      passedRuleGate: true, passedLLMClassifier: true,
    };
  }

  const extracted = await extractQuestionsWithLLM(rawText, recentTurns, sessionId);
  const combinedExtracted = combineExtractedQuestions(extracted);
  if (extracted.length > 1 && combinedExtracted) {
    const normalizedForDedup = normalizeForDedup(combinedExtracted);
    if (isDuplicateQuestion(sessionId, normalizedForDedup)) {
      return {
        isQuestion: false,
        rawText,
        questionSpan: combinedExtracted,
        cleanQuestion: combinedExtracted,
        type: classifyQuestion(extracted[extracted.length - 1]?.text || combinedExtracted),
        confidence: Math.max(0.75, Math.min(0.95, extracted.reduce((max, q) => Math.max(max, q.confidence || 0), 0.75))),
        notes: "Duplicate suppressed",
        passedRuleGate: true,
        passedLLMClassifier: true,
      };
    }

    return {
      isQuestion: true,
      rawText,
      questionSpan: combinedExtracted,
      cleanQuestion: combinedExtracted,
      type: classifyQuestion(extracted[extracted.length - 1]?.text || combinedExtracted),
      confidence: Math.max(0.75, Math.min(0.95, extracted.reduce((max, q) => Math.max(max, q.confidence || 0), 0.75))),
      notes: "Multi-question extraction fast-path",
      passedRuleGate: true,
      passedLLMClassifier: true,
    };
  }
  const fallback = (extractQuestionFromSegment(rawText) || rawText).trim();
  const candidate = selectBestQuestion(extracted, fallback, sessionFacts).trim() || fallback;

  const passedRuleGate = ruleGateQuestion(candidate);
  if (!passedRuleGate) {
    return {
      isQuestion: false,
      rawText,
      questionSpan: candidate,
      cleanQuestion: candidate,
      type: "other",
      confidence: 0,
      notes: "Failed rule gate",
      passedRuleGate: false,
      passedLLMClassifier: false,
    };
  }

  // Stage 3: skip LLM when quick confidence is high enough.
  // Only genuinely uncertain/messy turns fall through to the LLM classifier.
  const { score: quickScore, type: quickType } = computeQuickConfidence(candidate);
  if (quickScore >= 0.70) {
    const cleanQuestion = applyAsrCorrections(candidate);
    const normalizedForDedup = normalizeForDedup(cleanQuestion);
    if (isDuplicateQuestion(sessionId, normalizedForDedup)) {
      return {
        isQuestion: false, rawText, questionSpan: candidate, cleanQuestion,
        type: quickType, confidence: quickScore, notes: "Duplicate suppressed",
        passedRuleGate: true, passedLLMClassifier: true,
      };
    }
    console.log(`[questionDetect] stage3 fast-path (${quickScore.toFixed(2)}): "${cleanQuestion}"`);
    return {
      isQuestion: true, rawText, questionSpan: candidate, cleanQuestion,
      type: quickType, confidence: quickScore,
      notes: `Stage3 fast-path score=${quickScore.toFixed(2)}`,
      passedRuleGate: true, passedLLMClassifier: true,
    };
  }

  const classResult = await classifyWithLLM(rawText, candidate, recentTurns, sessionId);
  if (!classResult.isQuestion || classResult.confidence < confidenceThreshold) {
    return {
      isQuestion: false,
      rawText,
      questionSpan: classResult.questionSpan || candidate,
      cleanQuestion: candidate,
      type: classResult.type,
      confidence: classResult.confidence,
      notes: `Classifier: isQ=${classResult.isQuestion}, conf=${classResult.confidence}`,
      passedRuleGate: true,
      passedLLMClassifier: false,
    };
  }

  const toNormalize = (classResult.questionSpan || candidate).trim();
  const normResult = await normalizeQuestion(toNormalize, recentTurns, sessionFacts, sessionId);
  const normalizedForDedup = normalizeForDedup(normResult.cleanQuestion);

  if (isDuplicateQuestion(sessionId, normalizedForDedup)) {
    return {
      isQuestion: false,
      rawText,
      questionSpan: toNormalize,
      cleanQuestion: normResult.cleanQuestion,
      type: classResult.type,
      confidence: classResult.confidence,
      notes: "Duplicate suppressed",
      passedRuleGate: true,
      passedLLMClassifier: true,
    };
  }

  return {
    isQuestion: true,
    rawText,
    questionSpan: toNormalize,
    cleanQuestion: normResult.cleanQuestion,
    type: classResult.type,
    confidence: classResult.confidence,
    notes: normResult.notes,
    passedRuleGate: true,
    passedLLMClassifier: true,
  };
}
