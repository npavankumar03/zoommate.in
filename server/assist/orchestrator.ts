import { createHash } from "crypto";
import {
  detectMetaRequest,
  isAffirmation,
  isNegation,
  detect,
  detectQuestion,
  likelyContainsQuestion,
  extractCandidateSpan,
  fingerprint,
  computeWordOverlap,
  normalizeForDedup,
  normalizeText,
  splitSentences,
} from "@shared/questionDetection";
import type { AnswerStyle } from "@shared/schema";
import type { MeetingState } from "../realtime/meetingStore";
import {
  getAnswerStyle,
  canAutoTrigger,
  markTriggered,
  isRecentFingerprintDuplicate,
  incrementSuppression,
  enqueueQuestion,
  getUnanswered,
  expireOldUnanswered,
  isDuplicateAction,
} from "../realtime/meetingStore";
import { extractQuestionsWithLLM, runDetectionPipeline } from "./questionDetect";

export type OrchestrateInput = {
  meetingId: string;
  mode: "pause" | "enter" | "final";
  audioMode: "system" | "mic";
  snapshotText: string;
  recentFinals: string[];
  state: MeetingState;
  overrideQuestion?: string;
};

export type OrchestrateOutput = {
  action: "answer" | "rewrite_brief" | "rewrite_deeper" | "ignore" | "wait";
  displayQuestion: string;
  llmPrompt: string;
  prompt: string;
  questions: Array<{ text: string; confidence: number; clean: string }>;
  questionNorms: string[];
  dedupeKey: string;
  confidence: number;
  style: AnswerStyle;
};

function hash(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

function hasExplicitCue(text: string): boolean {
  const raw = (text || "").trim();
  const norm = normalizeForDedup(raw);
  if (!norm) return false;
  if (raw.includes("?")) return true;
  return /\b(do you|can you|could you|would you|have you|are you|tell me|walk me through|hit me with|what|why|how|which|who|when|where)\b/.test(norm);
}

function composeInstantQuestion(raw: string): string {
  let text = (raw || "").replace(/\s+/g, " ").trim();
  if (!text) return text;

  text = text.replace(/\b(and|or|also)\s*$/i, "").trim();

  const norm = normalizeText(text);
  const expKeywords = /\b(experience|worked|used|familiar|comfortable|exposure|background|hands on|knowledge|certification|strong in)\b/;
  if (/^(you\s+have|youve|you've|youre|you're)\b/i.test(text) && expKeywords.test(norm)) {
    text = `Do ${text.replace(/^(you|youve|you've|youre|you're)\b/i, "you")}`;
  }

  if (/^hit (me|us)( with)?\b/i.test(text)) {
    text = text.replace(/^hit (me|us)( with)?\b/i, "Tell me about");
  }

  if (detectQuestion(text) && !/[?.!]$/.test(text)) {
    text += "?";
  }

  return text.charAt(0).toUpperCase() + text.slice(1);
}

const IMPERATIVE_QUESTION_CUES = /\b(briefly explain|explain|describe|walk me through|talk about|tell me about|tell me|give me|compare|differentiate|elaborate on|hit me with)\b/i;
const SHORT_FOLLOWUP_RE = /^(why|how|which one|how so|what do you mean|which part|tell me more|go deeper|expand|what about)\??$/i;
const SHORT_TOPIC_FRAGMENT_RE = /^[a-z0-9.+#/-]{2,40}$/i;

function getLatestQuestionAnchor(state: MeetingState): string {
  const unanswered = state.questionQueue
    .filter((q) => !q.answeredTs)
    .slice(-5)
    .map((q) => q.clean)
    .filter(Boolean);
  if (unanswered.length) return unanswered[unanswered.length - 1];
  return state.recentQuestions[0]?.clean || "";
}

function attachShortFollowupToAnchor(fragment: string, anchor: string): string {
  const followup = (fragment || "").replace(/\s+/g, " ").trim().replace(/\?+$/, "");
  const base = (anchor || "").replace(/\s+/g, " ").trim().replace(/\?+$/, "");
  if (!followup || !base) return fragment;
  return `${base} Follow-up: ${followup}?`;
}

function appendTopicFragmentToAnchor(fragment: string, anchor: string): string {
  const topic = (fragment || "").replace(/\s+/g, " ").trim().replace(/[?.,;:!]+$/g, "");
  const base = (anchor || "").replace(/\s+/g, " ").trim().replace(/\?+$/, "");
  if (!topic || !base) return fragment;
  const baseNorm = normalizeForDedup(base);
  const topicNorm = normalizeForDedup(topic);
  if (!topicNorm || baseNorm.includes(topicNorm)) return `${base}?`;
  return `${base} and ${topic}?`;
}

function extractFallbackQuestionSpan(raw: string): string {
  const text = (raw || "").replace(/\s+/g, " ").trim();
  if (!text) return "";

  const sentences = splitSentences(text);
  const units = (sentences.length ? sentences : [text])
    .flatMap((s) => s.split(/\b(?:and then|if so|also|then)\b/gi))
    .map((s) => s.trim())
    .filter(Boolean);

  for (let i = units.length - 1; i >= 0; i--) {
    const unit = units[i];
    if (detectQuestion(unit) || IMPERATIVE_QUESTION_CUES.test(unit)) {
      return composeInstantQuestion(unit);
    }
  }

  const lowered = text.toLowerCase();
  const cueMatch = lowered.match(/(briefly explain|explain|describe|walk me through|talk about|tell me about|tell me|give me|compare|differentiate|elaborate on|hit me with)/g);
  if (cueMatch && cueMatch.length > 0) {
    const lastCue = cueMatch[cueMatch.length - 1];
    const idx = lowered.lastIndexOf(lastCue);
    if (idx >= 0) {
      return composeInstantQuestion(text.slice(idx));
    }
  }

  return "";
}

function extractQuestionsFast(text: string): string[] {
  const raw = (text || "").trim();
  if (!raw) return [];

  const chunks = splitSentences(raw).length > 0
    ? splitSentences(raw)
    : [raw];

  const expanded: string[] = [];
  for (const c of chunks) {
    const parts = c.split(/\b(?:if so|also|and then|next)\b/gi).map((x) => x.trim()).filter(Boolean);
    if (parts.length > 1) expanded.push(...parts);
    else expanded.push(c.trim());
  }

  const out: string[] = [];
  for (const chunk of expanded) {
    const q = composeInstantQuestion(chunk);
    if (!q) continue;
    if (!detectQuestion(q) && q.split(/\s+/).length < 3) continue;
    out.push(q);
    if (out.length >= 5) break;
  }

  if (!out.length) {
    const q = composeInstantQuestion(raw);
    if (q && detectQuestion(q)) out.push(q);
  }

  const dedup: string[] = [];
  const seen = new Set<string>();
  for (const q of out) {
    const norm = normalizeForDedup(q);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    dedup.push(q);
  }
  return dedup;
}

async function extractQuestionsPrecise(
  raw: string,
  recentFinals: string[],
  meetingId: string,
): Promise<string[]> {
  const base = extractQuestionsFast(raw);

  try {
    const llm = await Promise.race([
      extractQuestionsWithLLM(raw, recentFinals.join("\n"), meetingId),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("extract-timeout")), 900)),
    ]);

    const fromLlm = llm
      .map((q) => composeInstantQuestion(q.text))
      .filter((q) => !!q)
      .filter((q) => detectQuestion(q) || IMPERATIVE_QUESTION_CUES.test(q));

    if (fromLlm.length > 0) {
      const dedup = new Set<string>();
      const out: string[] = [];
      for (const q of fromLlm) {
        const norm = normalizeForDedup(q);
        if (!norm || dedup.has(norm)) continue;
        dedup.add(norm);
        out.push(q);
        if (out.length >= 5) break;
      }
      if (out.length) return out;
    }

    const fallbackSpan = extractFallbackQuestionSpan(raw);
    if (fallbackSpan) return [fallbackSpan];
    return base;
  } catch {
    const fallbackSpan = extractFallbackQuestionSpan(raw);
    if (fallbackSpan) return [fallbackSpan];
    return base;
  }
}

export function applyAnswerStyle(style: AnswerStyle, questionOrMultiPrompt: string): string {
  if (style === "brief") {
    return [
      "Answer style: BRIEF.",
      "Sound natural and interview-realistic.",
      "- Give a direct answer in 1 line.",
      "- Then 2–4 bullet points max.",
      "- No filler, no repeating the question.",
      "",
      questionOrMultiPrompt,
    ].join("\n");
  }

  if (style === "deep") {
    return [
      "Answer style: DEEP (but still interview-usable).",
      "Sound natural and interview-realistic.",
      "Format:",
      "1) Direct answer (1–2 lines)",
      "2) Key points (4–6 bullets)",
      "3) Example (STAR-style, short)",
      "4) Tradeoffs / risks (2–3 bullets)",
      "5) Wrap-up (1 line)",
      "Rules: Do not invent facts. If unclear, state assumption briefly.",
      "",
      questionOrMultiPrompt,
    ].join("\n");
  }

  if (style === "concise") {
    return [
      "Answer style: CONCISE.",
      "Give a single clear answer in 2–3 sentences max. No bullets. No filler. Sound natural.",
      "",
      questionOrMultiPrompt,
    ].join("\n");
  }

  if (style === "star") {
    return [
      "Answer style: STAR.",
      "Structure your answer exactly as:",
      "**Situation:** (1 sentence)",
      "**Task:** (1 sentence)",
      "**Action:** (2–3 sentences — what YOU did)",
      "**Result:** (1–2 sentences — measurable outcome if possible)",
      "Keep each section tight. Do not invent facts.",
      "",
      questionOrMultiPrompt,
    ].join("\n");
  }

  if (style === "bullet") {
    return [
      "Answer style: BULLET POINTS.",
      "Answer using only bullet points (4–6 bullets). Lead with the most important point.",
      "No prose paragraphs. Each bullet = 1 clear idea. Sound interview-ready.",
      "",
      questionOrMultiPrompt,
    ].join("\n");
  }

  if (style === "talking_points") {
    return [
      "Answer style: TALKING POINTS.",
      "Give 3–5 short talking points the user can say out loud naturally.",
      "Each point should be 1 sentence. Label them 1) 2) 3) etc.",
      "These are meant to be spoken, not read. Keep them conversational.",
      "",
      questionOrMultiPrompt,
    ].join("\n");
  }

  if (style === "direct_followup") {
    return [
      "Answer style: DIRECT RESPONSE + FOLLOW-UP HINT.",
      "First: give a direct 2–4 sentence answer.",
      "Then on a new line add: **Follow-up you might get:** [one likely follow-up question]",
      "Then: **Tip:** [one sentence on how to handle it]",
      "",
      questionOrMultiPrompt,
    ].join("\n");
  }

  return [
    "Answer style: STANDARD.",
    "Sound natural and interview-realistic.",
    "Format:",
    "- Direct answer (1–2 lines)",
    "- 3–5 bullets supporting points",
    "- 1 short example (STAR-ish) if applicable",
    "Rules: Do not invent facts; keep it crisp.",
    "",
    questionOrMultiPrompt,
  ].join("\n");
}

export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateOutput> {
  const now = Date.now();
  const cleanText = (input.snapshotText || "").replace(/\s+/g, " ").trim();
  const baseStyle = getAnswerStyle(input.meetingId);

  if (!cleanText) {
    return { action: "ignore", displayQuestion: "", llmPrompt: "", prompt: "", questions: [], questionNorms: [], dedupeKey: "", confidence: 0, style: baseStyle };
  }

  const meta = detectMetaRequest(cleanText);
  if (meta) {
    input.state.pendingMeta = { type: meta, ts: now };
    return { action: "wait", displayQuestion: "", llmPrompt: "", prompt: "", questions: [], questionNorms: [], dedupeKey: "", confidence: 0.8, style: baseStyle };
  }

  const affirmation = isAffirmation(cleanText);
  const negation = isNegation(cleanText);

  if (negation && input.state.pendingMeta && (now - input.state.pendingMeta.ts) <= 10000) {
    input.state.pendingMeta = undefined;
    return { action: "ignore", displayQuestion: "", llmPrompt: "", prompt: "", questions: [], questionNorms: [], dedupeKey: "", confidence: 0.8, style: baseStyle };
  }

  if (affirmation && input.state.pendingMeta && (now - input.state.pendingMeta.ts) <= 10000) {
    if (!input.state.lastAnswer) {
      input.state.pendingMeta = undefined;
      return { action: "ignore", displayQuestion: "", llmPrompt: "", prompt: "", questions: [], questionNorms: [], dedupeKey: "", confidence: 0.4, style: baseStyle };
    }

    const rewriteStyle: AnswerStyle = input.state.pendingMeta.type === "brief" ? "brief" : "deep";
    const action = input.state.pendingMeta.type === "brief" ? "rewrite_brief" : "rewrite_deeper";
    const prompt = applyAnswerStyle(
      rewriteStyle,
      `Rewrite the last answer ${rewriteStyle === "brief" ? "BRIEFLY" : "with deeper detail"} (no new facts):\n${input.state.lastAnswer}`,
    );
    const displayQuestion = rewriteStyle === "brief"
      ? "Rewrite the last answer briefly."
      : "Rewrite the last answer with deeper detail.";
    const dedupeKey = hash(normalizeForDedup(`${action}::${displayQuestion}`));
    input.state.pendingMeta = undefined;
    if (isDuplicateAction(input.meetingId, dedupeKey, 12000)) {
      return { action: "ignore", displayQuestion: "", llmPrompt: "", prompt: "", questions: [], questionNorms: [], dedupeKey, confidence: 0.9, style: rewriteStyle };
    }
    return { action, displayQuestion, llmPrompt: prompt, prompt, questions: [], questionNorms: [], dedupeKey, confidence: 0.92, style: rewriteStyle };
  }

  const sourceText = input.overrideQuestion?.trim() || cleanText;
  const sourceKind: "partial" | "final" | "manual" = input.mode === "enter"
    ? "manual"
    : input.mode === "final"
      ? "final"
      : "partial";
  const anchorQuestion = getLatestQuestionAnchor(input.state);
  let candidateSpan = extractCandidateSpan(sourceText) || sourceText;
  const normalizedSource = normalizeText(sourceText);
  const sourceWords = normalizedSource.split(/\s+/).filter(Boolean);
  if (anchorQuestion) {
    if (SHORT_FOLLOWUP_RE.test(normalizedSource)) {
      candidateSpan = attachShortFollowupToAnchor(sourceText, anchorQuestion);
    } else if (
      sourceWords.length >= 1
      && sourceWords.length <= 3
      && SHORT_TOPIC_FRAGMENT_RE.test(normalizedSource)
      && !hasExplicitCue(sourceText)
      && !IMPERATIVE_QUESTION_CUES.test(sourceText)
    ) {
      candidateSpan = appendTopicFragmentToAnchor(sourceText, anchorQuestion);
    }
  }
  const detection = detect(candidateSpan, sourceKind);
  let effectiveConfidence = detection.confidence;
  let effectiveIsQuestion = detection.isQuestion;
  let normalizedCandidate = normalizeText(candidateSpan);
  let fp = fingerprint(candidateSpan);

  const isShortFollowup = /^(why|how|which one|how so)$/.test(normalizedCandidate);
  if (!effectiveIsQuestion && isShortFollowup && input.state.lastAnswerAt && (now - input.state.lastAnswerAt) <= 6000) {
    effectiveIsQuestion = true;
    effectiveConfidence = Math.max(effectiveConfidence, 0.72);
  }

  if (input.state.isStreaming && input.mode !== "enter") {
    incrementSuppression(input.meetingId, "streaming_mutex");
    return { action: "wait", displayQuestion: "", llmPrompt: "", prompt: "", questions: [], questionNorms: [], dedupeKey: "", confidence: effectiveConfidence, style: baseStyle };
  }

  if (input.state.feedbackGuardUntilTs && now < input.state.feedbackGuardUntilTs && input.mode !== "enter") {
    incrementSuppression(input.meetingId, "feedback_guard");
    return { action: "wait", displayQuestion: "", llmPrompt: "", prompt: "", questions: [], questionNorms: [], dedupeKey: "", confidence: effectiveConfidence, style: baseStyle };
  }

  const recentAnswers = input.state.recentAnswers.slice(-5);
  const candidateNorm = normalizeForDedup(candidateSpan);
  const feedbackLoop = recentAnswers.some((x) => {
    const sample = normalizeForDedup((x.answer || "").slice(0, 400));
    return computeWordOverlap(candidateNorm, sample) > 0.75;
  });
  if (feedbackLoop && input.mode !== "enter") {
    input.state.feedbackGuardUntilTs = now + 200;
    incrementSuppression(input.meetingId, "feedback_loop");
    return { action: "wait", displayQuestion: "", llmPrompt: "", prompt: "", questions: [], questionNorms: [], dedupeKey: "", confidence: effectiveConfidence, style: baseStyle };
  }

  // Mic mode: only block if no question signal at all
  if (input.audioMode === "mic" && !hasExplicitCue(cleanText) && !IMPERATIVE_QUESTION_CUES.test(cleanText) && !effectiveIsQuestion && input.mode !== "enter") {
    incrementSuppression(input.meetingId, "mic_low_signal");
    return { action: "wait", displayQuestion: "", llmPrompt: "", prompt: "", questions: [], questionNorms: [], dedupeKey: "", confidence: effectiveConfidence, style: baseStyle };
  }

  const threshold = sourceKind === "partial" ? 0.78 : sourceKind === "final" ? 0.58 : 0.40;
  const shouldTryLlmClassifier =
    sourceKind !== "partial"
    && likelyContainsQuestion(sourceText)
    && (
      !effectiveIsQuestion
      || effectiveConfidence < threshold
      || (!hasExplicitCue(cleanText) && IMPERATIVE_QUESTION_CUES.test(cleanText))
    );

  if (shouldTryLlmClassifier) {
    try {
      const recentTurns = (input.recentFinals || []).slice(-6).join("\n");
      const sessionFacts = [
        input.state.recentQuestions[0]?.clean ? `Last interviewer question: ${input.state.recentQuestions[0].clean}` : "",
        input.state.lastAnswer ? `Last candidate answer: ${String(input.state.lastAnswer).slice(0, 500)}` : "",
      ].filter(Boolean).join("\n");
      const llmDetection = await runDetectionPipeline(
        candidateSpan || cleanText,
        recentTurns || undefined,
        sessionFacts || undefined,
        input.meetingId,
        sourceKind === "final" ? 0.58 : 0.52,
      );
      if (llmDetection.isQuestion && (llmDetection.cleanQuestion || llmDetection.questionSpan)) {
        candidateSpan = llmDetection.cleanQuestion || llmDetection.questionSpan;
        effectiveIsQuestion = true;
        effectiveConfidence = Math.max(effectiveConfidence, llmDetection.confidence || threshold);
        normalizedCandidate = normalizeText(candidateSpan);
        fp = fingerprint(candidateSpan);
      }
    } catch {
      // Keep fast rule-based fallback if classifier path fails.
    }
  }

  if (!effectiveIsQuestion || effectiveConfidence < threshold) {
    incrementSuppression(input.meetingId, "low_confidence");
    return { action: "wait", displayQuestion: "", llmPrompt: "", prompt: "", questions: [], questionNorms: [], dedupeKey: "", confidence: effectiveConfidence, style: baseStyle };
  }

  if (sourceKind === "partial" && input.mode !== "enter") {
    const sameFp = !!fp && !!input.state.partialFingerprint && input.state.partialFingerprint === fp;
    const stableByRepeat = sameFp && input.state.partialFingerprintCount >= 1;
    const stableByTime = sameFp && input.state.partialFingerprintSinceTs > 0 && (now - input.state.partialFingerprintSinceTs) >= 100;
    if (!stableByRepeat && !stableByTime) {
      incrementSuppression(input.meetingId, "unstable_partial");
      return { action: "wait", displayQuestion: "", llmPrompt: "", prompt: "", questions: [], questionNorms: [], dedupeKey: "", confidence: effectiveConfidence, style: baseStyle };
    }
  }

  const dedupeThreshold = input.mode === "enter" ? 0.95 : 0.88;
  if (isRecentFingerprintDuplicate(input.meetingId, fp, dedupeThreshold, 12000)) {
    incrementSuppression(input.meetingId, "dedupe");
    return { action: "ignore", displayQuestion: "", llmPrompt: "", prompt: "", questions: [], questionNorms: [], dedupeKey: "", confidence: effectiveConfidence, style: baseStyle };
  }

  if (input.mode !== "enter" && !canAutoTrigger(input.meetingId, now, 6000)) {
    incrementSuppression(input.meetingId, "rate_limit");
    return { action: "wait", displayQuestion: "", llmPrompt: "", prompt: "", questions: [], questionNorms: [], dedupeKey: "", confidence: effectiveConfidence, style: baseStyle };
  }

  markTriggered(input.meetingId, fp, sourceKind, now);

  // Auto path for partial/final: do not invoke extractor LLM to keep latency low.
  if (input.mode !== "enter") {
    const q = composeInstantQuestion(candidateSpan);
    const questionNorm = normalizeForDedup(q);
    enqueueQuestion(input.meetingId, q, now);
    const displayQuestion = q;
    const prompt = applyAnswerStyle(baseStyle, displayQuestion);
    const dedupeKey = hash(normalizeForDedup(`answer::${baseStyle}::${questionNorm || displayQuestion}`));
    if (isDuplicateAction(input.meetingId, dedupeKey, 12000)) {
      incrementSuppression(input.meetingId, "dedupe");
      return { action: "ignore", displayQuestion: "", llmPrompt: "", prompt: "", questions: [], questionNorms: [], dedupeKey, confidence: effectiveConfidence, style: baseStyle };
    }
    return {
      action: "answer",
      displayQuestion,
      llmPrompt: prompt,
      prompt,
      questions: [{ text: q, clean: q, confidence: effectiveConfidence }],
      questionNorms: questionNorm ? [questionNorm] : [],
      dedupeKey,
      confidence: effectiveConfidence,
      style: baseStyle,
    };
  }

  let extractedQuestions = input.overrideQuestion?.trim()
    ? [composeInstantQuestion(sourceText)]
    : await extractQuestionsPrecise(sourceText, input.recentFinals || [], input.meetingId);

  if (!extractedQuestions.length) {
    const fallback = extractFallbackQuestionSpan(sourceText) || composeInstantQuestion(sourceText);
    if (fallback && (detectQuestion(fallback) || IMPERATIVE_QUESTION_CUES.test(fallback) || likelyContainsQuestion(sourceText))) {
      extractedQuestions = [fallback];
    }
  }
  if (!extractedQuestions.length) {
    return { action: "wait", displayQuestion: "", llmPrompt: "", prompt: "", questions: [], questionNorms: [], dedupeKey: "", confidence: 0.35, style: baseStyle };
  }

  const cleanedExtracted = extractedQuestions
    .map((q) => q.trim())
    .filter(Boolean);
  const extractedByNorm = new Map<string, string>();
  for (const q of cleanedExtracted) {
    const norm = normalizeForDedup(q);
    if (!norm || extractedByNorm.has(norm)) continue;
    extractedByNorm.set(norm, q);
    enqueueQuestion(input.meetingId, q, now);
  }
  expireOldUnanswered(input.meetingId, 45000, now);

  const unresolved = getUnanswered(input.meetingId, 10);
  const unresolvedNorms = new Set(unresolved.map((q) => q.norm));
  let selectedQuestions = Array.from(extractedByNorm.entries())
    .filter(([norm]) => unresolvedNorms.has(norm))
    .map(([, q]) => q);
  if (!selectedQuestions.length) {
    // Fallback: still answer the extracted question(s) if unresolved lookup missed.
    selectedQuestions = Array.from(extractedByNorm.values());
  }
  selectedQuestions = selectedQuestions.slice(0, 3);

  const questionNorms = selectedQuestions.map((q) => normalizeForDedup(q)).filter(Boolean);
  const displayQuestion = selectedQuestions.length === 1
    ? selectedQuestions[0]
    : `Answer these interviewer questions separately:\n${selectedQuestions.map((q, i) => `${i + 1}) ${q}`).join("\n")}`;
  const prompt = applyAnswerStyle(baseStyle, displayQuestion);
  const stableNorms = Array.from(new Set(questionNorms)).sort();
  const dedupeBase = stableNorms.length ? stableNorms.join("|") : normalizeForDedup(displayQuestion);
  const dedupeKey = hash(normalizeForDedup(`answer::${baseStyle}::${dedupeBase}`));
  if (isDuplicateAction(input.meetingId, dedupeKey, 12000)) {
    return { action: "ignore", displayQuestion: "", llmPrompt: "", prompt: "", questions: [], questionNorms: [], dedupeKey, confidence: 0.8, style: baseStyle };
  }

  return {
    action: "answer",
    displayQuestion,
    llmPrompt: prompt,
    prompt,
    questions: selectedQuestions.map((q) => ({ text: q, clean: q, confidence: 1 })),
    questionNorms,
    dedupeKey,
    confidence: 0.9,
    style: baseStyle,
  };
}
