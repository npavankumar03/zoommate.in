import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import { storage } from "../storage";
import { runDetectionPipeline } from "../assist/questionDetect";
import { formatMemorySlotsForPrompt } from "../memoryExtractor";
import { URL } from "url";

interface SttSession {
  ws: WebSocket;
  userId: string;
  meetingId: string;
  turnIndex: number;
  currentPartial: string;
  lastPartialAt: number;
  silenceTimer: ReturnType<typeof setTimeout> | null;
  silenceMs: number;
  confidenceThreshold: number;
  finalized: boolean;
  googleStream: any | null;
  useGoogleStt: boolean;
  turnBuffer: string[];
  lastFinalAt: number;
  turnBoundaryTimer: ReturnType<typeof setTimeout> | null;
  currentSpeaker: number; // diarization speaker tag (1 = first speaker, 2 = second, etc.)
  speakerHistory: Array<{ tag: number; count: number }>; // track which tag is interviewer
  isEarlyFire: boolean;   // true while handleFinal is being called from a high-stability interim
  earlyFiredAt: number;   // timestamp of last early fire (0 = none)
}

// ── Tech vocabulary hints for Google STT speechContexts ──────────────────────
// Sending these phrases boosts recognition accuracy for commonly misheared terms.
const TECH_SPEECH_CONTEXT = {
  phrases: [
    // Frameworks & languages
    "Flask", "Django", "FastAPI", "React", "Angular", "Vue", "Next.js", "Node.js",
    "TypeScript", "JavaScript", "Python", "Java", "Golang", "Rust", "Kotlin", "Swift",
    "Spring Boot", "Spring", "Hibernate", "Maven", "Gradle",
    // Cloud & DevOps
    "AWS", "Azure", "GCP", "Google Cloud", "Amazon Web Services",
    "EC2", "S3", "Lambda", "RDS", "DynamoDB", "CloudWatch", "IAM", "EKS", "ECS",
    "Kubernetes", "Docker", "Terraform", "Ansible", "Jenkins", "CI/CD",
    "GitHub Actions", "GitLab CI", "ArgoCD", "Helm",
    // Databases
    "PostgreSQL", "MySQL", "MongoDB", "Redis", "Elasticsearch", "Cassandra",
    "DynamoDB", "Firebase", "SQLAlchemy", "Prisma", "Sequelize",
    // Messaging & streaming
    "Kafka", "RabbitMQ", "Celery", "SQS", "SNS", "Pub/Sub",
    // ML / AI
    "PyTorch", "TensorFlow", "scikit-learn", "Pandas", "NumPy", "Jupyter",
    "PySpark", "Spark", "Apache Spark", "Spark SQL", "Databricks",
    "LangChain", "LLM", "RAG", "vector database", "Pinecone", "Weaviate",
    // Architecture patterns
    "microservices", "REST API", "GraphQL", "gRPC", "WebSocket",
    "event driven", "CQRS", "domain driven design", "design patterns",
    "system design", "distributed systems", "load balancer", "API gateway",
    // Testing & tooling
    "pytest", "JUnit", "Jest", "Selenium", "Postman", "Swagger",
    "TDD", "BDD", "unit test", "integration test", "end to end test",
    // Other common terms
    "OAuth", "JWT", "SAML", "LDAP", "SSL", "TLS",
    "Agile", "Scrum", "Kanban", "Jira", "Confluence", "Bitbucket",
    "do you have experience", "have you worked with", "tell me about",
    "walk me through", "your experience with", "are you familiar with",
  ],
  boost: 15,
};

// ── Word timestamp helpers ────────────────────────────────────────────────────
function wordTimeToMs(wt: any): number {
  if (!wt) return 0;
  const secs = parseInt(String(wt.seconds || "0"), 10);
  const nanos = parseInt(String(wt.nanos || "0"), 10);
  return secs * 1000 + Math.floor(nanos / 1_000_000);
}

function splitByPauses(words: any[], pauseThresholdMs = 500): Array<{ text: string; speakerTag: number }> {
  if (!words || words.length === 0) return [];
  const segments: Array<{ text: string; speakerTag: number }> = [];
  let current: string[] = [];
  let currentSpeaker = words[0]?.speakerTag || 0;
  let prevEndMs = 0;

  for (const word of words) {
    const startMs = wordTimeToMs(word.startTime);
    const endMs = wordTimeToMs(word.endTime);
    const pause = current.length > 0 ? startMs - prevEndMs : 0;
    const speakerChanged = word.speakerTag && word.speakerTag !== currentSpeaker && currentSpeaker !== 0;

    if ((pause > pauseThresholdMs || speakerChanged) && current.length > 0) {
      segments.push({ text: current.join(" "), speakerTag: currentSpeaker });
      current = [];
      currentSpeaker = word.speakerTag || currentSpeaker;
    }
    current.push(String(word.word || ""));
    prevEndMs = endMs;
  }

  if (current.length > 0) {
    segments.push({ text: current.join(" "), speakerTag: currentSpeaker });
  }
  return segments.filter((s) => s.text.trim().length > 0);
}

const activeSessions = new Map<string, SttSession>();

export function getActiveSttSessions(): Map<string, SttSession> {
  return activeSessions;
}

let googleSpeechClient: any = null;

async function getGoogleSpeechClient(): Promise<any | null> {
  try {
    const credsJson = await storage.getSetting("google_stt_credentials");
    if (!credsJson) return null;
    const { SpeechClient } = await import("@google-cloud/speech");
    if (!googleSpeechClient) {
      const creds = JSON.parse(credsJson);
      googleSpeechClient = new SpeechClient({ credentials: creds });
    }
    return googleSpeechClient;
  } catch {
    return null;
  }
}

export function setupWsStt(httpServer: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname !== "/ws/stt") return;
    wss.handleUpgrade(req, socket as any, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const meetingId = url.searchParams.get("sessionId") || url.searchParams.get("meetingId") || "";
    const silenceMs = parseInt(url.searchParams.get("silenceMs") || "250", 10);
    const confidenceThreshold = parseFloat(url.searchParams.get("confidenceThreshold") || "0.65");

    let userId = "";
    try {
      const cookieHeader = req.headers.cookie || "";
      const sessionMatch = cookieHeader.match(/connect\.sid=([^;]+)/);
      if (sessionMatch) {
        const sid = decodeURIComponent(sessionMatch[1]);
        const rawSid = sid.startsWith("s:") ? sid.slice(2).split(".")[0] : sid;
        const { pool } = await import("../db");
        const result = await pool.query("SELECT sess FROM session WHERE sid = $1", [rawSid]);
        if (result.rows.length > 0) {
          const sess = typeof result.rows[0].sess === "string" ? JSON.parse(result.rows[0].sess) : result.rows[0].sess;
          userId = sess.userId || "";
        }
      }
    } catch (err: any) {
      console.error("[ws/stt] Auth error:", err.message);
    }

    if (!userId) {
      ws.close(4001, "Not authenticated");
      return;
    }
    if (!meetingId) {
      ws.close(4002, "Missing sessionId parameter");
      return;
    }

    const meeting = await storage.getMeeting(meetingId);
    if (!meeting || meeting.userId !== userId) {
      ws.close(4003, "Unauthorized");
      return;
    }

    const sessionKey = `${meetingId}:${userId}`;
    const existing = activeSessions.get(sessionKey);
    if (existing) {
      if (existing.silenceTimer) clearTimeout(existing.silenceTimer);
      if (existing.googleStream) {
        try { existing.googleStream.end(); } catch {}
      }
      existing.ws.close(4004, "Replaced by new connection");
    }

    const sttSession: SttSession = {
      ws,
      userId,
      meetingId,
      turnIndex: 0,
      currentPartial: "",
      lastPartialAt: Date.now(),
      silenceTimer: null,
      silenceMs: Math.max(100, Math.min(silenceMs, 600)),
      confidenceThreshold,
      finalized: false,
      googleStream: null,
      useGoogleStt: false,
      turnBuffer: [],
      lastFinalAt: Date.now(),
      turnBoundaryTimer: null,
      currentSpeaker: 0,
      speakerHistory: [],
      isEarlyFire: false,
      earlyFiredAt: 0,
    };

    activeSessions.set(sessionKey, sttSession);
    console.log(`[ws/stt] Connected: user=${userId} meeting=${meetingId}`);
    ws.send(JSON.stringify({ type: "connected", meetingId, silenceMs: sttSession.silenceMs }));

    ws.on("message", async (data: Buffer | string) => {
      try {
        if (typeof data === "string") {
          const msg = JSON.parse(data);
          if (msg.type === "config") {
            if (msg.silenceMs) sttSession.silenceMs = Math.max(200, Math.min(msg.silenceMs, 1000));
            if (msg.confidenceThreshold) sttSession.confidenceThreshold = msg.confidenceThreshold;
            return;
          }
          if (msg.type === "partial") {
            handlePartial(sttSession, msg.text, msg.confidence);
            return;
          }
          if (msg.type === "final") {
            await handleFinal(sttSession, msg.text, msg.confidence, msg.startMs, msg.endMs);
            return;
          }
          if (msg.type === "speech_started") {
            ws.send(JSON.stringify({ type: "speech_started" }));
            return;
          }
          if (msg.type === "start_google_stt") {
            await startGoogleStream(sttSession, msg.language || "en-US");
            return;
          }
          return;
        }

        if (Buffer.isBuffer(data) && data.length > 0) {
          if (sttSession.googleStream) {
            try {
              sttSession.googleStream.write({ audioContent: data });
            } catch {}
          }
          return;
        }

        handlePartial(sttSession, "", undefined);
      } catch (err: any) {
        console.error("[ws/stt] Message error:", err.message);
      }
    });

    ws.on("close", () => {
      if (sttSession.silenceTimer) clearTimeout(sttSession.silenceTimer);
      if (sttSession.googleStream) {
        try { sttSession.googleStream.end(); } catch {}
      }
      activeSessions.delete(sessionKey);
      if (sttSession.turnBoundaryTimer) clearTimeout(sttSession.turnBoundaryTimer);
      console.log(`[ws/stt] Disconnected: user=${userId} meeting=${meetingId}`);
    });

    ws.on("error", (err) => {
      console.error("[ws/stt] WS error:", err.message);
    });
  });
}

async function startGoogleStream(session: SttSession, language: string): Promise<void> {
  const client = await getGoogleSpeechClient();
  if (!client) {
    session.ws.send(JSON.stringify({ type: "error", message: "Google Cloud STT not configured. Using browser speech recognition instead." }));
    return;
  }

  if (session.googleStream) {
    try { session.googleStream.end(); } catch {}
  }

  try {
    const recognizeStream = client.streamingRecognize({
      config: {
        encoding: "LINEAR16",
        sampleRateHertz: 16000,
        languageCode: language,
        enableAutomaticPunctuation: true,
        model: "video",
        useEnhanced: true,
        enableWordTimeOffsets: true,
        enableWordConfidence: true,
        speechContexts: [TECH_SPEECH_CONTEXT],
        diarizationConfig: {
          enableSpeakerDiarization: true,
          minSpeakerCount: 2,
          maxSpeakerCount: 2,
        },
      },
      interimResults: true,
    });

    recognizeStream.on("data", (data: any) => {
      if (!data.results || data.results.length === 0) return;
      const result = data.results[0];
      const transcript = result.alternatives?.[0]?.transcript || "";
      const confidence = result.alternatives?.[0]?.confidence || 0.7;
      if (!transcript.trim()) return;

      if (result.isFinal) {
        // Drop low-confidence results — likely background noise or unintelligible audio.
        // Google STT only returns confidence on final results; 0 means it wasn't provided (treat as ok).
        const hasLowConfidence = confidence > 0 && confidence < 0.55;
        const isShortNoise = transcript.trim().split(/\s+/).length < 4;
        if (hasLowConfidence && isShortNoise) {
          console.log(`[ws/stt] Dropped low-confidence result conf=${confidence.toFixed(2)}: "${transcript.slice(0, 40)}"`);
          return;
        }

        const words = result.alternatives?.[0]?.words || [];
        if (words.length > 0) {
          // Split by pauses and speaker changes; handle each segment independently
          const segments = splitByPauses(words, 500);
          for (const seg of segments) {
            if (!seg.text.trim()) continue;
            // Track speaker — tag 1 is typically the interviewer (first/dominant speaker)
            if (seg.speakerTag && seg.speakerTag !== session.currentSpeaker) {
              session.currentSpeaker = seg.speakerTag;
            }
            void handleFinal(session, seg.text.trim(), confidence);
          }
        } else {
          void handleFinal(session, transcript.trim(), confidence);
        }
      } else {
        const stability = result.stability || 0;
        const text = transcript.trim();
        const now = Date.now();

        // Early-fire: stability >= 0.85, meaningful length, no recent early fire within 2s
        if (
          stability >= 0.85 &&
          text.length > 20 &&
          now - session.earlyFiredAt > 2000 &&
          now - session.lastFinalAt > 500
        ) {
          console.log(`[ws/stt] Early-fire at stability=${stability.toFixed(2)}: "${text.slice(0, 60)}"`);
          session.isEarlyFire = true;
          session.earlyFiredAt = now;
          void handleFinal(session, text, confidence);
        } else {
          handlePartial(session, text, stability || confidence);
        }
      }
    });

    recognizeStream.on("error", (err: any) => {
      console.error("[ws/stt] Google STT stream error:", err.message);
      session.googleStream = null;
      if (err.code === 11) {
        setTimeout(() => void startGoogleStream(session, language), 500);
      }
    });

    recognizeStream.on("end", () => {
      session.googleStream = null;
    });

    session.googleStream = recognizeStream;
    session.useGoogleStt = true;
    session.ws.send(JSON.stringify({ type: "google_stt_started" }));
  } catch (err: any) {
    console.error("[ws/stt] Failed to start Google STT:", err.message);
    session.ws.send(JSON.stringify({ type: "error", message: "Failed to start Google STT: " + err.message }));
  }
}

function handlePartial(session: SttSession, text: string, confidence?: number) {
  if (text) {
    session.currentPartial = text;
    session.lastPartialAt = Date.now();
  }

  if (session.ws.readyState === WebSocket.OPEN && text) {
    session.ws.send(JSON.stringify({
      type: "stt_partial",
      text,
      stability: confidence || 0.5,
      confidence: confidence || 0.5,
    }));
  }

  if (session.silenceTimer) clearTimeout(session.silenceTimer);
  session.silenceTimer = setTimeout(() => {
    if (session.currentPartial && session.currentPartial.trim().length > 2) {
      void handleFinal(session, session.currentPartial, undefined, undefined, undefined);
    }
  }, session.silenceMs);
}

async function handleFinal(session: SttSession, text: string, confidence?: number, startMs?: number, endMs?: number) {
  if (!text || text.trim().length < 2) return;

  // Capture and immediately clear the early-fire flag
  const isEarlyFire = session.isEarlyFire;
  session.isEarlyFire = false;

  // If this is the real isFinal arriving after an early fire within 800ms:
  // - If the turn boundary timer is still pending (detection hasn't run), swap in the final
  //   (more accurate) text. Otherwise just skip to avoid a double answer.
  if (!isEarlyFire && session.earlyFiredAt > 0 && Date.now() - session.earlyFiredAt < 800) {
    if (session.turnBoundaryTimer) {
      // Timer still pending — replace early text in buffer with the final transcript
      session.turnBuffer = [text.trim()];
    }
    // Either way, let the already-scheduled timer handle it; don't push again
    return;
  }

  if (session.silenceTimer) {
    clearTimeout(session.silenceTimer);
    session.silenceTimer = null;
  }

  session.turnBuffer.push(text.trim());
  session.lastFinalAt = Date.now();
  session.currentPartial = "";

  if (session.turnBoundaryTimer) clearTimeout(session.turnBoundaryTimer);

  session.turnBoundaryTimer = setTimeout(async () => { // was 800ms
    if (session.turnBuffer.length === 0) return;

    const fullTurn = session.turnBuffer.join(" ");
    session.turnBuffer = [];
    const turnIndex = session.turnIndex++;

    // Determine speaker label from diarization tag
    // Tag 1 = first/dominant speaker (usually interviewer in 2-speaker setup)
    const speakerLabel = session.currentSpeaker === 1 ? "interviewer"
      : session.currentSpeaker === 2 ? "candidate"
      : "unknown";

    if (session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: "stt_final",
        text: fullTurn,
        turnIndex,
        confidence: confidence || 0.8,
        speakerTag: session.currentSpeaker || 0,
        speaker: speakerLabel,
      }));
    }

    const meeting = await storage.getMeeting(session.meetingId);
    if (meeting && meeting.saveTranscript) {
      storage.createTranscriptTurn({
        meetingId: session.meetingId,
        turnIndex,
        speaker: speakerLabel,
        text: fullTurn,
        startMs: startMs || null,
        endMs: endMs || null,
        confidence: confidence || null,
        isQuestion: false,
        questionType: null,
        cleanQuestion: null,
      }).catch((err: any) => console.error("[ws/stt] Failed to persist turn:", err.message));
    }

    try {
      const recentTurns = await storage.getRecentTranscriptTurns(session.meetingId, 4);
      const recentContext = recentTurns.reverse().map(t => t.text).join("\n");
      const memoryContext = await formatMemorySlotsForPrompt(session.userId, session.meetingId);

      const result = await runDetectionPipeline(
        fullTurn,
        recentContext,
        memoryContext,
        session.meetingId,
        0.5,
      );

      const hasConfidence = result.confidence >= 0.5;

      if (result.isQuestion && hasConfidence) {
        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.send(JSON.stringify({
            type: "question_detected",
            rawText: result.rawText,
            cleanQuestion: result.cleanQuestion,
            questionType: result.type,
            confidence: result.confidence,
            turnIndex,
          }));
        }

        if (meeting && meeting.saveTranscript) {
          storage.createTranscriptTurn({
            meetingId: session.meetingId,
            turnIndex,
            speaker: "interviewer",
            text: fullTurn,
            startMs: startMs || null,
            endMs: endMs || null,
            confidence: result.confidence,
            isQuestion: true,
            questionType: result.type,
            cleanQuestion: result.cleanQuestion,
          }).catch(() => {});
        }
      }
    } catch (err: any) {
      console.error("[ws/stt] Detection pipeline error:", err.message);
    }
  }, 300);
}
