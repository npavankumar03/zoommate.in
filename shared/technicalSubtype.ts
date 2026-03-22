/**
 * Technical question subtype detection.
 *
 * Each subtype maps to a different answer shape — the order questions are answered,
 * what sections are required, and what the AI should never skip.
 *
 * Rules are ordered: more specific patterns first.
 * requiresCodingContext restricts rules that need an active coding session to avoid
 * false positives in general interview questions.
 */

export type TechnicalSubtype =
  | "dsa"               // algorithm / data structure — implement BFS, two sum, sliding window
  | "system_design"     // design Twitter, URL shortener, distributed cache
  | "backend"           // REST API, auth, middleware, message queues, caching
  | "frontend"          // React, hooks, virtual DOM, CSS, SSR, state management
  | "sql"               // queries, joins, indexes, transactions, schema design
  | "debugging"         // why is this failing, fix this bug, root cause
  | "code_modification" // modify/refactor/extend existing code
  | "code_explanation"  // what does this do, explain line X, walk me through
  | "optimization";     // reduce complexity, faster approach, improve performance

export type SubtypeResult = {
  subtype: TechnicalSubtype;
  confidence: number;
};

type SubtypeRule = {
  type: TechnicalSubtype;
  re: RegExp;
  confidence: number;
  requiresCodingContext?: boolean;
};

// Ordered: most specific / unambiguous first.
const SUBTYPE_RULES: SubtypeRule[] = [
  // ── System design ──────────────────────────────────────────────────────────
  // Must come before backend — they share keywords like "api", "cache", "service"
  {
    type: "system_design",
    re: /\bhow\s+(?:would\s+you\s+|would\s+you\s+)?design\b|\bsystem\s+design\b|\bdesign\s+(?:a\s+)?(?:system|twitter|uber|instagram|facebook|netflix|youtube|whatsapp|slack|discord|airbnb|spotify|tiktok|url\s+shortener|chat(?:\s+app)?|notification\s+service|rate\s+limiter|distributed\s+cache|cdn|news\s+feed|search\s+engine|payment\s+system|booking\s+system|ride.?sharing|file\s+storage|event\s+streaming)\b|\barchitect\s+(?:a|the|this)\b|\bscalable\s+(?:system|architecture|solution)\b|\bdistributed\s+(?:system|design|architecture|database)\b|\bhigh\s+availability\b|\bfault\s+toleran|\bload\s+balanc|\bmicroservices?\s+architecture\b|\bservice\s+mesh\b|\bconsistency\s+(?:model|guarantee)\b|\bCAP\s+theorem\b|\beventual\s+consistency\b/i,
    confidence: 0.95,
  },

  // ── Debugging ──────────────────────────────────────────────────────────────
  // Before code_modification — "fix this bug" is debugging, not modification
  {
    type: "debugging",
    re: /\bwhy\s+(?:is|does|do|am|are|isn'?t|doesn'?t|don'?t|won'?t)\s+(?:this|it|my\s+code|the\s+code)\b|\bwhat'?s\s+wrong\s+with\b|\bfix\s+(?:the\s+)?(?:bug|error|issue|problem)\b|\bdebug\s+this\b|\bwhy\s+(?:is\s+it\s+failing|doesn'?t\s+it\s+work|isn'?t\s+it\s+working|is\s+this\s+breaking|am\s+i\s+getting)\b|\broot\s+cause\b|\berror\s+message\b|\bexception\s+(?:is\s+)?(?:being\s+)?thrown\b|\bnull(?:\s+pointer)?\s+(?:exception|error|dereference)\b|\bstack\s+overflow\b|\bundefined\s+is\s+not\s+a\s+function\b|\btypeerror\b|\bsyntaxerror\b|\bsegfault\b|\bthis\s+(?:code|function)\s+(?:isn'?t|doesn'?t)\s+work\b/i,
    confidence: 0.93,
  },

  // ── Code explanation ────────────────────────────────────────────────────────
  // "what does this function do" — needs coding context to avoid false positives
  {
    type: "code_explanation",
    re: /\bwhat\s+does\s+(?:this|that|the)\s+(?:code|function|method|line|block|class|snippet|loop|condition|statement)\s+do\b|\bexplain\s+(?:this|that|the)\s+(?:code|function|method|line|block|class|snippet|loop)\b|\bwalk\s+me\s+through\s+(?:this|that|the)\s+(?:code|function|solution|algorithm|implementation)\b|\bline\s+by\s+line\b|\bbreak\s+(?:this|that|it|the\s+code)\s+down\b|\bwhat\s+is\s+(?:this|that)\s+(?:function|method|class|variable|line)\s+doing\b|\bhow\s+does\s+(?:this|that|the)\s+(?:code|function|algorithm|loop|approach)\s+work\b/i,
    confidence: 0.91,
    requiresCodingContext: true,
  },

  // ── Optimization follow-up ──────────────────────────────────────────────────
  {
    type: "optimization",
    re: /\bcan\s+(?:we|you|i)\s+(?:do|make\s+it)\s+(?:better|faster|more\s+efficient)\b|\boptimi[sz]e?\s+(?:this|that|it|the\s+(?:code|solution|approach))\b|\breduce\s+(?:the\s+)?(?:time|space)\s+complexity\b|\bbetter\s+(?:time|space)\s+complexity\b|\bmore\s+efficient\s+(?:way|approach|solution)\b|\bfaster\s+(?:approach|solution|algorithm|way)\b|\bimprove\s+(?:the\s+)?(?:performance|complexity|time|space)\b|\bO\(n[²2^]\)\s*(?:to|→|->|instead)\b|\bcan\s+we\s+do\s+better\b|\btime\s+limit\b|\bTLE\b|\bbeat\s+the\s+time\s+limit\b/i,
    confidence: 0.91,
  },

  // ── Code modification ────────────────────────────────────────────────────────
  {
    type: "code_modification",
    re: /\b(?:modify|refactor|update|change|extend|convert|rewrite|restructure|clean\s+up)\s+(?:this|that|the|my)\s+(?:code|function|method|class|solution|approach)\b|\bconvert\s+(?:this\s+)?to\s+(?:async|promises?|callbacks?|iterative)\b|\badd\s+(?:error\s+handling|logging|caching|pagination|validation|authentication|authorization)\s+(?:to|for)\b|\bmake\s+(?:this|it)\s+(?:thread.safe|concurrent|async|non.blocking|more\s+readable)\b|\bextract\s+(?:a\s+)?(?:function|method|class|module|helper)\b|\brefactor\s+(?:this|that|it)\b/i,
    confidence: 0.90,
    requiresCodingContext: true,
  },

  // ── SQL ──────────────────────────────────────────────────────────────────────
  {
    type: "sql",
    re: /\b(?:write|create|build|show\s+me|give\s+me)\s+(?:a\s+)?(?:sql|query|select\s+statement|insert|update|delete)\b|\bsql\s+query\b|\b(?:mysql|postgresql|postgres|sqlite|oracle|sql\s+server|mariadb)\b|\b(?:inner|outer|left|right|cross|full)\s+join\b|\bwhere\s+clause\b|\bgroup\s+by\b|\bhaving\s+clause\b|\bwindow\s+function\b|\bpartition\s+by\b|\bindex(?:es|ing)?\s+(?:on|for|in)\b|\bforeign\s+key\b|\bnormali[sz]ation\b|\bdenormali[sz]ation\b|\bacid\b|\bdatabase\s+(?:design|schema|transaction)\b|\bstored\s+procedure\b|\bview\s+(?:in|for)\s+(?:sql|a\s+database)\b|\bcte\b|\bcommon\s+table\s+expression\b/i,
    confidence: 0.94,
  },

  // ── Frontend ─────────────────────────────────────────────────────────────────
  {
    type: "frontend",
    re: /\breact\b|\bhooks?\b(?:\s+in\s+react)|\busestate\b|\buseeffect\b|\buseref\b|\busememo\b|\busecallback\b|\buse(?:context|reducer|layout|effect|imperative)\b|\breact\s+(?:reconciliation|fiber|virtual\s+dom|context|component\s+lifecycle|suspense|concurrent\s+mode|server\s+components?)\b|\bvirtual\s+dom\b|\bcss\s+(?:grid|flexbox|specificity|cascade|selectors?|variables?|modules?)\b|\bdom\s+(?:manipulation|event|api)\b|\bevent\s+(?:bubbling|delegation|propagation|capturing)\b|\bwebpack\b|\bvite\b|\bnext\.?js\b|\bvue\.?js\b|\bangular\b|\bsvelte\b|\bsolid\.?js\b|\bclient[\s-]side\s+rendering\b|\bserver[\s-]side\s+rendering\b|\bhydration\b|\bstate\s+management\b|\bredux\b|\bzustand\b|\bjotai\b|\brecoil\b|\bweb\s+components?\b|\bshadow\s+dom\b|\bcors\s+from\s+(?:a\s+)?(?:browser|client)\b/i,
    confidence: 0.93,
  },

  // ── Backend / API ────────────────────────────────────────────────────────────
  {
    type: "backend",
    re: /\brest(?:ful)?\s+api\b|\bhttp\s+(?:method|verb|status\s+code|header)\b|\b(?:post|put|patch|delete)\s+(?:request|endpoint|route|method)\b|\bjwt\b|\boauth(?:\s*2(?:\.0)?)?\b|\bauthentication\b|\bauthorization\b|\bmiddleware\b|\bwebsockets?\b|\bgrpc\b|\bgraphql\b|\bmessage\s+queue\b|\bevent[\s-]driven\b|\bkafka\b|\brabbitmq\b|\bredis\b|\bcaching\s+(?:strategy|layer|mechanism)\b|\brate\s+limiting\b|\bapi\s+(?:gateway|design|versioning|key)\b|\bexpress(?:\.?js)?\b|\bfastapi\b|\bdjango\b|\bspring\s+boot\b|\bnode\.?js\s+(?:server|api|backend)\b|\bmicroservices?\b|\bserverless\b|\bcontainer(?:ization)?\b|\bdocker\b|\bkubernetes\b|\bci[\s/]?cd\b|\bdeployment\b|\bscaling\s+(?:a\s+)?(?:server|service|api)\b/i,
    confidence: 0.91,
  },

  // ── DSA ──────────────────────────────────────────────────────────────────────
  // Broad catch-all for algorithm/data structure questions — comes last
  {
    type: "dsa",
    re: /\b(?:implement|write|code|solve|find|return|design)\s+(?:a\s+)?(?:function|algorithm|solution|method|program)\b|\b(?:linked\s+list|binary\s+(?:tree|search\s+tree)|bst|avl\s+tree|red.?black\s+tree|graph|heap|trie|hash\s+(?:map|table|set)|priority\s+queue|monotonic\s+stack)\b|\b(?:bfs|dfs|dijkstra|bellman.ford|kruskal|prim|topological\s+sort|dynamic\s+programming|dp\b|memoization|tabulation|backtracking|two\s+pointers?|sliding\s+window|divide\s+and\s+conquer|greedy\s+algorithm|bit\s+manipulation)\b|\btime\s+complexity\b|\bspace\s+complexity\b|\bbig[\s-]?o\b|\bleetcode\b|\bhackerrank\b|\bcoding\s+(?:problem|challenge|interview|question)\b|\bin.?place\b|\brecursive\s+(?:approach|solution|function)\b|\biterative\s+(?:approach|solution|version)\b/i,
    confidence: 0.89,
  },
];

/**
 * Detect the technical subtype of a question.
 * Returns null for non-technical or ambiguous questions.
 */
export function detectTechnicalSubtype(
  question: string,
  hasCodingContext = false,
): SubtypeResult | null {
  const text = String(question || "").trim();
  if (!text) return null;

  let best: SubtypeResult | null = null;

  for (const rule of SUBTYPE_RULES) {
    if (rule.requiresCodingContext && !hasCodingContext) continue;
    if (!rule.re.test(text)) continue;
    const score = hasCodingContext ? Math.min(0.99, rule.confidence + 0.03) : rule.confidence;
    if (!best || score > best.confidence) {
      best = { subtype: rule.type, confidence: score };
    }
  }

  return best;
}
