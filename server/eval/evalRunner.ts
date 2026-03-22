/**
 * AceMate Coding Eval Runner
 *
 * Replays multi-turn conversations against the live streamAssistantAnswer pipeline,
 * scores each response against the eval suite criteria, and returns structured results.
 *
 * Usage (CLI):
 *   npx tsx server/eval/evalRunner.ts              # run all 20 cases
 *   npx tsx server/eval/evalRunner.ts --cases 1,5  # run specific cases
 *   npx tsx server/eval/evalRunner.ts --cases 1-5  # run a range
 *
 * Usage (API):
 *   POST /api/eval/coding  { cases?: number[] }
 */

import { streamAssistantAnswer } from "../assist/streamAssistantAnswer";
import { getCodingProblemState } from "../assist/sessionState";
import { isFollowUp } from "@shared/followup";
import { detectTechnicalSubtype } from "@shared/technicalSubtype";
import { EVAL_CASES, TOTAL_MAX_SCORE, type EvalCase } from "./codingEvalSuite";
import { printEvalReport } from "./evalReport";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CriterionResult = {
  name: string;
  points: number;
  earned: number;
  passed: boolean;
};

export type TurnLog = {
  turn: number;
  question: string;
  response: string;
  durationMs: number;
  /** Detected subtype label, e.g. "dsa" */
  detectedSubtype: string | null;
  /** Detected code transition, e.g. "language_switch" */
  detectedTransition: string | null;
  /** Whether isFollowUp returned true */
  isFollowUp: boolean;
  /** Whether prior code was in session state */
  hasPriorCode: boolean;
  /** Whether response contains a code block */
  hasCodeBlock: boolean;
  /** Whether response mentions a complexity (O(...)) */
  mentionsComplexity: boolean;
  /** Whether response references the prior solution by keyword */
  referencesPrior: boolean;
};

export type CaseResult = {
  id: number;
  name: string;
  category: string;
  failureMode: string;
  score: number;
  maxScore: number;
  passed: boolean;          // true if score === maxScore
  criteria: CriterionResult[];
  turns: TurnLog[];
  error?: string;
};

export type SuiteResult = {
  runAt: string;
  totalScore: number;
  maxScore: number;
  band: string;
  categoryScores: Record<string, { score: number; max: number; label: string }>;
  cases: CaseResult[];
  topFailures: Array<{ id: number; name: string; missed: number }>;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const EVAL_USER_ID = "eval-user-000";
const TURN_TIMEOUT_MS = 45_000;

// Minimal meeting shape — satisfies toMeetingSettings() without a real DB record
function makeMockMeeting(meetingId: string) {
  return {
    id: meetingId,
    userId: EVAL_USER_ID,
    type: "interview",
    responseFormat: "technical",
    customInstructions: "",
    conversationContext: "",
    documentIds: [] as string[],
    rollingSummary: "",
    model: "automatic",
    sessionMode: undefined,
  } as any;
}

// ── Core: run a single turn ───────────────────────────────────────────────────

async function runTurn(
  meetingId: string,
  question: string,
  turnIndex: number,
  prevResponses: string[],
): Promise<{ response: string; durationMs: number }> {
  const start = Date.now();

  const timeoutSignal = AbortSignal.timeout(TURN_TIMEOUT_MS);
  const gen = streamAssistantAnswer({
    meetingId,
    userId: EVAL_USER_ID,
    question,
    format: "technical",
    transport: "sse",
    meeting: makeMockMeeting(meetingId),
    abortSignal: timeoutSignal,
    submitSource: `eval-turn-${turnIndex}`,
  });

  let finalAnswer = "";
  let chunkBuffer = "";

  for await (const event of gen) {
    if (event.type === "chunk") {
      chunkBuffer += event.text;
    } else if (event.type === "end") {
      // Prefer the finalized answer from the end event if available
      finalAnswer = event.response?.answer || chunkBuffer;
    } else if (event.type === "error") {
      throw new Error(`LLM error on turn ${turnIndex}: ${event.message}`);
    }
  }

  if (!finalAnswer) finalAnswer = chunkBuffer;

  return { response: finalAnswer.trim(), durationMs: Date.now() - start };
}

// ── Turn metadata extraction ──────────────────────────────────────────────────

function buildTurnLog(
  turn: number,
  question: string,
  response: string,
  durationMs: number,
  meetingId: string,
  prevResponses: string[],
): TurnLog {
  const codingState = getCodingProblemState(meetingId);
  const followUpResult = isFollowUp(question, { hasCodingContext: Boolean(codingState) });
  const subtypeResult = detectTechnicalSubtype(question, Boolean(codingState));

  const prevText = prevResponses.join(" ").toLowerCase();
  const referencesPrior =
    prevResponses.length > 0 &&
    (/hash\s*map|sliding.window|two.pointer|kadane|binary.search|linked.list|dp\b|backtrack/i.test(response) ||
      // Check if any key noun from prior answers appears in new response
      prevText
        .split(/\s+/)
        .filter((w) => w.length > 6)
        .slice(0, 30)
        .some((w) => response.toLowerCase().includes(w)));

  return {
    turn,
    question,
    response,
    durationMs,
    detectedSubtype: subtypeResult?.subtype ?? null,
    detectedTransition: followUpResult.codeTransition ?? null,
    isFollowUp: followUpResult.isFollowUp,
    hasPriorCode: Boolean(codingState?.currentCodeVersion),
    hasCodeBlock: /```/.test(response),
    mentionsComplexity: /O\([^)]+\)/i.test(response) || /time complexity|space complexity/i.test(response),
    referencesPrior,
  };
}

// ── Score a single case ───────────────────────────────────────────────────────

async function runEvalCase(testCase: EvalCase): Promise<CaseResult> {
  const meetingId = `eval-${testCase.id}-${Date.now()}`;
  const allResponses: string[] = [];
  const turnLogs: TurnLog[] = [];

  try {
    // Replay all turns
    for (let i = 0; i < testCase.turns.length; i++) {
      const { question } = testCase.turns[i];
      const { response, durationMs } = await runTurn(meetingId, question, i + 1, allResponses);
      allResponses.push(response);
      turnLogs.push(buildTurnLog(i + 1, question, response, durationMs, meetingId, allResponses.slice(0, -1)));
    }

    // Score criteria — each criterion specifies which turn to evaluate (default: last)
    const codingState = getCodingProblemState(meetingId);
    const criteriaResults: CriterionResult[] = testCase.criteria.map((criterion) => {
      const targetTurn = criterion.evalOnTurn ?? testCase.turns.length;
      const response = allResponses[targetTurn - 1] ?? "";
      let passed = false;
      try {
        passed = criterion.check(response, allResponses, codingState);
      } catch {
        passed = false;
      }
      return {
        name: criterion.name,
        points: criterion.points,
        earned: passed ? criterion.points : 0,
        passed,
      };
    });

    const score = criteriaResults.reduce((s, c) => s + c.earned, 0);
    const maxScore = criteriaResults.reduce((s, c) => s + c.points, 0);

    return {
      id: testCase.id,
      name: testCase.name,
      category: testCase.category,
      failureMode: testCase.failureMode,
      score,
      maxScore,
      passed: score === maxScore,
      criteria: criteriaResults,
      turns: turnLogs,
    };
  } catch (err) {
    const maxScore = testCase.criteria.reduce((s, c) => s + c.points, 0);
    return {
      id: testCase.id,
      name: testCase.name,
      category: testCase.category,
      failureMode: testCase.failureMode,
      score: 0,
      maxScore,
      passed: false,
      criteria: testCase.criteria.map((c) => ({ name: c.name, points: c.points, earned: 0, passed: false })),
      turns: turnLogs,
      error: String(err),
    };
  }
}

// ── Scoring band ──────────────────────────────────────────────────────────────

function scoreBand(score: number, max: number): string {
  const pct = (score / max) * 100;
  if (pct >= 85) return "NEAR SPECIALIZED CODING-COPILOT QUALITY (170–200)";
  if (pct >= 65) return "GOOD — INCONSISTENT ON MULTI-TURN & CONSTRAINTS (130–169)";
  if (pct >= 45) return "USEFUL FOR DEMOS, WEAK FOR REAL CODING INTERVIEWS (90–129)";
  return "PROMPT ILLUSION — NOT REAL CONTINUITY (below 90)";
}

// ── Run full suite ────────────────────────────────────────────────────────────

export async function runEvalSuite(caseIds?: number[]): Promise<SuiteResult> {
  const cases = caseIds
    ? EVAL_CASES.filter((c) => caseIds.includes(c.id))
    : EVAL_CASES;

  const categoryScores: Record<string, { score: number; max: number; label: string }> = {
    basic_anchoring:    { score: 0, max: 0, label: "Basic anchoring (1–5)" },
    constraint_mutation:{ score: 0, max: 0, label: "Constraint mutation (6–12)" },
    domain_routing:     { score: 0, max: 0, label: "Domain routing (13–16)" },
    multi_turn:         { score: 0, max: 0, label: "Multi-turn continuity (17–20)" },
  };

  const results: CaseResult[] = [];
  let totalScore = 0;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    process.stdout.write(`\nRunning case ${i + 1}/${cases.length}: ${c.name}...`);
    const result = await runEvalCase(c);
    results.push(result);
    totalScore += result.score;
    categoryScores[result.category].score += result.score;
    categoryScores[result.category].max   += result.maxScore;
    process.stdout.write(` ${result.score}/${result.maxScore}\n`);
  }

  const topFailures = results
    .filter((r) => r.score < r.maxScore)
    .sort((a, b) => (b.maxScore - b.score) - (a.maxScore - a.score))
    .slice(0, 5)
    .map((r) => ({ id: r.id, name: r.name, missed: r.maxScore - r.score }));

  return {
    runAt: new Date().toISOString(),
    totalScore,
    maxScore: TOTAL_MAX_SCORE,
    band: scoreBand(totalScore, TOTAL_MAX_SCORE),
    categoryScores,
    cases: results,
    topFailures,
  };
}

// ── CLI entry point ───────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  let caseIds: number[] | undefined;

  const casesFlag = args.find((a) => a.startsWith("--cases=") || a === "--cases");
  if (casesFlag) {
    const val = casesFlag.includes("=") ? casesFlag.split("=")[1] : args[args.indexOf("--cases") + 1];
    if (val) {
      if (val.includes("-")) {
        const [from, to] = val.split("-").map(Number);
        caseIds = Array.from({ length: to - from + 1 }, (_, i) => from + i);
      } else {
        caseIds = val.split(",").map(Number).filter(Boolean);
      }
    }
  }

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║      AceMate Coding Follow-Up Eval Suite                 ║");
  console.log(`║      ${caseIds ? `${caseIds.length} selected cases` : "20 cases"} | ${TOTAL_MAX_SCORE} points max${caseIds ? "                  " : "                  "}║`);
  console.log("╚══════════════════════════════════════════════════════════╝");

  const result = await runEvalSuite(caseIds);
  printEvalReport(result);

  // Write JSON results
  const fs = await import("fs");
  const outFile = `eval-results-${Date.now()}.json`;
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log(`\nResults saved to: ${outFile}`);

  process.exit(result.totalScore >= (TOTAL_MAX_SCORE * 0.45) ? 0 : 1);
}

if (require.main === module || process.argv[1]?.endsWith("evalRunner.ts")) {
  main().catch((err) => {
    console.error("Eval runner failed:", err);
    process.exit(1);
  });
}
