import { useRef, useEffect, useState, useCallback } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Play, Copy, Check, Sparkles, Loader2 } from "lucide-react";

interface LiveCodeEditorProps {
  onAskCode?: (code: string, question: string) => void;
  isStreaming?: boolean;
}

export function LiveCodeEditor({ onAskCode, isStreaming }: LiveCodeEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [lang, setLang] = useState("javascript");
  const [copied, setCopied] = useState(false);

  const getLangExtension = useCallback((language: string) => {
    switch (language) {
      case "python": return python();
      case "typescript": return javascript({ typescript: true });
      default: return javascript();
    }
  }, []);

  useEffect(() => {
    if (!editorRef.current) return;

    const state = EditorState.create({
      doc: "// Start coding here...\n",
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle),
        oneDark,
        keymap.of([...defaultKeymap, ...historyKeymap] as any),
        getLangExtension(lang),
        EditorView.theme({
          "&": { height: "100%", fontSize: "13px" },
          ".cm-scroller": { overflow: "auto" },
          ".cm-content": { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [lang, getLangExtension]);

  const getCode = useCallback(() => {
    return viewRef.current?.state.doc.toString() || "";
  }, []);

  const handleCopy = useCallback(async () => {
    const code = getCode();
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [getCode]);

  const handleAskAI = useCallback(() => {
    const code = getCode();
    if (!code.trim() || !onAskCode) return;
    onAskCode(code, `Review and help with this ${lang} code. Explain any issues and suggest improvements.`);
  }, [getCode, lang, onAskCode]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-1.5 border-b flex items-center justify-between gap-2 bg-muted/30 shrink-0">
        <div className="flex items-center gap-2">
          <Select value={lang} onValueChange={setLang}>
            <SelectTrigger className="h-7 w-[130px] text-xs" data-testid="select-code-lang">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="javascript">JavaScript</SelectItem>
              <SelectItem value="typescript">TypeScript</SelectItem>
              <SelectItem value="python">Python</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy} data-testid="button-copy-code">
            {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-7 text-xs"
            onClick={handleAskAI}
            disabled={isStreaming}
            data-testid="button-ask-ai-code"
          >
            {isStreaming ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
            Ask AI
          </Button>
        </div>
      </div>
      <div ref={editorRef} className="flex-1 overflow-hidden" data-testid="code-editor" />
    </div>
  );
}
