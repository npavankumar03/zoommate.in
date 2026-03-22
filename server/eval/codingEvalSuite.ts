/**
 * AceMate Coding Follow-Up Eval Suite — 20 structured test cases.
 *
 * Each case replays a multi-turn conversation and scores the final response
 * against mechanically checkable criteria (regex + state checks).
 *
 * Category breakdown (matches the scoring bands in the spec):
 *   Cases  1–5:  Basic anchoring           (50 pts)
 *   Cases  6–12: Constraint mutation        (70 pts)
 *   Cases 13–16: Domain-specific routing   (40 pts)
 *   Cases 17–20: Multi-turn continuity      (40 pts)
 *   Total:                                 200 pts
 */

import type { CodingProblemState } from "../assist/sessionState";

// ── Types ─────────────────────────────────────────────────────────────────────

export type EvalCriterion = {
  name: string;
  points: number;
  /** 1-indexed turn number to evaluate on. Defaults to last turn. */
  evalOnTurn?: number;
  /**
   * @param response  The response text for the turn being evaluated.
   * @param all       All turn responses collected so far (0-indexed).
   * @param state     CodingProblemState after the evaluated turn.
   */
  check: (response: string, all: string[], state: CodingProblemState | null) => boolean;
};

export type EvalTurn = { question: string };

export type EvalCase = {
  id: number;
  name: string;
  failureMode: string;
  category: "basic_anchoring" | "constraint_mutation" | "domain_routing" | "multi_turn";
  turns: EvalTurn[];
  criteria: EvalCriterion[];
};

// ── Shared helpers ────────────────────────────────────────────────────────────

const hasCode   = (r: string) => /```/.test(r);
const hasO      = (r: string, expr: string) => new RegExp(`O\\(${expr}\\)`, "i").test(r);
const hasWords  = (r: string, ...words: (string | RegExp)[]) =>
  words.every((w) => (w instanceof RegExp ? w.test(r) : new RegExp(w, "i").test(r)));
const noWords   = (r: string, ...words: (string | RegExp)[]) =>
  words.every((w) => !(w instanceof RegExp ? w.test(r) : new RegExp(w, "i").test(r)));
const hasChangeMarkers = (r: string) => /←\s*(changed|optimized|fixed)/.test(r);
const countMatches = (r: string, patterns: RegExp[]) =>
  patterns.filter((p) => p.test(r)).length;

// ── 20 Test Cases ─────────────────────────────────────────────────────────────

export const EVAL_CASES: EvalCase[] = [

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 1: BASIC ANCHORING (cases 1–5)                          max 50 pts
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 1,
    name: "explanation-after-implementation",
    failureMode: "Generic explanation unrelated to the generated code.",
    category: "basic_anchoring",
    turns: [
      { question: "Write Python code for two sum." },
      { question: "Explain how this works." },
    ],
    criteria: [
      {
        name: "Has code block",
        points: 2,
        check: (r) => hasCode(r),
      },
      {
        name: "Mentions hash map / dict approach",
        points: 3,
        check: (r) => /hash\s*map|hashmap|dict(?:ionary)?|\bmap\b/i.test(r),
      },
      {
        name: "Stays in Python context",
        points: 2,
        check: (r) => /python|def\s+\w+|\.get\(|in\s+seen/i.test(r) || /```py/.test(r),
      },
      {
        name: "References O(n) complexity",
        points: 3,
        check: (r) => hasO(r, "n"),
      },
    ],
  },

  {
    id: 2,
    name: "complexity-follow-up",
    failureMode: "Answers complexity for brute-force O(n²) instead of hashmap O(n) solution.",
    category: "basic_anchoring",
    turns: [
      { question: "Write Python code for two sum." },
      { question: "What is the time and space complexity?" },
    ],
    criteria: [
      {
        name: "States O(n) time",
        points: 4,
        check: (r) => /time.*O\(n\)|O\(n\).*time/i.test(r) || (hasO(r, "n") && /time/i.test(r)),
      },
      {
        name: "States O(n) space",
        points: 3,
        check: (r) => /space.*O\(n\)|O\(n\).*space/i.test(r) || (hasO(r, "n") && /space/i.test(r)),
      },
      {
        name: "No O(n²) confusion (not brute-force complexity)",
        points: 3,
        check: (r) => !/O\(n[²2]\)|O\(n\s*\*\s*n\)/i.test(r),
      },
    ],
  },

  {
    id: 3,
    name: "modify-previous-code",
    failureMode: "Writes a brand new approach without referencing prior state.",
    category: "basic_anchoring",
    turns: [
      { question: "Write Python code for valid parentheses." },
      { question: "Modify it to return the index where validation first fails instead of True/False." },
    ],
    criteria: [
      {
        name: "Has full code block",
        points: 2,
        check: (r) => hasCode(r),
      },
      {
        name: "Has change markers (← changed)",
        points: 3,
        check: (r) => hasChangeMarkers(r),
      },
      {
        name: "Logic uses index / enumerate",
        points: 3,
        check: (r) => /enumerate|return\s+i\b|index/i.test(r),
      },
      {
        name: "Has 'What changed' section",
        points: 2,
        check: (r) => /what changed|changes:|modified:/i.test(r),
      },
    ],
  },

  {
    id: 4,
    name: "optimize-brute-force",
    failureMode: "Vague 'use dynamic programming' with no actual complexity transition.",
    category: "basic_anchoring",
    turns: [
      { question: "Write a brute force solution for maximum subarray." },
      { question: "Optimize it." },
    ],
    criteria: [
      {
        name: "Names Kadane's algorithm",
        points: 4,
        check: (r) => /kadane/i.test(r),
      },
      {
        name: "Has optimized code block",
        points: 2,
        check: (r) => hasCode(r),
      },
      {
        name: "Shows before/after complexity",
        points: 4,
        check: (r) =>
          (/O\(n[²2]\)|O\(n\s*\*\s*n\)/i.test(r) && hasO(r, "n")) ||
          /before[\s\S]{0,40}O\(|after[\s\S]{0,40}O\(|was[\s\S]{0,20}O\(|now[\s\S]{0,20}O\(/i.test(r),
      },
    ],
  },

  {
    id: 5,
    name: "language-translation",
    failureMode: "Changes algorithm while changing language (e.g. iterative → recursive).",
    category: "basic_anchoring",
    turns: [
      { question: "Write Python code for reverse linked list." },
      { question: "Now do the same in Java." },
    ],
    criteria: [
      {
        name: "Has Java code block",
        points: 3,
        check: (r) => /```java/.test(r) || /ListNode|public\s+(ListNode|void)/.test(r),
      },
      {
        name: "Iterative approach preserved (while loop present, no recursion)",
        points: 4,
        check: (r) => {
          const iterative = /while\s*\(|iterative/i.test(r);
          const pureRecursive =
            /\brecursi/i.test(r) && !/avoid.*recurs|not.*recurs|iterative.*instead/i.test(r);
          return iterative && !pureRecursive;
        },
      },
      {
        name: "O(1) space preserved",
        points: 3,
        check: (r) => hasO(r, "1"),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 2: CONSTRAINT MUTATION (cases 6–12)                     max 70 pts
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 6,
    name: "add-edge-case-support",
    failureMode: "Answers generic binary search theory without actually mutating boundary logic.",
    category: "constraint_mutation",
    turns: [
      { question: "Write Python code for binary search." },
      { question: "Handle duplicate values and return the first occurrence." },
    ],
    criteria: [
      {
        name: "Has modified code block",
        points: 3,
        check: (r) => hasCode(r),
      },
      {
        name: "Adjusts right/hi boundary toward mid for first occurrence",
        points: 4,
        check: (r) => /right\s*=\s*mid\b|hi\s*=\s*mid\b|end\s*=\s*mid\b|high\s*=\s*mid\b/i.test(r),
      },
      {
        name: "Explains standard binary search is insufficient",
        points: 3,
        check: (r) => /standard|typical|normal|basic/i.test(r) && /not|won.t|doesn.t|fails/i.test(r),
      },
    ],
  },

  {
    id: 7,
    name: "debugging-follow-up",
    failureMode: "Generic debugging advice not anchored to the pasted code.",
    category: "constraint_mutation",
    turns: [
      {
        question:
          "Here is code for merging two sorted arrays:\n\n" +
          "```python\ndef merge_sorted(a, b):\n    result = []\n    i, j = 0, 0\n" +
          "    while i < len(a) and j < len(b):\n        if a[i] <= b[j]:\n" +
          "            result.append(a[i])\n            i += 1\n        else:\n" +
          "            result.append(b[j])\n            j += 1\n" +
          "    while i < len(a):\n        result.append(a[i + 1])  # possible bug\n" +
          "        i += 1\n    result.extend(b[j:])\n    return result\n```\n\nExplain this code.",
      },
      { question: "Why does this crash on the last element of array a?" },
    ],
    criteria: [
      {
        name: "Identifies off-by-one as root cause",
        points: 4,
        check: (r) =>
          /off.by.one|a\[i\s*\+\s*1\]|i\s*\+\s*1.*should.*i\b|index.*out|out.*index/i.test(r),
      },
      {
        name: "Has fix code block",
        points: 3,
        check: (r) => hasCode(r),
      },
      {
        name: "Has prevention / how to catch it",
        points: 3,
        check: (r) => /prevent|avoid|test|assert|unit.test|edge.case/i.test(r),
      },
    ],
  },

  {
    id: 8,
    name: "explain-specific-line",
    failureMode: "Explains generic cache theory instead of the specific OrderedDict choice.",
    category: "constraint_mutation",
    turns: [
      { question: "Write Python code for LRU cache." },
      { question: "Explain why you used OrderedDict." },
    ],
    criteria: [
      {
        name: "Mentions OrderedDict by name",
        points: 4,
        check: (r) => /OrderedDict|ordered.dict/i.test(r),
      },
      {
        name: "Mentions O(1) for get/put",
        points: 3,
        check: (r) => hasO(r, "1"),
      },
      {
        name: "Explains move-to-end / insertion-order tracking",
        points: 3,
        check: (r) => /move.*end|move.*front|insertion.order|most.recent|reorder|move_to_end/i.test(r),
      },
    ],
  },

  {
    id: 9,
    name: "pronoun-ambiguity-already-optimal",
    failureMode: "Invents fake optimization for an already-optimal sliding-window solution.",
    category: "constraint_mutation",
    turns: [
      { question: "Write Python code for longest substring without repeating characters." },
      { question: "Can we optimize that?" },
    ],
    criteria: [
      {
        name: "Recognizes solution is already optimal",
        points: 4,
        check: (r) =>
          /already optimal|already O\(n\)|can.t (do|improve) better|cannot improve|optimal solution|best.*possible/i.test(r),
      },
      {
        name: "Mentions sliding window",
        points: 3,
        check: (r) => /sliding.window/i.test(r),
      },
      {
        name: "Does NOT claim false O(log n) or O(1) time improvement",
        points: 3,
        check: (r) =>
          !/O\(n\s*log\s*n\)|O\(log\s*n\)\s*time|O\(1\)\s*time/i.test(r),
      },
    ],
  },

  {
    id: 10,
    name: "test-writing-follow-up",
    failureMode: "Restarts algorithm explanation instead of giving testing strategy.",
    category: "constraint_mutation",
    turns: [
      { question: "Write Python code for palindrome check." },
      { question: "How would you test this?" },
    ],
    criteria: [
      {
        name: "Mentions empty string edge case",
        points: 2,
        check: (r) => /empty\s*string|empty\s*input|''|""/i.test(r),
      },
      {
        name: "Mentions single character",
        points: 2,
        check: (r) => /single.char|one.char|length.*1\b|len.*==.*1/i.test(r),
      },
      {
        name: "Mentions case sensitivity",
        points: 3,
        check: (r) => /case.?sensitive|upper|lower|insensitive/i.test(r),
      },
      {
        name: "Has structured test cases or assert statements",
        points: 3,
        check: (r) => hasCode(r) && /assert|test_|==\s*True|==\s*False/i.test(r),
      },
    ],
  },

  {
    id: 11,
    name: "streaming-input-constraint",
    failureMode: "Repeats static-array answer without recognizing the constraint shift.",
    category: "constraint_mutation",
    turns: [
      { question: "Write Python code to find duplicates in an array." },
      {
        question:
          "What if the input is streamed — you can only read each element once and can't store all of it?",
      },
    ],
    criteria: [
      {
        name: "Recognizes the constraint shift (streaming / single-pass / limited memory)",
        points: 3,
        check: (r) => /stream|one.pass|single.pass|online|can.t.re.read|limited.memory/i.test(r),
      },
      {
        name: "Discusses memory / space trade-off or probabilistic approach",
        points: 4,
        check: (r) => /tradeoff|trade.off|memory|bloom.filter|probabilistic|approximate|space/i.test(r),
      },
      {
        name: "Does NOT just repeat static-array sort/set approach unchanged",
        points: 3,
        check: (r) =>
          !/sort.*first.*then|iterate.*array.*again|go through.*array.*again/i.test(r),
      },
    ],
  },

  {
    id: 12,
    name: "space-optimization-is-possible",
    failureMode: "Says impossible when the O(1) space version (prefix/suffix in output array) exists.",
    category: "constraint_mutation",
    turns: [
      { question: "Write Python code for product of array except self." },
      { question: "Can you reduce the extra space to O(1)?" },
    ],
    criteria: [
      {
        name: "Claims it IS possible (does not say impossible)",
        points: 4,
        check: (r) => !/impossible|can.t reduce|cannot reduce|not possible/i.test(r),
      },
      {
        name: "Mentions using output/result array itself as prefix storage",
        points: 3,
        check: (r) => /output.array|result.array|prefix.*suffix.*in.place|in.place/i.test(r),
      },
      {
        name: "Has code block",
        points: 3,
        check: (r) => hasCode(r),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 3: DOMAIN-SPECIFIC ROUTING (cases 13–16)                max 40 pts
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 13,
    name: "async-concurrency-follow-up",
    failureMode: "Keeps sequential await pattern; just wraps it in extra comments.",
    category: "domain_routing",
    turns: [
      { question: "Write Node.js code to fetch data from three APIs sequentially using async/await." },
      { question: "Make it concurrent." },
    ],
    criteria: [
      {
        name: "Uses Promise.all or Promise.allSettled",
        points: 4,
        check: (r) => /Promise\.all(?:Settled)?/i.test(r),
      },
      {
        name: "Has concurrent code block with Promise.all",
        points: 3,
        check: (r) => hasCode(r) && /Promise\.all/i.test(r),
      },
      {
        name: "Mentions error handling for concurrent calls",
        points: 3,
        check: (r) => /try.*catch|allSettled|error|reject|throw/i.test(r),
      },
    ],
  },

  {
    id: 14,
    name: "backend-framework-follow-up",
    failureMode: "Framework drift — drifts to Django/Express instead of staying in FastAPI.",
    category: "domain_routing",
    turns: [
      { question: "How would you implement file upload in FastAPI?" },
      { question: "How would you validate file type and size server-side?" },
    ],
    criteria: [
      {
        name: "Stays in FastAPI (UploadFile / Depends / File)",
        points: 4,
        check: (r) => /fastapi|UploadFile|File\(|Depends/i.test(r),
      },
      {
        name: "Validates content type or MIME type",
        points: 3,
        check: (r) => /content.type|mime|media.type|file.type|content_type/i.test(r),
      },
      {
        name: "Validates file size",
        points: 3,
        check: (r) => /file.size|content.length|max.size|size.limit|\.size/i.test(r),
      },
    ],
  },

  {
    id: 15,
    name: "sql-tie-handling",
    failureMode: "Generic SQL lecture with no updated query that handles ties.",
    category: "domain_routing",
    turns: [
      { question: "Write SQL to get the second highest salary." },
      { question: "What if there are ties — multiple people with the same salary?" },
    ],
    criteria: [
      {
        name: "Has SQL code block",
        points: 3,
        check: (r) => /```sql/.test(r) || /SELECT[\s\S]{0,300}FROM/i.test(r),
      },
      {
        name: "Uses DENSE_RANK or explains tie-handling (DISTINCT / ranking)",
        points: 4,
        check: (r) => /DENSE_RANK|dense_rank|RANK\s*\(\)|rank\s*\(\)|DISTINCT.*ORDER/i.test(r),
      },
      {
        name: "Updated query actually handles ties",
        points: 3,
        check: (r) => hasCode(r) && /DENSE_RANK|dense_rank|DISTINCT/i.test(r),
      },
    ],
  },

  {
    id: 16,
    name: "system-design-bottleneck",
    failureMode: "Generic distributed-systems buzzwords without referencing the proposed design.",
    category: "domain_routing",
    turns: [
      { question: "Design a URL shortener." },
      { question: "What's the bottleneck?" },
    ],
    criteria: [
      {
        name: "Names a real bottleneck (DB, cache, hot-key, ID generation, redirects)",
        points: 4,
        check: (r) =>
          /database|db write|cache miss|hot.key|id.generation|collision|redirect.*scale|read.*heavy/i.test(r),
      },
      {
        name: "References the previously proposed design",
        points: 3,
        check: (r) => /cache|hash|redirect|short.*url|long.*url|key.?value/i.test(r),
      },
      {
        name: "Proposes a concrete solution to the bottleneck",
        points: 3,
        check: (r) => /CDN|cache|shard|partition|read.replica|consistent.hash|pre.generate/i.test(r),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 4: MULTI-TURN CONTINUITY (cases 17–20)                  max 40 pts
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 17,
    name: "explain-then-rewrite",
    failureMode: "Produces different logic; doesn't stay anchored to the pasted code.",
    category: "multi_turn",
    turns: [
      {
        question:
          "Explain this Python code:\n\n" +
          "```python\ndef flatten(lst):\n    result = []\n    stack = [lst]\n" +
          "    while stack:\n        item = stack.pop()\n        if isinstance(item, list):\n" +
          "            stack.extend(item)\n        else:\n            result.append(item)\n" +
          "    result.reverse()\n    return result\n```",
      },
      { question: "Now rewrite it in a cleaner way." },
    ],
    criteria: [
      {
        name: "Preserves flatten behavior (still flattens nested lists)",
        points: 3,
        check: (r) => /flatten|nested|recursive|yield/i.test(r),
      },
      {
        name: "Has code block",
        points: 2,
        check: (r) => hasCode(r),
      },
      {
        name: "Explains what became cleaner",
        points: 3,
        check: (r) => /cleaner|readable|simpler|concise|refactor|elegant/i.test(r),
      },
      {
        name: "Stays in Python",
        points: 2,
        check: (r) => /python|def\s+|isinstance/i.test(r) || /```py/.test(r),
      },
    ],
  },

  {
    id: 18,
    name: "bug-fix-regression-check",
    failureMode: "Forgets the original fix and restarts from scratch.",
    category: "multi_turn",
    turns: [
      {
        question:
          "This function crashes on null input. Fix it:\n\n" +
          "```python\ndef get_first(lst):\n    return lst[0]\n```",
      },
      { question: "What other cases might still fail after your fix?" },
    ],
    criteria: [
      {
        name: "References the null/empty fix from turn 1",
        points: 3,
        check: (r) => /null|None|not.*lst|empty|if.*lst/i.test(r),
      },
      {
        name: "Identifies ≥2 adjacent edge cases",
        points: 4,
        check: (r) =>
          countMatches(r, [
            /empty/i,
            /not.*list|non.list|wrong.type|type.error/i,
            /string.*index|iterate.*string/i,
            /negative.*index/i,
            /very.large|memory/i,
            /index.*error|index.*out/i,
          ]) >= 2,
      },
      {
        name: "Does not restart from scratch (keeps guard logic)",
        points: 3,
        check: (r) => /if.*not|if.*None|if.*empty|guard|check|isinstance/i.test(r),
      },
    ],
  },

  {
    id: 19,
    name: "5-turn-chained-follow-up",
    failureMode: "Loses track of active approach / alternatives by turn 4–5.",
    category: "multi_turn",
    turns: [
      { question: "Write Python code for top K frequent elements." },
      { question: "Explain the heap approach." },
      { question: "Can we do bucket sort instead?" },
      { question: "Which one is better and when?" },
      { question: "Now show the bucket sort code." },
    ],
    criteria: [
      // Evaluated on turn 4 (the "which is better?" response)
      {
        name: "Turn 4: compares both approaches with trade-offs (not one-size-fits-all)",
        points: 3,
        evalOnTurn: 4,
        check: (r) => /heap/i.test(r) && /bucket/i.test(r) && /depend|trade.?off|when|better.*for/i.test(r),
      },
      // Evaluated on turn 5 (the "show bucket sort" response)
      {
        name: "Turn 5: has actual bucket sort code",
        points: 4,
        evalOnTurn: 5,
        check: (r) => hasCode(r) && /bucket/i.test(r),
      },
      {
        name: "Turn 5: mentions O(n) for bucket sort",
        points: 3,
        evalOnTurn: 5,
        check: (r) => hasO(r, "n"),
      },
    ],
  },

  {
    id: 20,
    name: "short-ambiguous-follow-ups",
    failureMode: "Collapses to generic filler because the follow-ups are short.",
    category: "multi_turn",
    turns: [
      { question: "Write a thread-safe singleton in Java." },
      { question: "Why?" },
      { question: "Any downside?" },
      { question: "What's better?" },
    ],
    criteria: [
      // Turn 3: "Any downside?" must reference the design, not be generic
      {
        name: "Turn 3: references actual design choice (double-checked locking / synchronized)",
        points: 3,
        evalOnTurn: 3,
        check: (r) => /double.check|synchronized|volatile|lock|overhead|performance/i.test(r),
      },
      // Turn 4: "What's better?" must give real alternatives
      {
        name: "Turn 4: names a real alternative (enum / Bill Pugh / eager init)",
        points: 4,
        evalOnTurn: 4,
        check: (r) => /enum\s+singleton|Bill\s+Pugh|initialization.on.demand|holder|eager.*init|static.*final.*instance/i.test(r),
      },
      {
        name: "Turn 4: response is substantive (>30 words)",
        points: 3,
        evalOnTurn: 4,
        check: (r) => r.trim().split(/\s+/).length > 30,
      },
    ],
  },
];

// ── Category metadata ─────────────────────────────────────────────────────────

export const CATEGORY_META = {
  basic_anchoring:    { label: "Basic anchoring (1–5)",        caseRange: [1, 5]  },
  constraint_mutation:{ label: "Constraint mutation (6–12)",    caseRange: [6, 12] },
  domain_routing:     { label: "Domain routing (13–16)",        caseRange: [13, 16]},
  multi_turn:         { label: "Multi-turn continuity (17–20)", caseRange: [17, 20]},
} as const;

export const TOTAL_MAX_SCORE = EVAL_CASES.reduce(
  (sum, c) => sum + c.criteria.reduce((s, cr) => s + cr.points, 0),
  0,
);
