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
  const followUp = isFollowUp(questionText, { lastAssistantAt: state.lastAssistantAt });
  if (!followUp.isFollowUp) return { pack: "", isFollowUp: false };

  const anchor = resolveAnchorTurn(state);
  const relevantPairs = selectRelevantQAPairs(sessionId, questionText, 2, 900);
  const anchorQ = (anchor.lastUserQuestion || relevantPairs[0]?.q || "").slice(0, 400);
  const anchorA = (anchor.lastAssistantAnswer || relevantPairs[0]?.a || "").slice(0, 600);
  const extraPair = relevantPairs.find((p) => p.q !== anchorQ || p.a !== anchorA);
  const extraBlock = extraPair
    ? `\n\nRelevant earlier QA:\nQ: ${extraPair.q.slice(0, 300)}\nA: ${extraPair.a.slice(0, 500)}`
    : "";

  if (!anchorQ && !anchorA && !extraPair) return { pack: "", isFollowUp: false };

  const pack = [
    "=== FOLLOW-UP CONTEXT (use this to answer precisely; do NOT be generic) ===",
    `Previous question: ${anchorQ}`,
    `Previous answer: ${anchorA}`,
    "If the follow-up is ambiguous, ask ONE clarifying question, otherwise answer directly.",
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
        "- Start by referencing the prior answer in 1 sentence (e.g., \"On the caching point I mentioned...\").",
        "- Then expand with 2-5 bullets or a short paragraph.",
        "- End with one concrete example or next step if technical.",
        "- If too ambiguous, ask ONE clarifying question.",
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
