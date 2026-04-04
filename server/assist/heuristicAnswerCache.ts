/**
 * Heuristic answer cache — pre-generates answers for common predictable
 * interview questions (tell me about yourself, strengths, weaknesses, etc.)
 * at session start so Enter gives an instant reply with no LLM round-trip.
 *
 * Only used for questions whose answer comes purely from the candidate profile
 * (resume / custom instructions). Coding, system design, and scenario questions
 * are never served from this cache.
 */

import { streamLLM } from "../llmRouter2";

type HeuristicType =
  | "tell_me_about_yourself"
  | "strengths"
  | "weaknesses"
  | "why_this_role"
  | "five_years"
  | "greatest_achievement"
  | "work_style";

type HeuristicRule = {
  type: HeuristicType;
  re: RegExp;
  prompt: string;
};

const HEURISTIC_RULES: HeuristicRule[] = [
  {
    type: "tell_me_about_yourself",
    re: /\b(tell\s+me\s+about\s+yourself|walk\s+me\s+through\s+(your\s+)?(background|experience|resume|profile)|introduce\s+yourself|about\s+yourself|your\s+background|brief\s+introduction)\b/i,
    prompt: "Tell me about yourself.",
  },
  {
    type: "strengths",
    re: /\b(what\s+(are|is)\s+(your|a)\s+(greatest?\s+)?strengths?|tell\s+me\s+(about\s+)?your\s+strengths?|describe\s+your\s+strengths?|key\s+strengths?)\b/i,
    prompt: "What are your greatest strengths?",
  },
  {
    type: "weaknesses",
    re: /\b(what\s+(are|is)\s+(your|a)\s+(greatest?\s+)?weaknesses?|tell\s+me\s+(about\s+)?your\s+weaknesses?|describe\s+your\s+weakness|areas?\s+(of\s+)?improvement|areas?\s+(you\s+)?work\s+on)\b/i,
    prompt: "What is your greatest weakness and how are you working on it?",
  },
  {
    type: "why_this_role",
    re: /\b(why\s+(do\s+you\s+want|are\s+you\s+interested\s+in|did\s+you\s+apply\s+(for)?)\s+(this|the)\s+(role|job|position|company|opportunity)|what\s+draws\s+you\s+to\s+this|why\s+(this\s+(company|role|job)|us\b)|why\s+do\s+you\s+want\s+to\s+join)\b/i,
    prompt: "Why do you want this role and what motivates you about this opportunity?",
  },
  {
    type: "five_years",
    re: /\b(where\s+(do\s+you\s+see\s+yourself|will\s+you\s+be)\s+in\s+(5|five)\s+years?|five\s+year\s+(plan|goal)|5\s+year\s+(plan|goal)|long[\s-]term\s+(goals?|plans?))\b/i,
    prompt: "Where do you see yourself in 5 years? What are your long-term career goals?",
  },
  {
    type: "greatest_achievement",
    re: /\b(what\s+(is|was|are)\s+(your|a)\s+(greatest|biggest|most\s+significant|proudest)\s+(achievement|accomplishment|success|project|contribution)|tell\s+me\s+about\s+(a\s+time\s+you\s+(succeeded|achieved|accomplished|proud)|your\s+greatest\s+achievement))\b/i,
    prompt: "What is your greatest professional achievement? Give a specific example with impact.",
  },
  {
    type: "work_style",
    re: /\b(how\s+do\s+you\s+(work|handle|deal\s+with)\s+(under\s+pressure|stress|tight\s+deadlines?|pressure|difficult\s+(situations?|challenges?))|describe\s+your\s+work\s+style|how\s+do\s+you\s+(manage|prioritize)\s+(your\s+time|priorities|multiple\s+tasks?|competing\s+priorities))\b/i,
    prompt: "How do you handle pressure and manage competing priorities? Give a specific example.",
  },
];

// Cache: `meetingId:type` → pre-generated answer text
const heuristicCache = new Map<string, string>();
// Track meetings currently being warmed to avoid duplicate parallel generations
const warmingInProgress = new Set<string>();

/**
 * Returns the heuristic type if the question is a common predictable one, else null.
 */
export function detectHeuristicType(question: string): HeuristicType | null {
  const text = String(question || "").trim();
  if (!text) return null;
  for (const rule of HEURISTIC_RULES) {
    if (rule.re.test(text)) return rule.type;
  }
  return null;
}

/**
 * Returns the pre-generated answer for a common question, or null if not cached.
 */
export function getHeuristicAnswer(meetingId: string, question: string): string | null {
  const type = detectHeuristicType(question);
  if (!type) return null;
  return heuristicCache.get(`${meetingId}:${type}`) ?? null;
}

/**
 * Pre-generate answers for all common question types in the background.
 * Called once at session_start. Safe to call multiple times — skips already-cached types.
 */
export async function warmHeuristicAnswers(
  userId: string,
  meetingId: string,
  profileContext: string,
  customInstructions?: string,
): Promise<void> {
  if (!profileContext.trim()) return;
  if (warmingInProgress.has(meetingId)) return;

  // Skip if all types already cached for this meeting
  const allCached = HEURISTIC_RULES.every((r) => heuristicCache.has(`${meetingId}:${r.type}`));
  if (allCached) return;

  warmingInProgress.add(meetingId);

  const customBlock = customInstructions?.trim()
    ? `\n\n=== CUSTOM INSTRUCTIONS (follow these exactly for format, tone, style) ===\n${customInstructions.trim()}\n===`
    : "";

  const systemPrompt = [
    "You are a professional job candidate in an interview. Answer in first-person, naturally and concisely (3-5 sentences).",
    "Base your answer strictly on the candidate profile below. Be specific — use real skills, companies, and achievements from the profile.",
    "Do NOT start with 'Certainly', 'Sure', 'Great question', 'Of course'. Start directly with the substance.",
    "Do NOT mention being an AI. Answer as the candidate themselves.",
    "Use bold (**text**) to highlight key terms, skills, and role titles.",
    `\nCandidate profile:\n${profileContext.slice(0, 8000)}`,
    customBlock,
  ].join("\n");

  await Promise.allSettled(
    HEURISTIC_RULES.map(async (rule) => {
      const cacheKey = `${meetingId}:${rule.type}`;
      if (heuristicCache.has(cacheKey)) return;
      try {
        let answer = "";
        for await (const chunk of streamLLM(
          "LIVE_INTERVIEW_ANSWER",
          systemPrompt,
          rule.prompt,
          meetingId,
          { model: "gpt-4o-mini", maxTokens: 350, cacheUserId: userId },
        )) {
          answer += chunk;
        }
        if (answer.trim()) {
          heuristicCache.set(cacheKey, answer.trim());
          console.log(`[heuristic] cached meetingId=${meetingId} type=${rule.type} len=${answer.length}`);
        }
      } catch (err: any) {
        // Best-effort — fall back to normal LLM pipeline on Enter if generation fails
        console.warn(`[heuristic] warm failed meetingId=${meetingId} type=${rule.type}: ${err?.message}`);
      }
    }),
  );

  warmingInProgress.delete(meetingId);
}

/**
 * Evict cache entries for a meeting (e.g. when profile/instructions change).
 */
export function clearHeuristicCache(meetingId: string): void {
  for (const key of [...heuristicCache.keys()]) {
    if (key.startsWith(`${meetingId}:`)) heuristicCache.delete(key);
  }
}
