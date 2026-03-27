import { callLLM } from "../llmRouter2";
import { addMessage, getLastMessage, getMemory } from "./onEnterMemory";
import { getSessionState, recordAssistantAnswer, recordUserQuestion, selectRelevantQAPairs } from "./sessionState";
import { isFollowUp, resolveAnchorTurn } from "@shared/followup";

function buildConversationHistory(sessionId: string): string {
  const memory = getMemory(sessionId);
  if (!memory.length) return "";
  return memory
    .map((m) => `${m.role === "interviewer" ? "Interviewer" : "Candidate"}: ${m.content}`)
    .join("\n");
}

function buildFollowUpPack(sessionId: string, questionText: string): { pack: string; isFollowUp: boolean } {
  const state = getSessionState(sessionId);
  const wordCount = questionText.trim().split(/\s+/).length;
  const isShortOrAmbiguous = wordCount <= 8;
  const followUp = isFollowUp(questionText, { lastAssistantAt: state.lastAssistantAt });

  // Always treat short/ambiguous utterances as follow-ups if there is any recent context
  const anchor = resolveAnchorTurn(state);
  const relevantPairs = selectRelevantQAPairs(sessionId, questionText, 2, 900);
  const anchorQ = (anchor.lastUserQuestion || relevantPairs[0]?.q || "").slice(0, 400);
  const anchorA = (anchor.lastAssistantAnswer || relevantPairs[0]?.a || "").slice(0, 600);
  const hasRecentContext = Boolean(anchorQ || anchorA);

  // Only skip follow-up pack if: not a follow-up AND not short/ambiguous AND no recent context
  if (!followUp.isFollowUp && !isShortOrAmbiguous && !hasRecentContext) return { pack: "", isFollowUp: false };
  // If no recent context at all, nothing to anchor to
  if (!hasRecentContext) return { pack: "", isFollowUp: false };

  const extraPair = relevantPairs.find((p) => p.q !== anchorQ || p.a !== anchorA);
  const extraBlock = extraPair
    ? `\n\nRelevant earlier QA:\nQ: ${extraPair.q.slice(0, 300)}\nA: ${extraPair.a.slice(0, 500)}`
    : "";

  const isShortCue = wordCount <= 3;
  const pack = [
    "=== FOLLOW-UP CONTEXT (use this to answer precisely; do NOT be generic) ===",
    `Latest interviewer topic: ${anchorQ}`,
    `Last answer given: ${anchorA}`,
    isShortCue
      ? "SHORT FOLLOW-UP CUE DETECTED: Ignore the literal input. Bind directly to the latest interviewer topic above and expand the last answer. Do NOT ask for clarification."
      : "Bind this input to the latest interviewer topic above. If the input is short, ambiguous, or incomplete, infer the full intent from the topic and answer directly.",
    "Only ask for clarification if there is truly NO usable recent context in the session — otherwise always answer.",
    extraBlock,
  ].filter(Boolean).join("\n");

  return { pack, isFollowUp: true };
}

export async function generateOnEnter({
  sessionId,
  resume,
  jobDescription,
  transcript,
  typedInput,
}: {
  sessionId: string;
  resume: string;
  jobDescription: string;
  transcript: string;
  typedInput?: string;
}) {
  const hasTyped = Boolean(typedInput && typedInput.trim().length > 0);
  const hasTranscript = Boolean(transcript && transcript.trim().length > 0);
  const repeatEnter = !hasTyped && !hasTranscript;

  if (!hasTyped && hasTranscript) {
    addMessage(sessionId, "interviewer", transcript);
    recordUserQuestion(sessionId, transcript);
  }

  const conversationHistory = buildConversationHistory(sessionId);
  const lastCandidate = getLastMessage(sessionId, "candidate")?.content || "";
  const lastInterviewer = getLastMessage(sessionId, "interviewer")?.content || "";

  const questionForFollowUp = (hasTranscript ? transcript : lastInterviewer || typedInput || "").trim();
  const { pack: followUpPack, isFollowUp: followUpDetected } = buildFollowUpPack(sessionId, questionForFollowUp || lastInterviewer);

  const seedInput = repeatEnter
    ? `Repeat Enter: deepen the previous answer without introducing new facts.\nPrevious answer:\n${lastCandidate}`
    : hasTyped
      ? `Candidate typed input:\n"${typedInput}"`
      : `Latest interviewer transcript:\n"${transcript}"`;

  const followUpPolicy = followUpDetected
    ? [
        "FOLLOW-UP POLICY:",
        "- Bind to the latest interviewer topic automatically.",
        "- Start by referencing the prior answer in 1 sentence (e.g., \"On the caching point I mentioned...\").",
        "- Then expand with 2-5 bullets or a short paragraph.",
        "- End with one concrete example or next step if technical.",
        "- If short, ambiguous, or incomplete transcript — infer full intent from context and answer directly.",
        "- Never ask for clarification unless there is truly NO usable recent context in the session.",
      ].join("\n")
    : "";

  const systemPrompt = `You are an elite interview copilot assisting a candidate in a real interview.

Your job:
- Expand what the candidate typed (if any), OR answer based on the latest interviewer transcript.
- Maintain continuity with the entire session history.
- Deepen the answer if this is a repeat Enter.

Rules:
1. Always answer in first person (as the candidate).
2. Never mention being an AI.
3. Never contradict previous answers.
4. Do not make up senior-level experience the candidate does not have.
5. If the candidate typed text, expand, refine, and professionalize it.
6. If no typed text, answer the interviewer’s transcript.
7. If Enter is pressed repeatedly with no new text, deepen the prior answer.
8. Align responses with resume and job description context.
9. Be confident, structured, and interview-ready.

Do NOT:
- Wait for question marks.
- Block answers if detection logic doesn’t see a question.
- Introduce new unrelated topics.
- Ask for clarification — always infer and answer.

Short utterance rules (apply when input is 6 words or less):
- Treat it as a follow-up to the last active topic automatically.
- Rewrite the vague input into a full contextual question based on conversation history, then answer it.
- Anchor to the last discussed topic even if the input seems unrelated.
- Answer even if the transcript is incomplete or cut off mid-sentence.

${followUpPolicy}`.trim();

  const userPrompt = [
    "Resume Context:",
    resume || "(none)",
    "",
    "Job Description:",
    jobDescription || "(none)",
    "",
    "Conversation So Far:",
    conversationHistory || "(none)",
    "",
    followUpPack || "",
    seedInput,
    "",
    "Now produce the best possible interview answer based on the provided context.",
  ].filter(Boolean).join("\n");

  const isCodingQuestion = /\b(code|coding|function|class|algorithm|implement|write|build|program|script|solution|snippet|def |class |import |```)\b/i.test(seedInput + " " + (transcript || "") + " " + (typedInput || ""));
  const maxTokens = isCodingQuestion ? 4000 : 700;

  const answer = await callLLM(
    "LIVE_INTERVIEW_ANSWER",
    systemPrompt,
    userPrompt,
    sessionId,
    { temperature: 0.4, maxTokens, cacheUserId: sessionId },
  );

  const cleanAnswer = (answer || "").trim();
  if (cleanAnswer) {
    addMessage(sessionId, "candidate", cleanAnswer);
    const questionForPair = hasTranscript ? transcript : (getSessionState(sessionId).lastUserQuestion || lastInterviewer || "");
    recordAssistantAnswer(sessionId, questionForPair, cleanAnswer);
  }

  return cleanAnswer;
}
