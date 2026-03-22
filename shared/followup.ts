export type FollowUpResult = {
  isFollowUp: boolean;
  confidence: number;
  reason: string;
  codeTransition?: CodeTransitionType;
};

// Each type represents a distinct code-state transition the interviewer is requesting.
// The type is used downstream to generate specific AI instructions per transition.
export type CodeTransitionType =
  | "optimize"          // "optimize that", "can we do better", "reduce time complexity"
  | "space"             // "do it in-place", "O(1) space", "no extra memory"
  | "language_switch"   // "do this in Python", "convert to Java", "what changes for FastAPI"
  | "constraint_change" // "what if input is sorted/streamed/negative", "handle duplicates"
  | "thread_safety"     // "make it thread-safe", "handle concurrent requests"
  | "testing"           // "how would you test this", "write unit tests", "edge cases"
  | "error_handling"    // "add error handling", "what if null", "handle exceptions"
  | "scale"             // "scale this to 10M", "production-ready version"
  | "explain_part"      // "explain line 5", "walk me through the loop"
  | "refactor"          // "clean this up", "make it more readable", "extract a function"
  | "complexity"        // "what's the time complexity", "big O", "can we go from O(n²)"
  | "alternative";      // "use a stack instead", "iterative version", "without recursion"

type FollowUpOptions = {
  lastAssistantAt?: number;
  now?: number;
  hasCodingContext?: boolean; // true when CodingProblemState exists for this session
};

type CodeTransitionRule = {
  type: CodeTransitionType;
  re: RegExp;
  confidence: number;
  // When true, rule only fires if hasCodingContext is set — avoids false positives in behavioral sessions
  requiresCodingContext?: boolean;
};

// Rules are ordered: first match wins for type, but all are evaluated for best confidence.
const CODE_TRANSITION_RULES: CodeTransitionRule[] = [
  // ── Space constraint (highest priority — very unambiguous) ─────────────────
  {
    type: "space",
    re: /\bin.?place\b|O\(1\)\s*space|constant\s+space|\bno\s+extra\s+(?:space|memory)\b|without\s+(?:extra|additional)\s+(?:space|memory|array|set|map)\b|reduce\s+(?:the\s+)?(?:space|memory)\b|space[\s-]efficient/i,
    confidence: 0.96,
  },

  // ── Language switch ────────────────────────────────────────────────────────
  {
    type: "language_switch",
    re: /\b(?:in|using)\s+(?:python|java(?!script)|golang?|typescript|javascript|c\+\+|c#|csharp|rust|kotlin|swift|ruby|scala)\b|convert\s+(?:this\s+)?to\s+(?:python|java|go|typescript|javascript|c\+\+|c#|rust|kotlin|swift)\b|rewrite\s+(?:this\s+)?in\s+\w+\b|do\s+(?:this|the\s+same)\s+in\s+\w+\b|same\s+(?:thing\s+)?in\s+\w+\b|what\s+changes?\s+for\s+(?:fastapi|django|flask|spring|express|rails|laravel|nextjs|nestjs)\b/i,
    confidence: 0.96,
  },

  // ── Thread safety / concurrency ────────────────────────────────────────────
  {
    type: "thread_safety",
    re: /\bthread.?safe\b|thread\s+safe\b|concurrent(?:ly)?\b|race\s+condition\b|synchroni[sz]e?\b|lock.?free\b|\bmutex\b|\batomic\b|parallel\s+(?:version|access|execution)/i,
    confidence: 0.94,
  },

  // ── Complexity analysis ────────────────────────────────────────────────────
  {
    type: "complexity",
    re: /what(?:'s|\s+is)\s+(?:the\s+)?(?:time|space)\s+complexity\b|big.?o\b|O\(n[²2]\)|O\(n\^2\)|O\(2\^n\)|analyze\s+(?:the\s+)?complexity\b|time\s+and\s+space\b|complexity\s+analysis\b|can\s+we\s+(?:do|go)\s+from\s+O\(|improve\s+(?:from|the)\s+O\(/i,
    confidence: 0.93,
  },

  // ── Optimize ───────────────────────────────────────────────────────────────
  {
    type: "optimize",
    re: /\boptimi[sz]e?\b|\boptimization\b|\bfaster\b|\bspeed\s+(?:it\s+)?up\b|\bmore\s+efficient\b|\bbetter\s+time\b|\breduce\s+time\b|\bimprove\s+(?:the\s+)?(?:time|performance|speed)\b|\btime\s+limit\b|\bTLE\b|\bcan\s+we\s+do\s+better\b|\bmore\s+performant\b|\bfaster\s+(?:way|approach|solution)\b/i,
    confidence: 0.91,
  },

  // ── Testing ────────────────────────────────────────────────────────────────
  {
    type: "testing",
    re: /\bhow\s+(?:would|do|should)\s+(?:you|we|i)\s+test\b|\bwrite\s+(?:a\s+)?(?:unit\s+)?tests?\b|\btest\s+cases?\s+(?:for|this|that)\b|\bwhat\s+(?:would\s+you\s+test|edge\s+cases|test\s+cases)\b|\bunit\s+tests?\b|\bintegration\s+test\b|\btest\s+(?:this|it|the\s+code)\b|\bassert(?:ions?)?\b|\btest\s+coverage\b/i,
    confidence: 0.91,
  },

  // ── Scale / production ─────────────────────────────────────────────────────
  {
    type: "scale",
    re: /\bscale\s+(?:this|it|the\s+solution)\b|\bat\s+(?:10|100|1)[mbk]\b|millions?\s+of\s+(?:records?|items?|users?|requests?)\b|\blarge\s+scale\b|\bproduction.?ready\b|\bproduction\s+version\b|\bdistributed\s+(?:version|system)\b|\bhigh\s+(?:volume|traffic|load)\b|\bscalable\b|\bwhat\s+happens?\s+(?:at|with)\s+(?:scale|large\s+input)/i,
    confidence: 0.89,
  },

  // ── Alternative approach ───────────────────────────────────────────────────
  {
    type: "alternative",
    re: /\b(?:use|using)\s+(?:a\s+)?(?:stack|queue|heap|trie|hashmap|hash\s+map|two\s+pointer|sliding\s+window|bfs|dfs|dp|dynamic\s+programming)\s*(?:instead|approach)?\b|\biterative\s+(?:version|approach|solution)\b|\bwithout\s+recursion\b|\bnon.?recursive\b|\bdifferent\s+(?:approach|way|method|solution)\b|\banother\s+(?:approach|way|solution)\b|\balternative\s+(?:approach|solution|method)\b|\binstead\s+of\s+(?:recursion|using|a\s+loop)\b|\bcan\s+we\s+(?:use|do)\s+(?:a\s+)?\w+\s+instead\b/i,
    confidence: 0.89,
  },

  // ── Explain specific part (requires coding context to avoid "explain that" in behavioral) ──
  {
    type: "explain_part",
    re: /\bexplain\s+(?:line\s+\d+|this\s+line|that\s+line|the\s+loop|the\s+block|this\s+block|the\s+function|the\s+method|the\s+condition)\b|\bwalk\s+me\s+through\s+(?:the\s+loop|this\s+block|that\s+function|the\s+code|each\s+line)\b|\bwhat\s+does\s+(?:this|that|line\s+\d+|the\s+loop|the\s+block)\s+do\b|\bline\s+by\s+line\b|\bbreak\s+(?:it|this|that|the\s+code)\s+down\s+line\b/i,
    confidence: 0.88,
    requiresCodingContext: true,
  },

  // ── Refactor ───────────────────────────────────────────────────────────────
  {
    type: "refactor",
    re: /\brefactor\s+(?:this|that|it|the\s+code)\b|\bclean\s+(?:this|that|it|the\s+code)\s+up\b|\bmake\s+(?:it|this|the\s+code)\s+(?:more\s+)?(?:readable|clean|cleaner|maintainable|idiomatic)\b|\bextract\s+(?:a\s+)?(?:function|method|helper|class)\b|\bsimplif(?:y|ied)\s+(?:this|that|it|the\s+code)\b|\bshorter\s+(?:version|code|way)\b|\bmore\s+pythonic\b|\bmore\s+idiomatic\b/i,
    confidence: 0.88,
    requiresCodingContext: true,
  },

  // ── Error handling ─────────────────────────────────────────────────────────
  {
    type: "error_handling",
    re: /\badd\s+error\s+handl|\bhandle\s+(?:null|exception|error|overflow|underflow)\b|\bnull\s+check\b|\bwhat\s+if\s+(?:null|it.s\s+null|empty|negative\s+input)\b|\btry.?catch\b|\bthrow\s+exception\b|\bguard\s+clause\b|\binput\s+validat/i,
    confidence: 0.87,
    requiresCodingContext: true,
  },

  // ── Constraint change ──────────────────────────────────────────────────────
  {
    type: "constraint_change",
    re: /\bwhat\s+if\s+(?:the\s+)?(?:input|array|list|string)\s+(?:is|are|has|have|contains?)\b|\bwhat\s+if\s+(?:duplicates?|negatives?|sorted|reversed|empty|null|infinite)\b|\bhandle\s+(?:duplicates?|negatives?|sorted\s+input|empty\s+input|null\s+input)\b|\bwhat\s+about\s+(?:duplicates?|sorted\s+input|empty|negatives?|overfl)\b|\bwhat\s+if\s+n\s+is\b|\binput\s+is\s+streamed?\b|\bstreaming\s+input\b|\bunsorted\s+input\b|\bwhat\s+if\s+(?:the\s+)?(?:array|list|string)\s+is\b/i,
    confidence: 0.85,
    requiresCodingContext: true,
  },
];

const STRONG_FOLLOWUPS = new Set([
  "why",
  "how",
  "how so",
  "what about that",
  "can you expand",
  "tell me more",
  "go deeper",
  "elaborate",
  "explain that",
  "explain more",
  "what do you mean",
  "and then",
  "what next",
]);

const FOLLOWUP_CUE_RE = /\b(explain|explain more|tell me more|go deeper|elaborate|expand|dig deeper|what do you mean|what about that|about that|about it|how so|why|and then|what next|you said|you mentioned|you told|you just said|you just mentioned|as you said|earlier you|percentage you|number you|metric you|figure you|how much you|what number|what percentage|what was that|what did you mean|what did you say)\b/i;

const COREF_TERMS = new Set([
  "that",
  "this",
  "it",
  "those",
  "they",
  "he",
  "she",
  "there",
  "then",
  "same",
  "said",      // "how much you said", "what you said"
  "mentioned", // "you mentioned earlier"
  "earlier",   // "earlier you said"
]);

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "if",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "about",
  "that",
  "this",
  "it",
  "those",
  "they",
  "he",
  "she",
  "there",
  "then",
  "same",
  "why",
  "how",
  "what",
  "when",
  "where",
  "who",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function hasConcreteNounPhrase(tokens: string[]): boolean {
  const nonStop = tokens.filter((t) => t.length >= 4 && !STOPWORDS.has(t));
  return nonStop.length >= 2;
}

/**
 * Detects whether a question is a code-state transition — an instruction
 * to transform or analyze an existing code solution in a specific way.
 *
 * Returns the best-matching transition type and its confidence, or null if none match.
 * Pass hasCodingContext=true when there is an active CodingProblemState for the session;
 * this unlocks rules that need context to avoid false positives and boosts all confidences.
 */
export function detectCodeTransition(
  q: string,
  hasCodingContext = false,
): { type: CodeTransitionType; confidence: number } | null {
  const text = String(q || "").trim();
  if (!text) return null;

  let best: { type: CodeTransitionType; confidence: number } | null = null;

  for (const rule of CODE_TRANSITION_RULES) {
    if (rule.requiresCodingContext && !hasCodingContext) continue;
    if (!rule.re.test(text)) continue;
    // Coding context boosts confidence — AI has the full code to work with
    const score = hasCodingContext ? Math.min(0.99, rule.confidence + 0.04) : rule.confidence;
    if (!best || score > best.confidence) {
      best = { type: rule.type, confidence: score };
    }
  }

  return best;
}

export function isFollowUp(q: string, opts: FollowUpOptions = {}): FollowUpResult {
  const raw = String(q || "").trim();
  if (!raw) return { isFollowUp: false, confidence: 0, reason: "empty" };

  const normalized = raw.toLowerCase().replace(/\s+/g, " ").trim();
  const tokens = tokenize(raw);
  const tokenCount = tokens.length;
  let confidence = 0;
  let reason = "";

  if (STRONG_FOLLOWUPS.has(normalized) || FOLLOWUP_CUE_RE.test(normalized)) {
    confidence = 0.9;
    reason = "strong_phrase";
  }

  const hasCoref = tokens.some((t) => COREF_TERMS.has(t));
  // "short_ambiguous" fires for short fragments that lack a concrete topic of their own.
  // BUT exclude first-person statements ("I need 40", "I want Python") — those are instructions,
  // not references to a previous answer. Require coreference or a continuation opener instead.
  const startsFirstPerson = /^i\b/i.test(normalized);
  const startsWithContinuation = /^(and\b|also\b|but\b|what about\b|how about\b|or\b|plus\b)/i.test(normalized);
  if (!confidence && tokenCount <= 8 && !hasConcreteNounPhrase(tokens) && !startsFirstPerson) {
    if (hasCoref || startsWithContinuation) {
      confidence = 0.72;
      reason = "short_ambiguous";
    }
  }
  if (hasCoref) {
    confidence = Math.max(confidence, 0.68);
    reason = reason ? `${reason}+coref` : "coref";
  }

  // Code-state transition detection — these are follow-ups by definition because
  // they reference an existing solution and request a specific transformation.
  const codeTransition = detectCodeTransition(raw, opts.hasCodingContext);
  if (codeTransition && codeTransition.confidence >= 0.82) {
    confidence = Math.max(confidence, codeTransition.confidence);
    reason = reason
      ? `${reason}+code_transition:${codeTransition.type}`
      : `code_transition:${codeTransition.type}`;
  }

  // Follow-up detection should be content-based, not time-based.

  return {
    isFollowUp: confidence >= 0.65,
    confidence,
    reason: reason || "none",
    codeTransition: codeTransition?.type,
  };
}

export type FollowUpSessionState = {
  lastUserQuestion?: string;
  lastAssistantAnswer?: string;
};

export function resolveAnchorTurn(state: FollowUpSessionState | null | undefined): {
  lastUserQuestion?: string;
  lastAssistantAnswer?: string;
} {
  if (!state) return {};
  return {
    lastUserQuestion: state.lastUserQuestion,
    lastAssistantAnswer: state.lastAssistantAnswer,
  };
}
