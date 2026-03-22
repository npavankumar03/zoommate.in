import { storage } from "./storage";
import { getPrewarmedOpenAIKey } from "./llmRouter";
import { indexDocumentForRag } from "./rag";

const REVIEW_MODEL = "gpt-4o-mini";
const DOC_TYPE = "session_review";

// ─── LLM call ────────────────────────────────────────────────────────────────

async function callLLM(system: string, user: string): Promise<string> {
  const apiKey = getPrewarmedOpenAIKey() || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("No API key for session review");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: REVIEW_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 900,
      temperature: 0,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Session review LLM error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content?.trim() || "";
}

// ─── Review generation ───────────────────────────────────────────────────────

const REVIEW_SYSTEM_PROMPT = `You are analyzing a job interview session to generate a structured review.
Given Q&A pairs from a real interview session, identify:
- questions_asked: array of the key interview questions asked (deduplicated, clean)
- went_well: array of topics/questions where the candidate answered confidently and correctly
- failed: array of topics/questions where answers were weak, vague, incorrect, or incomplete
- gaps_exposed: array of knowledge areas the candidate clearly lacks (based on answer quality)
- improvement_notes: array of specific, actionable things to improve before next interview

Rules:
- Be honest and direct — this is private feedback
- Each array: 3–6 items max, concise strings
- Base judgement only on what is in the Q&A, not assumptions
- Return valid JSON only, no markdown fences`;

interface SessionReviewData {
  questions_asked: string[];
  went_well: string[];
  failed: string[];
  gaps_exposed: string[];
  improvement_notes: string[];
}

async function analyzeSession(
  qaPairs: Array<{ question: string; answer: string }>,
  rollingSummary: string,
): Promise<SessionReviewData> {
  const qaBlock = qaPairs
    .slice(0, 40) // cap at 40 pairs to stay within token budget
    .map((p, i) => `Q${i + 1}: ${p.question}\nA${i + 1}: ${p.answer.slice(0, 400)}`)
    .join("\n\n");

  const userMsg = rollingSummary
    ? `Session summary:\n${rollingSummary}\n\nQ&A pairs:\n${qaBlock}`
    : `Q&A pairs:\n${qaBlock}`;

  const raw = await callLLM(REVIEW_SYSTEM_PROMPT, userMsg);

  try {
    return JSON.parse(raw) as SessionReviewData;
  } catch {
    // Fallback: extract JSON from response if wrapped
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as SessionReviewData;
    throw new Error("Session review: failed to parse LLM JSON");
  }
}

function formatReviewAsText(review: SessionReviewData, meetingTitle: string, date: string): string {
  const fmt = (arr: string[]) =>
    arr.length ? arr.map((x) => `- ${x}`).join("\n") : "- (none identified)";

  return [
    `SESSION REVIEW: ${meetingTitle}`,
    `Date: ${date}`,
    "",
    "QUESTIONS ASKED:",
    fmt(review.questions_asked),
    "",
    "WENT WELL:",
    fmt(review.went_well),
    "",
    "FAILED / WEAK:",
    fmt(review.failed),
    "",
    "GAPS EXPOSED:",
    fmt(review.gaps_exposed),
    "",
    "IMPROVEMENT NOTES:",
    fmt(review.improvement_notes),
  ].join("\n");
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function generateSessionReview(meetingId: string): Promise<void> {
  try {
    const meeting = await storage.getMeeting(meetingId);
    if (!meeting) return;

    const responses = await storage.getResponses(meetingId);
    if (responses.length < 2) {
      console.log(`[sessionReview] Skipping — only ${responses.length} responses`);
      return;
    }

    const qaPairs = responses
      .filter((r) => r.question && r.answer)
      .map((r) => ({ question: r.question, answer: r.answer }));

    console.log(`[sessionReview] Generating review for meeting ${meetingId} (${qaPairs.length} Q&A pairs)`);

    const review = await analyzeSession(qaPairs, meeting.rollingSummary || "");
    const date = new Date().toISOString().slice(0, 10);
    const content = formatReviewAsText(review, meeting.title, date);

    // Delete old review for this meeting if it exists
    const allDocs = await storage.getDocuments(meeting.userId);
    const docName = `_session_review_${meetingId}`;
    const existing = allDocs.find((d: any) => d.name === docName);
    if (existing) await storage.deleteDocument(existing.id);

    // Store as searchable document so RAG can surface past failures/gaps
    const newDoc = await storage.createDocument({
      userId: meeting.userId,
      name: docName,
      content,
      type: DOC_TYPE,
    } as any);

    await indexDocumentForRag((newDoc as any).id);
    console.log(`[sessionReview] Review stored and indexed for meeting ${meetingId}`);
  } catch (err: any) {
    console.error("[sessionReview] Failed:", err.message);
  }
}

// ─── Prompt injection ────────────────────────────────────────────────────────

export async function formatSessionReviewsForPrompt(userId: string): Promise<string> {
  try {
    const allDocs = await storage.getDocuments(userId);
    const reviews = allDocs
      .filter((d: any) => d.type === DOC_TYPE)
      .sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, 3); // last 3 sessions

    if (!reviews.length) return "";

    const sections = reviews.map((r: any) => {
      // Extract only the actionable lines to keep prompt compact
      const lines = (r.content as string).split("\n");
      const pick = (header: string) => {
        const idx = lines.findIndex((l) => l.startsWith(header));
        if (idx === -1) return [];
        const items: string[] = [];
        for (let i = idx + 1; i < lines.length && lines[i].startsWith("- "); i++) {
          items.push(lines[i].slice(2));
        }
        return items;
      };

      const failed = pick("FAILED / WEAK:");
      const gaps = pick("GAPS EXPOSED:");
      const notes = pick("IMPROVEMENT NOTES:");

      const parts: string[] = [];
      if (failed.length) parts.push(`Weak areas: ${failed.join("; ")}`);
      if (gaps.length) parts.push(`Gaps: ${gaps.join("; ")}`);
      if (notes.length) parts.push(`Focus on: ${notes.join("; ")}`);
      return parts.join(" | ");
    }).filter(Boolean);

    if (!sections.length) return "";

    return `<PAST_SESSION_INSIGHTS>\n${sections.join("\n")}\n</PAST_SESSION_INSIGHTS>`;
  } catch {
    return "";
  }
}
