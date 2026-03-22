/**
 * AceMate Eval Report — pretty-prints suite results to the terminal.
 *
 * Output format:
 *   Per-case: criterion pass/fail with points
 *   Category summary: score bar + percentage
 *   Total: score, band, top failures
 */

import type { SuiteResult, CaseResult } from "./evalRunner";

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  white:  "\x1b[37m",
  gray:   "\x1b[90m",
};

const green  = (s: string) => `${C.green}${s}${C.reset}`;
const red    = (s: string) => `${C.red}${s}${C.reset}`;
const yellow = (s: string) => `${C.yellow}${s}${C.reset}`;
const cyan   = (s: string) => `${C.cyan}${s}${C.reset}`;
const bold   = (s: string) => `${C.bold}${s}${C.reset}`;
const dim    = (s: string) => `${C.dim}${s}${C.reset}`;

function bar(score: number, max: number, width = 20): string {
  if (max === 0) return "░".repeat(width);
  const filled = Math.round((score / max) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function pct(score: number, max: number): string {
  if (max === 0) return "  0%";
  return `${Math.round((score / max) * 100).toString().padStart(3)}%`;
}

function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

// ── Per-case block ────────────────────────────────────────────────────────────

function printCase(c: CaseResult): void {
  const scoreColor = c.score === c.maxScore ? green : c.score >= c.maxScore * 0.6 ? yellow : red;
  const caseHeader = bold(`CASE ${c.id}: ${c.name}`);
  console.log(`\n${caseHeader}`);
  if (c.error) {
    console.log(`  ${red("✗ ERROR:")} ${c.error}`);
    return;
  }

  for (const cr of c.criteria) {
    const icon = cr.passed ? green("✓") : red("✗");
    const pts  = cr.passed
      ? green(`[${cr.earned}/${cr.points}]`)
      : red(`[0/${cr.points}]`);
    console.log(`  ${icon} ${pad(cr.name, 50)} ${pts}`);
  }
  console.log(
    `  ${bold("Score:")} ${scoreColor(`${c.score}/${c.maxScore}`)}` +
    `  ${dim(pct(c.score, c.maxScore))}` +
    (c.score < c.maxScore ? dim(`  ← ${c.failureMode.slice(0, 60)}`) : ""),
  );

  // Turn log summary
  for (const t of c.turns) {
    const flags: string[] = [];
    if (t.isFollowUp)        flags.push("followup");
    if (t.hasPriorCode)      flags.push("prior-code");
    if (t.hasCodeBlock)      flags.push("has-code");
    if (t.mentionsComplexity) flags.push("complexity");
    if (t.detectedSubtype)   flags.push(t.detectedSubtype);
    if (t.detectedTransition) flags.push(t.detectedTransition);
    console.log(
      `  ${dim(`T${t.turn}:`)} ${dim(t.question.slice(0, 55).replace(/\n/g, " "))} ` +
      `${dim(`[${t.durationMs}ms]`)}` +
      (flags.length ? dim(` {${flags.join(", ")}}`) : ""),
    );
  }
}

// ── Category summary row ──────────────────────────────────────────────────────

function categoryRow(
  label: string,
  score: number,
  max: number,
): string {
  const p = max > 0 ? (score / max) * 100 : 0;
  const barStr = bar(score, max, 20);
  const scoreStr = `${score}/${max}`;
  const weakness = p < 60 ? red(" ← WEAK") : p < 75 ? yellow(" ← NEEDS WORK") : "";
  return (
    `  ${pad(label, 35)} ` +
    `${p >= 75 ? green(barStr) : p >= 60 ? yellow(barStr) : red(barStr)}  ` +
    `${cyan(scoreStr.padStart(7))}  ${pct(score, max)}${weakness}`
  );
}

// ── Main report ───────────────────────────────────────────────────────────────

export function printEvalReport(result: SuiteResult): void {
  console.log("\n" + "═".repeat(62));
  console.log(bold("CATEGORY SUMMARY"));
  console.log("─".repeat(62));
  for (const cat of Object.values(result.categoryScores)) {
    if (cat.max > 0) {
      console.log(categoryRow(cat.label, cat.score, cat.max));
    }
  }

  console.log("\n" + "═".repeat(62));

  const totalPct = (result.totalScore / result.maxScore) * 100;
  const totalColor = totalPct >= 75 ? green : totalPct >= 55 ? yellow : red;
  console.log(bold("TOTAL SCORE"));
  console.log(
    `  ${totalColor(bold(`${result.totalScore} / ${result.maxScore}`))}  ` +
    `${totalColor(bold(pct(result.totalScore, result.maxScore)))}  ` +
    `${bar(result.totalScore, result.maxScore, 30)}`,
  );
  console.log(`\n  ${bold("Band:")} ${yellow(result.band)}`);

  if (result.topFailures.length) {
    console.log("\n" + "─".repeat(62));
    console.log(bold("TOP FAILURES"));
    for (const f of result.topFailures) {
      console.log(`  ${red(`Case ${f.id}:`)} ${f.name}  ${dim(`(-${f.missed} pts)`)}`);
    }
  }

  console.log("\n" + "═".repeat(62));

  // Print per-case details
  console.log("\n" + bold("PER-CASE BREAKDOWN"));
  for (const c of result.cases) {
    printCase(c);
  }

  console.log("\n" + "═".repeat(62));
  console.log(`${dim("Run at:")} ${result.runAt}`);
  console.log("═".repeat(62) + "\n");
}

// ── Regression diff ───────────────────────────────────────────────────────────
// Call this to compare two saved result files and see what changed.

export function diffResults(prev: SuiteResult, curr: SuiteResult): void {
  console.log(bold("\nREGRESSION DIFF"));
  console.log("─".repeat(62));

  const delta = curr.totalScore - prev.totalScore;
  const deltaStr = delta >= 0 ? green(`+${delta}`) : red(`${delta}`);
  console.log(
    `Total: ${prev.totalScore} → ${curr.totalScore}  (${deltaStr})  ` +
    `${prev.band !== curr.band ? yellow(`Band changed: ${prev.band.slice(0, 25)} → ${curr.band.slice(0, 25)}`) : ""}`,
  );

  const prevMap = new Map(prev.cases.map((c) => [c.id, c]));
  const currMap = new Map(curr.cases.map((c) => [c.id, c]));

  const improved: string[] = [];
  const regressed: string[] = [];

  Array.from(currMap.entries()).forEach(([id, currCase]) => {
    const prevCase = prevMap.get(id);
    if (!prevCase) return;
    const d = currCase.score - prevCase.score;
    if (d > 0) improved.push(`  ${green(`Case ${id} +${d}`)}: ${currCase.name}`);
    if (d < 0) regressed.push(`  ${red(`Case ${id} ${d}`)}: ${currCase.name}`);
  });

  if (improved.length) {
    console.log(bold("\nImproved:"));
    improved.forEach((s) => console.log(s));
  }
  if (regressed.length) {
    console.log(bold("\nRegressed:"));
    regressed.forEach((s) => console.log(s));
  }
  if (!improved.length && !regressed.length) {
    console.log(dim("  No changes."));
  }
  console.log("─".repeat(62));
}
