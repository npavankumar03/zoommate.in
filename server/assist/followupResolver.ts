/**
 * FollowUp Resolver — structured resolution of follow-up questions.
 *
 * Turns an ambiguous follow-up ("make it faster", "do it in Java", "can you do it in-place")
 * into a concrete FollowUpResolution that names:
 *   - The unified intent label
 *   - The target object (problem + approach + language + version)
 *   - The operation being requested
 *   - An optional dimension (space | time | language:java | concurrent)
 *   - How any pronoun ("it", "this", "that") was resolved
 */

import type { CodeTransitionType } from "@shared/followup";
import type { TechnicalIntent } from "@shared/technicalIntent";
import type { CodingProblemState } from "./sessionState";

// ── Types ─────────────────────────────────────────────────────────────────────

export type FollowUpTarget = {
  /** Canonical label, e.g. "two_sum_hashmap_v2" */
  label:       string;
  problemType: string;
  approach:    string;
  language:    string;
  version:     number;
};

export type FollowUpResolution = {
  intent:    TechnicalIntent;
  target:    FollowUpTarget;
  operation: CodeTransitionType | string;
  /** "space" | "time" | "language:java" | "concurrent" */
  dimension?: string;
  /** '"it" → two_sum_hashmap_v2' */
  resolvedPronoun?: string;
};

// ── Dimension extractors ───────────────────────────────────────────────────────

const LANGUAGE_RE = /\b(?:in|using|to|into)\s+(python|java(?!script)|golang?|go|typescript|javascript|js|c\+\+|c#|csharp|rust|kotlin|swift|ruby|scala)\b/i;
const LANG_NORMALISE: Record<string, string> = {
  golang: "go", "c#": "csharp", "c++": "cpp",
  js: "javascript",
};

function extractDimension(question: string, transition: CodeTransitionType | undefined): string | undefined {
  if (transition === "space") return "space";
  if (transition === "complexity") {
    if (/\btime\b/i.test(question)) return "time";
    if (/\bspace\b/i.test(question)) return "space";
    return "time"; // default complexity ask = time
  }
  if (transition === "language_switch") {
    const m = question.match(LANGUAGE_RE);
    if (m) {
      const lang = m[1].toLowerCase();
      return `language:${LANG_NORMALISE[lang] ?? lang}`;
    }
  }
  if (transition === "thread_safety") return "concurrent";
  if (transition === "optimize") {
    if (/\bspace\b/i.test(question)) return "space";
    return "time";
  }
  return undefined;
}

// ── Pronoun resolver ──────────────────────────────────────────────────────────

const COREF_RE = /\b(it|this|that|those|them|the\s+code|the\s+solution|the\s+function)\b/i;

function resolvePronoun(question: string, state: CodingProblemState): string | undefined {
  if (!COREF_RE.test(question)) return undefined;
  const label = buildTargetLabel(state);
  const pronoun = (question.match(COREF_RE)?.[1] || "it").replace(/\s+/g, " ").toLowerCase();
  return `"${pronoun}" → ${label}`;
}

// ── Label builder ─────────────────────────────────────────────────────────────

function buildTargetLabel(state: CodingProblemState): string {
  const parts: string[] = [];

  const problem = (state.problemType || "solution")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 30);
  parts.push(problem);

  if (state.activeApproach) {
    const approach = state.activeApproach
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 20);
    parts.push(approach);
  }

  const version = (state.operationHistory?.length ?? 0) + 1;
  parts.push(`v${version}`);

  return parts.join("_");
}

// ── Main resolver ─────────────────────────────────────────────────────────────

/**
 * Resolve a follow-up question against the current coding state.
 * Returns null when there is no active coding problem to anchor to.
 */
export function resolveFollowUp(
  question:        string,
  state:           CodingProblemState | null | undefined,
  codeTransition:  CodeTransitionType | undefined,
  intent:          TechnicalIntent | null,
): FollowUpResolution | null {
  if (!state || !intent) return null;

  const label = buildTargetLabel(state);

  const target: FollowUpTarget = {
    label,
    problemType: state.problemType || "",
    approach:    state.activeApproach || "",
    language:    state.chosenLanguage || "",
    version:     (state.operationHistory?.length ?? 0) + 1,
  };

  const dimension  = extractDimension(question, codeTransition);
  const resolvedPronoun = resolvePronoun(question, state);

  return {
    intent,
    target,
    operation: codeTransition || intent,
    ...(dimension        ? { dimension }        : {}),
    ...(resolvedPronoun  ? { resolvedPronoun }  : {}),
  };
}
