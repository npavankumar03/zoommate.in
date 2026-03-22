/**
 * Server-side response parser.
 *
 * Parses the fully-assembled LLM answer text into typed sections so the structured
 * response can be emitted over WebSocket and consumed by the client renderer
 * without client-side re-parsing.
 */

import type { TechnicalIntent } from "@shared/technicalIntent";

// ── Section types ─────────────────────────────────────────────────────────────

export type CodeSection      = { kind: "code";       language: string; code: string };
export type ComplexitySection= { kind: "complexity"; time: string; space: string };
export type ApproachSection  = { kind: "approach";   text: string };
export type EdgeSection      = { kind: "edge_cases"; text: string };
export type NoteSection      = { kind: "note";       title: string; text: string };
export type ProseSection     = { kind: "prose";      text: string };

export type ParsedSection =
  | CodeSection | ComplexitySection | ApproachSection
  | EdgeSection | NoteSection | ProseSection;

// ── Structured response ───────────────────────────────────────────────────────

export type StructuredResponse = {
  intent: TechnicalIntent | null;
  sections: ParsedSection[];
  meta: {
    hasCode:         boolean;
    languages:       string[];
    timeComplexity:  string;
    spaceComplexity: string;
    hasChangeMarkers:boolean;
    sectionCount:    number;
  };
};

// ── Complexity extractor ──────────────────────────────────────────────────────

function extractComplexity(text: string): { time: string; space: string } {
  const timeMatch =
    text.match(/time[:\s]*(?:complexity[:\s]*)?(O\([^)]+\))/i) ||
    text.match(/(O\([^)]+\))\s*(?:[-–—]?\s*time|for\s+time|\(time\))/i);
  const spaceMatch =
    text.match(/space[:\s]*(?:complexity[:\s]*)?(O\([^)]+\))/i) ||
    text.match(/(O\([^)]+\))\s*(?:[-–—]?\s*space|for\s+space|\(space\))/i);

  const allO = Array.from(text.matchAll(/\b(O\([^)]+\))/gi)).map((m) => m[1]);
  return {
    time:  timeMatch?.[1]  || allO[0] || "",
    space: spaceMatch?.[1] || allO[1] || "",
  };
}

// ── Text block parser ─────────────────────────────────────────────────────────

function headerOf(line: string): string | null {
  const t = line
    .replace(/^#+\s*/, "")
    .replace(/^\*+|\*+$/g, "")
    .replace(/:+$/, "")
    .trim()
    .toLowerCase();
  if (/^(approach|algorithm|idea|strategy|intuition|solution)$/.test(t)) return "approach";
  if (/^(complexity|time|space|time\s*[&+]\s*space|time complexity|space complexity|complexities)$/.test(t)) return "complexity";
  if (/^(edge cases?|edge case)$/.test(t)) return "edge_cases";
  if (/^(note|notes|what changed|what was added|changes|follow.?up|optimization|important)$/.test(t)) return "note";
  return null;
}

function isHeader(line: string): boolean {
  return (
    /^#{1,4}\s/.test(line) ||
    /^\*{1,2}[^*\n]+\*{1,2}:?\s*$/.test(line.trim()) ||
    /^\*{2}[^*]+\*{2}$/.test(line.trim())
  );
}

function flushBlock(type: string | null, lines: string[], sections: ParsedSection[]) {
  const block = lines.join("\n").trim();
  if (!block) return;

  if (type === "approach") {
    sections.push({ kind: "approach", text: block });
  } else if (type === "complexity") {
    const cx = extractComplexity(block);
    sections.push({ kind: "complexity", time: cx.time, space: cx.space });
  } else if (type === "edge_cases") {
    sections.push({ kind: "edge_cases", text: block });
  } else if (type === "note") {
    const firstLine = (lines[0] || "").replace(/^#+\s*|\*+/g, "").replace(/:$/, "").trim() || "Note";
    const rest = lines.slice(1).join("\n").trim();
    sections.push({ kind: "note", title: firstLine, text: rest || block });
  } else {
    const cx = extractComplexity(block);
    if (cx.time && block.split("\n").length <= 5 && /O\(/.test(block)) {
      sections.push({ kind: "complexity", time: cx.time, space: cx.space });
    } else {
      sections.push({ kind: "prose", text: block });
    }
  }
}

function parseTextBlock(text: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const lines = text.split("\n");
  let currentType: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    if (isHeader(line)) {
      const type = headerOf(line);
      if (type) {
        flushBlock(currentType, currentLines, sections);
        currentType = type;
        currentLines = [line];
        continue;
      }
    }
    currentLines.push(line);
  }
  flushBlock(currentType, currentLines, sections);
  return sections;
}

function parseSections(content: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const fenceRe = /```(\w+)?\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRe.exec(content)) !== null) {
    const textBefore = content.slice(lastIndex, match.index).trim();
    if (textBefore) sections.push(...parseTextBlock(textBefore));

    const lang = (match[1] || "text").trim();
    const code = match[2].trim();
    if (code && !/^(text|plain|plaintext)$/i.test(lang)) {
      sections.push({ kind: "code", language: lang, code });
    }
    lastIndex = match.index + match[0].length;
  }

  const textAfter = content.slice(lastIndex).trim();
  if (textAfter) sections.push(...parseTextBlock(textAfter));

  return sections;
}

// ── Main parse function ───────────────────────────────────────────────────────

export function parseResponse(
  text: string,
  intent?: TechnicalIntent | null,
): StructuredResponse {
  const cleaned = text.replace(/^[\u2026.]{1,3}\s*/, "").trim();
  const sections = parseSections(cleaned);

  // Build meta
  const codeSections   = sections.filter((s): s is CodeSection => s.kind === "code");
  const complexSect    = sections.find((s): s is ComplexitySection => s.kind === "complexity");
  const hasChangeMarkers = /←\s*changed/i.test(cleaned);

  const languages = Array.from(new Set(codeSections.map((s) => s.language))).filter(Boolean);
  const timeComplexity  = complexSect?.time  || extractComplexity(cleaned).time;
  const spaceComplexity = complexSect?.space || extractComplexity(cleaned).space;

  return {
    intent: intent ?? null,
    sections,
    meta: {
      hasCode:          codeSections.length > 0,
      languages,
      timeComplexity,
      spaceComplexity,
      hasChangeMarkers,
      sectionCount:     sections.length,
    },
  };
}
