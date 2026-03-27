import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useMemo, memo } from "react";

// Closes any unclosed markdown markers so ReactMarkdown doesn't show raw
// asterisks/underscores/backticks mid-stream while the next chunk is in flight.
function completePartialMarkdown(text: string): string {
  let t = text;
  // Bold: count ** pairs — if odd, close it
  const boldMarkers = (t.match(/\*\*/g) || []).length;
  if (boldMarkers % 2 !== 0) t += "**";
  // Italic single *: count * not part of ** — if odd, close it
  const singleStars = (t.replace(/\*\*/g, "")).match(/\*/g) || [];
  if (singleStars.length % 2 !== 0) t += "*";
  // Inline code backtick
  const backticks = (t.match(/(?<!`)`(?!`)/g) || []).length;
  if (backticks % 2 !== 0) t += "`";
  return t;
}

function normalizeQaSpacing(raw: string): string {
  const text = String(raw || "");
  if (!text) return "";
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\s*Interviewer:\s*/g, "\n\nInterviewer: ")
    .replace(/\s*Candidate:\s*/g, "\n\nCandidate: ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const qaInlineMatch = normalized.match(
    /^(?:\.{1,3}\s*)?((?:what|why|how|when|where|who|which|can|could|would|will|do|did|does|is|are|have|has|tell|explain)\b[\s\S]*?\?)\s+([\s\S]+)$/i,
  );

  if (qaInlineMatch) {
    const question = qaInlineMatch[1].trim();
    const answer = qaInlineMatch[2].trim();
    return `Interviewer: ${question}\n\nCandidate: ${answer}`;
  }

  return normalized;
}

const CodeBlock = memo(function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const code = String(children).replace(/\n$/, "");

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="relative group my-3 rounded-xl border border-border/70 bg-[#1f2430]"
      data-testid="code-block"
      style={{ width: "100%", minWidth: 0, maxWidth: "100%" }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-white/5 px-4 py-2">
        <span className="text-[11px] font-mono lowercase tracking-wide text-white/70">{language || "code"}</span>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-white/80 hover:bg-white/10 hover:text-white" onClick={handleCopy} data-testid="button-copy-code">
          {copied ? <Check className="w-3 h-3 text-chart-3" /> : <Copy className="w-3 h-3" />}
        </Button>
      </div>
      <div
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
            overflowX: "visible",
            display: "block",
            width: "100%",
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
});

// Streaming renderer — plain text only, zero ReactMarkdown overhead.
// No AST parsing = no DOM thrashing = no flicker. Markdown renders fully
// on the committed ResponseCard after the stream ends.
function StreamingMarkdown({ content, className }: { content: string; className?: string }) {
  const text = content.replace(/^[\u2026.]{1,3}\s*/, "");
  // Split on newlines so paragraphs / line-breaks are preserved
  const lines = text.split("\n");
  return (
    <div className={`streaming-prose${className ? ` ${className}` : ""}`} style={{ minWidth: 0, width: "100%" }}>
      {lines.map((line, i) =>
        line === "" ? <br key={i} /> : <span key={i} className="streaming-line">{line}{i < lines.length - 1 ? null : null}</span>
      )}
    </div>
  );
}

const FINAL_COMPONENTS = {
  code({ node, className: codeClassName, children, ...props }: any) {
    const match = /language-(\w+)/.exec(codeClassName || "");
    const lang = match?.[1] || "";
    const isInline = !match && !String(children).includes("\n");
    if (/^(text|plain|plaintext)$/i.test(lang)) {
      return <p className="mb-3 last:mb-0 whitespace-pre-wrap">{children}</p>;
    }
    if (isInline) {
      return <code className="px-1 py-0.5 bg-muted rounded text-xs font-mono" {...props}>{children}</code>;
    }
    return <CodeBlock language={lang} children={String(children)} />;
  },
  p({ children }: any) { return <p className="mb-3 last:mb-0">{children}</p>; },
  strong({ children }: any) { return <strong className="font-semibold">{children}</strong>; },
  ul({ children }: any) { return <ul className="list-disc pl-4 mb-1.5 space-y-0.5">{children}</ul>; },
  ol({ children }: any) { return <ol className="list-decimal pl-4 mb-1.5 space-y-0.5">{children}</ol>; },
  li({ children }: any) { return <li className="leading-relaxed">{children}</li>; },
  h1({ children }: any) { return <h1 className="text-base font-bold mb-1">{children}</h1>; },
  h2({ children }: any) { return <h2 className="text-sm font-bold mb-1">{children}</h2>; },
  h3({ children }: any) { return <h3 className="text-sm font-semibold mb-1">{children}</h3>; },
  blockquote({ children }: any) {
    return <blockquote className="border-l-2 border-primary/30 pl-3 italic text-muted-foreground my-1.5">{children}</blockquote>;
  },
};

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, className, streaming }: { content: string; className?: string; streaming?: boolean }) {
  // During streaming use the fast inline renderer to avoid ReactMarkdown DOM thrashing
  if (streaming) {
    return <StreamingMarkdown content={content} className={className} />;
  }
  const stripped = content.replace(/^[\u2026.]{1,3}\s*/, "");
  const normalizedContent = completePartialMarkdown(normalizeQaSpacing(stripped));
  return (
    <div className={className} style={{ minWidth: 0, width: "100%" }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={FINAL_COMPONENTS}>
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
});
