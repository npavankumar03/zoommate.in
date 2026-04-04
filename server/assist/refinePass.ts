/**
 * Typed technical refinement engine.
 *
 * The fast pass gives an immediate first answer (260 tokens, temperature 0.2).
 * The refinement pass is a full-context second stream that checks the fast answer
 * against a subtype-specific rubric and produces the complete final answer.
 *
 * Each subtype has:
 *   - A rubric: the exact quality criteria that interviewers evaluate on
 *   - A token budget: sized to fit the required sections without padding
 *   - A temperature: lower for code/SQL (deterministic), moderate for design
 */

import { detectTechnicalSubtype, type TechnicalSubtype } from "@shared/technicalSubtype";
import { getCodingProblemState, extractSpaceUsingStructures } from "./sessionState";

export type RefineConfig = {
  subtype: TechnicalSubtype;
  maxTokens: number;
  temperature: number;
};

// ── Subtype config ────────────────────────────────────────────────────────────

const REFINE_CONFIGS: Record<TechnicalSubtype, { maxTokens: number; temperature: number }> = {
  system_design:    { maxTokens: 1200, temperature: 0.35 }, // 6 sections need room
  dsa:              { maxTokens: 1200, temperature: 0.20 }, // approach + full code + 2 complexities + edge cases
  optimization:     { maxTokens: 1200, temperature: 0.20 }, // full rewritten code + before/after comparison
  code_modification:{ maxTokens: 1200, temperature: 0.20 }, // full mutated code, no shortcuts
  backend:          { maxTokens:  900, temperature: 0.30 }, // concept + flow + code + gotchas
  frontend:         { maxTokens:  900, temperature: 0.30 }, // mental model + mechanism + code + mistakes
  debugging:        { maxTokens:  900, temperature: 0.20 }, // root cause first, fix code, prevention
  sql:              { maxTokens:  700, temperature: 0.15 }, // deterministic query + breakdown
  code_explanation: { maxTokens:  600, temperature: 0.30 }, // quote + walkthrough + rationale
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the refinement config if this question warrants a typed refinement pass,
 * or null if the question is not technical / doesn't need refinement.
 */
export function getRefineConfig(question: string, hasCodingContext: boolean): RefineConfig | null {
  const result = detectTechnicalSubtype(question, hasCodingContext);
  if (!result) return null;
  const cfg = REFINE_CONFIGS[result.subtype];
  return { subtype: result.subtype, ...cfg };
}

/**
 * Builds the refinement context block that gets appended to the tier-0 system prompt
 * during the second pass. It includes:
 *   - The fast answer (so the model knows what was already said)
 *   - The subtype rubric (what MUST be present in the final answer)
 *   - Clear instruction not to mention it's a refinement
 */
export function buildRefineContext(
  subtype: TechnicalSubtype,
  fastAnswer: string,
  meetingId: string,
): string {
  const rubric = buildRubric(subtype, meetingId);
  const fastAnswerBlock = fastAnswer.trim()
    ? `Previous fast answer (improve on this — do not just repeat it):\n${fastAnswer.trim().slice(0, 1800)}`
    : "";

  return [
    "=== REFINEMENT PASS ===",
    "A fast initial answer was streamed to the user. You are now producing the COMPLETE, FINAL answer.",
    "RULES: Do NOT mention this is a refinement. Do NOT say 'as I mentioned'. Just give the complete answer.",
    fastAnswerBlock,
    rubric,
    "=== END REFINEMENT ===",
  ].filter(Boolean).join("\n\n");
}

// ── Per-subtype rubrics ───────────────────────────────────────────────────────
// Each rubric is a checklist of what MUST be present. The model is told to add
// anything missing from the fast answer without touching what is already correct.

function buildRubric(subtype: TechnicalSubtype, meetingId: string): string {
  switch (subtype) {

    case "dsa":
      return [
        "DSA QUALITY RUBRIC — every item below MUST appear in your answer:",
        "1. Algorithm named + core insight (1-2 sentences): what data structure/technique and why it fits",
        "2. Complete working code in a fenced block (```python / ```java / etc.) — actual runnable code, not pseudocode",
        "3. Time complexity as O(...) with a one-line justification (e.g. 'O(n) — single pass through the array')",
        "4. Space complexity as O(...) with a one-line justification",
        "5. Edge cases — explicitly name at least 2 from: empty input, single element, all duplicates,",
        "   negative numbers, integer overflow, no valid answer exists, very large input",
        "If the fast answer already covers an item correctly, keep it. Add what is missing.",
      ].join("\n");

    case "debugging":
      return [
        "DEBUGGING QUALITY RUBRIC — every item below MUST appear in your answer:",
        "1. Root cause FIRST — state it in the opening sentence. Never bury it.",
        "2. Mechanism — explain WHY this fails at the language/runtime level (not just 'it's wrong')",
        "3. Fixed code in a fenced block — every corrected line ends with `// ← fixed` (JS/TS/Java/Go/Rust)",
        "   or `# ← fixed` (Python/Ruby/Shell) or `-- ← fixed` (SQL)",
        "4. Prevention — one sentence: the class of bug and how to catch it early",
        "CRITICAL: If the fast answer buries the root cause or skips the explanation, reorder and fix it.",
      ].join("\n");

    case "system_design": {
      return [
        "SYSTEM DESIGN QUALITY RUBRIC — all 6 sections MUST be present:",
        "1. Scale assumptions — explicit numbers before designing (e.g. '10k req/sec, 1TB data, 100M users')",
        "2. Core components — named list: each component + its single-sentence role",
        "3. Request flow — one concrete path: client → component A → component B → storage → response",
        "4. Data model — key entities named, storage choice (SQL vs NoSQL) with the reason",
        "5. Trade-offs — at least ONE named trade-off with both sides",
        "   (e.g. 'strong consistency vs availability: we chose eventual consistency to reduce latency')",
        "6. Bottleneck — the single hardest scaling challenge and how to address it",
        "Each section: 2-4 sentences max. If any section is missing, add it concisely.",
      ].join("\n");
    }

    case "code_modification": {
      const state = getCodingProblemState(meetingId);
      const priorCode = state?.currentCodeVersion
        ? `Prior code version (this MUST be mutated, not replaced):\n\`\`\`\n${state.currentCodeVersion.slice(0, 900)}\n\`\`\``
        : "";

      // Gap 2: Language translation — enforce algorithm and complexity preservation
      const isLanguageSwitch = state?.lastOperation === "language_switch";
      const algorithmPreservation = isLanguageSwitch && state
        ? [
            "LANGUAGE TRANSLATION PRESERVATION (language switch detected):",
            state.activeApproach  ? `- Algorithm to preserve: ${state.activeApproach}` : "",
            state.currentComplexity.time  ? `- Required Time complexity: ${state.currentComplexity.time}` : "",
            state.currentComplexity.space ? `- Required Space complexity: ${state.currentComplexity.space}` : "",
            state.chosenLanguage ? `- Source language: ${state.chosenLanguage}` : "",
            "- Port idioms faithfully: Python dict → Java HashMap, list comp → stream/loop, etc.",
            "- Watch O(n) traps: Java ArrayList.contains() is O(n), not O(1) — use HashSet instead.",
            "- The algorithm logic MUST be identical; only syntax should differ.",
          ].filter(Boolean).join("\n")
        : "";

      return [
        "CODE MODIFICATION QUALITY RUBRIC:",
        "1. Preserve the prior solution — apply targeted changes, do NOT rewrite from scratch",
        priorCode,
        algorithmPreservation,
        "2. Every changed line gets an inline end-of-line comment:",
        "   `// ← changed` for JS/TS/Java/C#/Go/Rust  |  `# ← changed` for Python/Shell  |  `-- ← changed` for SQL",
        "3. Return the FULL complete code — every line, including unchanged lines",
        "4. End with a 'What changed:' section — one bullet per modification with reason",
        isLanguageSwitch
          ? "CRITICAL: This is a language translation. Algorithm logic MUST be identical — only syntax changes."
          : "CRITICAL: If the fast answer is a full rewrite, redo it as a targeted mutation with change markers.",
      ].filter(Boolean).join("\n");
    }

    case "optimization": {
      const state = getCodingProblemState(meetingId);
      const currentComplexity = state?.currentComplexity?.time
        ? `Current complexity to beat: Time ${state.currentComplexity.time}${state.currentComplexity.space ? `, Space ${state.currentComplexity.space}` : ""}`
        : "";

      // Gap 1: Grounded constraint follow-ups — name the specific O(n) structures in current code
      const spaceStructures = state?.currentCodeVersion && state?.chosenLanguage
        ? extractSpaceUsingStructures(state.currentCodeVersion, state.chosenLanguage)
        : [];
      const structureHint = spaceStructures.length
        ? `Current O(n) auxiliary structures in your code: ${spaceStructures.join(", ")}. When identifying the bottleneck, name these specifically.`
        : "";

      return [
        "OPTIMIZATION QUALITY RUBRIC:",
        "1. Bottleneck — specifically name what makes the current solution slow or memory-heavy",
        currentComplexity,
        structureHint,
        "2. Better approach — name it + one sentence why it's faster/leaner than the current one",
        "3. Complete optimized code in a fenced block — every line present, changed lines marked `// ← optimized`",
        "4. Complexity comparison (MANDATORY):",
        "   BEFORE: Time O(...) Space O(...)",
        "   AFTER:  Time O(...) Space O(...)",
        "CRITICAL: The before/after complexity table is mandatory. Never produce this answer without it.",
      ].filter(Boolean).join("\n");
    }

    case "backend":
      return [
        "BACKEND/API QUALITY RUBRIC:",
        "1. Core concept in plain language — what it IS and why it exists (1-2 sentences)",
        "2. Concrete mechanism — name actual HTTP methods, status codes, headers, or data flow steps",
        "   (e.g. 'client sends POST /auth with {username, password} → server validates → returns 200 + JWT')",
        "3. Code example — fenced block showing real implementation or usage, even a short snippet",
        "4. Gotcha — one real-world pitfall: security, performance, or common misconfiguration",
        "RULE: Vague descriptions with no concrete details (no codes, no method names, no flow) are not acceptable.",
      ].join("\n");

    case "frontend":
      return [
        "FRONTEND QUALITY RUBRIC:",
        "1. Mental model — one sentence: what this concept IS in plain English (no jargon)",
        "2. Mechanism — how it works internally (reconciliation steps, event loop phase, render cycle phase, etc.)",
        "3. Code example — runnable fenced block (```jsx or ```typescript) showing real, non-trivial usage",
        "4. When to use + one common mistake:",
        "   (e.g. 'Use useMemo when expensive computation, not for object identity. Common mistake: over-memoizing')",
        "RULE: Abstract theory without a code example is a failed answer for frontend questions.",
      ].join("\n");

    case "sql":
      return [
        "SQL QUALITY RUBRIC:",
        "1. SQL query in a fenced ```sql block — REQUIRED even for conceptual questions (show a minimal example)",
        "2. Non-obvious clauses explained — JOIN condition logic, WHERE vs HAVING, window frame, partition key",
        "3. Performance consideration — index usage, query plan impact, N+1 risk, or when NOT to use this pattern",
        "4. Edge case — what happens with NULL values, empty tables, or duplicate rows",
        "RULE: No SQL answer is complete without a ```sql fenced code block.",
      ].join("\n");

    case "code_explanation":
      return [
        "CODE EXPLANATION QUALITY RUBRIC:",
        "1. Quote the relevant snippet — fenced code block at the top, not inline",
        "2. Step-by-step walkthrough — explain each meaningful line or block in execution order",
        "   Use 'line X does Y because Z' — never hand-wave with 'this handles the edge case'",
        "3. Design rationale — one paragraph: why this approach vs the obvious simpler alternative",
        "RULE: Walk through in execution order. Every non-trivial line needs an explanation.",
      ].join("\n");

    default:
      return [
        "QUALITY RUBRIC:",
        "1. Answer is complete — all parts of the question are addressed",
        "2. Code examples (if any) are fenced and syntactically correct",
        "3. Key trade-offs or caveats are explicitly named, not implied",
      ].join("\n");
  }
}
