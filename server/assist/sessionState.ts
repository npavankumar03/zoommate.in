import { normalizeForDedup } from "@shared/questionDetection";

export type SessionTurn = { role: "user" | "assistant"; text: string; ts: number };
export type QAPair = { q: string; a: string; ts: number; requestId?: string };
export type InterviewerQuestion = { text: string; norm: string; ts: number; answeredTs?: number };
export type SpokenReply = { text: string; ts: number };
export type AssistantMemoryAnswer = { question: string; answer: string; ts: number; requestId?: string };
export type InterviewerPatternSummary = {
  dominantTypes: string[];
  repeatedTopics: string[];
  tendsToAskFollowUps: boolean;
};

export type CodeOperation =
  | "initial_solution"
  | "optimize"
  | "in_place"
  | "language_switch"
  | "thread_safe"
  | "refactor"
  | "add_tests"
  | "add_error_handling"
  | "constraint_change"
  | "alternative"
  | "complexity_analysis"
  | "explain";

export type CodingProblemState = {
  problemType: string;              // e.g. "palindrome check", "graph BFS", "sliding window"
  activeApproach: string;           // current solution strategy being discussed
  chosenLanguage: string;           // "Java", "Python", "JavaScript", etc.
  currentComplexity: { time: string; space: string };
  constraints: string[];            // e.g. ["no extra space", "handle negatives"]
  currentCodeVersion: string;       // latest code block extracted from answer
  previousCodeVersion: string;      // version before the last code change — enables "why did you change X?"
  rejectedAlternatives: string[];   // approaches mentioned as suboptimal or avoided
  unsolvedFollowUps: string[];      // follow-up questions raised but not yet answered
  lastOperation: CodeOperation;     // what kind of transformation the last turn was
  operationHistory: Array<{ operation: CodeOperation; ts: number }>; // full turn trail
  updatedAt: number;
};

export type SessionState = {
  lastUserQuestion?: string;
  lastAssistantAnswer?: string;
  lastAssistantAt?: number;
  lastTurns: SessionTurn[];
  qaPairs: QAPair[];
  interviewerQuestions: InterviewerQuestion[];
  spokenReplies: SpokenReply[];
  assistantAnswers: AssistantMemoryAnswer[];
  codingProblemState?: CodingProblemState;
};

const stateBySession = new Map<string, SessionState>();
const MAX_TURNS = 40;
const MAX_QA_PAIRS = 40;
const MAX_MEMORY_ITEMS = 50;

function getOrCreate(meetingId: string): SessionState {
  const existing = stateBySession.get(meetingId);
  if (existing) return existing;
  const created: SessionState = { lastTurns: [], qaPairs: [], interviewerQuestions: [], spokenReplies: [], assistantAnswers: [] };
  stateBySession.set(meetingId, created);
  return created;
}

function markQuestionAnsweredByText(s: SessionState, question: string, ts = Date.now()): void {
  const norm = normalizeForDedup(question || "");
  if (!norm) return;
  for (let i = s.interviewerQuestions.length - 1; i >= 0; i--) {
    const q = s.interviewerQuestions[i];
    if (q.answeredTs) continue;
    if (q.norm === norm) {
      q.answeredTs = ts;
      return;
    }
  }
}

export function getSessionState(meetingId: string): SessionState {
  return getOrCreate(meetingId);
}

export function recordUserQuestion(meetingId: string, question: string, ts = Date.now()): void {
  const s = getOrCreate(meetingId);
  const clean = String(question || "").trim();
  if (!clean) return;
  s.lastUserQuestion = clean;
  s.lastTurns.push({ role: "user", text: clean, ts });
  if (s.lastTurns.length > MAX_TURNS) s.lastTurns = s.lastTurns.slice(-MAX_TURNS);
  recordInterviewerQuestion(meetingId, clean, ts);
}

export function recordAssistantAnswer(
  meetingId: string,
  question: string,
  answer: string,
  requestId?: string,
  ts = Date.now(),
): void {
  const s = getOrCreate(meetingId);
  const cleanAnswer = String(answer || "").trim();
  const cleanQuestion = String(question || "").trim();
  if (!cleanAnswer) return;
  s.lastAssistantAnswer = cleanAnswer;
  s.lastAssistantAt = ts;
  s.lastTurns.push({ role: "assistant", text: cleanAnswer, ts });
  if (s.lastTurns.length > MAX_TURNS) s.lastTurns = s.lastTurns.slice(-MAX_TURNS);

  if (cleanQuestion) {
    s.qaPairs.unshift({ q: cleanQuestion, a: cleanAnswer, ts, requestId });
    if (s.qaPairs.length > MAX_QA_PAIRS) s.qaPairs = s.qaPairs.slice(0, MAX_QA_PAIRS);
    markQuestionAnsweredByText(s, cleanQuestion, ts);
  }
  s.assistantAnswers.unshift({ question: cleanQuestion, answer: cleanAnswer, ts, requestId });
  if (s.assistantAnswers.length > MAX_MEMORY_ITEMS) s.assistantAnswers = s.assistantAnswers.slice(0, MAX_MEMORY_ITEMS);
}

export function recordInterviewerQuestion(meetingId: string, question: string, ts = Date.now()): void {
  const s = getOrCreate(meetingId);
  const clean = String(question || "").trim();
  const norm = normalizeForDedup(clean);
  if (!clean || !norm) return;
  const recent = s.interviewerQuestions.find((q) => (ts - q.ts) <= 120000 && q.norm === norm);
  if (recent) {
    recent.ts = ts;
    if (!recent.text || recent.text.length < clean.length) recent.text = clean;
    return;
  }
  s.interviewerQuestions.push({ text: clean, norm, ts });
  if (s.interviewerQuestions.length > MAX_MEMORY_ITEMS) {
    s.interviewerQuestions = s.interviewerQuestions.slice(-MAX_MEMORY_ITEMS);
  }
}

export function recordSpokenReply(meetingId: string, reply: string, ts = Date.now()): void {
  const s = getOrCreate(meetingId);
  const clean = String(reply || "").trim();
  if (!clean) return;
  s.spokenReplies.unshift({ text: clean, ts });
  if (s.spokenReplies.length > MAX_MEMORY_ITEMS) s.spokenReplies = s.spokenReplies.slice(0, MAX_MEMORY_ITEMS);
}

export function getLastUnansweredInterviewerQuestion(meetingId: string): InterviewerQuestion | null {
  const s = getOrCreate(meetingId);
  for (let i = s.interviewerQuestions.length - 1; i >= 0; i--) {
    const q = s.interviewerQuestions[i];
    if (!q.answeredTs) return q;
  }
  return null;
}

export function getLatestSpokenReply(meetingId: string): SpokenReply | null {
  const s = getOrCreate(meetingId);
  return s.spokenReplies[0] || null;
}

export function getRecentSpokenReplies(
  meetingId: string,
  maxItems = 10,
  maxChars = 2000,
): SpokenReply[] {
  const s = getOrCreate(meetingId);
  if (!s.spokenReplies.length) return [];

  const selected: SpokenReply[] = [];
  let used = 0;
  for (const reply of s.spokenReplies) {
    if (selected.length >= maxItems) break;
    const text = String(reply.text || "").trim();
    if (!text) continue;
    if (text.length < 3) continue;
    if (/^(uh|um|hmm|mm|okay|ok|right|yeah|yes|no)$/i.test(text)) continue;
    const next = text.length + 2;
    if (used + next > maxChars && selected.length > 0) break;
    selected.push(reply);
    used += next;
  }

  return selected;
}

export function markInterviewerQuestionAnswered(meetingId: string, question: string, ts = Date.now()): void {
  const s = getOrCreate(meetingId);
  markQuestionAnsweredByText(s, question, ts);
}

function tokenize(text: string): string[] {
  return normalizeForDedup(text)
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function scoreSimilarity(query: string, candidate: string): number {
  const qTokens = new Set(tokenize(query));
  const cTokens = new Set(tokenize(candidate));
  if (!qTokens.size || !cTokens.size) return 0;
  let overlap = 0;
  for (const t of qTokens) if (cTokens.has(t)) overlap++;
  return overlap / Math.sqrt(qTokens.size * cTokens.size);
}

export function selectRelevantQAPairs(
  meetingId: string,
  question: string,
  maxPairs = 2,
  maxChars = 900,
): QAPair[] {
  const s = getOrCreate(meetingId);
  if (!s.qaPairs.length) return [];
  const scored = s.qaPairs.map((pair, idx) => {
    const content = `${pair.q}\n${pair.a}`;
    const score = scoreSimilarity(question, content) + (idx === 0 ? 0.05 : 0);
    return { pair, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const selected: QAPair[] = [];
  let usedChars = 0;

  for (const item of scored) {
    if (selected.length >= maxPairs) break;
    const candidate = item.pair;
    const size = candidate.q.length + candidate.a.length + 10;
    if (usedChars + size > maxChars && selected.length > 0) continue;
    selected.push(candidate);
    usedChars += size;
  }

  if (!selected.length && s.qaPairs[0]) {
    selected.push(s.qaPairs[0]);
  }

  return selected;
}

/**
 * Detects vague/back-reference questions like "what about that thing you said",
 * "earlier you mentioned", "going back to X", "can you elaborate on that" etc.
 * When true, the answer engine injects more Q&A history for better context.
 */
export function isVagueQuestion(text: string): boolean {
  const q = String(text || "").toLowerCase();
  return /\b(that thing|you mentioned|you said|earlier|going back|what about that|elaborate on that|tell me more about that|expand on that|what did you mean|refer(red)? to|as you (said|mentioned)|like you (said|mentioned)|the (thing|point|example|part) you|what was that|can you (clarify|explain) (that|what you)|what you (said|mentioned|talked about))\b/.test(q);
}

function classifyQuestionIntent(text: string): string {
  const q = String(text || "").toLowerCase();
  if (!q.trim()) return "general";
  if (/\b(experience|worked on|have you used|tell me about your|background)\b/.test(q)) return "experience";
  if (/\b(why|how|explain|walk me through|line by line|what happens)\b/.test(q)) return "explain";
  if (/\b(compare|difference|pros and cons|tradeoff)\b/.test(q)) return "compare";
  if (/\b(code|implement|write|build|leetcode|algorithm|complexity|debug|fix|modify)\b/.test(q)) return "coding";
  if (/\b(challenge|conflict|leadership|stakeholder|deadline|mistake|failure)\b/.test(q)) return "behavioral";
  return "general";
}

function extractQuestionTopics(text: string): string[] {
  return Array.from(
    new Set(
      tokenize(text).filter((token) =>
        !["experience", "about", "explain", "there", "their", "project", "worked", "using", "would", "could"].includes(token),
      ),
    ),
  ).slice(0, 12);
}

export function getRecentQuestionHistory(
  meetingId: string,
  maxItems = 6,
): Array<{ text: string; ts: number; answered: boolean }> {
  const s = getOrCreate(meetingId);
  return s.interviewerQuestions
    .slice()
    .sort((a, b) => b.ts - a.ts)
    .slice(0, maxItems)
    .map((q) => ({ text: q.text, ts: q.ts, answered: Boolean(q.answeredTs) }));
}

export function summarizeInterviewerPatterns(meetingId: string): InterviewerPatternSummary {
  const s = getOrCreate(meetingId);
  const recent = s.interviewerQuestions.slice(-10);
  if (!recent.length) {
    return { dominantTypes: [], repeatedTopics: [], tendsToAskFollowUps: false };
  }

  const typeCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();
  let followUps = 0;

  for (const item of recent) {
    const kind = classifyQuestionIntent(item.text);
    typeCounts.set(kind, (typeCounts.get(kind) || 0) + 1);
    const topics = extractQuestionTopics(item.text);
    for (const topic of topics) {
      topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
    }
    if (/\b(and|also|why|how so|what about|which one|tell me more|expand)\b/i.test(item.text)) {
      followUps += 1;
    }
  }

  const dominantTypes = Array.from(typeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type]) => type);

  const repeatedTopics = Array.from(topicCounts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic]) => topic);

  return {
    dominantTypes,
    repeatedTopics,
    tendsToAskFollowUps: followUps >= 2,
  };
}

export function buildInterviewerIntelligenceBlock(
  meetingId: string,
  activeQuestion: string,
  maxHistory = 5,
): string {
  const history = getRecentQuestionHistory(meetingId, maxHistory);
  const patterns = summarizeInterviewerPatterns(meetingId);
  const relevantPairs = selectRelevantQAPairs(meetingId, activeQuestion, 3, 1200);
  const parts: string[] = [];

  // Detect if current question was already answered (similarity >= 0.45)
  const s = stateBySession.get(meetingId);
  let previouslyAnsweredPair: QAPair | null = null;
  if (s && s.qaPairs.length) {
    const scored = s.qaPairs
      .map((pair) => ({ pair, score: scoreSimilarity(activeQuestion, pair.q) }))
      .filter((item) => item.score >= 0.45)
      .sort((a, b) => b.score - a.score);
    if (scored.length) previouslyAnsweredPair = scored[0].pair;
  }

  if (previouslyAnsweredPair) {
    parts.push(
      [
        "⚠ REPEAT/FOLLOW-UP DETECTED — INSTRUCTION: Do NOT give the same answer again.",
        "Build on what was said, go deeper, add a new angle, or acknowledge the prior answer briefly then expand.",
        `Prior answer to a similar question: "${previouslyAnsweredPair.a.slice(0, 400)}${previouslyAnsweredPair.a.length > 400 ? "..." : ""}"`,
      ].join("\n"),
    );
  }

  if (history.length) {
    parts.push(
      [
        "QUESTION HISTORY:",
        ...history
          .slice()
          .reverse()
          .map((q) => `- ${q.text}${q.answered ? " [answered]" : " [open]"}`),
      ].join("\n"),
    );
  }

  const patternLines: string[] = [];
  if (patterns.dominantTypes.length) patternLines.push(`- Common question styles: ${patterns.dominantTypes.join(", ")}`);
  if (patterns.repeatedTopics.length) patternLines.push(`- Repeated interviewer topics: ${patterns.repeatedTopics.join(", ")}`);
  if (patterns.tendsToAskFollowUps) patternLines.push("- Interviewer frequently asks follow-up/deeper-detail questions.");
  if (patternLines.length) {
    parts.push(["INTERVIEWER PATTERNS:", ...patternLines].join("\n"));
  }

  if (relevantPairs.length) {
    parts.push(
      [
        "RELEVANT PRIOR QA:",
        ...relevantPairs.map((pair) => `- Q: ${pair.q}\n  A: ${pair.a}`),
      ].join("\n"),
    );
  }

  return parts.join("\n\n").trim();
}

// ── Coding Problem State ─────────────────────────────────────────────────────

// ── Language extraction ───────────────────────────────────────────────────────

function extractLanguageFromAnswer(answer: string): string {
  const fence = answer.match(/```(\w+)/);
  if (!fence) return "";
  const lang = fence[1].toLowerCase();
  const map: Record<string, string> = {
    java: "Java", python: "Python", py: "Python",
    javascript: "JavaScript", js: "JavaScript",
    typescript: "TypeScript", ts: "TypeScript",
    cpp: "C++", "c++": "C++", c: "C",
    csharp: "C#", cs: "C#", go: "Go", golang: "Go",
    rust: "Rust", kotlin: "Kotlin", swift: "Swift", ruby: "Ruby",
    scala: "Scala", kotlin2: "Kotlin",
  };
  return map[lang] || fence[1];
}

// ── Code block extraction ─────────────────────────────────────────────────────

function extractCodeBlock(answer: string): string {
  const blocks = [...answer.matchAll(/```(?:\w+)?\n([\s\S]*?)```/g)];
  if (!blocks.length) return "";
  // Prefer the largest block — most likely the main solution, not an inline snippet
  return blocks.reduce((best, m) => (m[1].length > best.length ? m[1] : best), "").trim();
}

// ── Space-using data structure extraction ─────────────────────────────────────
// Identifies O(n) auxiliary structures in the current code — grounds rubric
// feedback so the model names the specific variables the candidate should eliminate.

const SPACE_STRUCTURE_PATTERNS: Array<{ re: RegExp; label: string; language?: RegExp }> = [
  // Language-specific named types
  { re: /\bCounter\b/,      label: "Counter",     language: /python/i },
  { re: /\bdefaultdict\b/,  label: "defaultdict", language: /python/i },
  { re: /\bdeque\b/,        label: "deque",       language: /python/i },
  { re: /\bHashMap\b/,      label: "HashMap",     language: /java/i },
  { re: /\bHashSet\b/,      label: "HashSet",     language: /java/i },
  { re: /\bArrayList\b/,    label: "ArrayList",   language: /java/i },
  { re: /\bArrayDeque\b/,   label: "ArrayDeque",  language: /java/i },
  { re: /\bStack\b/,        label: "Stack",       language: /java/i },
  { re: /new\s+Map\b/,      label: "Map",         language: /javascript|typescript/i },
  { re: /new\s+Set\b/,      label: "Set",         language: /javascript|typescript/i },
  { re: /\bmap\[/,          label: "map",         language: /go/i },
  // Language-agnostic: common O(n) auxiliary storage by variable name
  { re: /\bseen\s*[=:{(]/,           label: "`seen`" },
  { re: /\bvisited\s*[=:{(]/,        label: "`visited`" },
  { re: /\bcache\s*[=:{(]/,          label: "`cache`" },
  { re: /\bmemo\s*[=:{(]/,           label: "`memo`" },
  { re: /\bcounts?\s*[=:{(]/,        label: "`counts`" },
  { re: /\bfreq(?:uency)?\s*[=:{(]/, label: "`freq`" },
];

/**
 * Returns a list of O(n) data structures found in the given code.
 * Used to ground space-optimization rubric feedback with specific variable/type names.
 */
export function extractSpaceUsingStructures(code: string, language: string): string[] {
  if (!code) return [];
  const found = new Set<string>();
  for (const { re, label, language: langFilter } of SPACE_STRUCTURE_PATTERNS) {
    if (langFilter && !langFilter.test(language)) continue;
    if (re.test(code)) found.add(label);
  }
  return [...found].slice(0, 5);
}

// ── Complexity extraction (big-O notation + prose) ────────────────────────────

const COMPLEXITY_PROSE: Array<{ re: RegExp; value: string }> = [
  { re: /\bconstant\s+(?:time|space)\b/i,    value: "O(1)" },
  { re: /\blogarithmic\s+(?:time|space)\b/i, value: "O(log n)" },
  { re: /\blinear\s+(?:time|space)\b/i,      value: "O(n)" },
  { re: /\bn\s*log\s*n\b|\bn\s*\*\s*log\s*n\b/i, value: "O(n log n)" },
  { re: /\bquadratic\b|\bn[\s-]squared\b/i,  value: "O(n²)" },
  { re: /\bexponential\b/i,                  value: "O(2^n)" },
  { re: /\bfactorial\b/i,                    value: "O(n!)" },
];

function resolveComplexityProse(text: string): string {
  for (const { re, value } of COMPLEXITY_PROSE) {
    if (re.test(text)) return value;
  }
  return "";
}

function extractComplexity(text: string): { time: string; space: string } {
  // Explicit O(...) notation near "time" / "space"
  const timeNotation  = text.match(/time[:\s]*(?:complexity[:\s]*)?(O\([^)]+\))/i)?.[1] || "";
  const spaceNotation = text.match(/space[:\s]*(?:complexity[:\s]*)?(O\([^)]+\))/i)?.[1] || "";

  // All O(...) tokens in document order
  const allO = [...text.matchAll(/\b(O\([^)]+\))/g)].map((m) => m[1]);

  // Prose fallback — scan sentences containing "time" / "space" for verbal descriptions
  const sentences = text.split(/[.!?]\s+/);
  let timeProse = "";
  let spaceProse = "";
  for (const s of sentences) {
    if (!timeProse  && /\btime\b/i.test(s))  timeProse  = resolveComplexityProse(s);
    if (!spaceProse && /\bspace\b/i.test(s)) spaceProse = resolveComplexityProse(s);
  }

  return {
    time:  timeNotation  || allO[0]  || timeProse  || "",
    space: spaceNotation || allO[1]  || spaceProse || "",
  };
}

// ── Rejected alternatives ─────────────────────────────────────────────────────

function extractRejectedAlternatives(answer: string): string[] {
  const patterns = [
    /instead of ([^,.]+)/gi,
    /rather than ([^,.]+)/gi,
    /avoid(?:ing)? ([^,.]+)/gi,
    /(?:we|I) (?:don't|cannot|can't|won't) use ([^,.]+)/gi,
    /(?:naive|brute.?force|simple) approach[^.]*(?:would be|is) ([^.]+)/gi,
    /(?:a (?:simple|naive|brute.?force) solution)[^.]*(?:would|is|uses?) ([^.]+)/gi,
    /(?:string conversion|extra space|converting to string)[^.]*(?:not allowed|avoided|not used)/gi,
    /(?:this|that) (?:would be|is) (?:too slow|inefficient|suboptimal)[^.]*/gi,
  ];
  const found = new Set<string>();
  for (const re of patterns) {
    for (const m of answer.matchAll(re)) {
      const alt = (m[1] || m[0]).trim().slice(0, 80);
      if (alt.split(/\s+/).length <= 12) found.add(alt);
    }
  }
  return [...found].slice(0, 6);
}

// ── Problem type detection ────────────────────────────────────────────────────
// Ordered: more specific patterns first to avoid "array" swallowing specific types.

const PROBLEM_TYPE_RULES: Array<{ re: RegExp; type: string }> = [
  { re: /palindrome/,                                             type: "palindrome check" },
  { re: /anagram/,                                               type: "anagram detection" },
  { re: /longest.{0,20}(substring|subarray|sequence)|(substring|subarray).{0,20}longest/, type: "longest substring/subarray" },
  { re: /three.?sum/,                                            type: "three sum" },
  { re: /two.?sum|pair.{0,15}target/,                           type: "two sum" },
  { re: /merge.{0,15}intervals?|interval\s+overlap/,             type: "merge intervals" },
  { re: /valid.{0,10}parenthes|matching.{0,10}bracket/,          type: "valid parentheses" },
  { re: /kth.{0,15}(largest|smallest|element)/,                  type: "kth element" },
  { re: /trapping.{0,10}rain|rain.{0,10}trap/,                   type: "trapping rain water" },
  { re: /container.{0,10}water|water.{0,10}container/,           type: "container with most water" },
  { re: /max.{0,15}(subarray|sum)|subarray.{0,15}(max|sum)/,     type: "max subarray sum" },
  { re: /product.{0,15}except.{0,10}self/,                       type: "product except self" },
  { re: /coin.{0,10}change/,                                     type: "coin change" },
  { re: /climb.{0,10}(stair|step)|stair.{0,10}climb/,            type: "climbing stairs" },
  { re: /house.{0,10}rob/,                                       type: "house robber" },
  { re: /word.{0,10}(break|search|ladder)/,                      type: "word problem" },
  { re: /minimum.{0,10}path|path.{0,10}sum/,                     type: "path sum" },
  { re: /reverse.{0,15}(string|array|linked|list)/,              type: "reverse" },
  { re: /move.{0,10}zeroes?/,                                    type: "move zeroes" },
  { re: /fibonacci|\bfib\b/,                                     type: "fibonacci" },
  { re: /linked.?list/,                                          type: "linked list" },
  { re: /binary.?tree|bst|binary search tree/,                   type: "binary tree" },
  { re: /\bgraph\b|bfs|dfs|breadth.first|depth.first/,           type: "graph traversal" },
  { re: /dynamic.?programming|\bdp\b|memoization|tabulation/,    type: "dynamic programming" },
  { re: /sliding.?window/,                                       type: "sliding window" },
  { re: /binary.?search/,                                        type: "binary search" },
  { re: /\btrie\b/,                                              type: "trie" },
  { re: /\bheap\b|priority.?queue/,                              type: "heap/priority queue" },
  { re: /\bbacktrack/,                                           type: "backtracking" },
  { re: /\brecurs/,                                              type: "recursion" },
  { re: /\bsort\b|\bsorting\b/,                                  type: "sorting" },
  { re: /\bstack\b/,                                             type: "stack" },
  { re: /\bqueue\b/,                                             type: "queue" },
  { re: /hash|hashmap|dictionary/,                               type: "hash map" },
  { re: /matrix|grid/,                                           type: "matrix/grid" },
  { re: /string/,                                                type: "string manipulation" },
  { re: /array/,                                                 type: "array" },
];

function extractProblemType(question: string, answer: string): string {
  const text = `${question} ${answer}`.toLowerCase();
  for (const { re, type } of PROBLEM_TYPE_RULES) {
    if (re.test(text)) return type;
  }
  return "";
}

// ── Active approach extraction ────────────────────────────────────────────────
// Captures the strategy sentence even when phrased as "The intuition is", "I'll scan from",
// "We can maintain a window", etc. — not just "use/using" keyword patterns.

function extractActiveApproach(answer: string): string {
  const clean = answer.replace(/```[\s\S]*?```/g, "").replace(/\r\n/g, "\n");
  const sentences = clean.split(/(?:[.!?])\s+/);

  // Strong signals — these almost always describe the approach
  const strongPatterns = [
    /\bthe (?:idea|intuition|key insight|approach|strategy|trick|key observation) (?:is|here is|here)\b/i,
    /\bwe (?:can|will|should|need to|are going to) (?:use|iterate|scan|check|traverse|build|maintain|keep track|apply)\b/i,
    /\bi (?:would|will|can|am going to) (?:use|start|iterate|scan|check|traverse|build|maintain)\b/i,
    /\busing (?:a )?(?:hashmap|two pointer|sliding window|stack|queue|heap|dp|recursion|bfs|dfs|trie|set)\b/i,
    /\bby (?:using|maintaining|keeping|scanning|iterating|traversing|checking|tracking)\b/i,
    /\binstead,? (?:we|i) (?:can|will|should)\b/i,
    /\bthe (?:trick|key) (?:here )?is\b/i,
  ];

  for (const s of sentences) {
    const trimmed = s.trim();
    if (trimmed.length < 15 || trimmed.length > 260) continue;
    for (const re of strongPatterns) {
      if (re.test(trimmed)) {
        return trimmed
          .replace(/^(so|well|basically|essentially|here|okay|right|first|now),?\s*/i, "")
          .trim();
      }
    }
  }

  // Fallback: any sentence with strategy vocabulary
  for (const s of sentences) {
    const trimmed = s.trim();
    if (trimmed.length < 15 || trimmed.length > 260) continue;
    if (/\b(use|using|approach|idea|strategy|technique|method|instead|rather|avoid|check|reverse|split|iterate|traverse|maintain|keep track|scan|pointer|window|expand|shrink|compare)\b/i.test(trimmed)) {
      return trimmed
        .replace(/^(so|well|basically|essentially|here|the idea is|the approach is|the key is|the trick is),?\s*/i, "")
        .trim();
    }
  }
  return "";
}

// ── Constraints extraction ────────────────────────────────────────────────────

function extractConstraints(question: string, answer: string): string[] {
  const text = `${question} ${answer}`;
  const found: string[] = [];
  const patterns = [
    /no extra (?:space|memory)[^.;,]*/gi,
    /in.?place[^.;,]*/gi,
    /O\(1\)\s*space[^.;,]*/gi,
    /constant\s+(?:extra\s+)?(?:space|memory)[^.;,]*/gi,
    /(?:handle|handles?) (?:negative|overflow|empty|null|duplicates?)[^.;,]*/gi,
    /(?:input|number|integer|array|string) (?:can be|is|are|may be) (?:negative|zero|positive|sorted|unsorted|empty)[^.;,]*/gi,
    /(?:single|one) pass[^.;,]*/gi,
    /without (?:extra|additional) (?:space|memory|array|set|map)[^.;,]*/gi,
    /(?:large|huge|massive) (?:input|array|data)[^.;,]*/gi,
    /streaming?\s+input[^.;,]*/gi,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const c = m[0].trim().slice(0, 100);
      if (c.split(/\s+/).length >= 3 && !found.some((f) => f.toLowerCase() === c.toLowerCase())) {
        found.push(c);
      }
    }
  }
  return found.slice(0, 8);
}

// ── Unsolved follow-up extraction ─────────────────────────────────────────────

function extractUnsolvedFollowUps(answer: string): string[] {
  const patterns = [
    /(?:you might also|another follow.?up|one edge case|still need to handle|not covered here|worth noting)[^.]+/gi,
    /(?:this doesn't handle|doesn't account for|doesn't cover|we haven't handled)[^.]+/gi,
    /(?:could also|might also|worth considering|one thing to consider)[^.]+/gi,
    /(?:as a follow.?up|for a follow.?up|next step would be)[^.]+/gi,
    /(?:left as an exercise|you could extend this|could be extended)[^.]+/gi,
  ];
  const found: string[] = [];
  for (const re of patterns) {
    for (const m of answer.matchAll(re)) {
      const s = m[0].trim().slice(0, 120);
      if (s.split(/\s+/).length >= 4 && !found.includes(s)) found.push(s);
    }
  }
  return found.slice(0, 5);
}

// ── Operation detection ───────────────────────────────────────────────────────
// Determines what kind of code state transition this turn represents.

function detectOperation(
  question: string,
  answer: string,
  existing: CodingProblemState | undefined,
): CodeOperation {
  if (!existing) return "initial_solution";

  const q = question.toLowerCase();
  const a = answer.toLowerCase();
  const hasCode = /```/.test(answer);

  // Complexity / explain — text-only answers
  if (!hasCode) {
    if (/(?:time|space)\s*complexity|big.?o|o\(n|analyze|how (?:fast|slow|efficient)/i.test(q + a)) {
      return "complexity_analysis";
    }
    return "explain";
  }

  // Code-producing operations — check question intent
  if (/optim|faster|speed\s+up|more\s+efficient|better\s+time|reduce\s+time|time\s+limit|TLE|can\s+we\s+do\s+better/i.test(q)) return "optimize";
  if (/in.?place|O\(1\)\s*space|no\s+extra\s+(space|memory)|constant\s+space/i.test(q)) return "in_place";
  if (/thread.?safe|concurrent|race\s+condition|synchroni[sz]/i.test(q)) return "thread_safe";
  if (/refactor|clean\s+up|more\s+readable|extract\s+(a\s+)?(function|method)|simplif/i.test(q)) return "refactor";
  if (/(?:unit\s+)?tests?|test\s+cases?|edge\s+cases?|assert/i.test(q)) return "add_tests";
  if (/error\s+handl|null\s+check|handle\s+(null|exception)|try.?catch|guard/i.test(q)) return "add_error_handling";
  if (/what\s+if\s+(input|array|the\s+input|duplicates?|sorted|negative|streamed?|empty|infinite|large)/i.test(q)) return "constraint_change";
  if (/iterative|without\s+recursion|non.?recursive|different\s+approach|stack\s+instead|use\s+(bfs|dfs|dp|heap)/i.test(q)) return "alternative";

  // Language switch: new language appears in code fence that differs from existing
  const newLang = extractLanguageFromAnswer(answer);
  if (newLang && existing.chosenLanguage && newLang !== existing.chosenLanguage) return "language_switch";

  // Default: assume this is building on the prior solution
  return "initial_solution";
}

// ── State update ──────────────────────────────────────────────────────────────

export function updateCodingProblemState(
  meetingId: string,
  question: string,
  answer: string,
): void {
  const s = getOrCreate(meetingId);
  const existing = s.codingProblemState;

  // Require at least a code fence OR an existing state (so text-only follow-ups update too)
  const hasCode = /```/.test(answer);
  if (!hasCode && !existing) return;

  const operation = detectOperation(question, answer, existing);
  const language = extractLanguageFromAnswer(answer) || existing?.chosenLanguage || "";
  const newCode = extractCodeBlock(answer);
  // Preserve previous version before overwriting — enables "why did you change X?" answers
  const previousCode = newCode && existing?.currentCodeVersion && newCode !== existing.currentCodeVersion
    ? existing.currentCodeVersion
    : existing?.previousCodeVersion || "";
  const code = newCode || existing?.currentCodeVersion || "";

  const complexity = extractComplexity(`${question} ${answer}`);
  const rejected = [
    ...(existing?.rejectedAlternatives || []),
    ...extractRejectedAlternatives(answer),
  ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 8);
  const unsolved = extractUnsolvedFollowUps(answer);
  const problemType = extractProblemType(question, answer) || existing?.problemType || "";
  const approach = extractActiveApproach(answer) || existing?.activeApproach || "";
  const constraints = extractConstraints(question, answer);
  if (!constraints.length && existing?.constraints?.length) constraints.push(...existing.constraints);

  // Operation history — keep last 8 turns
  const MAX_OP_HISTORY = 8;
  const prevHistory = existing?.operationHistory || [];
  const operationHistory: Array<{ operation: CodeOperation; ts: number }> = [
    ...prevHistory,
    { operation, ts: Date.now() },
  ].slice(-MAX_OP_HISTORY);

  s.codingProblemState = {
    problemType,
    activeApproach: approach,
    chosenLanguage: language,
    currentComplexity: {
      time:  complexity.time  || existing?.currentComplexity?.time  || "",
      space: complexity.space || existing?.currentComplexity?.space || "",
    },
    constraints,
    currentCodeVersion: code,
    previousCodeVersion: previousCode,
    rejectedAlternatives: rejected,
    unsolvedFollowUps: unsolved,
    lastOperation: operation,
    operationHistory,
    updatedAt: Date.now(),
  };
}

export function getCodingProblemState(meetingId: string): CodingProblemState | null {
  return getOrCreate(meetingId).codingProblemState || null;
}

/**
 * Generates a 3–5 sentence narrative of where the coding session is.
 * Injected into prompts to help the model maintain continuity across turns
 * without re-reading the full structured context block.
 */
export function buildReasoningNarrative(meetingId: string): string {
  const state = getCodingProblemState(meetingId);
  if (!state) return "";

  const parts: string[] = [];

  // Core: problem + approach + language
  const coreParts: string[] = [];
  if (state.problemType)    coreParts.push(`solving ${state.problemType}`);
  if (state.activeApproach) coreParts.push(`using ${state.activeApproach}`);
  if (state.chosenLanguage) coreParts.push(`in ${state.chosenLanguage}`);
  if (coreParts.length) parts.push(`We are ${coreParts.join(", ")}.`);

  // Complexity
  const cx: string[] = [];
  if (state.currentComplexity.time)  cx.push(`Time ${state.currentComplexity.time}`);
  if (state.currentComplexity.space) cx.push(`Space ${state.currentComplexity.space}`);
  if (cx.length) parts.push(`Current complexity: ${cx.join(", ")}.`);

  // Operation trail (only meaningful when >1 turn exists)
  if ((state.operationHistory?.length ?? 0) > 1) {
    const trail = state.operationHistory.map((o) => o.operation).join(" → ");
    parts.push(`Session trail: ${trail}.`);
  }

  // Active constraints
  if (state.constraints.length) {
    parts.push(`Active constraints: ${state.constraints.join("; ")}.`);
  }

  // Open follow-ups the candidate hasn't fully resolved
  if (state.unsolvedFollowUps.length) {
    parts.push(`Open follow-ups: ${state.unsolvedFollowUps.slice(0, 2).join("; ")}.`);
  }

  return parts.join(" ");
}

// includeCode=false suppresses the code body — used for non-code questions to save tokens
export function buildCodingContextBlock(meetingId: string, includeCode = true): string {
  const state = getCodingProblemState(meetingId);
  if (!state) return "";

  const lines: string[] = ["=== CODING PROBLEM CONTEXT ==="];

  // Reasoning narrative — full-sentence session summary for multi-turn continuity
  const narrative = buildReasoningNarrative(meetingId);
  if (narrative) lines.push(narrative);

  if (state.problemType)    lines.push(`Problem type: ${state.problemType}`);
  if (state.chosenLanguage) lines.push(`Language: ${state.chosenLanguage}`);
  if (state.lastOperation)  lines.push(`Last operation: ${state.lastOperation}`);
  if (state.operationHistory?.length) {
    const trail = state.operationHistory.map((o) => o.operation).join(" → ");
    lines.push(`Operation trail: ${trail}`);
  }
  if (state.activeApproach) lines.push(`Active approach: ${state.activeApproach}`);
  if (state.currentComplexity.time || state.currentComplexity.space) {
    const parts: string[] = [];
    if (state.currentComplexity.time)  parts.push(`Time ${state.currentComplexity.time}`);
    if (state.currentComplexity.space) parts.push(`Space ${state.currentComplexity.space}`);
    lines.push(`Current complexity: ${parts.join(", ")}`);
  }
  if (state.constraints.length) lines.push(`Constraints: ${state.constraints.join("; ")}`);
  if (includeCode && state.currentCodeVersion) {
    lines.push(`Current code:\n\`\`\`\n${state.currentCodeVersion.slice(0, 1500)}\n\`\`\``);
    if (state.previousCodeVersion) {
      lines.push(`Previous version:\n\`\`\`\n${state.previousCodeVersion.slice(0, 800)}\n\`\`\``);
    }
  }
  if (state.rejectedAlternatives.length) {
    lines.push(`Rejected alternatives: ${state.rejectedAlternatives.join("; ")}`);
  }
  if (state.unsolvedFollowUps.length) {
    lines.push(`Unsolved follow-up topics: ${state.unsolvedFollowUps.join("; ")}`);
  }
  lines.push("=== END CODING CONTEXT ===");
  return lines.join("\n");
}
