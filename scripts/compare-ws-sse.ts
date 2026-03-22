import WebSocket from "ws";

type RunOptions = {
  baseUrl: string;
  meetingId: string;
  question: string;
  cookie: string;
  format?: string;
  customFormatPrompt?: string;
  quickMode?: boolean;
  docsMode?: "auto" | "always" | "off";
  model?: string;
  timeoutMs?: number;
  minSimilarity?: number;
};

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function normalizeBaseUrl(input: string): string {
  return input.replace(/\/$/, "");
}

async function runSse(opts: RunOptions): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs || 20000);
  try {
    const res = await fetch(`${opts.baseUrl}/api/meetings/${opts.meetingId}/ask-stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": opts.cookie,
      },
      body: JSON.stringify({
        question: opts.question,
        format: opts.format,
        quickMode: opts.quickMode,
        docsMode: opts.docsMode,
        model: opts.model,
        customFormatPrompt: opts.customFormatPrompt,
      }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(`SSE request failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let splitAt = buffer.indexOf("\n\n");
      while (splitAt >= 0) {
        const packet = buffer.slice(0, splitAt);
        buffer = buffer.slice(splitAt + 2);
        splitAt = buffer.indexOf("\n\n");

        const lines = packet.split(/\r?\n/);
        const dataLines = lines.filter((line) => line.startsWith("data: "));
        if (!dataLines.length) continue;
        const raw = dataLines.map((line) => line.slice(6)).join("\n");
        let payload: any = null;
        try {
          payload = JSON.parse(raw);
        } catch {
          continue;
        }
        if (payload?.type === "chunk") {
          answer += String(payload.chunk || payload.text || "");
        }
        if (payload?.type === "done") {
          return answer;
        }
      }
    }

    return answer;
  } finally {
    clearTimeout(timeout);
  }
}

async function runWs(opts: RunOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const wsUrl = opts.baseUrl.replace(/^http/, "ws") + "/ws";
    const ws = new WebSocket(wsUrl, {
      headers: {
        Cookie: opts.cookie,
      },
    });

    let answer = "";
    let resolved = false;
    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      ws.close();
      reject(new Error("WS timeout"));
    }, opts.timeoutMs || 20000);

    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "session_start",
        sessionId: opts.meetingId,
      }));
      ws.send(JSON.stringify({
        type: "question",
        sessionId: opts.meetingId,
        text: opts.question,
        format: opts.format,
        quickMode: opts.quickMode,
        docsMode: opts.docsMode,
        model: opts.model,
        metadata: {
          mode: "enter",
          customFormatPrompt: opts.customFormatPrompt,
        },
      }));
    });

    ws.on("message", (raw) => {
      let msg: any = null;
      try {
        msg = JSON.parse(String(raw || ""));
      } catch {
        return;
      }
      if (msg.type === "assistant_chunk") {
        answer += String(msg.text || "");
      }
      if (msg.type === "assistant_end") {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        ws.close();
        resolve(answer);
      }
      if (msg.type === "error") {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        ws.close();
        reject(new Error(msg.message || "WS error"));
      }
    });

    ws.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function simpleSimilarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  const setA = new Set(na.split(" "));
  const setB = new Set(nb.split(" "));
  let overlap = 0;
  for (const w of setA) if (setB.has(w)) overlap++;
  return overlap / Math.max(1, setA.size);
}

async function main() {
  const baseUrl = normalizeBaseUrl(getArg("base") || process.env.BASE_URL || "http://localhost:3000");
  const meetingId = getArg("meeting") || process.env.MEETING_ID || "";
  const question = getArg("question") || process.env.QUESTION || "";
  const cookie = getArg("cookie") || process.env.COOKIE || "";
  const format = getArg("format") || process.env.FORMAT;
  const customFormatPrompt = getArg("customPrompt") || process.env.CUSTOM_PROMPT;
  const quickRaw = getArg("quick") || process.env.QUICK_MODE;
  const quickMode = quickRaw === undefined ? undefined : quickRaw === "true";
  const docsMode = (getArg("docs") || process.env.DOCS_MODE) as any || "auto";
  const model = getArg("model") || process.env.MODEL;
  const minSimilarityRaw = getArg("minSim") || process.env.MIN_SIMILARITY;
  const minSimilarity = minSimilarityRaw ? Number(minSimilarityRaw) : undefined;

  if (!meetingId || !question || !cookie) {
    console.log("Usage:");
    console.log("  tsx scripts/compare-ws-sse.ts --base=http://localhost:3000 --meeting=<id> --question=\"...\" --cookie=\"connect.sid=...\" [--format=star] [--customPrompt=\"...\"] [--quick=true] [--docs=auto] [--model=gpt-5-mini] [--minSim=0.9]");
    process.exit(1);
  }

  const opts: RunOptions = {
    baseUrl,
    meetingId,
    question,
    cookie,
    format,
    customFormatPrompt,
    quickMode,
    docsMode,
    model,
    timeoutMs: 25000,
    minSimilarity,
  };

  const [wsAnswer, sseAnswer] = await Promise.all([
    runWs(opts),
    runSse(opts),
  ]);

  const similarity = simpleSimilarity(wsAnswer, sseAnswer);

  console.log("--- WS answer ---\n" + wsAnswer + "\n");
  console.log("--- SSE answer ---\n" + sseAnswer + "\n");
  console.log(`Similarity: ${Math.round(similarity * 100)}%`);
  if (wsAnswer !== sseAnswer) {
    console.log("Note: text differs (minor differences may be due to streaming timing)." );
  }
  if (Number.isFinite(opts.minSimilarity) && similarity < Number(opts.minSimilarity)) {
    console.error(`Similarity below threshold: ${similarity.toFixed(2)} < ${Number(opts.minSimilarity).toFixed(2)}`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("compare-ws-sse failed:", err?.message || err);
  process.exit(1);
});
