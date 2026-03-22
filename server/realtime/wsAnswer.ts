import { WebSocket, WebSocketServer } from "ws";
import type { Server, IncomingMessage } from "http";
import { URL } from "url";
import { storage } from "../storage";
import { streamAssistantAnswer, abortSessionStream, hasActiveStream } from "../assist/streamAssistantAnswer";
import { getLastUnansweredInterviewerQuestion, getLatestSpokenReply, recordUserQuestion, getCodingProblemState } from "../assist/sessionState";
import { levenshteinSimilarity, normalizeQuestionForSimilarity } from "@shared/questionDetection";
import { getRefineConfig, buildRefineContext } from "../assist/refinePass";
import { parseResponse } from "../assist/responseParser";

interface AnswerSession {
  ws: WebSocket;
  userId: string;
  sessionId: string;
  requestId: string;
}

// Known follow-up words/phrases that are always valid — never treat as noise/vague
const KNOWN_FOLLOWUP_RE = /^(why|how so|how|what about|elaborate|explain|tell me more|go on|continue|and then|what next|what else|can you explain|can you elaborate|give me an example|okay|ok|sure|interesting|really|seriously|and|so|then|next|more|again|wait|huh|show me|keep going|proceed|expand|clarify|summarize|repeat|example|further|detail|go ahead|dive deeper|dig deeper|break it down|zoom in|say more|one more)\??$/i;

// Detects incomplete questions that end with a dangling preposition/article (sentence cut off mid-ask)
function isDanglingStub(q: string): boolean {
  const words = q.split(" ").filter(Boolean);
  if (words.length > 12) return false; // long enough to be real
  if (q.includes("?")) return false;   // has question mark = complete enough
  return /\b(in|with|at|for|on|about|of|from|to|by|and|or|the|a|an|any|some|your|our|their|its|this|that|these|those)\s*$/.test(q);
}

function isVagueQuestion(text: string): boolean {
  const q = String(text || "").toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
  if (!q) return true;
  if (KNOWN_FOLLOWUP_RE.test(q)) return false;
  const words = q.split(" ").filter(Boolean);
  if (words.length <= 1 && !q.includes("?")) return true;
  // Partial/cut-off question stubs — interviewer didn't finish speaking
  if (isDanglingStub(q)) return true;
  if (/^(do you have experience|do you have experience in|have you worked on|tell me about)\??$/.test(q)) return true;
  return false;
}

function looksLikeInterviewNoise(text: string): boolean {
  const q = String(text || "").toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
  if (!q) return true;
  // Known follow-ups are never noise
  if (KNOWN_FOLLOWUP_RE.test(q)) return false;
  const words = q.split(" ").filter(Boolean);
  if (words.length < 2 && !q.includes("?")) return true;

  const hasQuestionCue = /\?|^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|tell|walk|explain|describe|share|give|talk|are you|have you|your experience|your background)\b/.test(q)
    || /\b(tell me about|tell us about|walk me through|talk me through|describe a time|give me an example|have you worked|have you used|have you ever|are you familiar|are you comfortable with|your experience (with|in)|your background in)\b/.test(q);
  const hasInterviewCue = /\b(experience|project|api|apis|react|python|fastapi|fast api|fast apis|django|backend|frontend|system|design|challenge|work|role|aws|azure|gcp|cloud|kubernetes|docker|microservice|database|sql|nosql|java|typescript|golang|rust|spring|node|angular|vue)\b/.test(q);
  const hasFollowUpCue = /^(show me|keep going|one more|go on|go ahead|tell me more|explain more|elaborate more|more detail|what else|what next|and then|say more|dive deeper|dig deeper|expand on|break it down|walk me through that)\b/.test(q);
  if (!hasQuestionCue && !hasInterviewCue && !hasFollowUpCue && words.length <= 12) return true;

  const randomNoisePattern = /\b(call mum|road closed|downtown|island|laguna|nokia)\b/;
  if (randomNoisePattern.test(q) && !hasInterviewCue) return true;

  return false;
}

function chooseBestQuestionSeed(candidates: Array<string | undefined | null>): string {
  const cleaned = candidates
    .map((c) => String(c || "").trim())
    .filter(Boolean)
    .filter((text) => !looksLikeInterviewNoise(text));
  if (!cleaned.length) return "[Continue]";

  const scored = cleaned.map((text, idx) => {
    const vague = isVagueQuestion(text);
    const hasQuestionMark = text.includes("?");
    const score = (vague ? 0 : 1000) + (hasQuestionMark ? 80 : 0) + Math.min(text.length, 400) - idx;
    return { text, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].text;
}

function extractLatestMergedSegment(raw: string): string {
  const text = String(raw || "").trim();
  if (!text) return "";
  const parts = text
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return text;

  // Prefer last explicit question-like segment.
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (/\?/.test(p) || /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|tell|walk|explain)\b/i.test(p)) {
      return p;
    }
  }
  return parts[parts.length - 1];
}

// Tech terms that alone constitute a valid implicit interview question
const KNOWN_TECH_TERM_RE = /^(flask|django|fastapi|react|angular|vue|python|java|javascript|typescript|nodejs|node\.?js|aws|azure|gcp|docker|kubernetes|redis|kafka|mongodb|postgres|postgresql|mysql|spring|terraform|ansible|graphql|microservices?|devops|git|linux|bash|celery|rabbitmq|elasticsearch|nginx|jenkins|airflow|spark|hadoop|pandas|numpy|pytorch|tensorflow|scikit|langchain|openai|llm|rag|pinecone|weaviate|next\.?js|tailwind|redux|webpack|vite|jest|pytest|junit|maven|gradle|intellij|pycharm|jupyter|postman|jira|confluence|bitbucket|github|gitlab|agile|scrum|kanban|ci.?cd|rest|soap|grpc|jwt|oauth|saml|ldap|ssl|tls|tcp|http|websocket|sql|nosql|orm|crud|solid|mvp|mvc|mvvm|tdd|bdd|ddd|design pattern|system design|data structure|algorithm|leetcode|hackerrank)s?\b$/i;

function looksLikeNoiseSegment(text: string): boolean {
  const q = String(text || "").toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
  if (!q) return true;
  if (KNOWN_FOLLOWUP_RE.test(q)) return false;
  // Known tech terms alone are never noise — treat as implicit "do you have experience in X"
  if (KNOWN_TECH_TERM_RE.test(q.trim())) return false;
  const words = q.split(" ").filter(Boolean);
  if (words.length <= 1 && !q.includes("?")) return true;

  // Hard noise patterns — background audio, accidental activations
  if (/\b(hey cortana|hey siri|ok google|alexa|open internet explorer|call mom|call dad|call mum|play music|road closed|downtown|laguna|nokia|mumbai|sundar pichai|breaking news|weather today|stock market)\b/.test(q)) return true;

  // Pure filler with no substance
  const fillerOnly = /^(um+|uh+|hmm+|ah+|oh+|er+|so+|like|okay|ok|yeah|yes|no|right|sure|well|alright|got it|i see|mhm|mm+|yep|nope)\s*$/.test(q);
  if (fillerOnly) return true;

  // Repetitive single-word noise (e.g. "the the the" or "and and and")
  const uniqueWords = new Set(words);
  if (uniqueWords.size === 1 && words.length > 1) return true;

  const hasQuestionCue = /\?|^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|tell|walk|explain|describe|share|give|talk|are you|have you|your experience|your background)\b/.test(q)
    || /\b(tell me about|tell us about|walk me through|talk me through|describe a time|give me an example|have you worked|have you used|have you ever|are you familiar|are you comfortable with|your experience with|your experience in|your background in)\b/.test(q);

  // Interview cue — must be a meaningful tech/interview term, not just any common word
  const hasInterviewCue = /\b(experience|react|python|fastapi|flask|django|api|apis|project|worked|aws|azure|gcp|cloud|kubernetes|docker|microservice|database|sql|nosql|java|typescript|golang|spring|node|angular|vue|devops|agile|scrum|architecture|system design|algorithm|data structure|machine learning|ci cd|deployment|testing|optimization)\b/.test(q);

  // Short segments (≤6 words) with no question cue AND no interview cue → noise
  if (!hasQuestionCue && !hasInterviewCue && words.length <= 6) return true;

  // Medium segments (7–12 words) also need at least one signal
  if (!hasQuestionCue && !hasInterviewCue && words.length <= 12) return true;

  return false;
}

function extractStrictInterviewerQuestion(raw: string): string {
  const input = String(raw || "").trim();
  if (!input) return "";

  const normalized = input.replace(/\r\n/g, "\n");
  const segments = normalized
    .split(/\n+/)
    .flatMap((line) => line.split("|"))
    .map((s) => s.trim())
    .filter(Boolean);

  if (!segments.length) return "";

  let best = "";
  let bestScore = -1e9;
  for (let i = 0; i < segments.length; i++) {
    let s = segments[i];
    const isInterviewerLine = /^interviewer\s*:/i.test(s);
    const isCandidateLine = /^candidate\s*:/i.test(s);
    if (isCandidateLine) continue;
    s = s.replace(/^interviewer\s*:\s*/i, "").trim();
    if (!s) continue;
    if (looksLikeNoiseSegment(s)) continue;

    const q = s.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
    const words = q.split(" ").filter(Boolean).length;
    const hasQMark = s.includes("?");
    const startsQuestion = /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|tell|walk|explain|describe|share|give|talk|are you|have you|your experience|your background)\b/.test(q);
    const directWhDefinition = /^(what is|what's|define|explain)\b/.test(q);
    const hasInterviewCue = /\b(experience|project|worked|role|responsibility|domain|process|stakeholder|analysis|business|technical|start date|end date|month|year)\b/.test(q);
    const qTokens = q.split(/\s+/).filter((w) => w.length >= 4);
    const uniqueTokenCount = new Set(qTokens).size;
    const hasCompoundJoiner = /\b(and|also|as well as)\b/.test(q);
    const punctuationSplitCount = s.split(/[?,]/).map((p) => p.trim()).filter(Boolean).length;
    const multiClauseBonus = punctuationSplitCount >= 2 ? Math.min(40, (punctuationSplitCount - 1) * 12) : 0;
    const partialStub = /^(when did you|do you have|what was your|have you worked with|tell me about)\s*$/.test(q)
      || isDanglingStub(q);

    // #6: candidate self-talk penalty — these patterns are almost never interviewer questions
    const isCandidateSelfTalk = /^(i have|i worked|i built|i implemented|i used|i developed|i created|i led|i managed|in my experience|at my previous|at my last|we built|we used|we implemented|my role|my project|my team|my experience)\b/.test(q);
    // #8: cased tech term boost — post-ASR correction, cased terms signal real interview content
    const hasCasedTechTerm = /\b(AWS|Azure|GCP|React|Python|Java|TypeScript|Docker|Kubernetes|Redis|Kafka|Flask|Django|FastAPI|GraphQL|PostgreSQL|MongoDB|Spring|Terraform|Ansible|Jenkins|Node\.?js|Angular|Vue)\b/.test(s);
    // #3: standalone tech entity — 1-3 word segment with just a tech name = implicit "tell me about X"
    const isImplicitTechQuestion = words <= 3 && hasCasedTechTerm && !isCandidateSelfTalk;

    let score = 0;
    score += hasQMark ? 80 : 0;
    score += startsQuestion ? 50 : 0;
    score += (directWhDefinition && words >= 3 && words <= 8) ? 85 : 0;
    score += hasInterviewCue ? 35 : 0;
    score += Math.min(50, Math.floor(uniqueTokenCount / 2) * 6);
    score += (hasCompoundJoiner && words >= 6) ? 30 : 0;
    score += multiClauseBonus;
    score += isInterviewerLine ? 40 : 0;
    score += Math.max(0, 30 - Math.abs(words - 14));
    score += i * 8; // stronger recency bias: later segments are newer
    score += hasCasedTechTerm ? 25 : 0; // #8: cased tech term boost
    score += isImplicitTechQuestion ? 60 : 0; // #3: standalone tech entity = implicit question
    score -= partialStub ? 120 : 0;
    score -= isCandidateSelfTalk ? 150 : 0; // #6: penalise candidate self-talk heavily
    // Keep short direct questions (e.g. "what is mvcc?") from getting buried.
    const isKnownFollowUpPhrase = KNOWN_FOLLOWUP_RE.test(q) || /^(elaborate|explain|show me|tell me more|go on|keep going|more detail|give an example|can you expand|can you clarify|walk me through that|break it down|expand on that|zoom in|dig deeper)\b/i.test(q);
    if (words <= 3 && !(hasQMark || startsQuestion) && !isKnownFollowUpPhrase && !isImplicitTechQuestion) score -= 80;
    if (words <= 2 && !hasQMark && !isKnownFollowUpPhrase && !isImplicitTechQuestion) score -= 50;

    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }

  // Reject the best candidate if it's still a dangling stub — return "" so the caller
  // falls back to the last unanswered interviewer question instead.
  if (best && isDanglingStub(best.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim())) {
    return "";
  }
  if (best) {
    // Expand standalone tech term to a full question so the LLM has clear intent
    const bestNorm = best.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    if (KNOWN_TECH_TERM_RE.test(bestNorm)) {
      return `Do you have experience in ${best}?`;
    }
    return best;
  }

  // Fallback 1: latest explicit question-like segment.
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i].replace(/^interviewer\s*:\s*/i, "").trim();
    if (!s || looksLikeNoiseSegment(s)) continue;
    const q = s.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
    if (isDanglingStub(q)) continue; // skip dangling stubs in fallback too
    if (s.includes("?") || /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|tell|walk|explain)\b/.test(q)) {
      return s;
    }
  }

  // Fallback 2: latest non-noise segment.
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i].replace(/^interviewer\s*:\s*/i, "").trim();
    if (!s || looksLikeNoiseSegment(s)) continue;
    return s;
  }

  return "";
}

function safeSend(ws: WebSocket, payload: unknown) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch (err: any) {
    console.error("[ws/answer] send failed:", err.message);
  }
}

async function resolveUserId(req: IncomingMessage): Promise<string> {
  try {
    const cookieHeader = req.headers.cookie || "";
    const sessionMatch = cookieHeader.match(/connect\.sid=([^;]+)/);
    if (!sessionMatch) return "";
    const sid = decodeURIComponent(sessionMatch[1]);
    const rawSid = sid.startsWith("s:") ? sid.slice(2).split(".")[0] : sid;
    const { pool } = await import("../db");
    const result = await pool.query("SELECT sess FROM session WHERE sid = $1", [rawSid]);
    if (result.rows.length === 0) return "";
    const sess = typeof result.rows[0].sess === "string" ? JSON.parse(result.rows[0].sess) : result.rows[0].sess;
    return sess.userId || "";
  } catch {
    return "";
  }
}


export function setupWsAnswer(httpServer: Server): void {
  const wss = new WebSocketServer({ noServer: true });
  const activeBySession = new Map<string, AnswerSession>();
  const recentQuestionFingerprints = new Map<string, Array<{ fp: string; ts: number }>>();
  const lastQuestionBySession = new Map<string, string>(); // for continuation stitching

  const TECH_TOKEN_RE = /\b(react|python|java|javascript|typescript|aws|azure|gcp|docker|kubernetes|redis|kafka|flask|django|fastapi|sql|nosql|mongodb|postgres|spring|node|angular|vue|terraform|ansible|graphql|microservice|devops|agile|scrum|ci.?cd|git|linux|bash)\b/gi;
  const extractTechTokens = (s: string): Set<string> =>
    new Set((s.match(TECH_TOKEN_RE) || []).map((t) => t.toLowerCase()));

  const isRecentDuplicate = (sessionId: string, fingerprint: string, now = Date.now()): boolean => {
    const list = recentQuestionFingerprints.get(sessionId) || [];
    const newTech = extractTechTokens(fingerprint);
    for (const item of list) {
      if ((now - item.ts) > 12000) continue;
      if (levenshteinSimilarity(fingerprint, item.fp) < 0.85) continue;
      // Same text fingerprint — but if tech topics are completely different, allow it through
      const oldTech = extractTechTokens(item.fp);
      if (newTech.size > 0 && oldTech.size > 0) {
        const overlap = [...newTech].filter((t) => oldTech.has(t)).length;
        if (overlap === 0) continue; // different topics — not a true duplicate
      }
      return true;
    }
    return false;
  };

  const rememberFingerprint = (sessionId: string, fingerprint: string, now = Date.now()) => {
    const current = recentQuestionFingerprints.get(sessionId) || [];
    const next = [{ fp: fingerprint, ts: now }, ...current.filter((x) => x.fp !== fingerprint)]
      .filter((x, idx) => idx < 20 && (now - x.ts) <= 12000);
    recentQuestionFingerprints.set(sessionId, next);
  };

  httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname !== "/ws") return;
    wss.handleUpgrade(req, socket as any, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    const userId = await resolveUserId(req);
    if (!userId) {
      ws.close(4001, "Not authenticated");
      return;
    }

    const socketState = { userId, sessionId: "", requestId: "" };

    ws.on("message", async (raw: Buffer | string) => {
      try {
        const text = typeof raw === "string" ? raw : raw.toString("utf8");
        const msg = JSON.parse(text);
        const type = String(msg?.type || "");

        if (type === "session_start") {
          const sessionId = String(msg?.sessionId || "").trim();
          if (!sessionId) {
            safeSend(ws, { type: "error", sessionId: "", requestId: "", message: "Missing sessionId" });
            return;
          }
          if (msg?.userId && String(msg.userId) !== userId) {
            safeSend(ws, { type: "error", sessionId, requestId: "", message: "Unauthorized userId" });
            return;
          }
          const meeting = await storage.getMeeting(sessionId);
          if (!meeting || meeting.userId !== userId) {
            safeSend(ws, { type: "error", sessionId, requestId: "", message: "Unauthorized session" });
            return;
          }
          socketState.sessionId = sessionId;
          safeSend(ws, { type: "session_started", sessionId });
          return;
        }

        if (type === "cancel") {
          const sessionId = String(msg?.sessionId || socketState.sessionId || "").trim();
          if (!sessionId) return;
          abortSessionStream(sessionId);
          return;
        }

        if (type === "question") {
          const sessionId = String(msg?.sessionId || socketState.sessionId || "").trim();
          const rawQuestionText = String(msg?.text || "");
          const questionText = rawQuestionText.trim();
          const force = msg?.force === true;
          if (!sessionId) {
            safeSend(ws, { type: "error", sessionId, requestId: "", message: "Missing sessionId or text" });
            return;
          }

          const meeting = await storage.getMeeting(sessionId);
          if (!meeting || meeting.userId !== userId) {
            safeSend(ws, { type: "error", sessionId, requestId: "", message: "Unauthorized session" });
            return;
          }

          if (hasActiveStream(sessionId)) {
            console.log(`[ws/answer] replacing_active_stream sessionId=${sessionId} force=${force}`);
            abortSessionStream(sessionId);
          }

          const metadata = (msg?.metadata && typeof msg.metadata === "object") ? msg.metadata : {};
          const submitSource = typeof metadata.submitSource === "string" ? metadata.submitSource : "unknown";
          const multiQuestionMode = metadata.multiQuestionMode === true;
          const lastUnanswered = getLastUnansweredInterviewerQuestion(sessionId);
          const latestSpokenReply = getLatestSpokenReply(sessionId);
          const primarySeed =
            (multiQuestionMode
              ? questionText.trim()
              : (extractStrictInterviewerQuestion(questionText.trim()) || extractLatestMergedSegment(questionText.trim())));
          let questionForStream = primarySeed
            ? primarySeed
            : chooseBestQuestionSeed([lastUnanswered?.text, latestSpokenReply?.text, "[Continue]"]);

          // #2: Continuation stitching — "and also X" / "plus X" → stitch onto previous question
          const CONNECTOR_PREFIX = /^(and\s+also|and|also|plus|as\s+well\s+as|what\s+about|or)\s+/i;
          const connectorMatch = CONNECTOR_PREFIX.exec(questionForStream);
          if (connectorMatch) {
            const tail = questionForStream.slice(connectorMatch[0].length).trim();
            const prevQ = lastQuestionBySession.get(sessionId);
            if (prevQ && tail.length >= 2) {
              questionForStream = `${prevQ} and also ${tail}`;
              console.log(`[ws/answer] stitched continuation sessionId=${sessionId}`, { prevQ, tail, result: questionForStream });
            }
          }
          // #2b: Bare tech-topic stitching — "Flask", "Django", "AWS" (no joiner) → stitch onto previous question
          // Fires when the entire question is a short tech term without any question words.
          const QUESTION_WORD_RE = /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|is|are|tell|walk|explain)\b/i;
          const bareTopicOnly =
            !connectorMatch
            && !QUESTION_WORD_RE.test(questionForStream.trim())
            && !questionForStream.includes("?")
            && questionForStream.trim().split(/\s+/).filter(Boolean).length <= 4;
          if (bareTopicOnly) {
            const prevQ = lastQuestionBySession.get(sessionId);
            if (prevQ && QUESTION_WORD_RE.test(prevQ.trim())) {
              const prevNoQ = prevQ.replace(/\?\s*$/, "").trim();
              questionForStream = `${prevNoQ} and also ${questionForStream.trim()}?`;
              console.log(`[ws/answer] stitched bare topic sessionId=${sessionId}`, { prevQ, topic: questionForStream });
            }
          }
          // #4: Recency amplification — boost detection of topic that appeared in last answer
          // (stored below after answer completes; used here via lastQuestionBySession as proxy)
          lastQuestionBySession.set(sessionId, questionForStream);

          // Backend noise guard: reject partial/noisy ASR fragments that have no real question signal.
          // This is a safety net for cases where the frontend's gating passes too-short fragments.
          if (!force) {
            const lowerQuestion = questionForStream.trim().toLowerCase();
            // Block rhetorical check-ins where the interviewer is just confirming understanding
            if (/^(does\s+that\s+)?make\s+sense\??$/.test(lowerQuestion) || /^(are\s+you\s+)?following\??$/.test(lowerQuestion) || /^right\??$/.test(lowerQuestion) || /^you\s+know\??$/.test(lowerQuestion)) {
              console.log(`[ws/answer] rhetorical_checkin suppressed sessionId=${sessionId} text="${questionForStream.slice(0, 60)}"`);
              return;
            }

            const qWords = questionForStream.trim().split(/\s+/).filter(Boolean);
            const hasQuestionMark = questionForStream.includes("?");
            const hasQuestionWord = /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|is|are|tell|walk|explain|describe|share|give|talk)[\s,]/i.test(questionForStream.trim());
            const isKnownFollowUp = KNOWN_FOLLOWUP_RE.test(lowerQuestion);
            const hasInterviewSignal = /\b(experience|worked|familiar|background|explain|tell me about|walk me through|have you used|have you ever|your thoughts on|describe a time|trade-?offs?|pros and cons|optimize|scale|complexity)\b/i.test(questionForStream);
            // Reject if fewer than 3 words and no clear question signal
            if (qWords.length < 3 && !hasQuestionMark && !hasQuestionWord && !isKnownFollowUp && !hasInterviewSignal) {
              console.log(`[ws/answer] noise_guard suppressed sessionId=${sessionId} words=${qWords.length} text="${questionForStream.slice(0, 60)}"`);
              return;
            }
            // Also reject very short fragments (1 word) that would have no context
            if (qWords.length <= 1 && !hasQuestionMark && !isKnownFollowUp) {
              console.log(`[ws/answer] noise_guard suppressed single-word sessionId=${sessionId} text="${questionForStream.slice(0, 60)}"`);
              return;
            }
          }

          const fp = normalizeQuestionForSimilarity(questionForStream);
          if (!fp) return;
          if (!force && isRecentDuplicate(sessionId, fp)) {
            console.log(`[ws/answer] duplicate suppressed sessionId=${sessionId} fp="${fp.slice(0, 60)}"`);
            return;
          }
          rememberFingerprint(sessionId, fp);
          recordUserQuestion(sessionId, questionForStream);
          console.log(
            `[ws/answer] question sessionId=${sessionId} userId=${userId} chars=${questionForStream.length} force=${force} source=${submitSource} multi=${multiQuestionMode}`,
            {
              preview: questionForStream.slice(0, 160),
              transport: "ws",
            },
          );

          const docsModeRaw = typeof msg?.docsMode === "string"
            ? msg.docsMode
            : (typeof msg?.metadata?.docsMode === "string" ? msg.metadata.docsMode : "");
          const docsMode = docsModeRaw === "always" || docsModeRaw === "off" ? docsModeRaw : "auto";
          socketState.sessionId = sessionId;

          const wsAbortController = new AbortController();
          const onSocketClose = () => {
            wsAbortController.abort();
            abortSessionStream(sessionId);
          };
          ws.once("close", onSocketClose);

          const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          socketState.requestId = requestId;
          activeBySession.set(sessionId, { ws, userId, sessionId, requestId });
          safeSend(ws, { type: "assistant_start", sessionId, requestId });
          console.log(`[ws/answer] assistant_start sessionId=${sessionId} requestId=${requestId}`);

          const generator = streamAssistantAnswer({
            meetingId: sessionId,
            userId,
            question: questionForStream,
            format: typeof msg?.format === "string" ? msg.format : undefined,
            customFormatPrompt: typeof msg?.metadata?.customFormatPrompt === "string" ? msg.metadata.customFormatPrompt : undefined,
            quickMode: typeof msg?.quickMode === "boolean" ? msg.quickMode : undefined,
            docsMode,
            meeting,
            model: typeof msg?.model === "string" ? msg.model : undefined,
            transport: "ws",
            abortSignal: wsAbortController.signal,
            maxTokensOverride: 260,
            temperatureOverride: 0.2,
            requestIdOverride: requestId,
            submitSource,
            lastInterviewerQuestion: typeof metadata?.lastInterviewerQuestion === "string" ? metadata.lastInterviewerQuestion : undefined,
            recentSpokenReply: typeof metadata?.recentSpokenReply === "string" ? metadata.recentSpokenReply : undefined,
            sessionJobDescription: typeof metadata?.jobDescription === "string" ? metadata.jobDescription : undefined,
            sessionSystemPrompt: typeof metadata?.systemPrompt === "string" ? metadata.systemPrompt : undefined,
            liveTranscript: typeof metadata?.liveTranscript === "string" ? metadata.liveTranscript : undefined,
          });

          let emittedChunkCount = 0;
          let emittedCharCount = 0;
          let activeRequestId = requestId;
          let fastCancelled = false;
          // Accumulate fast answer text so the refinement pass can check it against the rubric
          let fastAnswerText = "";
          for await (const event of generator) {
            if (event.type === "start") {
              activeRequestId = event.requestId;
              continue;
            }
            if (event.type === "chunk") {
              emittedChunkCount += 1;
              const chunkText = String(event.text || "");
              emittedCharCount += chunkText.length;
              fastAnswerText += chunkText;
              safeSend(ws, { type: "assistant_chunk", sessionId, requestId: event.requestId, text: chunkText });
              console.log(`[ws/answer] assistant_chunk sessionId=${sessionId} requestId=${event.requestId} chunk=${emittedChunkCount} chars=${chunkText.length}`);
              continue;
            }
            if (event.type === "end") {
              fastCancelled = !!event.cancelled;
              if (emittedChunkCount === 0) {
                const fallbackText = String(event.response?.answer || "").trim()
                  || "I need a bit more context to answer that precisely. Could you clarify the question?";
                emittedChunkCount += 1;
                emittedCharCount += fallbackText.length;
                fastAnswerText += fallbackText;
                safeSend(ws, { type: "assistant_chunk", sessionId, requestId: event.requestId, text: fallbackText });
                console.warn(
                  `[ws/answer] forced_fallback_chunk sessionId=${sessionId} requestId=${event.requestId} chars=${fallbackText.length}`,
                );
              }
              safeSend(ws, { type: "assistant_end", sessionId, requestId: event.requestId, cancelled: !!event.cancelled });
              console.log(`[ws/answer] assistant_end sessionId=${sessionId} requestId=${event.requestId} total_chunks=${emittedChunkCount} total_chars=${emittedCharCount} cancelled=${!!event.cancelled}`);
              continue;
            }
            if (event.type === "error") {
              safeSend(ws, { type: "error", sessionId, requestId: event.requestId, message: event.message || "stream failed" });
            }
          }

          // --- TYPED REFINEMENT PASS ---
          // Classify the question into a technical subtype and fire a second full-context
          // stream with a subtype-specific rubric checklist. The rubric tells the model exactly
          // what is required for that question type (complexity for DSA, trade-offs for system
          // design, change markers for code modification, etc.) so the final answer is complete
          // against the same criteria the interviewer is mentally evaluating.
          const hasCodingContext = Boolean(getCodingProblemState(sessionId));
          const refineConfig = !fastCancelled && ws.readyState === WebSocket.OPEN
            ? getRefineConfig(questionForStream, hasCodingContext)
            : null;

          if (refineConfig) {
            const refineId = `${requestId}-r`;
            safeSend(ws, { type: "assistant_refine_start", sessionId, requestId: refineId });
            console.log(`[ws/answer] refine_start sessionId=${sessionId} refineId=${refineId} subtype=${refineConfig.subtype}`);

            const refineContext = buildRefineContext(refineConfig.subtype, fastAnswerText, sessionId);

            const refineGenerator = streamAssistantAnswer({
              meetingId: sessionId,
              userId,
              question: questionForStream,
              format: typeof msg?.format === "string" ? msg.format : undefined,
              customFormatPrompt: typeof msg?.metadata?.customFormatPrompt === "string" ? msg.metadata.customFormatPrompt : undefined,
              quickMode: false,
              docsMode,
              meeting,
              model: typeof msg?.model === "string" ? msg.model : undefined,
              transport: "ws",
              abortSignal: wsAbortController.signal,
              maxTokensOverride: refineConfig.maxTokens,
              temperatureOverride: refineConfig.temperature,
              requestIdOverride: refineId,
              submitSource,
              lastInterviewerQuestion: typeof metadata?.lastInterviewerQuestion === "string" ? metadata.lastInterviewerQuestion : undefined,
              recentSpokenReply: typeof metadata?.recentSpokenReply === "string" ? metadata.recentSpokenReply : undefined,
              sessionJobDescription: typeof metadata?.jobDescription === "string" ? metadata.jobDescription : undefined,
              sessionSystemPrompt: typeof metadata?.systemPrompt === "string" ? metadata.systemPrompt : undefined,
              liveTranscript: typeof metadata?.liveTranscript === "string" ? metadata.liveTranscript : undefined,
              refineContext,
            });

            let refineChunks = 0;
            for await (const event of refineGenerator) {
              if (ws.readyState !== WebSocket.OPEN) break;
              if (event.type === "chunk") {
                refineChunks += 1;
                safeSend(ws, { type: "assistant_refine_chunk", sessionId, requestId: refineId, text: String(event.text || "") });
              }
              if (event.type === "end") {
                safeSend(ws, { type: "assistant_refine_end", sessionId, requestId: refineId, cancelled: !!event.cancelled });
                console.log(`[ws/answer] refine_end sessionId=${sessionId} refineId=${refineId} subtype=${refineConfig.subtype} chunks=${refineChunks} cancelled=${!!event.cancelled}`);
              }
            }
          }
          // --- END TYPED REFINEMENT ---

          // Emit structured_response so the client can use pre-parsed sections
          // instead of re-parsing the raw text client-side.
          if (ws.readyState === WebSocket.OPEN && fastAnswerText) {
            try {
              const structured = parseResponse(fastAnswerText);
              if (structured.meta.hasCode || structured.sections.length > 1) {
                safeSend(ws, {
                  type: "structured_response",
                  sessionId,
                  requestId,
                  data: structured,
                });
              }
            } catch {
              // non-fatal — client falls back to raw text parsing
            }
          }

          ws.off("close", onSocketClose);
          const current = activeBySession.get(sessionId);
          if (current?.requestId === activeRequestId) {
            activeBySession.delete(sessionId);
          }
          socketState.requestId = "";
          return;
        }
      } catch (err: any) {
        safeSend(ws, {
          type: "error",
          sessionId: socketState.sessionId || "",
          requestId: socketState.requestId || "",
          message: err?.message || "Invalid message",
        });
      }
    });

    ws.on("close", () => {
      const sessionId = socketState.sessionId;
      if (sessionId) {
        const current = activeBySession.get(sessionId);
        if (current && current.ws === ws) {
          activeBySession.delete(sessionId);
        }
      }
    });
  });
}
