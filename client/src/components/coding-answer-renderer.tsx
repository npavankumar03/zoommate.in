/**
 * CodingAnswerRenderer
 *
 * Detects coding answers and renders them as structured visual sections:
 *   Approach → Complexity → Code → Edge Cases → Notes / What Changed
 *
 * Falls back to MarkdownRenderer for non-coding answers.
 *
 * Props:
 *   content         — raw LLM response text
 *   isFollowUp      — shows a "Follow-up" badge at the top
 *   followUpLabel   — e.g. "Optimize previous solution", "Language switch"
 *   className       — extra wrapper classes
 */

import { useState } from "react";
import { Copy, Check, GitBranch, Clock, Database, AlertTriangle, FileCode2 } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "./markdown-renderer";

// ── Section types ──────────────────────────────────────────────────────────────

type CodeSection      = { kind: "code";       language: string; code: string };
type ComplexitySection= { kind: "complexity"; time: string; space: string };
type ApproachSection  = { kind: "approach";   text: string };
type EdgeSection      = { kind: "edge_cases"; text: string };
type NoteSection      = { kind: "note";       title: string; text: string };
type ProseSection     = { kind: "prose";      text: string };
export type Section = CodeSection | ComplexitySection | ApproachSection | EdgeSection | NoteSection | ProseSection;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeStructuredSections(sections: Section[] | undefined): Section[] {
  if (!Array.isArray(sections) || sections.length === 0) return [];

  const normalized: Section[] = [];

  for (const raw of sections) {
    if (!raw || typeof raw !== "object" || !("kind" in raw)) continue;

    if (raw.kind === "code") {
      const language = isNonEmptyString((raw as any).language) ? String((raw as any).language).trim() : "code";
      const code = isNonEmptyString((raw as any).code) ? String((raw as any).code).trim() : "";
      if (!code || /^undefined$/i.test(code)) continue;

      const previous = normalized[normalized.length - 1];
      if (previous?.kind === "code" && previous.language === language) {
        previous.code = `${previous.code}\n${code}`.trim();
        continue;
      }

      normalized.push({ kind: "code", language, code });
      continue;
    }

    if (raw.kind === "complexity") {
      const time = isNonEmptyString((raw as any).time) ? String((raw as any).time).trim() : "";
      const space = isNonEmptyString((raw as any).space) ? String((raw as any).space).trim() : "";
      if (!time && !space) continue;
      normalized.push({ kind: "complexity", time, space });
      continue;
    }

    if (raw.kind === "approach" || raw.kind === "edge_cases" || raw.kind === "prose") {
      const text = isNonEmptyString((raw as any).text) ? String((raw as any).text).trim() : "";
      if (!text || /^undefined$/i.test(text)) continue;
      normalized.push({ kind: raw.kind, text } as Section);
      continue;
    }

    if (raw.kind === "note") {
      const title = isNonEmptyString((raw as any).title) ? String((raw as any).title).trim() : "Note";
      const text = isNonEmptyString((raw as any).text) ? String((raw as any).text).trim() : "";
      if (!text || /^undefined$/i.test(text)) continue;
      normalized.push({ kind: "note", title, text });
    }
  }

  return normalized;
}

function shouldFallbackToRawMarkdown(content: string, structuredSections?: Section[]): boolean {
  const normalized = normalizeStructuredSections(structuredSections);
  if (!structuredSections || structuredSections.length === 0) return false;
  if (normalized.length === 0) return true;

  const rawHasCodeFence = /```[\s\S]*?```/.test(content);
  const structuredCodeBlocks = normalized.filter((s): s is CodeSection => s.kind === "code");

  if (rawHasCodeFence && structuredCodeBlocks.length === 0) return true;
  if (structuredCodeBlocks.some((s) => !isNonEmptyString(s.code) || /^undefined$/i.test(s.code))) return true;

  const rawUndefinedCodeFence = /```(?:\w+)?\s*undefined\s*```/i.test(content);
  if (rawUndefinedCodeFence) return true;

  return false;
}

// ── Parser ─────────────────────────────────────────────────────────────────────

function extractComplexityValues(text: string): { time: string; space: string } {
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

function flushBlock(type: string | null, lines: string[], sections: Section[]) {
  const block = lines.join("\n").trim();
  if (!block) return;

  if (type === "approach") {
    sections.push({ kind: "approach", text: block });
  } else if (type === "complexity") {
    const cx = extractComplexityValues(block);
    sections.push({ kind: "complexity", time: cx.time, space: cx.space });
  } else if (type === "edge_cases") {
    sections.push({ kind: "edge_cases", text: block });
  } else if (type === "note") {
    // Extract title from first bold/heading line
    const firstLine = lines[0]?.replace(/^#+\s*|\*+/g, "").replace(/:$/, "").trim() || "Note";
    const rest = lines.slice(1).join("\n").trim();
    sections.push({ kind: "note", title: firstLine, text: rest || block });
  } else {
    // Prose — but try to auto-detect complexity if short block with O(...)
    const cx = extractComplexityValues(block);
    if (cx.time && block.split("\n").length <= 5 && /O\(/.test(block)) {
      sections.push({ kind: "complexity", time: cx.time, space: cx.space });
    } else {
      sections.push({ kind: "prose", text: block });
    }
  }
}

function parseTextBlock(text: string): Section[] {
  const sections: Section[] = [];
  const lines = text.split("\n");
  let currentType: string | null = null;
  let currentLines: string[] = [];

  const headerOf = (line: string): string | null => {
    const t = line.replace(/^#+\s*/, "").replace(/^\*+|\*+$/g, "").replace(/:+$/, "").trim().toLowerCase();
    if (/^(approach|algorithm|idea|strategy|intuition|solution)$/.test(t)) return "approach";
    if (/^(complexity|time|space|time\s*[&+]\s*space|time complexity|space complexity|complexities)$/.test(t)) return "complexity";
    if (/^(edge cases?|edge case)$/.test(t)) return "edge_cases";
    if (/^(note|notes|what changed|what was added|changes|follow.?up|optimization|important)$/.test(t)) return "note";
    return null;
  };

  const isHeader = (line: string) =>
    /^#{1,4}\s/.test(line) ||
    /^\*{1,2}[^*\n]+\*{1,2}:?\s*$/.test(line.trim()) ||
    /^\*{2}[^*]+\*{2}$/.test(line.trim());

  for (const line of lines) {
    if (isHeader(line)) {
      const type = headerOf(line);
      if (type) {
        flushBlock(currentType, currentLines, sections);
        currentType = type;
        currentLines = [line]; // include the header line for "note" title extraction
        continue;
      }
    }
    currentLines.push(line);
  }
  flushBlock(currentType, currentLines, sections);
  return sections;
}

function parseSections(content: string): Section[] {
  const sections: Section[] = [];
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

// Heuristic: is this worth rendering as structured sections?
function isCodingAnswer(content: string): boolean {
  return /```\w/.test(content) && /O\([^)]+\)/i.test(content);
}

// ── Sub-renderers ──────────────────────────────────────────────────────────────

function CopyableCode({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="rounded-xl border border-border/70 bg-[#1f2430] my-2"
      style={{ width: "100%", minWidth: 0, maxWidth: "100%" }}
    >
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-white/10 bg-white/5">
        <div className="flex items-center gap-1.5">
          <FileCode2 className="w-3 h-3 text-emerald-400/80" />
          <span className="text-[11px] font-mono lowercase tracking-wide text-emerald-400/80">
            {language || "code"}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-white/60 hover:bg-white/10 hover:text-white"
          onClick={handleCopy}
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
        </Button>
      </div>
      {/* code-scroll attaches the custom scrollbar CSS from index.css */}
      <div
        className="code-scroll"
        style={{
          width: "100%",
          overflowX: "auto",
          overflowY: "hidden",
          background: "#1f2430",
          borderBottomLeftRadius: "0.75rem",
          borderBottomRightRadius: "0.75rem",
        }}
      >
        <SyntaxHighlighter
          style={oneDark}
          language={language || "text"}
          PreTag="div"
          customStyle={{
            margin: 0,
            borderRadius: 0,
            fontSize: "0.82rem",
            padding: "1rem 1.1rem",
            background: "#1f2430",
            whiteSpace: "pre",
            // max-content lets long lines expand; minWidth keeps short blocks full-width
            width: "max-content",
            minWidth: "100%",
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

function ComplexityBadges({ time, space }: { time: string; space: string }) {
  if (!time && !space) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 my-2">
      {time && (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-mono font-medium">
          <Clock className="w-3 h-3" />
          Time {time}
        </span>
      )}
      {space && (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-300 text-[11px] font-mono font-medium">
          <Database className="w-3 h-3" />
          Space {space}
        </span>
      )}
    </div>
  );
}

function SectionCard({
  children,
  accent,
}: {
  children: React.ReactNode;
  accent?: "blue" | "amber" | "gray" | "red";
}) {
  const borderColor = {
    blue:  "border-l-blue-500/60",
    amber: "border-l-amber-500/60",
    gray:  "border-l-white/20",
    red:   "border-l-red-400/60",
  }[accent || "gray"];

  return (
    <div className={`pl-3 border-l-2 ${borderColor} my-2`}>
      {children}
    </div>
  );
}

function renderInlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((p, i) =>
    i % 2 === 1 ? <strong key={i} className="font-semibold">{p}</strong> : p,
  );
}

function ProseLines({ text }: { text: string }) {
  const lines = text.split("\n").filter(Boolean);
  return (
    <div className="space-y-0.5 text-sm leading-relaxed text-foreground/90">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (/^[-*•]\s/.test(trimmed)) {
          return (
            <p key={i} className="pl-3 relative before:content-['·'] before:absolute before:left-0 before:text-foreground/40">
              {renderInlineMarkdown(trimmed.replace(/^[-*•]\s/, ""))}
            </p>
          );
        }
        if (/^\d+[.)]\s/.test(trimmed)) {
          return (
            <p key={i} className="pl-5 relative">
              <span className="absolute left-0 text-foreground/40 text-[11px] top-0.5">{trimmed.match(/^(\d+)/)?.[1]}.</span>
              {renderInlineMarkdown(trimmed.replace(/^\d+[.)]\s/, ""))}
            </p>
          );
        }
        return <p key={i}>{renderInlineMarkdown(trimmed)}</p>;
      })}
    </div>
  );
}

// ── Section renderer (shared by both parse paths) ─────────────────────────────

function renderSection(section: Section, i: number): React.ReactNode {
  switch (section.kind) {
    case "approach":
      return (
        <SectionCard key={i} accent="blue">
          <p className="text-[10px] uppercase tracking-wide text-blue-400/70 font-semibold mb-1">Approach</p>
          <ProseLines text={section.text} />
        </SectionCard>
      );
    case "complexity":
      return <ComplexityBadges key={i} time={section.time} space={section.space} />;
    case "code":
      return <CopyableCode key={i} language={section.language} code={section.code} />;
    case "edge_cases":
      return (
        <SectionCard key={i} accent="red">
          <p className="text-[10px] uppercase tracking-wide text-red-400/70 font-semibold mb-1">
            <AlertTriangle className="w-3 h-3 inline mr-1 mb-0.5" />
            Edge Cases
          </p>
          <ProseLines text={section.text} />
        </SectionCard>
      );
    case "note":
      return (
        <SectionCard key={i} accent="gray">
          <p className="text-[10px] uppercase tracking-wide text-foreground/40 font-semibold mb-1">
            {section.title}
          </p>
          <div className="text-xs text-foreground/60 leading-relaxed">
            <ProseLines text={section.text} />
          </div>
        </SectionCard>
      );
    case "prose":
    default:
      return (
        <div key={i} className="text-sm leading-relaxed text-foreground/90 my-1">
          <ProseLines text={(section as ProseSection).text} />
        </div>
      );
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

interface CodingAnswerRendererProps {
  content: string;
  isFollowUp?: boolean;
  followUpLabel?: string;
  className?: string;
  /** Pre-parsed sections from server structured_response event. When provided,
   *  client-side re-parsing is skipped entirely. */
  structuredSections?: Section[];
}

export function CodingAnswerRenderer({
  content,
  isFollowUp,
  followUpLabel,
  className,
  structuredSections,
}: CodingAnswerRendererProps) {
  // Strip leading ellipsis artifacts from streaming
  const cleaned = content.replace(/^[\u2026.]{1,3}\s*/, "").trim();
  const safeStructuredSections = normalizeStructuredSections(structuredSections);

  // Use pre-parsed sections from server when available
  if (structuredSections && structuredSections.length > 0) {
    if (shouldFallbackToRawMarkdown(cleaned, structuredSections)) {
      return <MarkdownRenderer content={cleaned} className={className} />;
    }
    const sections = safeStructuredSections;
    return (
      <div className={`space-y-0.5 ${className || ""}`} style={{ minWidth: 0, width: "100%" }}>
        {isFollowUp && (
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[11px] font-medium mb-2">
            <GitBranch className="w-3 h-3" />
            {followUpLabel ? `Follow-up: ${followUpLabel}` : "Follow-up to previous solution"}
          </div>
        )}
        {sections.map((section, i) => renderSection(section, i))}
      </div>
    );
  }

  // Only parse into sections if this looks like a structured coding answer
  if (!isCodingAnswer(cleaned)) {
    return <MarkdownRenderer content={cleaned} className={className} />;
  }

  const sections = parseSections(cleaned);
  const safeParsedSections = normalizeStructuredSections(sections);
  if (safeParsedSections.length === 0) {
    return <MarkdownRenderer content={cleaned} className={className} />;
  }

  return (
    <div className={`space-y-0.5 ${className || ""}`} style={{ minWidth: 0, width: "100%" }}>

      {/* Follow-up badge */}
      {isFollowUp && (
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[11px] font-medium mb-2">
          <GitBranch className="w-3 h-3" />
          {followUpLabel ? `Follow-up: ${followUpLabel}` : "Follow-up to previous solution"}
        </div>
      )}

      {safeParsedSections.map((section, i) => renderSection(section, i))}
    </div>
  );
}
