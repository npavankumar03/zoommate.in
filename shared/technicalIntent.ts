/**
 * TechnicalIntent — unified 13-label enum merging TechnicalSubtype + CodeTransitionType.
 *
 * Used downstream by the follow-up resolver, response parser, and structured WebSocket event
 * so all layers agree on what kind of answer was produced.
 */

import type { CodeTransitionType } from "./followup";
import type { TechnicalSubtype } from "./technicalSubtype";

export type TechnicalIntent =
  | "coding_implement"    // DSA — new solution from scratch
  | "coding_explain"      // explain code / walk through
  | "coding_modify"       // refactor / error-handling / constraint change / thread-safe
  | "coding_optimize"     // faster / space-reduce / O(n²) → O(n)
  | "coding_debug"        // find / fix a bug
  | "coding_compare"      // alternative approach / "use a stack instead"
  | "language_translate"  // convert to Python / Java / Go
  | "sql_query"           // write / analyse SQL
  | "backend_design"      // REST API / auth / messaging / microservices
  | "frontend_design"     // React / hooks / CSS / SSR
  | "system_design"       // high-level architecture / scale / distributed
  | "testing_followup"    // write tests / coverage / assertions
  | "complexity_followup"; // big-O analysis / time+space breakdown

// ── Classifier ────────────────────────────────────────────────────────────────

const TRANSITION_MAP: Partial<Record<CodeTransitionType, TechnicalIntent>> = {
  optimize:         "coding_optimize",
  space:            "coding_optimize",
  language_switch:  "language_translate",
  constraint_change:"coding_modify",
  thread_safety:    "coding_modify",
  testing:          "testing_followup",
  error_handling:   "coding_modify",
  scale:            "system_design",
  explain_part:     "coding_explain",
  refactor:         "coding_modify",
  complexity:       "complexity_followup",
  alternative:      "coding_compare",
};

const SUBTYPE_MAP: Record<TechnicalSubtype, TechnicalIntent> = {
  dsa:               "coding_implement",
  system_design:     "system_design",
  backend:           "backend_design",
  frontend:          "frontend_design",
  sql:               "sql_query",
  debugging:         "coding_debug",
  code_modification: "coding_modify",
  code_explanation:  "coding_explain",
  optimization:      "coding_optimize",
};

/**
 * Classify a question into a TechnicalIntent.
 * Code transitions take priority over subtype detection.
 * Returns null for non-technical questions.
 */
export function classifyTechnicalIntent(
  codeTransition: CodeTransitionType | undefined,
  subtype: TechnicalSubtype | null | undefined,
): TechnicalIntent | null {
  if (codeTransition) {
    const mapped = TRANSITION_MAP[codeTransition];
    if (mapped) return mapped;
  }
  if (subtype) {
    return SUBTYPE_MAP[subtype] ?? null;
  }
  return null;
}

/** Human-readable label for UI display */
export const INTENT_LABELS: Record<TechnicalIntent, string> = {
  coding_implement:   "Implement",
  coding_explain:     "Explain Code",
  coding_modify:      "Modify Code",
  coding_optimize:    "Optimize",
  coding_debug:       "Debug",
  coding_compare:     "Compare Approaches",
  language_translate: "Language Switch",
  sql_query:          "SQL Query",
  backend_design:     "Backend Design",
  frontend_design:    "Frontend Design",
  system_design:      "System Design",
  testing_followup:   "Testing",
  complexity_followup:"Complexity Analysis",
};
