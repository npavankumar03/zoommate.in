import { useState, useEffect, useRef, useCallback, memo } from "react";
import { Link, useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Meeting, Response, MemorySlot, AnswerStyle } from "@shared/schema";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { DebugPanel, type DebugPanelData } from "@/components/debug-panel";
import { ReadingPane } from "@/components/reading-pane";
import { LiveCodeEditor } from "@/components/live-code-editor";
import {
  detectQuestion,
  detectQuestionAdvanced,
  normalizeForDedup,
  normalizeQuestionForSimilarity,
  levenshteinSimilarity,
  isSubstantiveSegment,
} from "@shared/questionDetection";
import { isFollowUp } from "@shared/followup";
import { AzureRecognizer, checkAzureAvailability } from "@/lib/stt/azureRecognizer";
import { getSocket } from "@/realtime/socketClient";
import {
  Zap, Mic, MicOff, Monitor, Send, Square,
  MessageSquare, Copy, Check, Sparkles, Loader2,
  Eye, Minimize2, Maximize2, Brain, Radio,
  Download, Trash2, Cloud, ScanSearch, ImagePlus, Database,
  CheckCircle, Star, XCircle, Plus, Images, X
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type AudioMode = "mic" | "system";
type DocsMode = "auto" | "always" | "off";
type SubmitSeedSource = "interpreted" | "transcript" | "memory-followup" | "fallback";
type ScreenShareWindow = Window & {
  __zoommateVisionStream?: MediaStream | null;
};
type WindowWithImageCapture = Window & {
  ImageCapture?: new (track: MediaStreamTrack) => {
    grabFrame: () => Promise<ImageBitmap>;
  };
};
type ScreenPreviewPopupWindow = Window & {
  __zoommatePreviewVideo?: HTMLVideoElement | null;
  __zoommatePreviewLabel?: HTMLDivElement | null;
};
type LatestScreenContext = {
  displayQuestion: string;
  promptQuestion: string;
  answer: string;
  capturedAt: number;
};

type VideoFrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
};

const SCREEN_CAPTURE_MAX_WIDTH = 1400;
const SCREEN_CAPTURE_JPEG_QUALITY = 0.72;
const TRANSCRIPT_GROUPING_MS = 10_000;

function isLikelyInterviewTopic(raw: string): boolean {
  const text = String(raw || "").toLowerCase().replace(/[^\w\s.+#/-]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 5) return false;

  const exactAllow = new Set([
    "python", "java", "javascript", "typescript", "react", "angular", "vue", "node", "nodejs",
    "fastapi", "django", "flask", "spring", "springboot", "dotnet", ".net", "c#", "c++", "cpp",
    "sql", "mysql", "postgres", "postgresql", "mongodb", "oracle", "redis", "graphql", "rest",
    "rest api", "rest apis", "api", "apis", "aws", "azure", "gcp", "docker", "kubernetes",
    "microservices", "system design", "data structures", "algorithms", "llm", "openai",
    "machine learning", "ai", "devops", "terraform", "jenkins", "git", "linux",
    "html", "css", "bootstrap", "tailwind", "nextjs", "next.js", "express", "nestjs", "node.js",
    "pandas", "numpy", "pytest", "unittest", "selenium", "playwright", "postman", "swagger",
    "grpc", "websocket", "websockets", "rabbitmq", "kafka", "elasticsearch", "opensearch",
    "snowflake", "databricks", "pyspark", "spark", "hadoop", "airflow", "etl", "ci/cd",
    "github actions", "gitlab", "bitbucket", "ansible", "prometheus", "grafana", "splunk",
    "oauth2", "oidc", "jwt", "sso", "saml", "okta", "keycloak", "postgresql", "sqlalchemy",
    "alembic", "pydantic", "asyncio", "celery", "langchain", "anthropic", "rag", "vector db",
    "pinecone", "qdrant", "weaviate", "faiss", "chroma", "huggingface", "tensorflow", "pytorch",
    "scikit-learn", "numpy", "microservice", "serverless", "lambda", "s3", "s3 bucket", "s3 buckets", "blob storage", "cosmos db",
    "nextauth", "auth0", "firebase", "supabase", "prisma", "typeorm", "sequelize", "drizzle",
    "vite", "webpack", "babel", "eslint", "prettier", "jest", "vitest", "cypress", "storybook",
    "azure functions", "azure blob", "azure blob storage", "azure devops", "api gateway",
    "nginx", "apache", "ec2", "ecs", "eks", "rds", "dynamodb", "sqs", "sns", "eventbridge",
    "bigquery", "pubsub", "cloud run", "cloud functions", "helm", "argo cd", "github", "bitbucket pipelines",
    "open telemetry", "opentelemetry", "new relic", "datadog", "jira", "confluence", "agile", "scrum",
  ]);

  if (exactAllow.has(text)) return true;

  return /\b(python|java|javascript|typescript|react|angular|vue|node|nodejs|node\.js|fastapi|fast api|django|flask|spring|spring boot|dotnet|\.net|c#|c\+\+|cpp|sql|mysql|postgres|postgresql|mongodb|oracle|redis|graphql|rest|api|apis|aws|azure|gcp|docker|kubernetes|microservices|microservice|architecture|system design|backend|frontend|full stack|devops|terraform|jenkins|git|linux|html|css|bootstrap|tailwind|nextjs|next\.js|express|nestjs|pandas|numpy|pytest|unittest|selenium|playwright|postman|swagger|grpc|websocket|websockets|rabbitmq|kafka|elasticsearch|opensearch|snowflake|databricks|pyspark|spark|hadoop|airflow|etl|ci\/cd|github actions|gitlab|bitbucket|ansible|prometheus|grafana|splunk|oauth|oauth2|oidc|jwt|sso|saml|okta|keycloak|sqlalchemy|alembic|pydantic|asyncio|celery|llm|openai|anthropic|langchain|rag|vector db|pinecone|qdrant|weaviate|faiss|chroma|huggingface|tensorflow|pytorch|scikit-learn|serverless|lambda|s3|blob storage|cosmos db|nextauth|auth0|firebase|supabase|prisma|typeorm|sequelize|drizzle|vite|webpack|babel|eslint|prettier|jest|vitest|cypress|storybook|azure functions|azure blob|azure blob storage|azure devops|api gateway|nginx|apache|ec2|ecs|eks|rds|dynamodb|sqs|sns|eventbridge|bigquery|pubsub|cloud run|cloud functions|helm|argo cd|github|new relic|datadog|open telemetry|opentelemetry|jira|confluence|agile|scrum)\b/i.test(text);
}

function normalizeInterviewTopicLabel(raw: string): string {
  const normalized = String(raw || "").toLowerCase().replace(/[^\w\s.+#/-]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (/^(reaction|preact|reacted|react|react js|reactjs|react jay es|react j s|re act|reactor)$/.test(normalized)) return "React";
  if (/^(flask|flash|flast|foster)$/.test(normalized)) return "Flask";
  if (/^(fast|fast api|fast apis|fastapi|fast a p i|fasta pi)$/.test(normalized)) return "FastAPI";
  if (/^(jango|django)$/.test(normalized)) return "Django";
  if (/^(python)$/.test(normalized)) return "Python";
  if (/^(azure)$/.test(normalized)) return "Azure";
  if (/^(aws)$/.test(normalized)) return "AWS";
  if (/^(s3|s3 bucket|s3 buckets|s3bucket|s3buckets|s 3|s three)$/.test(normalized)) return "S3";
  if (/^(sql)$/.test(normalized)) return "SQL";
  if (/^(mysql)$/.test(normalized)) return "MySQL";
  if (/^(postgres|postgresql|postgress|postgre sql|post gres)$/.test(normalized)) return "PostgreSQL";
  if (/^(mongodb|mongo db)$/.test(normalized)) return "MongoDB";
  if (/^(graphql|graph ql)$/.test(normalized)) return "GraphQL";
  if (/^(rest|rest api|rest apis|restful)$/.test(normalized)) return "REST APIs";
  if (/^(\.net|dotnet|dot net|net|the net)$/.test(normalized)) return ".NET";
  if (/^(javascript|java script)$/.test(normalized)) return "JavaScript";
  if (/^(typescript|type script)$/.test(normalized)) return "TypeScript";
  if (/^(nodejs|node js|node\.js|node jay ess|node jay s)$/.test(normalized)) return "Node.js";
  if (/^(docker|doc ker)$/.test(normalized)) return "Docker";
  if (/^(kubernetes|k8s|kuber netes|cuban etes)$/.test(normalized)) return "Kubernetes";
  if (/^(redis|red is|readys)$/.test(normalized)) return "Redis";
  if (/^(kafka|cafka|kaf ka)$/.test(normalized)) return "Kafka";
  if (/^(firebase|fire base)$/.test(normalized)) return "Firebase";
  if (/^(supabase|super base)$/.test(normalized)) return "Supabase";
  if (/^(prisma|prizma)$/.test(normalized)) return "Prisma";
  if (/^(sequelize|sqlize)$/.test(normalized)) return "Sequelize";
  if (/^(typeorm|type orm)$/.test(normalized)) return "TypeORM";
  if (/^(drizzle|drizel)$/.test(normalized)) return "Drizzle";
  if (/^(jest|gest)$/.test(normalized)) return "Jest";
  if (/^(vitest|vi test)$/.test(normalized)) return "Vitest";
  if (/^(cypress|cy press)$/.test(normalized)) return "Cypress";
  if (/^(storybook|story book)$/.test(normalized)) return "Storybook";
  if (/^(webpack|web pack)$/.test(normalized)) return "Webpack";
  if (/^(nginx|engine x)$/.test(normalized)) return "Nginx";
  if (/^(dynamodb|dynamo db)$/.test(normalized)) return "DynamoDB";
  if (/^(bigquery|big query)$/.test(normalized)) return "BigQuery";
  if (/^(pubsub|pub sub)$/.test(normalized)) return "Pub/Sub";
  if (/^(opentelemetry|open telemetry)$/.test(normalized)) return "OpenTelemetry";
  if (/^(datadog|data dog)$/.test(normalized)) return "Datadog";
  return String(raw || "").replace(/\s+/g, " ").trim();
}

function extractMeaningfulInterviewTopics(raw: string): string[] {
  const topic = String(raw || "")
    .replace(/\b(uh[\s-]*huh|uh+h|uh|um+|hmm+|mmm+|ah+|oh+)\b/gi, " ")
    .replace(/\bandalso(?=(?:\s|[.+#/-]|$))/gi, "and also ")
    .replace(/\balsoand(?=(?:\s|[.+#/-]|$))/gi, "also and ")
    .replace(/\b(?:and also|and|also)(?:\s+(?:and also|and|also))+\b/gi, " and also ")
    .replace(/[?.,;:!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!topic) return [];
  const parts = topic
    .split(/\s*(?:,|and also|and|&|\/|\+|or)\s*/i)
    .map((part) => normalizeInterviewTopicLabel(part))
    .filter((part) => isLikelyInterviewTopic(part));
  const normalizedTopic = topic.toLowerCase().replace(/[^\w\s.+#/-]/g, " ").replace(/\s+/g, " ").trim();
  const patternMatches: string[] = [];
  const topicPatterns: Array<{ re: RegExp; label: string }> = [
    { re: /\bpython\b/i, label: "Python" },
    { re: /\breact(?:\s*js)?\b|\breaction\b|\breacted\b|\bpreact\b/i, label: "React" },
    { re: /\bfast\s*api(?:s)?\b|\bfastapi\b/i, label: "FastAPI" },
    { re: /\bdjango\b|\bjango\b/i, label: "Django" },
    { re: /\bflask\b|\bflash\b|\bflast\b|\bfoster\b/i, label: "Flask" },
    { re: /\bjavascript\b|\bjava script\b/i, label: "JavaScript" },
    { re: /\btypescript\b|\btype script\b/i, label: "TypeScript" },
    { re: /\bnode(?:\.js|js)?\b|\bnode js\b/i, label: "Node.js" },
    { re: /\b(?:\.net|dot\s*net|dotnet)\b/i, label: ".NET" },
    { re: /\bjava\b/i, label: "Java" },
    { re: /\bc\+\+\b|\bcpp\b/i, label: "C++" },
    { re: /\bc#\b/i, label: "C#" },
    { re: /\bsql\b/i, label: "SQL" },
    { re: /\bmysql\b/i, label: "MySQL" },
    { re: /\bpost(?:gres|gresql|gre sql| gres)\b/i, label: "PostgreSQL" },
    { re: /\bmongo\s*db\b|\bmongodb\b/i, label: "MongoDB" },
    { re: /\boracle\b/i, label: "Oracle" },
    { re: /\bredis\b|\bred is\b/i, label: "Redis" },
    { re: /\bgraphql\b|\bgraph ql\b/i, label: "GraphQL" },
    { re: /\brest(?:ful)?(?:\s*api(?:s)?)?\b/i, label: "REST APIs" },
    { re: /\baws\b/i, label: "AWS" },
    { re: /\bs3(?:\s*bucket(?:s)?)?\b/i, label: "S3" },
    { re: /\bazure\b/i, label: "Azure" },
    { re: /\bgcp\b/i, label: "GCP" },
    { re: /\bdocker\b/i, label: "Docker" },
    { re: /\bkubernetes\b|\bk8s\b/i, label: "Kubernetes" },
    { re: /\bterraform\b/i, label: "Terraform" },
    { re: /\bjenkins\b/i, label: "Jenkins" },
    { re: /\bllm\b|\bopenai\b|\banthropic\b/i, label: "LLM" },
    { re: /\bfirebase\b|\bfire base\b/i, label: "Firebase" },
    { re: /\bsupabase\b|\bsuper base\b/i, label: "Supabase" },
    { re: /\bprisma\b|\bprizma\b/i, label: "Prisma" },
    { re: /\bsequelize\b|\bsqlize\b/i, label: "Sequelize" },
    { re: /\btypeorm\b|\btype orm\b/i, label: "TypeORM" },
    { re: /\bdrizzle\b|\bdrizel\b/i, label: "Drizzle" },
    { re: /\bjest\b|\bgest\b/i, label: "Jest" },
    { re: /\bvitest\b|\bvi test\b/i, label: "Vitest" },
    { re: /\bcypress\b|\bcy press\b/i, label: "Cypress" },
    { re: /\bstorybook\b|\bstory book\b/i, label: "Storybook" },
    { re: /\bwebpack\b|\bweb pack\b/i, label: "Webpack" },
    { re: /\bnginx\b|\bengine x\b/i, label: "Nginx" },
    { re: /\bdynamodb\b|\bdynamo db\b/i, label: "DynamoDB" },
    { re: /\bbigquery\b|\bbig query\b/i, label: "BigQuery" },
    { re: /\bpubsub\b|\bpub sub\b/i, label: "Pub/Sub" },
    { re: /\bopentelemetry\b|\bopen telemetry\b/i, label: "OpenTelemetry" },
    { re: /\bdatadog\b|\bdata dog\b/i, label: "Datadog" },
  ];
  for (const pattern of topicPatterns) {
    if (pattern.re.test(normalizedTopic)) {
      patternMatches.push(pattern.label);
    }
  }
  return [...new Set([...parts, ...patternMatches].map((part) => part.trim()).filter(Boolean))];
}

function cleanDetectedInterviewQuestion(raw: string): string {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const expMatch = text.match(/\b(do you have experience in|have you worked with|experience in)\b/i);
  if (!expMatch) return text;
  const anchor = expMatch[0];
  const rest = text.slice(expMatch.index! + anchor.length).trim();
  const topics = extractMeaningfulInterviewTopics(rest);
  if (!topics.length) return text;
  return `${anchor} ${topics.join(" and ")}?`;
}

function rewriteMixedTopicQuestion(raw: string): string {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (!text) return "";

  const normalized = text.toLowerCase().replace(/[^\w\s.+#/-]/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(vs|versus|difference between|compare)\b/i.test(normalized)) {
    const topics = extractMeaningfulInterviewTopics(text);
    if (topics.length >= 2) {
      return `What is the difference between ${topics[0]} and ${topics[1]}?`;
    }
    if (topics.length === 1) {
      return `Can you explain ${topics[0]}?`;
    }
  }

  const experienceMatch = text.match(/\b(do you have experience in|have you worked with|experience in)\b/i);
  if (experienceMatch) {
    const anchor = experienceMatch[0];
    const rest = text.slice(experienceMatch.index! + anchor.length).trim();
    const topics = extractMeaningfulInterviewTopics(rest);
    if (topics.length) return `${anchor} ${topics.join(" and ")}?`;
    return text;
  }

  const explainMatch = text.match(/\b(can you explain|could you explain|would you explain|explain|tell me about|walk me through)\b/i);
  if (explainMatch) {
    const anchor = explainMatch[0];
    const rest = text.slice(explainMatch.index! + anchor.length).trim();
    const topics = extractMeaningfulInterviewTopics(rest);
    if (topics.length === 1) return `${anchor} ${topics[0]}?`;
    if (topics.length > 1) return `${anchor} ${topics.join(" and ")}?`;
    return text;
  }

  return text;
}

interface ResponseCardProps {
  resp: Response;
  isHighlighted: boolean;
  content: string;
  onMount: (id: string, el: HTMLDivElement | null) => void;
}

const ResponseCard = memo(function ResponseCard({ resp, isHighlighted, content, onMount }: ResponseCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    onMount(resp.id, cardRef.current);
    return () => { onMount(resp.id, null); };
  }, [resp.id, onMount]);

  return (
    <div
      ref={cardRef}
      className={`py-2 ${isHighlighted ? "bg-primary/5 rounded px-2" : ""}`}
      data-testid={`card-response-${resp.id}`}
    >
      <div className="text-sm leading-relaxed">
        <MarkdownRenderer content={content} />
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground/50">
        {resp.createdAt ? new Date(resp.createdAt).toLocaleTimeString() : ""}
      </div>
    </div>
  );
});

export default function MeetingSession() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [isListening, setIsListening] = useState(false);
  const [audioMode, setAudioMode] = useState<AudioMode>("mic");
  const [transcriptSegments, setTranscriptSegments] = useState<string[]>([]);
  const [, setTranscriptSegmentKeys] = useState<string[]>([]);
  const [displayTranscriptSegments, setDisplayTranscriptSegments] = useState<string[]>([]);
  const [displayTranscriptSegmentKeys, setDisplayTranscriptSegmentKeys] = useState<string[]>([]);
  const [interimText, setInterimText] = useState("");
  const [stagedTranscriptText, setStagedTranscriptText] = useState("");
  const [manualTypeText, setManualTypeText] = useState("");
  const [sessionLaunched, setSessionLaunched] = useState(false);
  const [hasFullAccess, setHasFullAccess] = useState(false);
  const [freeSecondsRemaining, setFreeSecondsRemaining] = useState<number | null>(null);
  const [windowResetAt, setWindowResetAt] = useState<string | null>(null);
  const [lastSessionUsageMinutes, setLastSessionUsageMinutes] = useState<number | null>(null);
  const [statusNowTs, setStatusNowTs] = useState(Date.now());
  const [sessionAccessLoading, setSessionAccessLoading] = useState(false);
  const [showUpgradeBanner, setShowUpgradeBanner] = useState(false);
  const [showSessionEndedScreen, setShowSessionEndedScreen] = useState(false);
  const [sessionEndedSeconds, setSessionEndedSeconds] = useState(0);
  const [sessionRating, setSessionRating] = useState(0);
  const [sessionFeedback, setSessionFeedback] = useState("");
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [micGranted, setMicGranted] = useState(false);
  const [sessionLimitMinutes, setSessionLimitMinutes] = useState(60);
  const freeTickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [pendingTranscriptLine, setPendingTranscriptLine] = useState("");
  const [responseFormat, setResponseFormat] = useState("concise");
  const [customPrompt, setCustomPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState("automatic");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [streamingQuestion, setStreamingQuestion] = useState("");
  const [pendingResponse, setPendingResponse] = useState<{ question: string; answer: string } | null>(null);
  const [interpretedQuestion, setInterpretedQuestion] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isAwaitingFirstChunk, setIsAwaitingFirstChunk] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [conversationHistory, setConversationHistory] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const [initializedFromMeeting, setInitializedFromMeeting] = useState(false);
  const [quickResponseMode, setQuickResponseMode] = useState(() => {
    const stored = localStorage.getItem("zoommate-quick-response");
    return stored !== null ? stored === "true" : true;
  });
  const [sttLanguage, setSttLanguage] = useState(() => {
    return localStorage.getItem("zoommate-stt-lang") || "en-US";
  });
  const [showMemory, setShowMemory] = useState(false);
    const [showCoaching, setShowCoaching] = useState(false);
    const [coachingMetrics, setCoachingMetrics] = useState<{ totalAnswered: number; avgResponseMs: number; starCount: number; bulletCount: number; lastResponseMs: number; followUpSuggestions: string[] }>({ totalAnswered: 0, avgResponseMs: 0, starCount: 0, bulletCount: 0, lastResponseMs: 0, followUpSuggestions: [] });
  const [answerStyle, setAnswerStyle] = useState<AnswerStyle>("standard");
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [debugMeta, setDebugMeta] = useState<Partial<DebugPanelData>>({});
  const [showReadingPane, setShowReadingPane] = useState(false);
  const [isDetectionPaused, setIsDetectionPaused] = useState(false);
  const [docsMode, setDocsMode] = useState<DocsMode>(() => {
    const stored = localStorage.getItem("zoommate-docs-mode");
    return stored === "always" || stored === "off" ? stored : "auto";
  });
  const [socketConnected, setSocketConnected] = useState(false);
  const [responsesLocal, setResponsesLocal] = useState<Response[]>([]);
  const [showResponseHistory, setShowResponseHistory] = useState(false);
  const [highlightResponseId, setHighlightResponseId] = useState<string | null>(null);
  const [selectedQuestionFilter, setSelectedQuestionFilter] = useState<string>("");
  const [recentQuestions, setRecentQuestions] = useState<string[]>([]);
  const [azureAvailable, setAzureAvailable] = useState<boolean | null>(null);
  const [sttProvider, setSttProvider] = useState<"azure" | "browser">(() => {
    const saved = localStorage.getItem("zoommate-stt-engine");
    if (saved === "azure" || saved === "browser") return saved;
    return "browser";
  });
  const [autoAnswerEnabled, setAutoAnswerEnabled] = useState(false);
  const [wsTransportConnected, setWsTransportConnected] = useState(false);
  const [lastSubmitSource, setLastSubmitSource] = useState<SubmitSeedSource | "">("");
  const [sttStatus, setSttStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [sttError, setSttError] = useState("");
  const [isScreenAnalyzing, setIsScreenAnalyzing] = useState(false);
  const [multiCaptureQueue, setMultiCaptureQueue] = useState<string[]>([]);
  const [isMultiAnalyzing, setIsMultiAnalyzing] = useState(false);
  const [isScreenShareReady, setIsScreenShareReady] = useState(false);
  const [screenShareStream, setScreenShareStream] = useState<MediaStream | null>(null);
  const [screenShareLabel, setScreenShareLabel] = useState("");
  const [screenShareThumbnail, setScreenShareThumbnail] = useState("");
  const [isScreenPreviewPopupOpen, setIsScreenPreviewPopupOpen] = useState(false);
  const [safetyGuardEnabled, setSafetyGuardEnabled] = useState(() => {
    const saved = localStorage.getItem("zoommate-safety-guard");
    return saved !== "false";
  });
  const streamBufferRef = useRef<string>("");
  const flushTimerRef = useRef<number | null>(null);
  const rafPendingRef = useRef<number | null>(null);
  const autoScrollEnabledRef = useRef(true);
  const autoScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAssistantAnswerRef = useRef<string>("");
  const lastAnswerWasCodeRef = useRef<boolean>(false);
  const lastAppendedFpRef = useRef<string>("");
  const streamingAnswerRef = useRef<string>("");
  const wsTextQueueRef = useRef<string>("");   // WS text waiting to be smoothly revealed
  const displayedAccRef = useRef<string>("");  // text actually revealed to UI so far
  const streamingAccumulatorRef = useRef<string>("");
  const interpretedQuestionRef = useRef<string>("");
  const streamingQuestionRef = useRef<string>("");
  const isAwaitingFirstChunkRef = useRef<boolean>(false);
  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);
  const wsAnswerRef = useRef<WebSocket | null>(null);
  const activeSocketStreamIdRef = useRef<string>("");
  const activeWsStreamIdRef = useRef<string>("");
  const pendingQuestionForRequestRef = useRef<string>("");
  const requestQuestionByIdRef = useRef<Record<string, string>>({});
  const lastEnterSeedRef = useRef<{ text: string; ts: number }>({ text: "", ts: 0 });
  // Number of segments in segmentsRef at the time of the last Enter press.
  // Used to detect which segments are NEW since the last Enter (for second-Enter combine).
  const lastEnterSegmentCountRef = useRef<number>(0);
  const pendingEnterRef = useRef<{ text: string; ts: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const screenshotInputRef = useRef<HTMLInputElement | null>(null);
  const responseCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const responsesLocalRef = useRef<Response[]>([]);
  const latestScreenContextRef = useRef<LatestScreenContext | null>(null);
  const previousScreenContextRef = useRef<LatestScreenContext | null>(null);
  const dedupeToResponseIdRef = useRef<Record<string, string>>({});
  const sessionUsagePersistedRef = useRef(false);
  const answerStyleRef = useRef<AnswerStyle>("standard");
  const styleInitializedRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const azureRecognizerRef = useRef<AzureRecognizer | null>(null);
  const azureMicShadowRef = useRef<AzureRecognizer | null>(null);
  const azureLastCallRef = useRef<{ mode: "mic" | "system"; stream?: MediaStream; speaker: "interviewer" | "candidate" | "unknown" } | null>(null);
  const azureReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const azureStartFnRef = useRef<((mode: "mic" | "system", stream?: MediaStream, speaker?: "interviewer" | "candidate" | "unknown") => Promise<void>) | null>(null); // Dual-stream: candidate mic recognizer
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const segmentsRef = useRef<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const recognitionRestartCount = useRef(0);
  const recognitionAlive = useRef(true);
  const systemAudioStreamRef = useRef<MediaStream | null>(null);
  const displayCaptureStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const tabAudioStreamRef = useRef<MediaStream | null>(null);  // tab audio captured via getDisplayMedia for mixing
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const systemAudioAlive = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const systemTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const askedQuestionsRef = useRef<string[]>([]);
  const recentAskedFingerprintsRef = useRef<string[]>([]);
  const lastProcessedSegmentRef = useRef("");
  const lastSentSegmentIndexRef = useRef(-1);
  const displaySegmentsRef = useRef<string[]>([]);
  const displaySegmentKeysRef = useRef<string[]>([]);
  const visionCaptureStreamRef = useRef<MediaStream | null>(null);
  const sharedScreenVideoRef = useRef<HTMLVideoElement | null>(null);
  const sharedScreenPreviewVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenPreviewPopupRef = useRef<ScreenPreviewPopupWindow | null>(null);
  const recentAiOutputRef = useRef<string[]>([]);
  const lastCommittedResponseQuestionRef = useRef<string>("");
  const lastQuestionSentRef = useRef("");
  const lastAnswerDoneTimestampRef = useRef(0);
  const bargeInTriggeredRef = useRef(false);
  const lastResolvedQuestionRef = useRef<{ question: string; transcriptHash: string; ts: number } | null>(null);
  const questionDraftRef = useRef<string>("");
  const lastPartialTsRef = useRef<number>(0);
  const lastDraftTextRef = useRef<string>("");
  const stableSinceTsRef = useRef<number>(0);
  const continuationUntilTsRef = useRef<number>(0);
  const pendingTranscriptLineRef = useRef<string>("");
  const pendingTranscriptTsRef = useRef<number>(0);
  const pendingTranscriptFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAnsweredQuestionHashRef = useRef<string>("");
  const lastAnsweredQuestionTsRef = useRef<number>(0);
  const lastExtractedHashRef = useRef<string>("");
  const lastFinalizedTextRef = useRef<string>("");
  const lastFinalizedAtRef = useRef<number>(0);
  const submitCurrentQuestionRef = useRef<((source: string) => void) | null>(null);
  // True whenever interimText is showing content not yet committed to segments.
  // Prevents the empty-partial path from clearing visible text before the final arrives.
  const interimHasUnsavedContentRef = useRef<boolean>(false);
  // Tracks the current interimText value synchronously so commit path can read it.
  const interimTextRef = useRef<string>("");
  // Timestamp of the last segment committed to segmentsRef ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â used for the 10s combine window.
  const lastSegmentCommittedAtRef = useRef<number>(0);
  const lastExtractedTsRef = useRef<number>(0);
  const lastAutoTriggerHashRef = useRef<string>("");
  const lastAutoTriggerTsRef = useRef<number>(0);
  const lastRequestedIntentRef = useRef<{ fp: string; ts: number; mode: "pause" | "final" | "enter" } | null>(null);
  const lastTriggeredNormalizedTextRef = useRef<string>("");
  const lastTriggerTimestampRef = useRef<number>(0);
  const lastPartialFingerprintRef = useRef<string>("");
  const partialFingerprintCountRef = useRef<number>(0);
  const partialFingerprintStableSinceRef = useRef<number>(0);
  const speculativeQuestionRef = useRef<{ norm: string; text: string; ts: number; refined: boolean } | null>(null);
  const speculativePrepareRef = useRef<{ norm: string; text: string; ts: number; prepared: boolean } | null>(null);
  const recentAutoTriggerFingerprintsRef = useRef<Array<{ fp: string; ts: number }>>([]);
  const conversationContextLinesRef = useRef<string[]>([]);
  const conversationContextFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastConversationPersistRef = useRef<number>(0);
  const meetingIncognitoRef = useRef<boolean>(false);
  const triggerMetricRef = useRef<{
    t_trigger_decision?: number;
    t_partial_detected?: number;
    t_final_detected?: number;
    t_request_sent?: number;
    t_assistant_start_rendered?: number;
    t_first_token_rendered?: number;
    t_stream_done_rendered?: number;
  }>({});
  const transcriptPersistQueueRef = useRef<Array<{ text: string; startMs?: number; endMs?: number }>>([]);
  const transcriptPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstChunkWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refineBufferRef = useRef<string>("");
  const interviewerQuestionMemoryRef = useRef<Array<{ text: string; answered: boolean; ts: number }>>([]);
  const spokenReplyMemoryRef = useRef<Array<{ text: string; ts: number }>>([]);
  // Rolling buffer of last 2 non-candidate transcript segments for multi-segment speculative
  const recentInterviewerSegmentsRef = useRef<string[]>([]);
  const pendingQuestionTailRef = useRef<string[]>([]);
  const pendingTailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boundaryQuestionCandidatesRef = useRef<Array<{ text: string; ts: number }>>([]);
  const pendingContinuationTopicsRef = useRef<Array<{ topic: string; ts: number }>>([]);
  const interimKeywordMemoryRef = useRef<Array<{ token: string; ts: number }>>([]);
  const latestPartialQuestionCandidateRef = useRef<string>("");
  const latestPartialQuestionCandidateTsRef = useRef<number>(0);

  // State machine: prevents duplicate triggers, noisy post-answer triggers, and races
  type InterviewState = "listening" | "partial_detected" | "answering" | "cooldown";
  const interviewStateRef = useRef<InterviewState>("listening");
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Debounce ref for auto-trigger: prevents firing on the first question alone when
  // the interviewer is asking multiple questions in rapid succession.
  const autoTriggerDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getLiveVisionStream = useCallback((): MediaStream | null => {
    const candidates = [
      visionCaptureStreamRef.current,
      screenShareStream,
      (window as ScreenShareWindow).__zoommateVisionStream || null,
    ];
    for (const candidate of candidates) {
      const track = candidate?.getVideoTracks?.()[0];
      if (candidate && track && track.readyState === "live") {
        return candidate;
      }
    }
    return null;
  }, [screenShareStream]);

  // Cleanup pending tail timer on unmount to prevent state updates on unmounted component
  useEffect(() => {
    return () => {
      if (pendingTailTimerRef.current) {
        clearTimeout(pendingTailTimerRef.current);
        pendingTailTimerRef.current = null;
      }
    };
  }, []);

  const syncVisionStreamState = useCallback((stream: MediaStream | null) => {
    visionCaptureStreamRef.current = stream;
    setScreenShareStream(stream);
    const activeTrack = stream?.getVideoTracks?.()[0];
    if (activeTrack && activeTrack.readyState === "live") {
      setIsScreenShareReady(true);
      setScreenShareLabel(activeTrack.label || "Shared tab");
      (window as ScreenShareWindow).__zoommateVisionStream = stream;
    } else {
      setIsScreenShareReady(false);
      setScreenShareLabel("");
      setScreenShareThumbnail("");
      setIsScreenPreviewPopupOpen(false);
      (window as ScreenShareWindow).__zoommateVisionStream = null;
    }
  }, []);

  const syncScreenPreviewTargets = useCallback(() => {
    const liveStream = getLiveVisionStream();
    const previewVideo = sharedScreenPreviewVideoRef.current;
    if (previewVideo) {
      if (!liveStream) {
        previewVideo.pause();
        previewVideo.srcObject = null;
      } else {
        if (previewVideo.srcObject !== liveStream) {
          previewVideo.srcObject = liveStream;
        }
        previewVideo.muted = true;
        previewVideo.playsInline = true;
        void previewVideo.play().catch(() => undefined);
      }
    }

    const popup = screenPreviewPopupRef.current;
    if (!popup || popup.closed) {
      screenPreviewPopupRef.current = null;
      setIsScreenPreviewPopupOpen(false);
      return;
    }

    const popupVideo = popup.__zoommatePreviewVideo || null;
    const popupLabel = popup.__zoommatePreviewLabel || null;
    if (popupLabel) {
      popupLabel.textContent = screenShareLabel || (liveStream ? "Shared screen live preview" : "No active shared screen");
    }
    if (!popupVideo) return;

    if (!liveStream) {
      popupVideo.pause();
      popupVideo.srcObject = null;
      return;
    }
    if (popupVideo.srcObject !== liveStream) {
      popupVideo.srcObject = liveStream;
    }
    popupVideo.muted = true;
    popupVideo.playsInline = true;
    void popupVideo.play().catch(() => undefined);
  }, [getLiveVisionStream, screenShareLabel]);

  const ensureSharedScreenVideoReady = useCallback(async (): Promise<HTMLVideoElement> => {
    const stream = getLiveVisionStream();
    const video = sharedScreenVideoRef.current;
    if (!stream || !video) {
      throw new Error("Share a screen first");
    }

    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }

    video.muted = true;
    video.playsInline = true;

    try {
      await video.play();
    } catch {
      // Retry once metadata arrives.
    }

    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          cleanup();
          reject(new Error("Shared screen preview did not become ready"));
        }, 2500);

        const cleanup = () => {
          window.clearTimeout(timeout);
          video.removeEventListener("loadeddata", onReady);
          video.removeEventListener("loadedmetadata", onReady);
        };

        const onReady = () => {
          cleanup();
          resolve();
        };

        video.addEventListener("loadeddata", onReady);
        video.addEventListener("loadedmetadata", onReady);
      });
    }

    return video;
  }, [getLiveVisionStream]);

  const waitForFreshSharedScreenFrame = useCallback(async (video: HTMLVideoElement): Promise<void> => {
    const frameVideo = video as VideoFrameCallbackVideo;
    if (typeof frameVideo.requestVideoFrameCallback === "function") {
      await new Promise<void>((resolve) => {
        frameVideo.requestVideoFrameCallback!(() => resolve());
      });
      return;
    }

    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });
  }, []);

  const AUTO_PAUSE_MS = 2_500;
  const STABLE_MS = 350;
  const CONTINUATION_MS = 10_000;
  const INTERIM_KEYWORD_TTL_MS = 3000;
  const DUPLICATE_INTENT_WINDOW_MS = 15_000;
  const ENTER_AFTER_AUTO_SUPPRESS_MS = 5_000;
  const enterOnlyAnswerModeRef = useRef(true); // useRef so it holds a stable reference across renders
  const ENTER_ONLY_ANSWER_MODE = enterOnlyAnswerModeRef.current;
  const SPECULATIVE_WINDOW_MS = 10_000;
  // Named similarity threshold constants for consistency across detection logic
  const SIM_SPECULATIVE_REUSE = 0.82;
  const SIM_DEDUP_BLOCK = 0.85;
  const SIM_REFINEMENT_MAX = 0.80;
  const INTERPRETED_PLACEHOLDER = "Listening for a clear speaker question. Press Enter to answer from transcript context.";
  const liveMode = isListening && socketConnected;
  const MAX_CONVERSATION_CONTEXT_LINES = 60;
  const HYBRID_FOLLOWUP_WINDOW_MS = 30_000;
  const HYBRID_FOLLOWUP_MAX_WORDS = 8;

  const wordOverlap = useCallback((a: string, b: string): number => {
    const wa = normalizeForDedup(a).split(/\s+/).filter((w) => w.length > 2);
    const wb = new Set(normalizeForDedup(b).split(/\s+/).filter((w) => w.length > 2));
    if (wa.length === 0) return 0;
    let hits = 0;
    for (const w of wa) {
      if (wb.has(w)) hits++;
    }
    return hits / wa.length;
  }, []);

  const shouldReplaceLatestTranscriptLine = useCallback((current: string, next: string): boolean => {
    const currentNorm = normalizeForDedup(current);
    const nextNorm = normalizeForDedup(next);
    if (!currentNorm || !nextNorm || currentNorm === nextNorm) return false;
    const forwardOverlap = wordOverlap(current, next);
    const reverseOverlap = wordOverlap(next, current);
    const overlapsStrongly = forwardOverlap >= 0.92 || reverseOverlap >= 0.92;
    if (!overlapsStrongly) return false;

    const currentWords = currentNorm.split(/\s+/).filter(Boolean).length;
    const nextWords = nextNorm.split(/\s+/).filter(Boolean).length;
    const nextIsMoreComplete =
      nextWords > currentWords
      || nextNorm.includes(currentNorm)
      || /[?.,;:!]$/.test(next.trim());

    return nextIsMoreComplete;
  }, [wordOverlap]);

  const upsertTranscriptSegment = useCallback((text: string) => {
    const next = String(text || "").trim();
    if (!next) return;

    const latest = String(segmentsRef.current[0] || "").trim();
    // Canonical transcript is detection-oriented: keep strict dedup only.
    if (latest && wordOverlap(latest, next) > 0.92 && wordOverlap(next, latest) > 0.92) return;

    segmentsRef.current = [next, ...segmentsRef.current];
    setTranscriptSegments([...segmentsRef.current]);
    setTranscriptSegmentKeys((prev) => [`${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...prev]);
  }, [wordOverlap]);

  const upsertDisplayTranscriptSegment = useCallback((text: string) => {
    const next = String(text || "").trim();
    if (!next) return;
    // Suppress display updates for 300ms after an AI answer ends to prevent
    // late finals and echo bleed from visibly mutating the transcript.
    if (lastAnswerDoneTimestampRef.current && (Date.now() - lastAnswerDoneTimestampRef.current) < 300) return;
    const nextNorm = normalizeForDedup(next);
    if (!nextNorm) return;
    const latestDisplay = String(displaySegmentsRef.current[0] || "").trim();
    const latestNorm = normalizeForDedup(latestDisplay);
    if (latestNorm) {
      if (latestNorm.startsWith(nextNorm) && nextNorm.length >= 8 && nextNorm.split(/\s+/).length <= latestNorm.split(/\s+/).length) {
        return;
      }
      if (nextNorm.startsWith(latestNorm) && latestNorm.length >= 8 && latestNorm.split(/\s+/).length < nextNorm.split(/\s+/).length) {
        displaySegmentsRef.current = [next, ...displaySegmentsRef.current.slice(1)];
        displaySegmentKeysRef.current = [displaySegmentKeysRef.current[0] || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...displaySegmentKeysRef.current.slice(1)];
        setDisplayTranscriptSegments([...displaySegmentsRef.current]);
        setDisplayTranscriptSegmentKeys([...displaySegmentKeysRef.current]);
        return;
      }
    }
    if (displaySegmentsRef.current.some((seg) => normalizeForDedup(seg) === nextNorm)) return;
    // Evict any existing short stray fragment (≤2 words) whose words all appear
    // at the tail of the incoming segment — e.g. evict "yourself" when
    // "Tell me about yourself." arrives so it doesn't wall off earlier questions.
    const nextWords = nextNorm.split(/\s+/).filter(Boolean);
    const strayIndices: number[] = [];
    displaySegmentsRef.current.forEach((seg, i) => {
      const eNorm = normalizeForDedup(seg || "");
      const eWords = eNorm.split(/\s+/).filter(Boolean);
      if (eWords.length >= 1 && eWords.length <= 2) {
        const tail = nextWords.slice(-eWords.length);
        if (tail.join(" ") === eWords.join(" ")) strayIndices.push(i);
      }
    });
    if (strayIndices.length > 0) {
      displaySegmentsRef.current = displaySegmentsRef.current.filter((_, i) => !strayIndices.includes(i));
      displaySegmentKeysRef.current = displaySegmentKeysRef.current.filter((_, i) => !strayIndices.includes(i));
    }
    displaySegmentsRef.current = [next, ...displaySegmentsRef.current];
    displaySegmentKeysRef.current = [`${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...displaySegmentKeysRef.current];
    setDisplayTranscriptSegments([...displaySegmentsRef.current]);
    setDisplayTranscriptSegmentKeys([...displaySegmentKeysRef.current]);
  }, []);

  const replaceLatestDisplayTranscriptSegment = useCallback((text: string) => {
    upsertDisplayTranscriptSegment(text);
  }, [upsertDisplayTranscriptSegment]);

  const rememberAskedFingerprint = useCallback((fingerprint: string) => {
    if (!fingerprint) return;
    const next = [fingerprint, ...recentAskedFingerprintsRef.current.filter((x) => x !== fingerprint)];
    recentAskedFingerprintsRef.current = next.slice(0, 20);
  }, []);

  const rememberAutoTriggerFingerprint = useCallback((fingerprint: string, ts = Date.now()) => {
    if (!fingerprint) return;
    const next = [{ fp: fingerprint, ts }, ...recentAutoTriggerFingerprintsRef.current.filter((x) => x.fp !== fingerprint)];
    recentAutoTriggerFingerprintsRef.current = next
      .filter((x, idx) => idx < 20 && (ts - x.ts) <= 12000);
  }, []);

  const scheduleConversationContextPersist = useCallback((context: string) => {
    if (!id) return;
    if (meetingIncognitoRef.current) return;
    if (conversationContextFlushRef.current) {
      clearTimeout(conversationContextFlushRef.current);
    }
    conversationContextFlushRef.current = setTimeout(async () => {
      const now = Date.now();
      lastConversationPersistRef.current = now;
      try {
        await apiRequest("PATCH", `/api/meetings/${id}`, { conversationContext: context });
      } catch (err) {
        console.warn("[meeting] conversationContext persist failed", err);
      }
    }, 1200);
  }, [id]);

  const appendConversationContextLine = useCallback((speaker: "Interviewer" | "Candidate", text: string) => {
    const cleaned = String(text || "")
      .replace(/^(interviewer|candidate)\s*:\s*/i, "")
      .trim();
    if (!cleaned) return;
    const line = `${speaker}: ${cleaned}`;
    const lastLine = conversationContextLinesRef.current[conversationContextLinesRef.current.length - 1] || "";
    const normLine = normalizeForDedup(line.replace(/^(Interviewer|Candidate)\s*:\s*/i, ""));
    const normLast = normalizeForDedup(lastLine.replace(/^(Interviewer|Candidate)\s*:\s*/i, ""));
    if (normLine && normLine === normLast) return;

    const next = [...conversationContextLinesRef.current, line].slice(-MAX_CONVERSATION_CONTEXT_LINES);
    conversationContextLinesRef.current = next;
    const merged = next.join("\n");
    setConversationHistory(merged);
    scheduleConversationContextPersist(merged);
  }, [scheduleConversationContextPersist]);

  const isDuplicateRecentAutoTrigger = useCallback((fingerprint: string, now = Date.now()): boolean => {
    if (!fingerprint) return false;
    for (const prev of recentAutoTriggerFingerprintsRef.current) {
      if ((now - prev.ts) > 12000) continue;
      if (levenshteinSimilarity(fingerprint, prev.fp) >= SIM_DEDUP_BLOCK) {
        return true;
      }
    }
    return false;
  }, []);

  const isNearDuplicateAskedQuestion = useCallback((text: string): boolean => {
    const fingerprint = normalizeQuestionForSimilarity(text);
    if (!fingerprint) return false;
    for (const prev of recentAskedFingerprintsRef.current) {
      const sim = levenshteinSimilarity(fingerprint, prev);
      if (sim >= SIM_DEDUP_BLOCK) return true;
    }
    return false;
  }, []);

  const cleanAsrNoise = useCallback((raw: string): string => {
    let text = raw.replace(/\s+/g, " ").trim();
    if (!text) return text;

    // Collapse immediate repeated 1-3 word n-grams from noisy STT.
    const tokens = text.split(" ");
    const out: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const w = tokens[i];
      const prev = out[out.length - 1];
      if (prev && prev.toLowerCase() === w.toLowerCase()) continue;
      out.push(w);
    }
    text = out.join(" ");

    // Drop non-word / gibberish-like tokens while preserving common technical terms.
    const technicalToken = /^(react|redux|python|django|flask|fastapi|node|nodejs|typescript|javascript|java|golang|kotlin|scala|rust|c\+\+|c#|\.net|dotnet|api|apis|sql|nosql|postgres|postgresql|mysql|mongodb|redis|aws|azure|gcp|docker|kubernetes|k8s|graphql|rest|restful|jwt|oauth|cicd|ci\/cd|terraform|jenkins|ansible|kafka|rabbitmq|celery|airflow|spark|pyspark|hadoop|hive|snowflake|databricks|dbt|pandas|numpy|pytorch|tensorflow|sklearn|langchain|openai|llm|rag|nlp|ml|ai|elasticsearch|nginx|redis|memcached|grpc|websocket|microservices|serverless|nextjs|nestjs|vuejs|angular|svelte|webpack|vite|jest|pytest|junit|maven|gradle|helm|prometheus|grafana|kibana|logstash|firebase|supabase|prisma|drizzle|sequelize|typeorm|hibernate|springboot|fastify|express|hono|trpc)$/i;
    const isWordLikeToken = (token: string): boolean => {
      const core = token
        .toLowerCase()
        .replace(/^[^a-z0-9.+#/-]+|[^a-z0-9.+#/-]+$/gi, "");
      if (!core) return false;
      if (technicalToken.test(core)) return true;
      if (/^\d+$/.test(core)) return true;
      if (/^(i|a)$/.test(core)) return true;
      if (/^[a-z]{2,}(?:['-][a-z]{2,})?$/i.test(core)) return true;
      if (/^[a-z][a-z0-9]{2,}$/i.test(core)) return true;
      return false;
    };
    const filtered = text
      .split(" ")
      .filter((token) => isWordLikeToken(token));
    text = filtered.join(" ").trim();
    if (!text) return "";

    // Common ASR formatting normalization.
    text = text
      .replace(/\bback end\b/gi, "backend")
      .replace(/\bfront end\b/gi, "frontend")
      .replace(/\bfull stack\b/gi, "full stack")
      .replace(/\s+([?.!,])/g, "$1")
      .trim();

    return text;
  }, []);

  const normalizeTranscriptUtterance = useCallback((raw: string, mode: "partial" | "final" = "final"): string => {
    let text = cleanAsrNoise(raw || "");
    if (!text) return "";

    const fixes: Array<[RegExp, string]> = [
      // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Frameworks & Languages ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
      [/\bjango\b/gi, "Django"],
      [/\bgraph ?ql\b/gi, "GraphQL"],
      [/\bfast ?api?s?\b/gi, "FastAPI"],
      [/\brest(?:aurant)?\s+apis?\b/gi, "REST APIs"],
      [/\bpassed\s+apis?\b/gi, "REST APIs"],
      [/\bpast\s+apis?\b/gi, "REST APIs"],
      [/\bpy(?:\s+)?spark\b/gi, "PySpark"],
      [/\bsparks by spark\b/gi, "Spark/PySpark"],
      [/\breact(?:ion)?\s+js\b/gi, "React.js"],
      [/\breact(?:ion)?\s+native\b/gi, "React Native"],
      [/\bnext(?:\s+)?js\b/gi, "Next.js"],
      [/\bnode(?:\s+)?js\b/gi, "Node.js"],
      [/\bvue(?:\s+)?js\b/gi, "Vue.js"],
      [/\bangular(?:\s+)?js\b/gi, "AngularJS"],
      [/\btype(?:\s+)?script\b/gi, "TypeScript"],
      [/\bjava(?:\s+)?script\b/gi, "JavaScript"],
      [/\bspring(?:\s+)?boot\b/gi, "Spring Boot"],
      [/\bspring(?:\s+)?boot(?:\s+)?framework\b/gi, "Spring Boot"],
      [/\bhybernate\b/gi, "Hibernate"],
      [/\bhibernate\b/gi, "Hibernate"],
      [/\bmy(?:\s+)?sequel\b/gi, "MySQL"],
      [/\bpost(?:\s+)?gres(?:ql)?\b/gi, "PostgreSQL"],
      [/\bpost(?:\s+)?gray(?:s|sql)?\b/gi, "PostgreSQL"],
      [/\bmongo(?:\s+)?db\b/gi, "MongoDB"],
      [/\bredis(?:\s+)?cache\b/gi, "Redis cache"],
      [/\belastic(?:\s+)?search\b/gi, "Elasticsearch"],
      [/\bkubernetes\b/gi, "Kubernetes"],
      [/\bkuberneti[sz]\b/gi, "Kubernetes"],
      [/\bkuber(?:\s+)?net(?:es|is)?\b/gi, "Kubernetes"],
      [/\bdocker(?:\s+)?file\b/gi, "Dockerfile"],
      [/\bterraform\b/gi, "Terraform"],
      [/\bjenkins\b/gi, "Jenkins"],
      [/\bansible\b/gi, "Ansible"],
      [/\bprometheus\b/gi, "Prometheus"],
      [/\bgrafana\b/gi, "Grafana"],
      [/\bscikit(?:\s+|-)?learn\b/gi, "scikit-learn"],
      [/\btensor(?:\s+)?flow\b/gi, "TensorFlow"],
      [/\bpy(?:\s+)?torch\b/gi, "PyTorch"],
      [/\bpie(?:\s+)?torch\b/gi, "PyTorch"],
      [/\bpy torch\b/gi, "PyTorch"],
      [/\blang(?:\s+)?chain\b/gi, "LangChain"],
      [/\blanguid\b/gi, "LangChain"],
      [/\bopen(?:\s+)?ai\b/gi, "OpenAI"],
      [/\bhugging(?:\s+)?face\b/gi, "Hugging Face"],
      [/\bpandas\b/gi, "Pandas"],
      [/\bnumpy\b/gi, "NumPy"],
      [/\bnum(?:\s+)?pie\b/gi, "NumPy"],
      [/\bcelery\b/gi, "Celery"],
      [/\bcellar(?:y)?\b/gi, "Celery"],
      [/\brabbit(?:\s+)?mq\b/gi, "RabbitMQ"],
      [/\bkafka\b/gi, "Kafka"],
      [/\bairflow\b/gi, "Airflow"],
      [/\bair\s+flow\b/gi, "Airflow"],
      [/\bdbt\b/gi, "dbt"],
      [/\bsnow(?:\s+)?flake\b/gi, "Snowflake"],
      [/\bdatabricks\b/gi, "Databricks"],
      [/\bspark(?:\s+)?sql\b/gi, "Spark SQL"],
      [/\bphi\s+query\b/gi, "Hive query"],
      [/\bhive(?:\s+)?ql\b/gi, "HiveQL"],
      [/\bharted\b/gi, "Hadoop"],
      [/\bhadoop\b/gi, "Hadoop"],

      // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Cloud & DevOps ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
      [/\bamazon(?:\s+)?web(?:\s+)?services\b/gi, "AWS"],
      [/\baws(?:\s+)?lambda\b/gi, "AWS Lambda"],
      [/\bec(?:\s+)?2\b/gi, "EC2"],
      [/\bs(?:\s+)?3(?:\s+)?bucket\b/gi, "S3 bucket"],
      [/\bcloud(?:\s+)?formation\b/gi, "CloudFormation"],
      [/\bcloud\s+front\b/gi, "CloudFront"],
      [/\bapi(?:\s+)?gateway\b/gi, "API Gateway"],
      [/\bdynamo(?:\s+)?db\b/gi, "DynamoDB"],
      [/\brds\b/gi, "RDS"],
      [/\biam\b/gi, "IAM"],
      [/\bsns\b/gi, "SNS"],
      [/\bsqs\b/gi, "SQS"],
      [/\beks\b/gi, "EKS"],
      [/\beks(?:\s+)?cluster\b/gi, "EKS cluster"],
      [/\bgoogle(?:\s+)?cloud(?:\s+)?platform\b/gi, "GCP"],
      [/\bgcp\b/gi, "GCP"],
      [/\bbig(?:\s+)?query\b/gi, "BigQuery"],
      [/\bazure(?:\s+)?devops\b/gi, "Azure DevOps"],
      [/\bazure(?:\s+)?functions?\b/gi, "Azure Functions"],
      [/\bpub(?:\s+)?sub\b/gi, "Pub/Sub"],
      [/\bci(?:\s+)?cd\b/gi, "CI/CD"],
      [/\bcacd\b/gi, "CI/CD"],
      [/\bcic\s*d\b/gi, "CI/CD"],
      [/\bgit(?:\s+)?lab\b/gi, "GitLab"],
      [/\bgit(?:\s+)?hub(?:\s+)?actions?\b/gi, "GitHub Actions"],
      [/\bkitab\b/gi, "GitHub"],
      [/\bgit(?:\s+)?hub\b/gi, "GitHub"],

      // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Architecture & Concepts ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
      [/\bmicro(?:\s+)?services?\b/gi, "microservices"],
      [/\brest(?:ful)?\s+api\b/gi, "REST API"],
      [/\bgraph(?:\s+)?ql(?:\s+)?api\b/gi, "GraphQL API"],
      [/\bserver(?:\s+)?less\b/gi, "serverless"],
      [/\bload(?:\s+)?balancer\b/gi, "load balancer"],
      [/\brate(?:\s+)?limit(?:ing)?\b/gi, "rate limiting"],
      [/\bcache(?:\s+)?invalidat\w+\b/gi, "cache invalidation"],
      [/\bdesign(?:\s+)?pattern\b/gi, "design pattern"],
      [/\bdata(?:\s+)?structure\b/gi, "data structure"],
      [/\bobject(?:\s+)?oriented\b/gi, "object-oriented"],
      [/\bood\b/gi, "OOD"],
      [/\bsolid(?:\s+)?principles?\b/gi, "SOLID principles"],
      [/\bsolid\s+principle\b/gi, "SOLID principle"],
      [/\bdependency(?:\s+)?inject\w+\b/gi, "dependency injection"],
      [/\btest(?:\s+)?driven(?:\s+)?development\b/gi, "TDD"],
      [/\btdd\b/gi, "TDD"],
      [/\bbehavior(?:al)?(?:\s+)?driven\b/gi, "BDD"],
      [/\bagile(?:\s+)?methodology\b/gi, "Agile methodology"],
      [/\bscrum(?:\s+)?master\b/gi, "Scrum Master"],
      [/\bjira\b/gi, "Jira"],

      // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Databases & Querying ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
      [/\bno(?:\s+)?sql\b/gi, "NoSQL"],
      [/\bsql\s+query\b/gi, "SQL query"],
      [/\bstored(?:\s+)?procedure\b/gi, "stored procedure"],
      [/\bindex(?:ing)?\b/gi, "indexing"],
      [/\bjson(?:\s+)?web(?:\s+)?token\b/gi, "JWT"],
      [/\bjwt\b/gi, "JWT"],
      [/\bo(?:\s+)?auth\b/gi, "OAuth"],
      [/\boath\b/gi, "OAuth"],

      // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ AI / ML ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
      [/\bmachine(?:\s+)?learning\b/gi, "machine learning"],
      [/\bdeep(?:\s+)?learning\b/gi, "deep learning"],
      [/\bnatural(?:\s+)?language(?:\s+)?processing\b/gi, "NLP"],
      [/\bnlp\b/gi, "NLP"],
      [/\blarge(?:\s+)?language(?:\s+)?model\b/gi, "LLM"],
      [/\bllm\b/gi, "LLM"],
      [/\brag\b/gi, "RAG"],
      [/\bretrieval(?:\s+)?augmented\b/gi, "retrieval-augmented"],
      [/\bfine(?:\s+)?tun\w+\b/gi, "fine-tuning"],
      [/\bembeddings?\b/gi, "embeddings"],
      [/\bvector(?:\s+)?database\b/gi, "vector database"],
      [/\bpin(?:\s+)?cone\b/gi, "Pinecone"],
      [/\bchroma(?:\s+)?db\b/gi, "ChromaDB"],
      [/\bweaviate\b/gi, "Weaviate"],

      // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Common speech mishears ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
      [/\bfootstep development\b/gi, "full stack development"],
      [/\bfood(?:\s+)?stack\b/gi, "full stack"],
      [/\bfoot(?:\s+)?stack\b/gi, "full stack"],
      [/\baid driven\b/gi, "AI-driven"],
      [/\bair driven\b/gi, "AI-driven"],
      [/\bblue cross on blue shield\b/gi, "Blue Cross and Blue Shield"],
      [/\bpython\s+three\b/gi, "Python 3"],
      [/\bpython\s+two\b/gi, "Python 2"],
      [/\bjava\s+eight\b/gi, "Java 8"],
      [/\bjava\s+eleven\b/gi, "Java 11"],
      [/\bjava\s+seventeen\b/gi, "Java 17"],
      [/\byes(?:\s+)?sequel\b/gi, "MySQL"],
      [/\bmy\s+s\s*q\s*l\b/gi, "MySQL"],

      // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Grammar / phrasing fixes ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
      [/\bwhere did you worked\b/gi, "Where did you work"],
      [/\bwhere do you work recently\b/gi, "Where do you work currently"],
      [/\bwho you want to mentor\b/gi, "Who do you want to mentor"],
      [/\bhow many years of experience you have\b/gi, "How many years of experience do you have"],
      [/\btell me about you\b/gi, "Tell me about yourself"],
      [/\bwalk me through you\b/gi, "Walk me through yourself"],
      [/\bcan you explain me\b/gi, "Can you explain"],
      [/\bexplain me\b/gi, "explain"],
    ];
    for (const [re, to] of fixes) {
      text = text.replace(re, to);
    }

    // Context-aware replacements (confidence proxy):
    // apply ambiguous replacements only when surrounding domain context is present.
    const contextualFixes: Array<{ re: RegExp; to: string; when: RegExp }> = [
      // Frameworks (only replace in tech context to avoid false positives)
      { re: /\b(foster|flast|flash)\b/gi, to: "Flask", when: /\b(experience|python|api|apis|backend|django|react|fastapi)\b/i },
      { re: /\b(jango)\b/gi, to: "Django", when: /\b(python|api|backend|microservice|developer)\b/i },
      { re: /\b(rest areas?|restaurant)\b/gi, to: "REST", when: /\b(api|apis|graphql|backend|service)\b/i },
      { re: /\b(food stack|foot stack|footstep)\b/gi, to: "full stack", when: /\b(developer|engineer|python|java|react|django|fastapi)\b/i },
      { re: /\b(air driven|aid driven)\b/gi, to: "AI-driven", when: /\b(use case|analytics|model|data|pipeline)\b/i },
      { re: /\b(cacd|cic d|ci cd)\b/gi, to: "CI/CD", when: /\b(pipeline|deploy|jenkins|github|automation)\b/i },
      // "reaction" is a real word ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â only replace in coding context
      { re: /\breaction\b/gi, to: "React", when: /\b(component|hook|frontend|jsx|tsx|redux|next\.?js|state)\b/i },
      // "express" can be a tech term or normal word
      { re: /\bexpress\s+js\b/gi, to: "Express.js", when: /\b(node|backend|api|server|route|middleware)\b/i },
      // "sequel" is ambiguous
      { re: /\bsequel\b/gi, to: "SQL", when: /\b(database|query|table|join|index|postgres|mysql|nosql)\b/i },
      // "spring" could be season or framework
      { re: /\bspring\b/gi, to: "Spring", when: /\b(boot|java|microservice|hibernate|bean|mvc|jpa)\b/i },
      // "nest" could be Spring or Nest.js
      { re: /\bnest(?:\s+)?js\b/gi, to: "NestJS", when: /\b(node|typescript|backend|api|module|controller)\b/i },
      // "panda" vs "Pandas"
      { re: /\bpandas?\b/gi, to: "Pandas", when: /\b(dataframe|python|numpy|data|analysis|csv|machine learning)\b/i },
      // "cellar" vs "Celery"
      { re: /\bcellar\b/gi, to: "Celery", when: /\b(task|queue|worker|async|redis|rabbitmq|django)\b/i },
      // "oath" vs "OAuth"
      { re: /\boath\b/gi, to: "OAuth", when: /\b(token|auth|login|sso|google|github|jwt|permission)\b/i },
      // "pin cone" vs "Pinecone"
      { re: /\bpin\s*cone\b/gi, to: "Pinecone", when: /\b(vector|embedding|llm|rag|similarity|search)\b/i },
      // "karma" could be test runner
      { re: /\bkarma\b/gi, to: "Karma", when: /\b(test|angular|jasmine|unit|runner)\b/i },
      // "jest" only as test framework
      { re: /\bjest\b/gi, to: "Jest", when: /\b(test|unit|mock|react|typescript|coverage)\b/i },
      // "wire" vs "Webpack"
      { re: /\bweb\s*pack\b/gi, to: "Webpack", when: /\b(bundle|build|module|react|javascript|frontend)\b/i },
      // "vite" (pronounced "veet")
      { re: /\bveet\b/gi, to: "Vite", when: /\b(build|frontend|react|vue|bundle|module)\b/i },
      // "harbor" vs "Harbour" vs "Harbor" (container registry)
      { re: /\bharbor\b/gi, to: "Harbor", when: /\b(docker|registry|kubernetes|container|image)\b/i },
      // "helm" (Kubernetes package manager)
      { re: /\bhelm\b/gi, to: "Helm", when: /\b(kubernetes|chart|deploy|cluster|k8s)\b/i },
      // "air flow" vs "Airflow"
      { re: /\bair\s+flow\b/gi, to: "Airflow", when: /\b(dag|pipeline|etl|data|scheduler|task)\b/i },
      // "hive" vs "Apache Hive"
      { re: /\bhive\b/gi, to: "Hive", when: /\b(hadoop|query|sql|data|warehouse|mapreduce)\b/i },
      // "sparky" vs "Spark"
      { re: /\bsparky?\b/gi, to: "Spark", when: /\b(hadoop|data|streaming|rdd|dataframe|pyspark)\b/i },
      // "chaos" vs "Kaos" / "Chaos Engineering"
      { re: /\bchaos\s+engineering\b/gi, to: "chaos engineering", when: /\b(resilience|fault|test|service|microservice)\b/i },
      // "fire base" vs "Firebase"
      { re: /\bfire\s*base\b/gi, to: "Firebase", when: /\b(google|auth|realtime|database|push|mobile|cloud)\b/i },
    ];
    for (const rule of contextualFixes) {
      if (rule.when.test(text)) {
        text = text.replace(rule.re, rule.to);
      }
    }

    // Collapse repeated tokens and short repeated phrases from noisy ASR.
    text = text
      .replace(/\b(\w+)(?:\s+\1){1,}\b/gi, "$1")
      .replace(/\b((?:\w+\s+){1,4}\w+)\s+\1\b/gi, "$1")
      .replace(/\s+/g, " ")
      .trim();

    // Collapse repeated joiner noise:
    // "and and", "also also", "and also and also", etc.
    text = text
      .replace(/\b(and also)(?:\s+\1)+\b/gi, "and also")
      .replace(/\b(and)(?:\s+and)+\b/gi, "and")
      .replace(/\b(also)(?:\s+also)+\b/gi, "also")
      .replace(/\b(?:and\s+also\s+){2,}/gi, "and also ")
      // Remove joiner-only tails: "... and also", "... and", "... also"
      .replace(/\s+\b(and also|and|also)\b\s*$/i, "")
      // Clean malformed "difference between and also X" patterns.
      .replace(/\bdifference between(?:\s+(?:and|also|and also))+/gi, "difference between ")
      .replace(/\s+/g, " ")
      .trim();

    if (mode === "final") {
      // Lightweight grammar/tense rewrites for common ASR artifacts.
      text = text
        .replace(/\bi will\b(?=\s+(?:\w+\s+){0,4}(?:service|services|api|apis|pipeline|pipelines)\b)/gi, "I built")
        .replace(/\bi was in developing\b/gi, "I was developing")
        .replace(/\bfocus on building my identity in\b/gi, "I focus on building")
        .replace(/\bi have worked actually with larger data\b/gi, "I have worked with large datasets")
        .replace(/\bat working in\s+/gi, "I worked at ")
        .replace(/\bwhere do you work currently\??\s+he said\.?$/i, "Where do you work currently?")
        .replace(/\s+/g, " ")
        .trim();
    }

    if (mode === "final") {
      const qLike = /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|is|are|tell|walk|explain)\b/i.test(text);
      if (qLike && !/[?.!]$/.test(text)) {
        text = `${text}?`;
      } else if (!qLike && !/[?.!]$/.test(text)) {
        text = `${text}.`;
      }
      // Sentence-case for final transcript readability.
      if (text.length > 0) {
        text = text.charAt(0).toUpperCase() + text.slice(1);
      }
    }
    return text;
  }, [cleanAsrNoise]);

  const sanitizeDisplayedAnswerText = useCallback((raw: string): string => {
    const text = String(raw || "");
    if (!text) return "";
    return text
      .replace(/\binterviewer\s*:\s*/gi, "")
      .replace(/\bcandidate\s*:\s*/gi, "")
      .replace(/(^|\s)q\d+\s*:\s*/gi, "$1")
      .replace(/(^|\n)\s*question\s*\d+\s*:\s*/gi, "$1")
      .replace(/^\s*[,:;.-]+\s*/g, "")
      .replace(/[^\S\n]{2,}/g, " ");
  }, []);

  const isCodeRequestQuestion = useCallback((question?: string): boolean => {
    if (!question) return false;
    if (/(show|share|provide|give)\s+(me\s+)?(the\s+)?(code|snippet|implementation)/i.test(question)) return true;
    // Require an explicit production verb ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â bare "code" / "coding" in a question is NOT enough
    if (/\b(write|implement|build|create|develop)\b/i.test(question)) return true;
    if (/\b(snippet|leetcode|pseudocode)\b/i.test(question)) return true;
    if (/\b(sql|regex|bash script|shell script)\b/i.test(question)) return true;
    const q = question.toLowerCase();
    return /\bexample\b/.test(q) && /\b(snippet|implementation)\b/.test(q);
  }, []);

  const isStrictCodeOnlyRequest = useCallback((question?: string): boolean => {
    if (!question) return false;
    if (/\b(explain|why|how does|how do|what does|purpose|reason)\b/i.test(question)) return false;
    if (/\b(modify|change|update|fix|optimize|improve|refactor|extend|convert)\b/i.test(question)) return false;
    return /\b(only code|just code|code only|only the code|just the code|write only the code|return only code|give me only code)\b/i.test(question);
  }, []);

  const isCodeLikeAnswer = useCallback((answer?: string): boolean => {
    if (!answer) return false;
    if (/```/.test(answer)) return true;
    const text = String(answer);
    const codeTokens = /(def\s+\w+\s*\(|class\s+\w+[:\s]|return\s+|if\s+.+:|elif\s+|else:|\bimport\b|from\s+\w+\s+import|\bprint\s*\(|\bconst\b|\blet\b|\bvar\b|\bfunction\b|\bpublic\b|\bstatic\b|\bSystem\.out\.print|#include\b|\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b)/i.test(text);
    const codeSymbols = /[{}();=]/.test(text);
    const hasLineBreaks = /\n/.test(text);
    return codeTokens && (codeSymbols || hasLineBreaks);
  }, []);

  const shouldDisplayAnswerAsCode = useCallback((question?: string, answer?: string): boolean => {
    if (!answer) return false;
    const hasFence = /```/.test(answer);

    // Screen-share / coding-screen analysis ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â always code layout.
    if (/\b(screen capture analysis|coding screen|visible code|shared coding screen)\b/i.test(question || "")) {
      return true;
    }

    // Strict "code only" request ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â always code layout.
    if (isStrictCodeOnlyRequest(question)) return hasFence || isCodeLikeAnswer(answer);

    // Explicit "write / implement / show me code" request with a code block in answer.
    if (isCodeRequestQuestion(question) && hasFence) return true;

    // Answer is PREDOMINANTLY code: code-fence content covers >60% of total length
    // AND the non-code text is very short (not a prose explanation with a small snippet).
    // This catches AI responses that are basically pure code even without an explicit request.
    if (hasFence) {
      const totalLen = answer.length;
      const codeBlocks = answer.match(/```[\s\S]*?```/g) || [];
      const codeLen = codeBlocks.reduce((sum, m) => sum + m.length, 0);
      const proseText = answer.replace(/```[\s\S]*?```/g, "").trim();
      const proseWords = proseText.split(/\s+/).filter(Boolean).length;
      // Show code layout only when the answer is majority code AND has minimal prose.
      if (codeLen / totalLen > 0.6 && proseWords < 30) return true;
    }

    // Everything else (experience questions, behavioural, explanations with inline code
    // examples, etc.) ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ return false so MarkdownRenderer renders prose + code blocks
    // together without stripping the explanation.
    return false;
  }, [isCodeLikeAnswer, isCodeRequestQuestion, isStrictCodeOnlyRequest]);

  const isExplainFollowup = useCallback((question?: string): boolean => {
    if (!question) return false;
    return /\b(why|explain|explanation|how does|how do|what does|what is the purpose|reason|line by line|each line|step by step|walk me through)\b/i.test(question);
  }, []);

  const wantsLineByLineExplanation = useCallback((question?: string): boolean => {
    if (!question) return false;
    return /\b(line by line|each line|every line)\b/i.test(question);
  }, []);

  const isModifyCodeFollowup = useCallback((question?: string): boolean => {
    if (!question) return false;
    return /\b(add|change|update|fix|optimize|improve|refactor|extend|modify|include|convert)\b/i.test(question);
  }, []);

  const isShortContextualFollowup = useCallback((question?: string): boolean => {
    if (!question) return false;
    const normalized = String(question).toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
    const words = normalized.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 8) return false;
    return /^(why|how|how so|why so|what do you mean|which one|which part|can you expand|expand|tell me more|go deeper|what happened next|then what|and why|and how)\b/.test(normalized);
  }, []);

  const inferCodeLanguage = useCallback((question?: string, answer?: string): string => {
    const text = `${question || ""} ${answer || ""}`.toLowerCase();
    if (/\bpython\b/.test(text)) return "python";
    if (/\btypescript\b|\bts\b/.test(text)) return "typescript";
    if (/\bjavascript\b|\bjs\b/.test(text)) return "javascript";
    if (/\bjava\b/.test(text)) return "java";
    if (/\bc#\b|csharp|\.net|dotnet/.test(text)) return "csharp";
    if (/\bsql\b|postgres|postgresql|mysql|mssql/.test(text)) return "sql";
    if (/\bregex\b/.test(text)) return "regex";
    if (/\bbash\b|\bshell\b|\bcommand\b/.test(text)) return "bash";
    if (/\bhtml\b|\bcss\b/.test(text)) return "html";
    if (/\bjson\b/.test(text)) return "json";

    // Heuristic fallback based on code-like tokens.
    const code = String(answer || "");
    if (/\bdef\s+\w+\s*\(|\bclass\s+\w+:\b|\bprint\s*\(/i.test(code)) return "python";
    if (/\b(function|const|let|var)\b|=>/.test(code)) return "javascript";
    if (/\bpublic\s+static\b|\bclass\s+\w+\b/.test(code)) return "java";
    if (/\busing\s+System\b|\bnamespace\b/i.test(code)) return "csharp";
    if (/\bselect\b|\binsert\b|\bupdate\b|\bdelete\b/i.test(code)) return "sql";
    if (/^#!/.test(code) || /\b(echo|grep|awk|sed)\b/.test(code)) return "bash";
    return "";
  }, []);

  const formatSingleLineCode = useCallback((code: string, lang: string): string => {
    const raw = String(code || "").trim();
    if (!raw || raw.includes("\n")) return raw;
    // Python reflow for one-line outputs.
    if (lang === "python") {
      let text = raw;
      // Split multiple def/class blocks on the same line.
      text = text.replace(/\s+(?=def\s+\w+\s*\()/g, "\n");
      text = text.replace(/\s+(?=class\s+\w+\s*:)/g, "\n");
      text = text.replace(/\s+(def\s+\w+\s*\([^)]*\))\s*:/i, "\n$1:");
      text = text.replace(/\s+(class\s+\w+)\s*:/i, "\n$1:");
      text = text.replace(/\s+(if|elif|else|return|for|while|try|except|with|raise)\b/g, "\n$1");
      text = text.replace(/\s+(?=(\w+\s*=|if|elif|else|return|print|input|for|while|try|except|with|raise)\b)/g, "\n");
      text = text.replace(/\)\s+(?=(\w+\s*=|if|elif|else|return|print|input|for|while|try|except|with|raise)\b)/g, ")\n");
      text = text.replace(/\s+print\s*\(/g, "\nprint(");
      text = text.replace(/\s+input\s*\(/g, "\ninput(");
      text = text.replace(/\s+float\s*\(/g, "\nfloat(");
      text = text.replace(/\s+int\s*\(/g, "\nint(");
      text = text.replace(/\s+str\s*\(/g, "\nstr(");
      text = text.replace(/;\s*/g, "\n");
      text = text.replace(/\s*:\s*/g, ":\n");
      text = text.replace(/\s+/g, " ").trim();
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

      const indentKeywords = /^(def|if|elif|else|for|while|try|except|with)\b/;
      const out: string[] = [];
      let indent = 0;
      const decBefore = /^(elif|else|except|finally)\b/;
      for (const line of lines) {
        if (decBefore.test(line)) indent = Math.max(0, indent - 1);
        out.push(`${" ".repeat(indent * 4)}${line}`);
        if (indentKeywords.test(line) && line.endsWith(":")) indent += 1;
      }
      return out.join("\n");
    }

    // JavaScript/TypeScript/Java/C#/C++ basic reflow.
    if (["javascript", "typescript", "java", "csharp", "cpp", "c++"].includes(lang)) {
      let text = raw;
      text = text.replace(/\s+(?=using\s+\w+)/gi, "\n");
      text = text.replace(/\s+(?=namespace\s+\w+)/gi, "\n");
      text = text.replace(/\s*;\s*/g, ";\n");
      text = text.replace(/\s*{\s*/g, " {\n");
      text = text.replace(/\s*}\s*/g, "\n}\n");
      text = text.replace(/\s+(?=(public|private|protected|static|class|interface|if|else|for|while|try|catch|finally)\b)/g, "\n");
      text = text.replace(/\)\s+(?=(public|private|protected|static|class|if|else|for|while|try|catch|finally|\w+\s*=))?/g, ")\n");
      text = text.replace(/\s+(else if|else|catch|finally)\b/g, "\n$1");
      text = text.replace(/\s+(?=Console\.)/g, "\n");
      text = text.replace(/\s+/g, " ").trim();
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      return lines.join("\n");
    }

    // SQL basic reflow.
    if (lang === "sql") {
      let text = raw;
      text = text.replace(/\s+(select|from|where|group by|order by|having|insert into|update|delete from|values|join|left join|right join|inner join|outer join)\b/gi, "\n$1");
      text = text.replace(/\s*,\s*/g, ", ");
      text = text.replace(/\s+/g, " ").trim();
      return text.replace(/\n+/g, "\n").trim();
    }

    // Bash/shell basic reflow.
    if (lang === "bash") {
      let text = raw;
      text = text.replace(/\s*;\s*/g, ";\n");
      text = text.replace(/\s*(\&\&|\|\|)\s*/g, " $1\n");
      text = text.replace(/\s+/g, " ").trim();
      return text.replace(/\n+/g, "\n").trim();
    }

    return raw;
  }, []);

  const normalizeCodeFences = useCallback((answer?: string, question?: string): string => {
    if (!answer) return "";
    let text = String(answer);
    const hasFence = /```/.test(text);
    const lang = inferCodeLanguage(question, text);
    const normalizedLang = lang || "text";

    // If model outputs a bare language label line (e.g., "python"), convert it to a fence.
    text = text.replace(/(^|\n)\s*(python|javascript|typescript|java|c#|csharp|sql|bash|shell|html|css|json)\s*(?=\n)/gi, (_m, lead, label) => {
      const l = label.toLowerCase() === "shell" ? "bash" : label.toLowerCase();
      return `${lead}\`\`\`${l}`;
    });
    // If answer starts with a language label line, strip it so we can wrap cleanly.
    text = text.replace(/^\s*(python|javascript|typescript|java|c#|csharp|sql|bash|shell|html|css|json)\s*\n+/i, "");

    const findCodeStart = (value: string, language: string): number => {
      const v = value;
      if (language === "python") {
        const m = /\b(def|class)\b/.exec(v);
        return m ? m.index : -1;
      }
      if (language === "javascript" || language === "typescript") {
        const m = /\b(function|class|const|let|var)\b/.exec(v);
        return m ? m.index : -1;
      }
      if (language === "sql") {
        const m = /\b(select|insert|update|delete)\b/i.exec(v);
        return m ? m.index : -1;
      }
      return -1;
    };

    const nowHasFence = /```/.test(text);
    if (!nowHasFence && shouldDisplayAnswerAsCode(question, text)) {
      const codeStart = findCodeStart(text, lang);
      if (codeStart > 0) {
        const prefix = text.slice(0, codeStart).trim();
        const code = text.slice(codeStart).trim();
        const formatted = formatSingleLineCode(code, lang);
        return `${prefix}\n\n\`\`\`${normalizedLang}\n${formatted}\n\`\`\``;
      }
      const formatted = formatSingleLineCode(text, lang);
      return `\`\`\`${normalizedLang}\n${formatted}\n\`\`\``;
    }

    // If prose is inline with the fence, split it out so code starts on a new line.
    text = text.replace(/```(\w+)?[ \t]+/g, (_m, fenceLang) => `\`\`\`${fenceLang || ""}\n`);

    // Normalize fences to be on their own lines.
    text = text.replace(/```(\w+)?\s*/g, (_m, fenceLang) => `\`\`\`${fenceLang || ""}\n`);
    text = text.replace(/\s*```/g, "\n```");

    // Reflow single-line code inside fenced blocks.
    text = text.replace(/```(\w+)?\n([\s\S]*?)\n```/g, (_m, fenceLang, body) => {
      const fenceLangNorm = String(fenceLang || "").toLowerCase() || normalizedLang;
      const trimmed = String(body || "").trim();
      const formatted = formatSingleLineCode(trimmed, fenceLangNorm);
      return `\`\`\`${fenceLangNorm}\n${formatted}\n\`\`\``;
    });
    return text;
  }, [formatSingleLineCode, inferCodeLanguage, shouldDisplayAnswerAsCode]);

  const extractFirstCodeBlock = useCallback((text: string): string => {
    const match = text.match(/```(\w+)?\n([\s\S]*?)\n```/);
    if (!match) return "";
    const lang = match[1] || "";
    const body = match[2] || "";
    return `\`\`\`${lang}\n${body}\n\`\`\``;
  }, []);

  const enforceCodeOnlyDisplay = useCallback((answer?: string, question?: string): string => {
    const normalized = normalizeCodeFences(answer, question);

    // Find the first fenced code block position so we can keep any prose that
    // appears before it (the explanation the AI puts above the code).
    const fenceMatch = normalized.match(/```[\s\S]*?```/);
    if (fenceMatch && fenceMatch.index !== undefined) {
      const proseAbove = normalized.slice(0, fenceMatch.index).trim();
      const codeBlock = fenceMatch[0];
      // Also collect any "What changed:" section that follows the code block.
      const afterCode = normalized.slice(fenceMatch.index + codeBlock.length).trim();
      const whatChangedMatch = afterCode.match(/^(what changed[\s\S]*)/i);
      const whatChanged = whatChangedMatch ? whatChangedMatch[1].trim() : "";

      const parts = [proseAbove, codeBlock, whatChanged].filter(Boolean);
      return parts.join("\n\n");
    }

    // No fenced block found ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â wrap whole answer as code (best-effort).
    const lang = inferCodeLanguage(question, answer) || "text";
    const formatted = formatSingleLineCode(String(answer || "").trim(), lang);
    return `\`\`\`${lang}\n${formatted}\n\`\`\``;
  }, [formatSingleLineCode, inferCodeLanguage, normalizeCodeFences]);

  const streamingDisplayQuestion = streamingQuestion || pendingResponse?.question || "";
  const streamingDisplayAnswer = streamingAnswer || pendingResponse?.answer || "";
  const streamingDisplayAsCode = shouldDisplayAnswerAsCode(streamingDisplayQuestion, streamingDisplayAnswer);
  const streamingDisplayAnswerNormalized = normalizeCodeFences(streamingDisplayAnswer, streamingDisplayQuestion);
  const newestResponse = responsesLocal[0];
  const newestResponseMatchesStreaming =
    !!newestResponse?.answer
    && !!streamingDisplayAnswer
    && (
      normalizeForDedup(newestResponse.answer) === normalizeForDedup(streamingDisplayAnswer)
      || normalizeForDedup(newestResponse.question || "") === normalizeForDedup(streamingDisplayQuestion)
    );
  const shouldShowStreamingCard =
    isAwaitingFirstChunk
    || ((!!streamingAnswer || !!pendingResponse?.answer) && (!newestResponseMatchesStreaming || isStreaming));

  const buildSpeechPhraseHints = useCallback((): string[] => {
    const baseHints = [
      // Languages
      "Python", "JavaScript", "TypeScript", "Java", "Kotlin", "Go", "Golang", "Rust", "Scala",
      "Swift", "C++", "C#", ".NET", "Ruby", "PHP", "Elixir", "Haskell", "Clojure", "Dart", "R",
      "Perl", "Lua", "Julia", "Solidity", "Groovy", "F#", "Erlang", "OCaml",
      // Frontend
      "React", "React Native", "Redux", "Next.js", "Gatsby", "Remix", "Angular", "Vue.js", "Nuxt.js",
      "Svelte", "SvelteKit", "Tailwind CSS", "Bootstrap", "Material UI", "Chakra UI", "Ant Design",
      "Framer Motion", "Three.js", "D3.js", "Chart.js", "Recharts", "Zustand", "MobX",
      "React Query", "TanStack Query", "SWR", "Vite", "Webpack", "Rollup", "esbuild", "Babel",
      "ESLint", "Prettier", "Storybook", "Playwright", "Puppeteer", "Cypress", "Vitest", "Jest",
      "Jotai", "Recoil", "Zod", "Yup", "React Hook Form", "Expo", "Electron", "Tauri",
      "Turbo", "Turborepo", "Nx", "Lerna", "pnpm", "Bun", "Deno",
      // Backend
      "Node.js", "Express.js", "FastAPI", "Flask", "Django", "Spring Boot", "Spring",
      "NestJS", "Hono", "Fastify", "Koa", "Rails", "Ruby on Rails", "Laravel", "Phoenix", "Gin", "Fiber",
      "GraphQL", "REST APIs", "gRPC", "WebSocket", "tRPC", "Protobuf", "Actix", "Axum", "Rocket",
      // Databases
      "PostgreSQL", "MySQL", "SQLite", "Oracle", "SQL Server", "MongoDB", "Redis", "Cassandra",
      "DynamoDB", "Cosmos DB", "Firestore", "Firebase", "Supabase", "PlanetScale", "CockroachDB",
      "Neo4j", "InfluxDB", "TimescaleDB", "Elasticsearch", "BigQuery", "Redshift", "Snowflake",
      "Databricks", "Delta Lake", "ClickHouse", "Pinecone", "Weaviate", "Chroma",
      "Neon", "Turso", "ScyllaDB", "ArangoDB", "Couchbase", "etcd",
      // ORMs / DB tools
      "SQLAlchemy", "Prisma", "TypeORM", "Sequelize", "Drizzle", "Mongoose",
      // Cloud - AWS
      "AWS", "EC2", "ECS", "EKS", "Lambda", "S3", "S3 Buckets", "RDS", "DynamoDB", "SQS", "SNS",
      "EventBridge", "API Gateway", "CloudFront", "Route 53", "CloudFormation", "CDK", "Fargate",
      "Elastic Beanstalk", "ElastiCache", "IAM", "VPC", "CloudWatch", "Step Functions",
      "Secrets Manager", "Parameter Store", "Cognito", "Amplify", "AppSync", "Glue", "Athena",
      "Kinesis", "MSK", "ECR", "ACM", "WAF", "Shield", "GuardDuty",
      // Cloud - Azure
      "Azure", "Azure DevOps", "Azure Functions", "Azure Blob Storage", "Azure Service Bus",
      "Azure Kubernetes Service", "Azure Container Apps", "Azure Active Directory",
      "Azure Cosmos DB", "Azure SQL", "Azure Monitor", "Azure Key Vault",
      "Azure Event Hub", "Azure Data Factory", "Azure Synapse",
      // Cloud - GCP
      "GCP", "Google Cloud", "GKE", "Cloud Run", "Cloud Functions", "Cloud Storage",
      "Pub/Sub", "BigQuery", "Spanner", "Firestore", "Vertex AI", "Cloud Build",
      "Cloud Composer", "Dataflow", "Looker",
      // Deployment platforms
      "Vercel", "Netlify", "Fly.io", "Railway", "Render", "Heroku",
      "Cloudflare", "Cloudflare Workers", "Cloudflare Pages", "Deno Deploy",
      // DevOps / Infrastructure
      "Docker", "Kubernetes", "Helm", "Argo CD", "Istio", "Linkerd", "Consul", "Envoy",
      "Terraform", "Pulumi", "Ansible", "Chef", "Puppet", "Vagrant",
      "CI/CD", "Jenkins", "GitHub Actions", "GitLab", "GitLab CI", "CircleCI", "Travis CI",
      "Bitbucket", "GitHub", "Tekton", "Spinnaker", "FluxCD",
      "etcd", "Packer", "Vault", "Nomad", "Boundary",
      // Messaging / Streaming
      "Kafka", "RabbitMQ", "Celery", "SQS", "ActiveMQ", "NATS", "Apache Pulsar", "Redis Streams",
      "Apache Flink", "Flink",
      // Observability
      "Prometheus", "Grafana", "Datadog", "Kibana", "OpenTelemetry", "Jaeger", "Zipkin",
      "New Relic", "Splunk", "Dynatrace", "Loki", "Tempo", "Sentry", "PagerDuty",
      // ML / AI / Data
      "TensorFlow", "PyTorch", "scikit-learn", "NumPy", "Pandas", "Matplotlib", "Seaborn",
      "PySpark", "Spark", "Hadoop", "Airflow", "dbt", "Prefect", "Dagster", "MLflow",
      "Hugging Face", "LangChain", "LangGraph", "OpenAI", "LLM", "RAG", "Fine-tuning",
      "Polars", "Dask", "Ray", "XGBoost", "LightGBM", "Keras", "ONNX",
      "Trino", "Presto", "Hive", "Flink", "dbt",
      // Python ecosystem
      "FastAPI", "Pydantic", "uvicorn", "gunicorn", "Celery", "pytest", "Poetry", "pip",
      "virtualenv", "conda", "Jupyter", "Alembic",
      // Security / Auth
      "JWT", "OAuth", "OAuth 2.0", "SAML", "LDAP", "RBAC", "ABAC", "CORS", "CSRF",
      "mTLS", "SSL", "TLS", "OWASP", "HashiCorp Vault", "Keycloak", "Okta", "Auth0",
      "OpenID Connect", "SSO", "MFA", "Zero Trust", "SIEM", "SOC 2",
      // Protocols / Standards
      "REST API", "gRPC", "GraphQL", "WebSocket", "HTTP", "HTTPS", "OpenAPI", "Swagger",
      "Protobuf", "Avro", "Parquet", "JSON", "YAML", "XML",
      // Concepts
      "microservices", "serverless", "DevOps", "DevSecOps", "GitOps", "SRE",
      "event-driven architecture", "CQRS", "event sourcing", "domain-driven design",
      "load balancing", "rate limiting", "circuit breaker", "API gateway",
      "blue-green deployment", "canary deployment", "zero-downtime deployment",
      "horizontal scaling", "vertical scaling", "sharding", "replication",
      "distributed systems", "CAP theorem", "eventual consistency", "idempotency",
      "twelve-factor app", "clean architecture", "SOLID principles",
      "design patterns", "monorepo", "multitenant", "multitenancy",
      // Testing
      "unit testing", "integration testing", "end-to-end testing", "TDD", "BDD",
      "pytest", "Jest", "Vitest", "Cypress", "Playwright", "Selenium", "TestNG", "JUnit",
      "Mockito", "Locust", "k6", "Gatling", "SonarQube", "Artillery",
      // Mobile
      "Flutter", "Expo", "React Native", "SwiftUI", "Jetpack Compose",
      // Other common
      "Nginx", "Apache", "HAProxy", "Traefik", "Linux", "Bash", "shell scripting",
      "Docker Compose", "Podman", "Makefile", "Jira", "Confluence",
      "WebAssembly", "WASM", "OpenAPI", "AsyncAPI", "Kafka Streams",
      // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Data structures & algorithms ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
      "array", "linked list", "doubly linked list", "stack", "queue", "deque",
      "hash map", "hash table", "hash set", "binary tree", "binary search tree",
      "balanced BST", "AVL tree", "red-black tree", "B-tree", "trie", "segment tree",
      "Fenwick tree", "heap", "min heap", "max heap", "priority queue",
      "graph", "directed graph", "undirected graph", "weighted graph", "adjacency list",
      "adjacency matrix", "matrix", "two-dimensional array",
      // Algorithms
      "binary search", "linear search", "depth-first search", "breadth-first search",
      "DFS", "BFS", "Dijkstra", "Bellman-Ford", "Floyd-Warshall", "A star",
      "dynamic programming", "memoization", "tabulation", "greedy algorithm",
      "divide and conquer", "backtracking", "recursion", "two pointers",
      "sliding window", "bit manipulation", "topological sort",
      "merge sort", "quick sort", "heap sort", "bubble sort", "insertion sort",
      "selection sort", "counting sort", "radix sort", "bucket sort",
      "KMP algorithm", "Rabin-Karp", "Z algorithm", "Manacher",
      "union find", "disjoint set", "Kruskal", "Prim", "spanning tree",
      // Complexity
      "Big O notation", "time complexity", "space complexity",
      "O of N", "O of log N", "O of N squared", "O of N log N",
      "constant time", "linear time", "quadratic time", "exponential time",
      "amortized complexity",
      // OOP / Design
      "object-oriented programming", "OOP", "inheritance", "polymorphism",
      "encapsulation", "abstraction", "interface", "abstract class",
      "design patterns", "Singleton", "Factory", "Abstract Factory",
      "Builder", "Prototype", "Adapter", "Bridge", "Composite", "Decorator",
      "Facade", "Flyweight", "Proxy", "Chain of Responsibility", "Command",
      "Iterator", "Mediator", "Memento", "Observer", "State", "Strategy",
      "Template Method", "Visitor", "Dependency Injection",
      "SOLID", "Single Responsibility", "Open Closed", "Liskov Substitution",
      "Interface Segregation", "Dependency Inversion",
      // Functional programming
      "functional programming", "pure function", "immutability", "closures",
      "higher-order functions", "map filter reduce", "currying", "composition",
      "monad", "functor", "lambda",
      // Concurrency
      "multithreading", "concurrency", "parallelism", "async await",
      "asynchronous", "synchronous", "thread", "process", "coroutine",
      "mutex", "semaphore", "deadlock", "race condition", "thread safety",
      "atomic operation", "lock", "event loop", "callback", "promise",
      "future", "goroutine", "channel",
      // Memory / OS
      "garbage collection", "memory management", "heap memory", "stack memory",
      "memory leak", "pointer", "reference", "pass by value", "pass by reference",
      "virtual memory", "cache", "CPU cache", "L1 cache", "L2 cache",
      "context switch", "process scheduling", "deadlock prevention",
      // System design
      "consistent hashing", "load balancer", "CDN", "content delivery network",
      "horizontal scaling", "vertical scaling", "database sharding",
      "database replication", "primary replica", "read replica",
      "caching strategy", "cache invalidation", "write through", "write back",
      "message queue", "pub sub", "event driven", "SAGA pattern",
      "API design", "REST", "rate limiting", "throttling", "pagination",
      "websocket", "long polling", "server-sent events", "heartbeat",
      "service mesh", "sidecar pattern", "strangler fig", "CQRS",
      // Networking
      "TCP", "UDP", "HTTP", "HTTPS", "HTTP2", "HTTP3", "QUIC",
      "DNS", "IP address", "subnet", "NAT", "firewall", "proxy",
      "TLS handshake", "SSL certificate", "WebSocket protocol",
      // Coding interview platforms
      "LeetCode", "HackerRank", "CodeSignal", "GeeksforGeeks",
      // SQL / DB query
      "SQL query", "JOIN", "INNER JOIN", "LEFT JOIN", "RIGHT JOIN", "FULL JOIN",
      "GROUP BY", "ORDER BY", "WHERE", "HAVING", "subquery", "CTE",
      "window function", "PARTITION BY", "indexing", "query optimization",
      "database normalization", "denormalization", "ACID", "transactions",
      "deadlock in database", "N plus one problem", "ORM query",
    ];
    const dynamicText = `${customPrompt || ""}\n${conversationHistory || ""}`;
    const dynamic: string[] = [];
    for (const term of baseHints) {
      const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(dynamicText)) dynamic.push(term);
    }
    return [...new Set([...baseHints, ...dynamic])].slice(0, 1000);
  }, [customPrompt, conversationHistory]);

  const autocorrectNoisyQuestionWithContext = useCallback((raw: string): string => {
    let text = String(raw || "").trim();
    if (!text) return "";

    // Strip trailing STT noise fragments like "And. And." or "And. Or." that Azure
    // emits when it picks up brief filler sounds between sentences.
    // e.g. "Do you have experience in Azure And. And." ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ "Do you have experience in Azure"
    text = text.replace(/(\s+\b(and|or|but|so|also)\b[.,]?\s*){2,}$/gi, "").trim();
    text = text.replace(/\s+\b(and|or|but|so)\b[.]\s*$/gi, "").trim();
    const hintSet = new Set(
      buildSpeechPhraseHints()
        .map((h) => String(h || "").toLowerCase().replace(/\s+/g, " ").trim())
        .filter(Boolean),
    );
    const h = (term: string): boolean => {
      const t = term.toLowerCase().replace(/\s+/g, " ").trim();
      if (!t) return false;
      if (hintSet.has(t)) return true;
      const tight = t.replace(/\s+/g, "");
      for (const v of hintSet) { if (v.replace(/\s+/g, "") === tight) return true; }
      return false;
    };

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Languages ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("Python"))
      text = text.replace(/\b(pie\s*th?on|pai\s*thon|paith?an|pyt?hone|pie\s*ton|paython)\b/gi, "Python");
    if (h("JavaScript"))
      text = text.replace(/\b(java\s*scripts?|java\s*scr?ipt|j\s*s)\b/gi, "JavaScript");
    if (h("TypeScript"))
      text = text.replace(/\b(type\s*scripts?|type\s*scr?ipt|t\s*s)\b/gi, "TypeScript");
    if (h("Kotlin"))
      text = text.replace(/\b(cotlin|kot\s*lin|coatlin)\b/gi, "Kotlin");
    if (h("Golang") || h("Go"))
      text = text.replace(/\b(go\s*lang|go\s*language)\b/gi, "Go");
    if (h("Scala"))
      text = text.replace(/\b(skala|sc?ala)\b/gi, "Scala");
    if (h(".NET") || h("dotnet"))
      text = text.replace(/\b(dot\s*net|the\s*net|dotnet)\b/gi, ".NET");
    if (h("C#"))
      text = text.replace(/\b(c\s*sharp|c\s*hash|see\s*sharp)\b/gi, "C#");
    if (h("C++"))
      text = text.replace(/\b(c\s*plus\s*plus|c\s*\+\s*\+|cpp)\b/gi, "C++");
    if (h("Rust"))
      text = text.replace(/\b(rast\b|rusted?\s*lang|rust\s*language|ruste?\s*lang)\b/gi, "Rust");
    if (h("Ruby"))
      text = text.replace(/\b(rubi\b|rubby\b|rooby\b|ruubi)\b/gi, "Ruby");
    if (h("Rails") || h("Ruby on Rails"))
      text = text.replace(/\b(ruby\s*on\s*rails?|rail\s*s|rayls|rales|rials)\b/gi, "Rails");
    if (h("PHP"))
      text = text.replace(/\b(p\s*h\s*p|pee\s*h\s*pee|pe\s*h\s*pe|php)\b/gi, "PHP");
    if (h("Elixir"))
      text = text.replace(/\b(ely\s*xir|alex\s*ir|eli\s*xir|elixer)\b/gi, "Elixir");
    if (h("Phoenix"))
      text = text.replace(/\b(fen\s*ix|foenix|pho\s*nix|phoe\s*nix|feenix|fenix)\b/gi, "Phoenix");
    if (h("Swift"))
      text = text.replace(/\b(swif\b|swifts?\s*lang|swift\s*language)\b/gi, "Swift");
    if (h("Dart"))
      text = text.replace(/\b(dart\s*lang|darrt)\b/gi, "Dart");
    if (h("Golang") || h("Go"))
      text = text.replace(/\b(goo\s*lang|go\s*lang|go\s*language|golang)\b/gi, "Go");
    if (h("Flutter"))
      text = text.replace(/\b(flutt?er|fluter|flatr)\b/gi, "Flutter");
    if (h("Kotlin"))
      text = text.replace(/\b(cotlin|kot\s*lin|coatlin|coat\s*lin)\b/gi, "Kotlin");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Frontend frameworks ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("React"))
      text = text.replace(/\b(reaction|reacted|react\s*j\s*s|reactjs|re\s*act|reactor|pre\s*act)\b/gi, "React");
    if (h("React Native"))
      text = text.replace(/\b(react\s*nate\s*iv|react\s*nativ|react\s*natives?)\b/gi, "React Native");
    if (h("Next.js"))
      text = text.replace(/\b(next\s*j\s*s|nextjs|next\s*jay\s*s|next\s*jay\s*es)\b/gi, "Next.js");
    if (h("Vue.js") || h("Vue"))
      text = text.replace(/\b(view\s*j\s*s|view\s*js|vyu\s*js?|boo\s*js?|vue\s*j\s*s|vyu|vu\s*js?)\b/gi, "Vue.js");
    if (h("Angular"))
      text = text.replace(/\b(anguler|angulur|angular\s*js|angul[ae]r)\b/gi, "Angular");
    if (h("Svelte"))
      text = text.replace(/\b(swelt|svelt)\b/gi, "Svelte");
    if (h("Nuxt.js") || h("Nuxt"))
      text = text.replace(/\b(nuxt\s*j\s*s|nuxtjs|nu\s*xt)\b/gi, "Nuxt.js");
    if (h("Gatsby"))
      text = text.replace(/\b(gats\s*by|gat\s*sby)\b/gi, "Gatsby");
    if (h("Redux"))
      text = text.replace(/\b(re\s*dux|re\s*ducks)\b/gi, "Redux");
    if (h("Webpack"))
      text = text.replace(/\b(web\s*peck|web\s*pak|veb\s*pack|web\s*packs?)\b/gi, "Webpack");
    if (h("Tailwind CSS") || h("Tailwind"))
      text = text.replace(/\b(tail\s*wind|tail\s*winds?|tail\s*wind\s*css)\b/gi, "Tailwind CSS");
    if (h("Zustand"))
      text = text.replace(/\b(zoo\s*stand|zou\s*stand|zus\s*tand)\b/gi, "Zustand");
    if (h("Vite"))
      text = text.replace(/\b(veet\b|vi\s*tee\b|vi8\b)\b/gi, "Vite");
    if (h("esbuild"))
      text = text.replace(/\b(es\s*build|es-build)\b/gi, "esbuild");
    if (h("Deno"))
      text = text.replace(/\b(dee\s*no|de\s*no\s*js)\b/gi, "Deno");
    if (h("Bun"))
      text = text.replace(/\b(bun\s*js|bun\s*jay\s*s)\b/gi, "Bun");
    if (h("Turborepo") || h("Turbo"))
      text = text.replace(/\b(turbo\s*repo|turbo\s*repository)\b/gi, "Turborepo");
    if (h("Electron"))
      text = text.replace(/\b(electr?on\s*js|electon)\b/gi, "Electron");
    if (h("Zod"))
      text = text.replace(/\b(zod\s*schema|zod\s*validation)\b/gi, "Zod");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Backend frameworks ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("FastAPI"))
      text = text.replace(/\b(fast\s*api|fast\s*apis|fastapi|fast\s*a\s*p\s*i|fasta\s*pi|fast\s*pi[es]?)\b/gi, "FastAPI");
    if (h("Flask"))
      text = text.replace(/\b(flash|flast|foster|flaask|flas)\b/gi, "Flask");
    if (h("Django"))
      text = text.replace(/\b(jango|dingo|jingo|jan\s*go|djan\s*go)\b/gi, "Django");
    if (h("Spring Boot") || h("Spring"))
      text = text.replace(/\b(spring\s*boots?|spring\s*boot\s*framework)\b/gi, "Spring Boot");
    if (h("Node.js"))
      text = text.replace(/\b(node\s*j\s*s|nodejs|node\s*jay\s*e?ss?)\b/gi, "Node.js");
    if (h("Express.js") || h("Express"))
      text = text.replace(/\b(express\s*j\s*s|expressjs|ex\s*press\s*js)\b/gi, "Express.js");
    if (h("NestJS") || h("NestJs"))
      text = text.replace(/\b(nest\s*j\s*s|nestjs|nest\s*jay\s*s)\b/gi, "NestJS");
    if (h("GraphQL"))
      text = text.replace(/\b(graph\s*ql|graph-ql|grapple\s*ql|graph\s*cue\s*l|gra\s*ful)\b/gi, "GraphQL");
    if (h("gRPC"))
      text = text.replace(/\b(gripe\s*c|grip\s*c|g\s*r\s*p\s*c|grpc|g\s*rpc)\b/gi, "gRPC");
    if (h("Protobuf") || h("Protocol Buffers"))
      text = text.replace(/\b(proto\s*buf+[ef]?|proto\s*buffer|protocol\s*buffer)\b/gi, "Protobuf");
    if (h("tRPC"))
      text = text.replace(/\b(t\s*rpc|trpk)\b/gi, "tRPC");
    if (h("Laravel"))
      text = text.replace(/\b(lara\s*vel|laro\s*vel|lara\s*vell|laura\s*vel)\b/gi, "Laravel");
    if (h("Rails") || h("Ruby on Rails"))
      text = text.replace(/\b(ruby\s*on\s*rails?)\b/gi, "Ruby on Rails");
    if (h("Gin"))
      text = text.replace(/\b(gin\s*framework|gin\s*golang)\b/gi, "Gin");
    if (h("Fiber"))
      text = text.replace(/\b(fiber\s*golang|fiber\s*go)\b/gi, "Fiber");
    if (h("Actix"))
      text = text.replace(/\b(act\s*ix|actix\s*web)\b/gi, "Actix");
    if (h("Axum"))
      text = text.replace(/\b(ax\s*um|ax-um)\b/gi, "Axum");
    if (h("Hono"))
      text = text.replace(/\b(hon\s*o|ho\s*no)\b/gi, "Hono");
    if (h("Fastify"))
      text = text.replace(/\b(fasti\s*fy|fast\s*ify|fastifi)\b/gi, "Fastify");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Databases ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("PostgreSQL") || h("Postgres"))
      text = text.replace(/\b(post\s*gres\s*ql?|post\s*gress?|postgre\s*sql|post\s*grace\s*sql?|postgres\s*sequel|post\s*grey\s*sql)\b/gi, "PostgreSQL");
    if (h("MySQL"))
      text = text.replace(/\b(my\s*sequel|my\s*s\s*q\s*l|mysql)\b/gi, "MySQL");
    if (h("SQLite"))
      text = text.replace(/\b(sequel\s*lite|sql\s*lite|s\s*q\s*l\s*lite)\b/gi, "SQLite");
    if (h("MongoDB"))
      text = text.replace(/\b(mongo\s*db|mongod\s*b|mongodee|mango\s*db)\b/gi, "MongoDB");
    if (h("Redis"))
      text = text.replace(/\b(red\s*is|read\s*is|read\s*ys?|read\s*ease|red\s*ease)\b/gi, "Redis");
    if (h("Cassandra"))
      text = text.replace(/\b(cass?and?ra|kass?andra)\b/gi, "Cassandra");
    if (h("DynamoDB"))
      text = text.replace(/\b(dynamo\s*db|die\s*namo\s*db?|die\s*namo|dynamic\s*db)\b/gi, "DynamoDB");
    if (h("Cosmos DB") || h("CosmosDB"))
      text = text.replace(/\b(cosmo\s*db|cosmos\s*d\s*b)\b/gi, "Cosmos DB");
    if (h("Elasticsearch"))
      text = text.replace(/\b(elastic\s*search|elast\s*search|elastic\s*serch)\b/gi, "Elasticsearch");
    if (h("BigQuery"))
      text = text.replace(/\b(big\s*query|big\s*que\s*ry)\b/gi, "BigQuery");
    if (h("Snowflake"))
      text = text.replace(/\b(snow\s*flake|snow\s*flek)\b/gi, "Snowflake");
    if (h("Databricks"))
      text = text.replace(/\b(data\s*bricks?|data\s*brick)\b/gi, "Databricks");
    if (h("Redshift"))
      text = text.replace(/\b(red\s*shift|redsh\s*ift)\b/gi, "Redshift");
    if (h("ElastiCache"))
      text = text.replace(/\b(elastic\s*cac?he?|elastic\s*cash|elasti\s*cache)\b/gi, "ElastiCache");
    if (h("CockroachDB"))
      text = text.replace(/\b(cock\s*roach\s*db|cockroach\s*d\s*b)\b/gi, "CockroachDB");
    if (h("ClickHouse"))
      text = text.replace(/\b(click\s*house)\b/gi, "ClickHouse");
    if (h("Neo4j"))
      text = text.replace(/\b(neo\s*four\s*j|ne\s*o4\s*j|neo\s*4j)\b/gi, "Neo4j");
    if (h("Firestore") || h("Firebase"))
      text = text.replace(/\b(fire\s*store|fire\s*base|fire\s*baise)\b/gi, (m) =>
        /store/i.test(m) ? "Firestore" : "Firebase");
    if (h("Supabase"))
      text = text.replace(/\b(supa\s*base|super\s*base|supar\s*base)\b/gi, "Supabase");
    if (h("Neon"))
      text = text.replace(/\b(neon\s*db|ne\s*on\s*database)\b/gi, "Neon");
    if (h("etcd"))
      text = text.replace(/\b(et\s*c\s*d|et-cd|etcid)\b/gi, "etcd");
    if (h("Couchbase"))
      text = text.replace(/\b(couch\s*base|couch\s*baze)\b/gi, "Couchbase");
    if (h("ScyllaDB") || h("Scylla"))
      text = text.replace(/\b(scylla\s*db|silla\s*db|scilla\s*db)\b/gi, "ScyllaDB");
    if (h("Pinecone"))
      text = text.replace(/\b(pine\s*cone)\b/gi, "Pinecone");
    if (h("Weaviate"))
      text = text.replace(/\b(weavi\s*ate|wee\s*viate|wave\s*iate)\b/gi, "Weaviate");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ ORM / DB tools ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("SQLAlchemy"))
      text = text.replace(/\b(sql\s*alchemy|sequel\s*alchemy|sql\s*al\s*chemy|s\s*q\s*l\s*alchemy)\b/gi, "SQLAlchemy");
    if (h("Prisma"))
      text = text.replace(/\b(priz\s*ma|pris\s*mah?)\b/gi, "Prisma");
    if (h("Mongoose"))
      text = text.replace(/\b(mongo\s*ose|moong?oose)\b/gi, "Mongoose");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Cloud - AWS ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("AWS"))
      text = text.replace(/\b(a\s*w\s*s|awes|aw\s*s)\b/gi, "AWS");
    if (h("EC2"))
      text = text.replace(/\b(easy\s*2|easy\s*to|e\s*c\s*2|ec\s*2|e\s*c2)\b/gi, "EC2");
    if (h("EKS"))
      text = text.replace(/\b(e\s*k\s*s|e\s*ks)\b/gi, "EKS");
    if (h("ECS"))
      text = text.replace(/\b(e\s*c\s*s|e\s*cs)\b/gi, "ECS");
    if (h("S3") || h("S3 Buckets"))
      text = text
        .replace(/\b(rashtri|rashtra|rastri|s\s*3|s\s*three|es\s*three|s-3)\s*(bucket|buckets)?\b/gi,
          (m) => /bucket/i.test(m) ? "S3 Buckets" : "S3")
        .replace(/\b(rashtri|rashtra|rastri)\b/gi, "S3");
    if (h("Lambda"))
      text = text.replace(/\b(lam\s*da|lamda|lumb?da)\b/gi, "Lambda");
    if (h("RDS"))
      text = text.replace(/\b(r\s*d\s*s|ards)\b/gi, "RDS");
    if (h("SQS"))
      text = text.replace(/\b(s\s*q\s*s|sq\s*s)\b/gi, "SQS");
    if (h("SNS"))
      text = text.replace(/\b(s\s*n\s*s)\b/gi, "SNS");
    if (h("IAM"))
      text = text.replace(/\b(i\s*a\s*m|iam\s*role)\b/gi, "IAM");
    if (h("VPC"))
      text = text.replace(/\b(v\s*p\s*c)\b/gi, "VPC");
    if (h("CloudFormation"))
      text = text.replace(/\b(cloud\s*form\s*ation|cloud\s*forma\s*tion)\b/gi, "CloudFormation");
    if (h("CloudFront"))
      text = text.replace(/\b(cloud\s*fr?ont)\b/gi, "CloudFront");
    if (h("CloudWatch"))
      text = text.replace(/\b(cloud\s*watch)\b/gi, "CloudWatch");
    if (h("Cognito"))
      text = text.replace(/\b(cog\s*nito|cogn?eto)\b/gi, "Cognito");
    if (h("Fargate"))
      text = text.replace(/\b(far\s*gate)\b/gi, "Fargate");
    if (h("EventBridge"))
      text = text.replace(/\b(event\s*bridge)\b/gi, "EventBridge");
    if (h("Secrets Manager"))
      text = text.replace(/\b(secrets?\s*manager)\b/gi, "Secrets Manager");
    if (h("Route 53"))
      text = text.replace(/\b(route\s*5\s*3|route\s*fifty\s*three|route\s*53)\b/gi, "Route 53");
    if (h("Step Functions"))
      text = text.replace(/\b(step\s*functions?)\b/gi, "Step Functions");
    if (h("Elastic Beanstalk"))
      text = text.replace(/\b(elastic\s*bean\s*stalk|bean\s*stalk|beanstalk)\b/gi, "Elastic Beanstalk");
    if (h("Kinesis"))
      text = text.replace(/\b(kine\s*sis|kin\s*esis|kinissis)\b/gi, "Kinesis");
    if (h("Athena"))
      text = text.replace(/\b(ath\s*ena|athe\s*na)\b/gi, "Athena");
    if (h("Glue"))
      text = text.replace(/\b(aws\s*glue|a\s*w\s*s\s*glue)\b/gi, "AWS Glue");
    if (h("WAF"))
      text = text.replace(/\b(w\s*a\s*f|web\s*application\s*firewall)\b/gi, "WAF");
    if (h("GuardDuty"))
      text = text.replace(/\b(guard\s*duty|guard\s*duity)\b/gi, "GuardDuty");
    if (h("ACM"))
      text = text.replace(/\b(a\s*c\s*m|aws\s*certificate\s*manager)\b/gi, (m) =>
        /certificate/i.test(m) ? "ACM" : m);

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Cloud - Azure ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("Azure"))
      text = text.replace(/\b(asher|ozure|a\s*sure|a\s*zur|a\s*zyure|a\s*zure)\b/gi, "Azure");
    if (h("Azure DevOps"))
      text = text.replace(/\b(azure\s*dev\s*ops)\b/gi, "Azure DevOps");
    if (h("Azure Kubernetes Service"))
      text = text.replace(/\b(azure\s*k[u8]bernetes\s*service|aks)\b/gi, "Azure Kubernetes Service");
    if (h("Azure Functions"))
      text = text.replace(/\b(azure\s*functions?|azure\s*func)\b/gi, "Azure Functions");
    if (h("Azure Blob Storage"))
      text = text.replace(/\b(azure\s*blob\s*storage|azure\s*blob)\b/gi, "Azure Blob Storage");
    if (h("Azure Service Bus"))
      text = text.replace(/\b(azure\s*service\s*bus)\b/gi, "Azure Service Bus");
    if (h("Azure Active Directory"))
      text = text.replace(/\b(azure\s*active\s*directory|azure\s*a\s*d|aad)\b/gi, "Azure Active Directory");
    if (h("Azure Key Vault"))
      text = text.replace(/\b(azure\s*key\s*vault)\b/gi, "Azure Key Vault");
    if (h("Azure Event Hub"))
      text = text.replace(/\b(azure\s*event\s*hub)\b/gi, "Azure Event Hub");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Cloud - GCP ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("GCP") || h("Google Cloud"))
      text = text.replace(/\b(g\s*c\s*p|google\s*cloud\s*platform)\b/gi, "GCP");
    if (h("GKE"))
      text = text.replace(/\b(g\s*k\s*e)\b/gi, "GKE");
    if (h("Pub/Sub"))
      text = text.replace(/\b(pub\s*sub|pub\/sub|pub\s*slash\s*sub)\b/gi, "Pub/Sub");
    if (h("Vertex AI"))
      text = text.replace(/\b(vertex\s*a\s*i|verte\s*xai)\b/gi, "Vertex AI");
    if (h("BigQuery"))
      text = text.replace(/\b(big\s*query)\b/gi, "BigQuery");
    if (h("Cloud Run"))
      text = text.replace(/\b(cloud\s*run)\b/gi, "Cloud Run");
    if (h("Cloud Storage"))
      text = text.replace(/\b(gcs|google\s*cloud\s*storage)\b/gi, "Cloud Storage");
    if (h("Cloud Composer"))
      text = text.replace(/\b(cloud\s*composer)\b/gi, "Cloud Composer");
    if (h("Dataflow"))
      text = text.replace(/\b(data\s*flow|datafl?ow)\b/gi, "Dataflow");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Deployment platforms ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("Vercel"))
      text = text.replace(/\b(ver\s*cell?|ver\s*sel|pur\s*cel|ber\s*cell?)\b/gi, "Vercel");
    if (h("Netlify"))
      text = text.replace(/\b(net\s*lif[yi]|net\s*life\s*y|net\s*leaf[yi]?)\b/gi, "Netlify");
    if (h("Fly.io"))
      text = text.replace(/\b(fly\s*io|fly\s*dot\s*io)\b/gi, "Fly.io");
    if (h("Railway"))
      text = text.replace(/\b(rail\s*way\s*app|railway\s*io)\b/gi, "Railway");
    if (h("Render"))
      text = text.replace(/\b(render\s*cloud|render\s*app)\b/gi, "Render");
    if (h("Cloudflare") || h("Cloudflare Workers"))
      text = text.replace(/\b(cloud\s*flare|cloudflair|cloud\s*flair)\b/gi, "Cloudflare");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ DevOps / Infra ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("Kubernetes"))
      text = text.replace(/\b(kuber\s*netes?|cuban\s*etes|k8s|cooper\s*nettle?s?|kubernets|cube\s*nettle?s?|cuba\s*natick|coober\s*netes|cooper\s*natives?)\b/gi, "Kubernetes");
    if (h("Docker"))
      text = text.replace(/\b(dockered|dock\s*her|doc\s*ker|veb\s*pack|dok\s*er)\b/gi, "Docker");
    if (h("Terraform"))
      text = text.replace(/\b(terra\s*form|terra\s*farm|terra\s*for|terr\s*aform)\b/gi, "Terraform");
    if (h("Ansible"))
      text = text.replace(/\b(ans?able|uncle|uncled|an\s*sible)\b/gi, "Ansible");
    if (h("Helm"))
      text = text.replace(/\b(helm\s*chart|helm\s*charts)\b/gi, "Helm");
    if (h("Argo CD") || h("ArgoCD"))
      text = text.replace(/\b(argo\s*c\s*d|argocd|argo\s*seed|argo\s*cd)\b/gi, "Argo CD");
    if (h("CI/CD"))
      text = text.replace(/\b(cacd|ci\s*cd|cic\s*d|c\s*i\s*c\s*d|c\s*i\s*\/\s*c\s*d)\b/gi, "CI/CD");
    if (h("Jenkins"))
      text = text.replace(/\b(jenkin\s*s|jen\s*kins)\b/gi, "Jenkins");
    if (h("GitLab"))
      text = text.replace(/\b(kitab|git\s*lab|get\s*lab|getlab)\b/gi, "GitLab");
    if (h("GitHub Actions") || h("GitHub"))
      text = text.replace(/\b(git\s*hub\s*actions?|github\s*action|get\s*hub\s*action)\b/gi, "GitHub Actions");
    if (h("Istio"))
      text = text.replace(/\b(ist\s*io|is\s*tio|istyo)\b/gi, "Istio");
    if (h("Nginx"))
      text = text.replace(/\b(engine\s*x|n\s*jinx|en\s*jinx|engine\s*ex|en-jinx|en\s*gine\s*x)\b/gi, "Nginx");
    if (h("Pulumi"))
      text = text.replace(/\b(pulu\s*mi|pu\s*lumi)\b/gi, "Pulumi");
    if (h("HashiCorp Vault") || h("Vault"))
      text = text.replace(/\b(hash\s*i\s*corp\s*vault|hashi\s*corp\s*vault)\b/gi, "HashiCorp Vault");
    if (h("Docker Compose"))
      text = text.replace(/\b(docker\s*com\s*pose)\b/gi, "Docker Compose");
    if (h("etcd"))
      text = text.replace(/\b(et\s*c\s*d|etcid)\b/gi, "etcd");
    if (h("Consul"))
      text = text.replace(/\b(con\s*sul\s*io|consul\s*connect)\b/gi, "Consul");
    if (h("Envoy"))
      text = text.replace(/\b(en\s*voy\s*proxy)\b/gi, "Envoy");
    if (h("Linkerd"))
      text = text.replace(/\b(link\s*erd|linker\s*d)\b/gi, "Linkerd");
    if (h("Packer"))
      text = text.replace(/\b(hashi\s*packer|packer\s*io)\b/gi, "Packer");
    if (h("Nomad"))
      text = text.replace(/\b(hashi\s*nomad|nomad\s*scheduler)\b/gi, "Nomad");
    if (h("FluxCD") || h("Flux"))
      text = text.replace(/\b(flux\s*cd|fluxcd)\b/gi, "FluxCD");
    if (h("Tekton"))
      text = text.replace(/\b(tec\s*ton|tek\s*ton)\b/gi, "Tekton");
    if (h("Spinnaker"))
      text = text.replace(/\b(spina\s*ker|spin\s*naker|spinnaker)\b/gi, "Spinnaker");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Messaging / Streaming ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("Kafka"))
      text = text.replace(/\b(cafka|kaf\s*ka|cap\s*ca|car\s*fka|kufka)\b/gi, "Kafka");
    if (h("RabbitMQ"))
      text = text.replace(/\b(rabbit\s*m\s*q|rabbit\s*mq|rabbit\s*queue|rabbit\s*cue)\b/gi, "RabbitMQ");
    if (h("Celery"))
      text = text.replace(/\b(salar[yi]e?s?|cele\s*ry|seller[yi])\b/gi, "Celery");
    if (h("ActiveMQ"))
      text = text.replace(/\b(active\s*m\s*q|active\s*queue)\b/gi, "ActiveMQ");
    if (h("NATS"))
      text = text.replace(/\b(nats\s*io|nats\s*messaging)\b/gi, "NATS");
    if (h("Apache Pulsar") || h("Pulsar"))
      text = text.replace(/\b(apache\s*pul\s*sar|pul\s*sar\s*messaging)\b/gi, "Apache Pulsar");
    if (h("Apache Flink") || h("Flink"))
      text = text.replace(/\b(apache\s*flink|flink\s*streaming)\b/gi, "Apache Flink");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Observability ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("Prometheus"))
      text = text.replace(/\b(promet[eh]us|promo\s*theus|pro\s*metheus|pro\s*me\s*theus)\b/gi, "Prometheus");
    if (h("Grafana"))
      text = text.replace(/\b(graff?ana|graph\s*ana|graf\s*ana|graffanna)\b/gi, "Grafana");
    if (h("Kibana"))
      text = text.replace(/\b(kabana|key\s*banana|ki\s*bana|kib\s*ana)\b/gi, "Kibana");
    if (h("OpenTelemetry"))
      text = text.replace(/\b(open\s*tele?\s*metry)\b/gi, "OpenTelemetry");
    if (h("Datadog"))
      text = text.replace(/\b(data\s*dog)\b/gi, "Datadog");
    if (h("Splunk"))
      text = text.replace(/\b(splung|splun)\b/gi, "Splunk");
    if (h("New Relic"))
      text = text.replace(/\b(new\s*reli[ck])\b/gi, "New Relic");
    if (h("Jaeger"))
      text = text.replace(/\b(yager|jay\s*ger|yae\s*ger)\b/gi, "Jaeger");
    if (h("Sentry"))
      text = text.replace(/\b(sen\s*try\s*io|zentri)\b/gi, "Sentry");
    if (h("Dynatrace"))
      text = text.replace(/\b(dyna\s*trace|dy\s*na\s*trace)\b/gi, "Dynatrace");
    if (h("PagerDuty"))
      text = text.replace(/\b(pager\s*duty|pay\s*ger\s*duty)\b/gi, "PagerDuty");
    if (h("Loki"))
      text = text.replace(/\b(loki\s*logs|grafana\s*loki)\b/gi, "Loki");
    if (h("Zipkin"))
      text = text.replace(/\b(zip\s*kin)\b/gi, "Zipkin");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ ML / AI / Data ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("TensorFlow"))
      text = text.replace(/\b(tensor\s*flow|tenser\s*flow|tensor\s*flo)\b/gi, "TensorFlow");
    if (h("PyTorch"))
      text = text.replace(/\b(pi\s*torch|pie\s*torch|py\s*torch)\b/gi, "PyTorch");
    if (h("scikit-learn") || h("scikit"))
      text = text.replace(/\b(sci\s*kit\s*learn|sickit|sci\s*kit|scikit)\b/gi, "scikit-learn");
    if (h("NumPy"))
      text = text.replace(/\b(num\s*pie|numb\s*pie|number\s*p[iy]e?|num\s*pi|nummy)\b/gi, "NumPy");
    if (h("Pandas"))
      text = text.replace(/\b(panda\s*s|pand\s*as|pan\s*das)\b/gi, "Pandas");
    if (h("Matplotlib"))
      text = text.replace(/\b(mat\s*plot\s*lib|mat\s*plotlib)\b/gi, "Matplotlib");
    if (h("PySpark") || h("Spark"))
      text = text.replace(/\b(pi\s*spark|pie\s*spark|py\s*spark)\b/gi, "PySpark");
    if (h("Airflow"))
      text = text.replace(/\b(air\s*flow)\b/gi, "Airflow");
    if (h("dbt"))
      text = text.replace(/\b(d\s*b\s*t|debit\b)/gi, (m) =>
        /\b(transform|model|data\s*build|analytics|sql)\b/i.test(text) ? "dbt" : m);
    if (h("MLflow"))
      text = text.replace(/\b(ml\s*flow|m\s*l\s*flow)\b/gi, "MLflow");
    if (h("Hugging Face") || h("HuggingFace"))
      text = text.replace(/\b(hugging\s*face|huggin\s*face)\b/gi, "Hugging Face");
    if (h("LangChain"))
      text = text.replace(/\b(lang\s*chain|langchain)\b/gi, "LangChain");
    if (h("XGBoost"))
      text = text.replace(/\b(xg\s*boost|x\s*g\s*boost)\b/gi, "XGBoost");
    if (h("LightGBM"))
      text = text.replace(/\b(light\s*g\s*b\s*m|light\s*gbm)\b/gi, "LightGBM");
    if (h("Keras"))
      text = text.replace(/\b(kei\s*ras|kay\s*ras|kee\s*ras)\b/gi, "Keras");
    if (h("ONNX"))
      text = text.replace(/\b(o\s*n\s*n\s*x|onyx\b)/gi, (m) =>
        /\b(model|inference|runtime|format|export)\b/i.test(text) ? "ONNX" : m);
    if (h("Polars"))
      text = text.replace(/\b(po\s*lars)\b/gi, "Polars");
    if (h("Dask"))
      text = text.replace(/\b(das\s*k\b)\b/gi, "Dask");
    if (h("Prefect"))
      text = text.replace(/\b(pre\s*fect\s*io|prefect\s*workflow)\b/gi, "Prefect");
    if (h("Dagster"))
      text = text.replace(/\b(dag\s*ster)\b/gi, "Dagster");
    if (h("Trino") || h("Presto"))
      text = text.replace(/\b(tree\s*no|tri\s*no|pres\s*to\s*db)\b/gi, (m) => /pres/i.test(m) ? "Presto" : "Trino");
    if (h("LangGraph"))
      text = text.replace(/\b(lang\s*graph)\b/gi, "LangGraph");
    if (h("OpenAI"))
      text = text.replace(/\b(open\s*a\s*i|open-ai)\b/gi, "OpenAI");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Python ecosystem ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("Pydantic"))
      text = text.replace(/\b(pie\s*dantic|pi\s*dantic|pye\s*dantic|pie\s*dan\s*tick)\b/gi, "Pydantic");
    if (h("uvicorn"))
      text = text.replace(/\b(you\s*vicorn|u\s*vicorn|uvi\s*corn|yuvi\s*corn|u\s*vi\s*corn)\b/gi, "uvicorn");
    if (h("gunicorn"))
      text = text.replace(/\b(guni\s*corn|gooney\s*corn|gunny\s*corn|gun\s*i\s*corn)\b/gi, "gunicorn");
    if (h("SQLAlchemy"))
      text = text.replace(/\b(sql\s*alchemy|sequel\s*alchemy|sql\s*al\s*chemy)\b/gi, "SQLAlchemy");
    if (h("pytest"))
      text = text.replace(/\b(pi\s*test|pie\s*test|py\s*test)\b/gi, "pytest");
    if (h("Alembic"))
      text = text.replace(/\b(alem\s*bic|alm\s*bic)\b/gi, "Alembic");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Security / Auth ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("JWT"))
      text = text.replace(/\b(j\s*w\s*t|jay\s*w\s*t|jay\s*watt)\b/gi, "JWT");
    if (h("OAuth") || h("OAuth 2.0"))
      text = text.replace(/\b(oh\s*auth|o\s*auth|o-auth|oauth\s*2|o\s*auth\s*2\.?0?)\b/gi, "OAuth");
    if (h("SAML"))
      text = text.replace(/\b(sam\s*[el]l?|saml)\b/gi, "SAML");
    if (h("RBAC"))
      text = text.replace(/\b(r\s*back|r\s*bac|r\s*b\s*a\s*c)\b/gi, "RBAC");
    if (h("CORS"))
      text = text.replace(/\bcourse\b/gi, (m) =>
        /\b(api|http|request|header|policy|allow|enable|handle|origin|cross)\b/i.test(text) ? "CORS" : m);
    if (h("Okta"))
      text = text.replace(/\b(ok\s*ta|okht?a)\b/gi, "Okta");
    if (h("Auth0"))
      text = text.replace(/\b(auth\s*zero|auth\s*oh?|auth\s*0)\b/gi, "Auth0");
    if (h("Keycloak"))
      text = text.replace(/\b(key\s*cloak|kee\s*cloak)\b/gi, "Keycloak");
    if (h("OpenID Connect") || h("OIDC"))
      text = text.replace(/\b(open\s*id\s*connect|o\s*i\s*d\s*c|oidc)\b/gi, "OpenID Connect");
    if (h("mTLS") || h("TLS") || h("SSL"))
      text = text.replace(/\b(m\s*t\s*l\s*s|mutual\s*tls)\b/gi, "mTLS");
    if (h("LDAP"))
      text = text.replace(/\b(l\s*d\s*a\s*p|el\s*dap)\b/gi, "LDAP");
    if (h("ABAC"))
      text = text.replace(/\b(a\s*b\s*a\s*c)\b/gi, "ABAC");
    if (h("CSRF"))
      text = text.replace(/\b(c\s*s\s*r\s*f|cross\s*site\s*request\s*forgery)\b/gi, "CSRF");
    if (h("SSO"))
      text = text.replace(/\b(s\s*s\s*o|single\s*sign\s*on)\b/gi, "SSO");
    if (h("MFA"))
      text = text.replace(/\b(m\s*f\s*a|multi\s*factor\s*auth)\b/gi, "MFA");
    if (h("Zero Trust"))
      text = text.replace(/\b(zero\s*trust\s*security|zero\s*trust\s*network)\b/gi, "Zero Trust");
    if (h("SOC 2"))
      text = text.replace(/\b(sock\s*2|so\s*c\s*2|soc\s*type\s*2)\b/gi, "SOC 2");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ DevOps concepts (Indian accent) ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("microservices"))
      text = text.replace(/\b(micro\s*service\s*s?|micro-services?)\b/gi, "microservices");
    if (h("Kubernetes"))  // extra Indian accent variants
      text = text.replace(/\b(cube\s*nettles?|cooper\s*natick|koo\s*bernetes)\b/gi, "Kubernetes");
    if (h("CI/CD"))
      text = text.replace(/\b(see\s*i\s*see\s*dee|sai\s*sai\s*dee)\b/gi, "CI/CD");
    if (h("GitOps"))
      text = text.replace(/\b(git\s*ops)\b/gi, "GitOps");
    if (h("SRE"))
      text = text.replace(/\b(s\s*r\s*e|site\s*reliability\s*engineer(?:ing)?)\b/gi, "SRE");
    if (h("DevSecOps"))
      text = text.replace(/\b(dev\s*sec\s*ops)\b/gi, "DevSecOps");
    if (h("WebAssembly") || h("WASM"))
      text = text.replace(/\b(web\s*assembly|wasm)\b/gi, "WebAssembly");
    if (h("Jetpack Compose"))
      text = text.replace(/\b(jet\s*pack\s*com\s*pose|jetpack\s*compose)\b/gi, "Jetpack Compose");
    if (h("SwiftUI"))
      text = text.replace(/\b(swift\s*u\s*i|swift\s*ui)\b/gi, "SwiftUI");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Testing ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("SonarQube"))
      text = text.replace(/\b(sonar\s*cube|sonar\s*q\s*be?|son\s*ar\s*cube|sonar\s*cue)\b/gi, "SonarQube");
    if (h("Playwright"))
      text = text.replace(/\b(play\s*wright|play\s*write)\b/gi, "Playwright");
    if (h("Selenium"))
      text = text.replace(/\b(selen\s*ium|sel\s*enium)\b/gi, "Selenium");
    if (h("TestNG"))
      text = text.replace(/\b(test\s*n\s*g|test\s*ng)\b/gi, "TestNG");
    if (h("JUnit"))
      text = text.replace(/\b(j\s*unit|jay\s*unit)\b/gi, "JUnit");
    if (h("Mockito"))
      text = text.replace(/\b(mock\s*ito|moki\s*to)\b/gi, "Mockito");
    if (h("k6"))
      text = text.replace(/\b(k\s*6\s*load|kay\s*6)\b/gi, "k6");
    if (h("Gatling"))
      text = text.replace(/\b(gat\s*ling)\b/gi, "Gatling");
    if (h("Locust"))
      text = text.replace(/\b(lo\s*cust\s*io)\b/gi, "Locust");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Formats / Protocols ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("JSON"))
      text = text
        .replace(/\b(jay\s*son|jay-son)\b/gi, "JSON")
        .replace(/\bjason\b/gi, (m) =>
          /\b(format|parse|object|data|payload|response|body|file|stringify|schema)\b/i.test(text) ? "JSON" : m);
    if (h("REST APIs") || h("REST API"))
      text = text.replace(/\b(rest\s*areas?|restaurant)\b/gi, "REST");
    if (h("OpenAPI") || h("Swagger"))
      text = text.replace(/\b(open\s*api|swagger)\b/gi, "OpenAPI");
    if (h("YAML"))
      text = text.replace(/\b(yam\s*[el]l?|ya\s*mel)\b/gi, "YAML");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Data structures & algorithms (Indian accent) ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("array"))
      text = text.replace(/\b(ar\s*ray|aray|aar\s*ray)\b/gi, "array");
    if (h("linked list"))
      text = text.replace(/\b(link\s*list|link[dt]\s*list|lingk\s*list)\b/gi, "linked list");
    if (h("hash map") || h("hash table"))
      text = text.replace(/\b(hash\s*mep|hash\s*mep|hash\s*map|hesh\s*map)\b/gi, "hash map");
    if (h("binary search"))
      text = text.replace(/\b(bye\s*nary\s*search|bi\s*nary\s*search|binary\s*serch)\b/gi, "binary search");
    if (h("binary tree"))
      text = text.replace(/\b(bye\s*nary\s*tree|bi\s*nary\s*tree)\b/gi, "binary tree");
    if (h("binary search tree"))
      text = text.replace(/\b(bye\s*nary\s*search\s*tree|b\s*s\s*t)\b/gi, "binary search tree");
    if (h("DFS") || h("depth-first search"))
      text = text.replace(/\b(d\s*f\s*s|depth\s*first\s*serch|deepth\s*first)\b/gi, "DFS");
    if (h("BFS") || h("breadth-first search"))
      text = text.replace(/\b(b\s*f\s*s|bredth\s*first|breadth\s*first\s*serch)\b/gi, "BFS");
    if (h("dynamic programming"))
      text = text.replace(/\b(dye\s*namic\s*pro\s*gram\s*ming|dynamic\s*programing|DP\b)\b/gi, (m) =>
        /\bDP\b/.test(m) ? "dynamic programming" : "dynamic programming");
    if (h("memoization"))
      text = text.replace(/\b(memo\s*i\s*za\s*tion|memo\s*ization|memorization\b)/gi, (m) =>
        /memoriz/i.test(m) && /\b(dp|dynamic|cache|recursion|recursive)\b/i.test(text) ? "memoization" : m);
    if (h("recursion"))
      text = text.replace(/\b(re\s*cur\s*shun|re\s*kurshon|rekur\s*sion)\b/gi, "recursion");
    if (h("Big O notation"))
      text = text.replace(/\b(big\s*oh?\s*notation|big\s*o\s*no\s*tation|bigo)\b/gi, "Big O notation");
    if (h("time complexity"))
      text = text.replace(/\b(time\s*com\s*plex\s*ity|taim\s*complexity)\b/gi, "time complexity");
    if (h("space complexity"))
      text = text.replace(/\b(space\s*com\s*plex\s*ity|spase\s*complexity)\b/gi, "space complexity");
    if (h("O of N"))
      text = text.replace(/\b(o\s*of\s*n\s*squared|o\s*n\s*square|oh\s*n\s*squared)\b/gi, "O(NÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â²)");
    if (h("Dijkstra"))
      text = text.replace(/\b(dike\s*stra|dijk\s*stra|dike\s*straw|dyk\s*stra|day\s*kstra)\b/gi, "Dijkstra");
    if (h("Bellman-Ford"))
      text = text.replace(/\b(bell\s*man\s*ford)\b/gi, "Bellman-Ford");
    if (h("topological sort"))
      text = text.replace(/\b(topo\s*logical\s*sort|topo\s*sort)\b/gi, "topological sort");
    if (h("sliding window"))
      text = text.replace(/\b(slide\s*ing\s*window|slider\s*window|sliding\s*windo)\b/gi, "sliding window");
    if (h("two pointers"))
      text = text.replace(/\b(two\s*pointer\s*approach|two\s*pointr|2\s*pointers?)\b/gi, "two pointers");
    if (h("union find") || h("disjoint set"))
      text = text.replace(/\b(union\s*find|dis\s*joint\s*set|union-find)\b/gi, "union find");
    if (h("segment tree"))
      text = text.replace(/\b(seg\s*ment\s*tree|segment\s*tre)\b/gi, "segment tree");
    if (h("trie"))
      text = text.replace(/\b(try\s*data\s*structure|trie\s*tree|prefix\s*tree)\b/gi, "trie");
    if (h("heap"))
      text = text.replace(/\b(heap\s*data\s*structure|min\s*hip|max\s*hip)\b/gi, (m) =>
        /min/i.test(m) ? "min heap" : /max/i.test(m) ? "max heap" : "heap");
    if (h("priority queue"))
      text = text.replace(/\b(priority\s*cue|priority\s*q)\b/gi, "priority queue");
    if (h("merge sort"))
      text = text.replace(/\b(merge\s*sort|murge\s*sort)\b/gi, "merge sort");
    if (h("quick sort"))
      text = text.replace(/\b(quick\s*sort|kwik\s*sort)\b/gi, "quick sort");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ OOP concepts (Indian accent) ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("polymorphism"))
      text = text.replace(/\b(poly\s*mor\s*fism|poly\s*morph\s*ism|poly\s*morphizm)\b/gi, "polymorphism");
    if (h("encapsulation"))
      text = text.replace(/\b(en\s*cap\s*su\s*la\s*tion|encapsu\s*lation|in\s*capsulation)\b/gi, "encapsulation");
    if (h("inheritance"))
      text = text.replace(/\b(in\s*hair\s*i\s*tance|in\s*her\s*i\s*tance|inherritance)\b/gi, "inheritance");
    if (h("abstraction"))
      text = text.replace(/\b(abs\s*trac\s*tion|ab\s*straction)\b/gi, "abstraction");
    if (h("interface"))
      text = text.replace(/\b(inter\s*face|inter\s*faze)\b/gi, "interface");
    if (h("Dependency Injection"))
      text = text.replace(/\b(dependency\s*injec\s*tion|d\s*i\s*pattern|DI\s*pattern)\b/gi, "Dependency Injection");
    if (h("Singleton"))
      text = text.replace(/\b(single\s*ton\s*pattern|singleton\s*patern)\b/gi, "Singleton");
    if (h("Observer"))
      text = text.replace(/\b(observer\s*pattern)\b/gi, "Observer pattern");
    if (h("Factory"))
      text = text.replace(/\b(factory\s*pattern|fac\s*tory\s*design)\b/gi, "Factory pattern");
    if (h("SOLID"))
      text = text.replace(/\b(solid\s*principles?|s\s*o\s*l\s*i\s*d\s*principles?)\b/gi, "SOLID principles");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Concurrency (Indian accent) ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("mutex"))
      text = text.replace(/\b(mu\s*tex|myoo\s*tex|mew\s*tex|mootex)\b/gi, "mutex");
    if (h("semaphore"))
      text = text.replace(/\b(sem\s*a\s*fore?|sema\s*phore|sema\s*four)\b/gi, "semaphore");
    if (h("deadlock"))
      text = text.replace(/\b(dead\s*loc\b|dead\s*lok)\b/gi, "deadlock");
    if (h("race condition"))
      text = text.replace(/\b(race\s*con\s*di\s*tion|raise\s*condition)\b/gi, "race condition");
    if (h("async await"))
      text = text.replace(/\b(a\s*sink|a\s*sync|ay\s*sink|async\s*a\s*wait)\b/gi, (m) =>
        /wait/i.test(m) ? "async await" : "async");
    if (h("asynchronous"))
      text = text.replace(/\b(a\s*sync\s*ro\s*nous|ay\s*syn\s*cronous|a\s*syn\s*kronous)\b/gi, "asynchronous");
    if (h("goroutine"))
      text = text.replace(/\b(go\s*rou\s*tine|go\s*routine|go\s*roo\s*teen)\b/gi, "goroutine");
    if (h("coroutine"))
      text = text.replace(/\b(co\s*rou\s*tine|co\s*routine|ko\s*routine)\b/gi, "coroutine");
    if (h("thread safety"))
      text = text.replace(/\b(thread\s*safe\s*ty|tred\s*safety)\b/gi, "thread safety");
    if (h("event loop"))
      text = text.replace(/\b(event\s*lup|e\s*vent\s*loop)\b/gi, "event loop");
    if (h("promise"))
      text = text.replace(/\b(pro\s*mise\s*chain|promise\s*chaining)\b/gi, "promise chaining");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Memory / OS (Indian accent) ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("garbage collection"))
      text = text.replace(/\b(garbage\s*col\s*ec\s*tion|garbage\s*colection|garbaj\s*collection)\b/gi, "garbage collection");
    if (h("memory leak"))
      text = text.replace(/\b(memory\s*leek|mem\s*ory\s*leak)\b/gi, "memory leak");
    if (h("pointer"))
      text = text.replace(/\b(poin\s*ter|poin\s*tur)\b/gi, "pointer");
    if (h("heap memory"))
      text = text.replace(/\b(heap\s*mem\s*ory)\b/gi, "heap memory");
    if (h("stack memory"))
      text = text.replace(/\b(stack\s*mem\s*ory)\b/gi, "stack memory");
    if (h("context switch"))
      text = text.replace(/\b(con\s*text\s*switch\s*ing?|context\s*swit\s*ching?)\b/gi, "context switching");
    if (h("virtual memory"))
      text = text.replace(/\b(vir\s*tual\s*mem\s*ory)\b/gi, "virtual memory");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ System design (Indian accent) ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("consistent hashing"))
      text = text.replace(/\b(con\s*sistent\s*hash\s*ing|consistent\s*hasing)\b/gi, "consistent hashing");
    if (h("database sharding"))
      text = text.replace(/\b(data\s*base\s*sharding|db\s*sharding|shard\s*ing)\b/gi, "sharding");
    if (h("CDN") || h("content delivery network"))
      text = text.replace(/\b(c\s*d\s*n|content\s*delivery\s*net\s*work|content\s*deliv\s*ery)\b/gi, "CDN");
    if (h("cache invalidation"))
      text = text.replace(/\b(cache\s*invalid\s*ation|cash\s*invalidation)\b/gi, "cache invalidation");
    if (h("rate limiting"))
      text = text.replace(/\b(rate\s*lim\s*iting|rate\s*limit\s*ing)\b/gi, "rate limiting");
    if (h("load balancer"))
      text = text.replace(/\b(load\s*balan\s*cer|load\s*balansor)\b/gi, "load balancer");
    if (h("SAGA pattern"))
      text = text.replace(/\b(saga\s*pat\s*tern|saga\s*design)\b/gi, "SAGA pattern");
    if (h("CQRS"))
      text = text.replace(/\b(c\s*q\s*r\s*s|see\s*kyoo\s*ar\s*es)\b/gi, "CQRS");
    if (h("pub sub"))
      text = text.replace(/\b(pub\s*lish\s*subscribe|publish\s*sub\s*scribe)\b/gi, "pub/sub");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ SQL / DB query ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("JOIN") || h("INNER JOIN"))
      text = text.replace(/\b(inner\s*jon|in\s*ner\s*join|inner\s*jion)\b/gi, "INNER JOIN");
    if (h("LEFT JOIN"))
      text = text.replace(/\b(left\s*jon|lef\s*join)\b/gi, "LEFT JOIN");
    if (h("GROUP BY"))
      text = text.replace(/\b(group\s*bye|groop\s*by)\b/gi, "GROUP BY");
    if (h("window function"))
      text = text.replace(/\b(window\s*func\s*tion|windo\s*function)\b/gi, "window function");
    if (h("CTE"))
      text = text.replace(/\b(c\s*t\s*e|common\s*table\s*expression)\b/gi, "CTE");
    if (h("indexing"))
      text = text.replace(/\b(index\s*ing|in\s*dexing)\b/gi, "indexing");
    if (h("ACID"))
      text = text.replace(/\b(a\s*c\s*i\s*d\s*properties?|acid\s*transact)\b/gi, "ACID");
    if (h("N plus one problem"))
      text = text.replace(/\b(n\s*plus\s*one?\s*problem|n\+1\s*problem)\b/gi, "N+1 problem");
    if (h("query optimization"))
      text = text.replace(/\b(query\s*optim\s*ization|kwery\s*optimization)\b/gi, "query optimization");
    if (h("database normalization"))
      text = text.replace(/\b(normal\s*ization|db\s*normalization|normaliz\s*ation)\b/gi, "normalization");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Networking (Indian accent) ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("TCP"))
      text = text.replace(/\b(t\s*c\s*p|tee\s*cee\s*pee)\b/gi, "TCP");
    if (h("UDP"))
      text = text.replace(/\b(u\s*d\s*p|you\s*dee\s*pee)\b/gi, "UDP");
    if (h("DNS"))
      text = text.replace(/\b(d\s*n\s*s|dee\s*en\s*es)\b/gi, "DNS");
    if (h("HTTP2"))
      text = text.replace(/\b(h\s*t\s*t\s*p\s*2|http\s*version\s*2)\b/gi, "HTTP/2");
    if (h("TLS handshake"))
      text = text.replace(/\b(tls\s*hand\s*shake|t\s*l\s*s\s*handshake)\b/gi, "TLS handshake");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ LeetCode / interview platforms ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    if (h("LeetCode"))
      text = text.replace(/\b(leet\s*code|lit\s*code|lead\s*code|leat\s*code)\b/gi, "LeetCode");
    if (h("HackerRank"))
      text = text.replace(/\b(hacker\s*rank|haker\s*rank)\b/gi, "HackerRank");

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Generic ASR fixes ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    // "quote" ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ "code" in coding context
    if (/\b(quote|quot)\b/i.test(text) && /\b(code|coding|program|script|function|class|api|snippet|write|build|implement)\b/i.test(text))
      text = text.replace(/\b(quote|quot)\b/gi, "code");
    // "w" ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ "v" Indian accent (WebSocket, Webpack already handled above)
    if (h("WebSocket"))
      text = text.replace(/\b(veb\s*socket|web\s*soc?ket)\b/gi, "WebSocket");

    return text.replace(/\s+/g, " ").trim();
  }, [buildSpeechPhraseHints, customPrompt, conversationHistory]);

  const rememberInterimKeywords = useCallback((text: string, ts = Date.now()) => {
    const src = String(text || "").toLowerCase();
    if (!src) return;
    const tokens = src
      .replace(/[^\w\s.+#/-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean);
    if (!tokens.length) return;

    const allowed = new Set([
      "react", "flask", "fastapi", "fast", "api", "apis", "django", "python", "sql", "mysql", "postgres", "postgresql",
      "mongodb", "oracle", "database", "databases", "aws", "azure", "docker", "kubernetes", "terraform", "ansible",
      "graphql", "rest", "dotnet", "javascript", "typescript", "nodejs", "redis", "kafka", "subnet", "vnet", "vpn", "cidr", "nsg", "gateway", "peering", "endpoint",
      "firebase", "supabase", "prisma", "sequelize", "typeorm", "drizzle", "jest", "vitest", "cypress", "storybook",
      "webpack", "nginx", "dynamodb", "bigquery", "pubsub", "opentelemetry", "datadog", "blob", "functions", "devops",
      "ec2", "ecs", "eks", "rds", "sqs", "sns", "eventbridge", "helm", "argo",
    ]);

    const alias = (t: string): string => {
      if (t === "reaction" || t === "preact" || t === "reacted" || t === "reactjs" || t === "react js" || t === "react jay es" || t === "react j s" || t === "re act" || t === "reactor") return "react";
      if (t === "flash" || t === "flast" || t === "foster") return "flask";
      if (t === "jango") return "django";
      if (t === "dot net" || t === "the net") return "dotnet";
      if (t === "java script" || t === "javascripts") return "javascript";
      if (t === "type script" || t === "typescripts") return "typescript";
      if (t === "node js" || t === "node jay ess" || t === "node jay s") return "nodejs";
      if (t === "post gres" || t === "postgress" || t === "postgre sql") return "postgresql";
      if (t === "mongo db" || t === "mongod b") return "mongodb";
      if (t === "red is" || t === "readys") return "redis";
      if (t === "cafka" || t === "kaf ka") return "kafka";
      if (t === "kuber netes" || t === "cuban etes" || t === "k8s") return "kubernetes";
      if (t === "fire base") return "firebase";
      if (t === "super base") return "supabase";
      if (t === "prizma") return "prisma";
      if (t === "sqlize") return "sequelize";
      if (t === "type orm") return "typeorm";
      if (t === "drizel") return "drizzle";
      if (t === "vi test") return "vitest";
      if (t === "cy press") return "cypress";
      if (t === "story book") return "storybook";
      if (t === "web pack") return "webpack";
      if (t === "engine x") return "nginx";
      if (t === "dynamo db") return "dynamodb";
      if (t === "big query") return "bigquery";
      if (t === "pub sub") return "pubsub";
      if (t === "open telemetry") return "opentelemetry";
      if (t === "data dog") return "datadog";
      return t;
    };

    const extracted = tokens
      .map(alias)
      .filter((t) => allowed.has(t))
      .slice(-6);
    if (!extracted.length) return;

    const next = [...interimKeywordMemoryRef.current];
    for (const token of extracted) {
      next.unshift({ token, ts });
    }
    interimKeywordMemoryRef.current = next
      .filter((x, idx) => idx < 40 && (ts - x.ts) <= INTERIM_KEYWORD_TTL_MS);
  }, []);

  const getRecentInterimKeywordForRestore = useCallback((existingText: string, ts = Date.now()): string => {
    const existing = normalizeForDedup(existingText || "");
    const formatToken = (t: string): string => {
      if (t === "react") return "React";
      if (t === "flask") return "Flask";
      if (t === "fastapi" || t === "fast") return "FastAPI";
      if (t === "django") return "Django";
      if (t === "graphql") return "GraphQL";
      if (t === "dotnet") return ".NET";
      if (t === "javascript") return "JavaScript";
      if (t === "typescript") return "TypeScript";
      if (t === "nodejs") return "Node.js";
      if (t === "aws") return "AWS";
      if (t === "azure") return "Azure";
      if (t === "sql") return "SQL";
      if (t === "postgresql" || t === "postgres") return "PostgreSQL";
      if (t === "mongodb") return "MongoDB";
      if (t === "redis") return "Redis";
      if (t === "kafka") return "Kafka";
      if (t === "kubernetes") return "Kubernetes";
      return t;
    };

    for (const item of interimKeywordMemoryRef.current) {
      if ((ts - item.ts) > INTERIM_KEYWORD_TTL_MS) continue;
      const tokenNorm = normalizeForDedup(item.token);
      if (!tokenNorm) continue;
      if (existing.includes(tokenNorm)) continue;
      return formatToken(item.token);
    }
    return "";
  }, []);

  const isShortAffirmativeReply = useCallback((raw: string): boolean => {
    const normalized = String(raw || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    return /^(yes|yeah|yep|yup|correct|right|sure|i do|i did|absolutely|of course|exactly)$/.test(normalized);
  }, []);

  const isGenericInterpretedSeed = useCallback((raw: string): boolean => {
    const normalized = String(raw || "")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized) return true;
    if (/^(tell me|go on|continue|next|okay|ok|hmm|right|sure|please|what else|and then)$/.test(normalized)) {
      return true;
    }
    const tokens = normalized.split(" ").filter(Boolean);
    if (tokens.length <= 1 && !normalized.includes("?")) return true;
    return false;
  }, []);

  const cleanTranscriptForDisplay = useCallback((raw: string): string => {
    let text = cleanAsrNoise(String(raw || ""));
    if (!text) return "";
    text = text
      .replace(/\b(uh[\s-]*huh|uh+|umm+|mmm+|hmm+|ah+|oh+|like|you know|okay+|ok+|right+)\b/gi, " ")
      .replace(/\b(?:and also|and|also)(?:\s+(?:and also|and|also))+\b/gi, " and also ")
      .replace(/\s+/g, " ")
      .trim();
    // Strip leading filler "so" before tech terms (e.g. "so fast APIs" ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ "FastAPI").
    // Azure STT frequently picks up "so" as onset noise before a tech term fragment.
    text = text.replace(/^so\s+(?=(fast\s*api(?:s)?|fastapi|fast\s*app?)\b)/i, "");
    // Also strip "so" before tech terms mid-sentence (e.g. "and so fast APIs" ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ "and FastAPI").
    text = text.replace(/\bso\s+(fast\s*api(?:s)?|fastapi|fast\s*app?)\b/gi, "FastAPI");
    // Auto-correct common STT mishearings for tech terms
    text = text
      .replace(/\bfast\s*api\b/gi, "FastAPI")
      .replace(/\bfirst\s*ap[ip]a?\b/gi, "FastAPI")
      .replace(/\bfast\s*app?\b/gi, "FastAPI")
      .replace(/\bpy\s*thon\b/gi, "Python")
      .replace(/\bpie\s*thon\b/gi, "Python")
      .replace(/\bjava\s*script\b/gi, "JavaScript")
      .replace(/\btype\s*script\b/gi, "TypeScript")
      .replace(/\bnode\s*j[sz]\b/gi, "Node.js")
      .replace(/\breact\s*j[sz]\b/gi, "React")
      .replace(/\bpost\s*gres\b/gi, "PostgreSQL")
      .replace(/\bmy\s*sequel\b/gi, "MySQL")
      .replace(/\bsql\s*alchemy\b/gi, "SQLAlchemy")
      .replace(/\bmongo\s*d[bp]\b/gi, "MongoDB")
      .replace(/\bdocker\s*file\b/gi, "Dockerfile")
      .replace(/\bkubernetes\b/gi, "Kubernetes")
      .replace(/\bgit\s*hub\b/gi, "GitHub")
      .replace(/\bgit\s*lab\b/gi, "GitLab")
      .replace(/\bopen\s*ai\b/gi, "OpenAI")
      .replace(/\baws\b/gi, "AWS")
      .replace(/\bgcp\b/gi, "GCP")
      .replace(/\bci\s*\/?\s*cd\b/gi, "CI/CD")
      .replace(/\bback\s*end\b/gi, "backend")
      .replace(/\bfront\s*end\b/gi, "frontend")
      .replace(/\bfull\s*stack\b/gi, "full-stack")
      .replace(/\bend\s*to\s*end\b/gi, "end-to-end")
      .replace(/\brest\s*api\b/gi, "REST API")
      .replace(/\bgraph\s*ql\b/gi, "GraphQL")
      .replace(/\bweb\s*socket[sz]?\b/gi, "WebSocket")
      .replace(/\bdeep\s*learning\b/gi, "deep learning")
      .replace(/\bmachine\s*learning\b/gi, "machine learning");
    return text;
  }, [cleanAsrNoise]);

  const sanitizeQuestionCandidate = useCallback((raw: string): string => {
    let text = String(raw || "").replace(/\s+/g, " ").trim();
    if (!text) return "";

    // Strip leading filler and duplicated prompts.
    text = text.replace(/^(please|kindly|uh[\s-]*huh|uh|um|like|you know)\s+/i, "");
    // Strip leading "so" when it precedes a bare tech term (STT onset noise: "so FastAPI", "so React").
    text = text.replace(/^so\s+(?=(FastAPI|React|Python|Django|Flask|JavaScript|TypeScript|Node\.js|AWS|Azure|GCP|Docker|Kubernetes|GraphQL|MongoDB|PostgreSQL|Redis|Kafka|Spring|Angular|Vue)\b)/i, "");
    // Fix "and so FastAPI" / "and so fast APIs" ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ "and FastAPI" from STT onset noise in combined questions.
    text = text.replace(/\b(and|or)\s+so\s+(FastAPI|fast\s*api(?:s)?)\b/gi, (_, j) => `${j} FastAPI`);
    text = text.replace(/^(can you|could you|would you|will you)\s+explain\s+if\s+(we\s+)?(find|feel|think)\s+/i, "can you explain ");
    text = text.replace(/^(can you|could you|would you|will you)\s+explain\s+/i, "can you explain ");
    text = text.replace(/\bwrite a code\b/gi, "write code");
    text = text.replace(/\b(uh[\s-]*huh|uh+|umm+|mmm+|hmm+|ah+|oh+)\b/gi, " ");

    // Collapse repeated single words and short phrases from noisy STT.
    text = text
      .replace(/\b(\w+)(?:\s+\1){1,}\b/gi, "$1")
      .replace(/\b((?:\w+\s+){1,4}\w+)\s+\1\b/gi, "$1");

    // Normalize repeated joiners.
    text = text
      .replace(/\bandalso(?=(?:\s|[.+#/-]|$))/gi, "and also ")
      .replace(/\balsoand(?=(?:\s|[.+#/-]|$))/gi, "also and ")
      .replace(/\b(and also)(?:\s+\1)+\b/gi, "and also")
      .replace(/\b(and)(?:\s+and)+\b/gi, "and")
      .replace(/\b(also)(?:\s+also)+\b/gi, "also")
      .replace(/\b(?:and\s+also\s+){2,}/gi, "and also ")
      .replace(/\b(?:and also|and|also)(?:\s+(?:and also|and|also))+\b/gi, " and also ");

    // Trim trailing joiners that often appear as noise.
    text = text.replace(/\b(and also|and|also)\b\s*$/i, "").trim();
    text = text.replace(/\s+/g, " ").trim();

    // Ensure question ends with a question mark if it looks like a question.
    if (text && /^(can|could|would|will|do|does|did|is|are|what|why|how|where|when|who|explain|describe|tell|write|show|give)\b/i.test(text)) {
      if (!/[?.!]$/.test(text)) text = `${text}?`;
    }
    return rewriteMixedTopicQuestion(cleanDetectedInterviewQuestion(text));
  }, []);

  const dedupeExperienceTopics = useCallback((raw: string): string => {
    const text = String(raw || "").trim();
    if (!text) return "";
    const expMatch = text.match(/\b(do you have experience in|have you worked with|experience in)\b/i);
    if (!expMatch) return text;
    const anchor = expMatch[0];
    const rest = text.slice(expMatch.index! + anchor.length).trim();
    if (!rest) return text;

    const strictTopics = extractMeaningfulInterviewTopics(rest);
    if (strictTopics.length === 1) return `${anchor} ${strictTopics[0]}?`;
    if (strictTopics.length === 2) return `${anchor} ${strictTopics[0]} and ${strictTopics[1]}?`;
    if (strictTopics.length > 2) {
      const head = strictTopics.slice(0, -1).join(", ");
      const last = strictTopics[strictTopics.length - 1];
      return `${anchor} ${head}, and ${last}?`;
    }

    const normalizedRest = rest
      .toLowerCase()
      .replace(/[^\w\s.+#/-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const directSingleTopicPatterns: Array<{ re: RegExp; label: string }> = [
      { re: /\bpython\b/i, label: "Python" },
      { re: /\breact(?:\s*js)?\b|\breaction\b|\breacted\b|\bpreact\b/i, label: "React" },
      { re: /\bfast\s*api(?:s)?\b|\bfastapi\b/i, label: "FastAPI" },
      { re: /\bdjango\b|\bjango\b/i, label: "Django" },
      { re: /\bflask\b|\bflash\b|\bflast\b|\bfoster\b/i, label: "Flask" },
      { re: /\b(?:\.net|dot\s*net|dotnet)\b/i, label: ".NET" },
      { re: /\bjavascript\b|\bjava script\b/i, label: "JavaScript" },
      { re: /\btypescript\b|\btype script\b/i, label: "TypeScript" },
      { re: /\bnode(?:\.js|js)?\b|\bnode js\b/i, label: "Node.js" },
      { re: /\bsql\b/i, label: "SQL" },
      { re: /\baws\b/i, label: "AWS" },
      { re: /\bazure\b/i, label: "Azure" },
    ];
    const matchedSingles = directSingleTopicPatterns
      .filter((pattern) => pattern.re.test(normalizedRest))
      .map((pattern) => pattern.label);
    const uniqueSingles = [...new Set(matchedSingles)];
    if (uniqueSingles.length === 1) {
      return `${anchor} ${uniqueSingles[0]}?`;
    }

    const alias = (value: string): string => {
      const v = value.toLowerCase().replace(/\s+/g, " ").trim();
      if (!v) return "";
      if (/^(fast api|fast apis|fastapi|fast ap)$/.test(v)) return "FastAPI";
      if (/^(rest api|rest apis|restful|restful api|restful apis)$/.test(v)) return "REST APIs";
      if (/^(dot net|dotnet|\.net)$/.test(v)) return ".NET";
      if (/^(js|javascript)$/.test(v)) return "JavaScript";
      if (/^(ts|typescript)$/.test(v)) return "TypeScript";
      if (/^(postgres|postgresql|postql)$/.test(v)) return "PostgreSQL";
      if (/^(mongo|mongodb)$/.test(v)) return "MongoDB";
      if (/^(aws)$/.test(v)) return "AWS";
      if (/^(gcp)$/.test(v)) return "GCP";
      if (/^(k8s)$/.test(v)) return "Kubernetes";
      if (/^(flask|flash|flast|foster)$/.test(v)) return "Flask";
      if (/^(django|jango)$/.test(v)) return "Django";
      if (/^(react|reaction|preact|react js|reactjs|react jay es)$/.test(v)) return "React";
      return value.trim();
    };

    const parts = rest
      .split(/\s*(?:,|and also|and|&|\/|\+|or)\s*/i)
      .map((p) => p.replace(/[?.,;:!]+$/g, "").trim())
      .filter(Boolean)
      .map(alias)
      .filter(Boolean);

    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const p of parts) {
      const key = normalizeForDedup(p);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      deduped.push(p);
      if (deduped.length >= 6) break;
    }

    if (deduped.length === 0) return text;
    if (deduped.length === 1) return `${anchor} ${deduped[0]}?`;
    if (deduped.length === 2) return `${anchor} ${deduped[0]} and ${deduped[1]}?`;
    const head = deduped.slice(0, -1).join(", ");
    const last = deduped[deduped.length - 1];
    return `${anchor} ${head}, and ${last}?`;
  }, []);

  const isImperativePrompt = useCallback((raw: string): boolean => {
    const normalized = String(raw || "")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized) return false;
    return /^(tell me about|tell me|walk me through|walk me|explain|describe|talk me through|talk about|share|give me|show me|help me understand|run me through|go over|break down)\b/.test(normalized);
  }, []);

  const isRecentDuplicateIntent = useCallback((fingerprint: string, mode: "pause" | "final" | "enter", now = Date.now()): boolean => {
    if (!fingerprint) return false;
    const last = lastRequestedIntentRef.current;
    if (!last) return false;
    if ((now - last.ts) > DUPLICATE_INTENT_WINDOW_MS) return false;
    const sim = levenshteinSimilarity(fingerprint, last.fp);
    if (sim < 0.92) return false; // raised from 0.88 — rephrased questions at ~85-91% similarity now pass through
    if (mode === "enter" && last.mode !== "enter" && (now - last.ts) <= ENTER_AFTER_AUTO_SUPPRESS_MS) {
      return true;
    }
    return true;
  }, []);

  const rememberBoundaryQuestionCandidate = useCallback((text: string, ts = Date.now()) => {
    const cleaned = String(text || "").trim();
    if (!cleaned) return;
    const norm = normalizeForDedup(cleaned);
    if (!norm) return;
    const next = [
      { text: cleaned, ts },
      ...boundaryQuestionCandidatesRef.current.filter((x) => normalizeForDedup(x.text) !== norm),
    ];
    boundaryQuestionCandidatesRef.current = next
      .filter((x, idx) => idx < 30 && (ts - x.ts) <= 180000);
  }, []);

  const rememberContinuationTopics = useCallback((text: string, ts = Date.now()) => {
    const line = String(text || "").trim();
    if (!line) return;
    const normalized = line.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    if (!normalized) return;

    const continuationMatch = normalized.match(/^(?:and also|and|also|plus|including|along with|as well as|in addition)\s+(.+)$/i);
    const standaloneCandidate = !continuationMatch?.[1]
      ? normalized.replace(/[?.,;:!]+$/g, "").trim()
      : "";

    const topicAlias = (value: string): string => {
      const v = value.toLowerCase().replace(/\s+/g, " ").trim();
      if (!v) return "";
      if (/^(fast api|fast apis|fastapi)$/.test(v)) return "FastAPI";
      if (/^(rest api|rest apis|restful)$/.test(v)) return "REST APIs";
      if (/^(graphql|graph ql)$/.test(v)) return "GraphQL";
      if (/^(jango)$/.test(v)) return "Django";
      if (/^(foster|flast|flash)$/.test(v)) return "Flask";
      if (/^(react)$/.test(v)) return "React";
      if (/^(aws)$/.test(v)) return "AWS";
      if (/^(azure)$/.test(v)) return "Azure";
      return value.trim();
    };

    const rawTopics = continuationMatch?.[1]
      ? continuationMatch[1]
          .split(/\s*(?:,|and|&|\/|\+|or)\s*/i)
          .map((x) => topicAlias(String(x || "").trim()))
          .map((x) => x.replace(/[?.,;:!]+$/g, "").trim())
          .filter(Boolean)
      : [];

    // Conservative fallback: only keep very short standalone technical topic fragments.
    if (!rawTopics.length && standaloneCandidate) {
      const words = standaloneCandidate.split(/\s+/).filter(Boolean);
      const isQuestionStarter = /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|is|are|tell|walk|explain)\b/i.test(standaloneCandidate);
      const isPureStop = /^(and|or|also|in|on|with|for|to|of|the|a|an|it|this|that|experience|question|answer)$/i.test(standaloneCandidate);
      const looksSentence = words.length > 3;
      const looksTopic = isLikelyInterviewTopic(standaloneCandidate);
      if (!isQuestionStarter && !isPureStop && !looksSentence && looksTopic) {
        rawTopics.push(topicAlias(standaloneCandidate));
      }
    }

    if (!rawTopics.length) return;

    const ignore = /^(in|on|with|for|to|of|and|or|also|experience|build|building|simple|about)$/i;
    const valid = rawTopics.filter((topic) => {
      const wc = topic.split(/\s+/).filter(Boolean).length;
      if (wc < 1 || wc > 4) return false;
      if (ignore.test(topic)) return false;
      return true;
    });
    if (!valid.length) return;

    const next = [
      ...valid.map((topic) => ({ topic, ts })),
      ...pendingContinuationTopicsRef.current,
    ];
    const dedup: Array<{ topic: string; ts: number }> = [];
    for (const item of next) {
      const norm = normalizeForDedup(item.topic);
      if (!norm) continue;
      if (dedup.find((x) => normalizeForDedup(x.topic) === norm)) continue;
      dedup.push(item);
      if (dedup.length >= 20) break;
    }
    pendingContinuationTopicsRef.current = dedup.filter((x) => (ts - x.ts) <= 12_000);
  }, []);

    const buildQuestionFromMeaningfulFragment = useCallback((raw: string): string => {
      const fragment = String(raw || "")
        .replace(/^(and also|and|also|plus|as well as|along with|including|in addition)\b\s*/i, "")
        // Strip leading pause fillers: "So…", "Hmm…", "Okay…", "Right…", "Well…"
        .replace(/^(so|hmm|hm|okay|ok|right|well|uh|um|ah|now)\b[\s\u2026,.]+/i, "")
        .replace(/[?.,;:!]+$/g, "")
        .replace(/\b(and also)(?:\s+\1)+\b/gi, "and also")
        .replace(/\b(and)(?:\s+and)+\b/gi, "and")
        .replace(/\b(also)(?:\s+also)+\b/gi, "also")
        .replace(/\s+/g, " ")
        .trim();
      if (!fragment) return "";

      // Do not synthesize experience questions from pure numbers (e.g., ports like 443).
      if (/^\d{2,5}$/.test(fragment)) return "";

      if (detectQuestion(fragment)) {
        return fragment.endsWith("?") ? fragment : `${fragment}?`;
      }

    const words = fragment.split(/\s+/).filter(Boolean);
    if (words.length < 1 || words.length > 8) return "";

    const stop = new Set(["and", "also", "or", "yes", "no", "ok", "okay", "hmm", "uh", "um", "the", "a", "an", "in", "on", "with", "for", "to", "of", "experience"]);
    if (words.every((w) => stop.has(w.toLowerCase()))) return "";

    const v = fragment.toLowerCase().replace(/\s+/g, " ").trim();
    // Implicit question rewrites for rough STT fragments.
    if (/\bexperience in\b/i.test(v)) {
      const topic = fragment.replace(/^.*?\bexperience in\b/i, "").trim();
      if (topic) {
        const dedupedTopics = extractMeaningfulInterviewTopics(topic);
        if (dedupedTopics.length > 0) {
          return `Do you have experience in ${dedupedTopics.join(" and ")}?`;
        }
        if (isLikelyInterviewTopic(topic)) return `Do you have experience in ${normalizeInterviewTopicLabel(topic)}?`;
      }
      return "";
    }
    if (/\bdifference between\b/i.test(v)) {
      const rest = fragment.replace(/^.*?\bdifference between\b/i, "").trim();
      if (rest) return `What is the difference between ${rest}?`;
    }
    if (/^what\s+start date\b/i.test(v)) {
      const rest = fragment.replace(/^what\s+start date\b/i, "").trim();
      return rest ? `What was your start date ${rest}?` : "What was your start date?";
    }
    if (/^what\s+end date\b/i.test(v)) {
      const rest = fragment.replace(/^what\s+end date\b/i, "").trim();
      return rest ? `What was your end date ${rest}?` : "What was your end date?";
    }
    if (/\bnotice period\b/i.test(v)) return "What is your notice period?";
    if (/\bsalary expectation\b/i.test(v)) return "What is your salary expectation?";
    if (/\byour name\b/i.test(v)) return "What is your name?";
    if (/^(what|why|how|when|where|who|which)\b/i.test(v)) {
      return fragment.endsWith("?") ? fragment : `${fragment}?`;
    }

    // Resume-pointer: "I see Node.js here", "You mentioned microservices", "Looking at your X"
    const resumeMatch = v.match(/^(i see|you mentioned|looking at your|looking at|i noticed|i notice|i see that|you said)\s+(.+)/i);
    if (resumeMatch) {
      const topic = (resumeMatch[2] || "")
        .replace(/\b(here|there|on your resume|in your profile|on the resume)\s*\.?\s*$/i, "")
        .trim();
      if (topic) {
        const aliasedTopic = normalizeInterviewTopicLabel(topic);
        if (isLikelyInterviewTopic(aliasedTopic)) return `Can you tell me more about your experience with ${aliasedTopic}?`;
        return `Can you elaborate on ${topic}?`;
      }
    }

    // Declarative pushback: "That sounds expensive", "But that seems risky", "That's a lot"
    if (/^(that|this|but that|but this)\b.{0,40}\b(sounds|seems|looks|appears|feels|is|was)\b/i.test(v) && !fragment.includes("?")) {
      const concern = fragment.replace(/^but\s+/i, "").trim();
      return `${concern} — how would you address or justify that?`;
    }

    // Broad-to-narrow instruction: "Focus on X", "Just talk about X", "Only discuss X"
    const narrowMatch = v.match(/^(?:focus on|just (?:talk about|focus on|discuss|explain)|only (?:talk about|discuss|explain)|concentrate on|stick to|narrow down to)\s+(.+)/i);
    if (narrowMatch) {
      const topic = (narrowMatch[1] || "").trim();
      if (topic) return `Focus specifically on ${topic} — explain that part in detail.`;
    }

    const aliased = normalizeInterviewTopicLabel(fragment);

      if (words.length <= 3 && isLikelyInterviewTopic(aliased)) return `Do you have experience in ${aliased}?`;
      if (words.length <= 3) return "";
      return `Can you explain ${aliased}?`;
    }, []);

  const buildLiveQuestionCandidateFromPartial = useCallback((rawPartial: string): string => {
    const raw = String(rawPartial || "").replace(/\s+/g, " ").trim();
    if (!raw) return "";
    const normalized = raw.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
    if (!normalized) return "";

    const questionStart = /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|is|are|tell|walk|explain)\b/i;
    const joinerStart = /^(and also|and|also|plus|as well as|along with|including|in addition)\b/i;
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;

    if (detectQuestion(raw) || (questionStart.test(normalized) && wordCount >= 2)) {
      return raw.endsWith("?") ? raw : `${raw}?`;
    }

    const continuation = raw
      .replace(/^(and also|and|also|plus|as well as|along with|including|in addition)\b\s*/i, "")
      .replace(/[?.,;:!]+$/g, "")
      .trim();
    const continuationNorm = continuation.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    const continuationWords = continuationNorm.split(/\s+/).filter(Boolean).length;

    const prevCandidate = (latestPartialQuestionCandidateRef.current || "").trim();
    if (prevCandidate && continuation && continuationWords >= 1 && continuationWords <= 6 && (joinerStart.test(normalized) || wordCount <= 5)) {
      const base = prevCandidate.replace(/\?\s*$/, "").trim();
      const combined = `${base} and also ${continuation}`.replace(/\s+/g, " ").trim();
      return combined.endsWith("?") ? combined : `${combined}?`;
    }

    const synthesized = buildQuestionFromMeaningfulFragment(raw);
    return synthesized || "";
  }, [buildQuestionFromMeaningfulFragment]);

  const isLikelyNoiseSegment = useCallback((raw: string): boolean => {
    const text = String(raw || "").trim();
    if (!text) return true;
    const normalized = text.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
    const words = normalized.split(" ").filter(Boolean);
    const hasQuestionCue =
      /\?/.test(text) ||
      /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|tell|walk|explain)\b/.test(normalized);
    const hasInterviewCue =
      /\b(interview|experience|react|python|fastapi|fast api|fast apis|apis|flask|django|api|backend|frontend|project|wipro|anthem|resume|start date|end date|month|year|worked|java|javascript|typescript|nodejs|node js|angular|vue|nextjs|next js|spring|springboot|spring boot|aws|azure|gcp|google cloud|kubernetes|k8s|docker|terraform|ansible|jenkins|github|gitlab|bitbucket|ci cd|devops|microservice|microservices|sql|nosql|mongodb|postgres|postgresql|mysql|redis|kafka|rabbitmq|elasticsearch|graphql|rest|restful|grpc|oauth|jwt|agile|scrum|kanban|jira|confluence|linux|bash|shell|powershell|machine learning|deep learning|nlp|llm|openai|langchain|pandas|numpy|pytorch|tensorflow|spark|hadoop|airflow|dbt|snowflake|databricks|bigquery|data pipeline|etl|elt|data warehouse|data lake|data engineering|data science|full stack|fullstack|front end|back end|cloud native|serverless|lambda|s3|ec2|rds|dynamodb|sqs|sns|ecs|eks|iam|vpc|load balancer|ci|cd|unit test|integration test|selenium|cypress|jest|pytest|junit|tdd|bdd|agile|sprint|standup|code review|pull request|architecture|system design|scalability|performance|latency|throughput|availability|reliability|observability|monitoring|logging|alerting|grafana|prometheus|datadog|splunk|pagerduty)\b/.test(normalized);
    if (words.length <= 1) {
      return !(hasInterviewCue || hasQuestionCue);
    }

    if (/\b(hey cortana|open internet explorer|call mom|call dad|play music|download|road closed|downtown)\b/.test(normalized)) {
      return true;
    }

    // Pure filler regardless of length
    if (/^(okay|ok|right|alright|yeah|yes|no|hmm|uh|um|uh huh|so|and also|also)\b/.test(normalized) && words.length <= 4) return true;

    // Very short non-interview phrases ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â aggressive gate
    if (!hasInterviewCue && !hasQuestionCue && words.length <= 3) return true;

    // WH-word starters too short to be real questions ("when building", "how about")
    if (/^(what|why|how|when|where|who|which)/.test(normalized) && words.length <= 3 && !text.includes("?") && !hasInterviewCue) return true;

    // Medium length (4-10 words): only drop if it has no semantic substance ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â
    // no verb, no subject pronoun, and no known tech/role signal
    if (!hasInterviewCue && !hasQuestionCue && words.length <= 10) {
      const hasVerb = /\b(is|are|was|were|be|been|have|has|had|do|does|did|get|got|make|made|use|used|work|worked|know|knew|think|thought|say|said|see|saw|come|came|go|went|take|took|build|built|write|wrote|run|ran|implement|deploy|design|develop|create|handle|manage|integrate|configure|test|debug)\b/i.test(normalized);
      const hasSubjectPronoun = /\b(i|we|you|they|he|she|it|my|our|your|their|this|that|these|those)\b/i.test(normalized);
      const hasTechSignal = /\b(api|sdk|cloud|server|client|database|db|code|app|service|system|platform|tool|stack|framework|library|module|function|class|object|method|query|request|response|endpoint|deploy|build|test|debug|pipeline|repo|git|docker|ci|cd|devops|ml|ai|model|data|stream|queue|event|token|auth|ssl|tls|http|rest|graph|node|pod|cluster|container|instance|bucket|blob|vpc|subnet|lambda|trigger|hook|cron|job|task|worker|cache|session|cookie|jwt|oauth|saml|ldap|role|policy|permission|schema|table|index|join|migration|orm|crud|react|python|java|javascript|typescript|nodejs|angular|vue|nextjs|spring|aws|azure|gcp|kubernetes|k8s|terraform|ansible|jenkins|mongodb|postgres|postgresql|mysql|redis|kafka|rabbitmq|elasticsearch|graphql|grpc|microservice|microservices|serverless|s3|ec2|rds|dynamodb|sqs|sns|ecs|eks|iam|loadbalancer|fastapi|flask|django|pandas|numpy|pytorch|tensorflow|spark|hadoop|airflow|snowflake|databricks|bigquery|selenium|cypress|jest|pytest|junit|scalability|latency|throughput|observability|monitoring|logging|grafana|prometheus|datadog|splunk|architecture|fullstack|frontend|backend|agile|scrum|sprint|devops|bash|linux|shell|openai|langchain|llm)\b/i.test(normalized);
      // Keep it if it has a verb + subject (looks like a real sentence) OR tech signal
      if (!hasVerb && !hasSubjectPronoun && !hasTechSignal) return true;
    }

    return false;
  }, []);

  const isStrongInterviewerQuestion = useCallback((raw: string): boolean => {
    const text = String(raw || "").trim();
    if (!text) return false;
    const advanced = detectQuestionAdvanced(text);
    const normalized = text.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
    // No first-person "I" pronoun + enough words + question/tech cue → interviewer speaking
    const iCount = (text.match(/\bI\b/g) || []).length;
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    const hasQuestionOrTechCue =
      /\?/.test(text)
      || /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|tell|walk|explain|describe|share|give)\b/.test(normalized)
      || /\b(experience|react|python|fastapi|java|javascript|typescript|nodejs|angular|vue|aws|azure|gcp|kubernetes|docker|sql|nosql|mongodb|postgres|redis|kafka|graphql|microservice|backend|frontend|devops|agile|machine learning|llm|architecture|scalability|project|role|challenge|design|deploy|api|flask|django|spring|terraform|linux|bash)\b/.test(normalized);
    if (iCount === 0 && wordCount >= 5 && hasQuestionOrTechCue && !isLikelyNoiseSegment(text)) return true;
    const hasQuestionCue =
      /\?/.test(text)
      || /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|tell|walk|explain)\b/.test(normalized)
      || /\b(experience|project|react|python|fastapi|fast api|fast apis|apis|django|architecture|design|challenge|role)\b/.test(normalized);
    return (detectQuestion(text) || (advanced.isQuestion && advanced.confidence >= 0.5)) && hasQuestionCue;
  }, [isLikelyNoiseSegment]);

  const looksLikeLikelyInterimQuestion = useCallback((raw: string): boolean => {
    const text = String(raw || "").trim();
    if (!text) return false;
    const advanced = detectQuestionAdvanced(text);
    const normalized = text.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
    const words = normalized.split(" ").filter(Boolean).length;
    const startsWithWh = /^(what|why|how|when|where|who|which)\b/i.test(normalized);
    const startsWithAux = /^(do|does|did|can|could|would|have|has|is|are|tell|walk|explain)\b/i.test(normalized);
    const openEndedJoinerTail = /\b(and|or|also|as well as|along with|including|in addition|regarding|about|specifically)\s*\??$/i.test(normalized);
    return detectQuestion(text) || advanced.confidence >= 0.5 || (startsWithWh && words >= 4) || (startsWithAux && words >= 3) || openEndedJoinerTail;
  }, []);

  const sanitizeMergedSeed = useCallback((raw: string): string => {
    const text = String(raw || "").trim();
    if (!text) return "";
    const parts = text
      .split("|")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length <= 1) return text;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]
        .replace(/\b(and also)(?:\s+\1)+\b/gi, "and also")
        .replace(/\b(and)(?:\s+and)+\b/gi, "and")
        .replace(/\b(also)(?:\s+also)+\b/gi, "also")
        .replace(/\s+\b(and also|and|also)\b\s*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
      if (/\?/.test(p) || /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|tell|walk|explain)\b/i.test(p)) {
        return p;
      }
    }
    return parts[parts.length - 1];
  }, []);

  const pickBestRecentQuestionSeed = useCallback((segments: string[]): string => {
    const items = (segments || [])
      .map((s, idx) => ({ text: String(s || "").trim(), idx }))
      .filter((x) => !!x.text);
    if (!items.length) return "";

    let best = "";
    let bestScore = -1e9;
    for (const { text, idx } of items) {
      if (isLikelyNoiseSegment(text)) continue;
      const normalized = text.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
      const words = normalized.split(" ").filter(Boolean);
      const hasQMark = text.includes("?");
      const startsLikeQuestion = /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|tell|walk|explain)\b/.test(normalized);
      const hasInterviewCue = /\b(experience|react|python|fastapi|fast api|fast apis|apis|flask|django|java|javascript|typescript|nodejs|angular|vue|nextjs|spring|aws|azure|gcp|kubernetes|docker|terraform|mongodb|postgres|mysql|redis|kafka|graphql|microservice|serverless|backend|frontend|fullstack|devops|agile|scrum|machine learning|deep learning|llm|openai|pandas|pytorch|tensorflow|spark|snowflake|databricks|bigquery|selenium|jest|pytest|architecture|wipro|anthem|start date|end date|month|year|worked|resume|project|role|challenge|design|deploy|build|scalability|performance|system|database|api|sql|nosql|linux|bash|ci cd|github|gitlab|jenkins|datadog|grafana|prometheus)\b/.test(normalized);
      const partialStub = /^(when did you|do you have|what was your|have you worked with|tell me about)\s*$/.test(normalized);
      const dateSpecific = /\b(start date|end date|from|to|month|year|wipro)\b/.test(normalized);
      const questionLike = hasQMark || startsLikeQuestion || (hasInterviewCue && words.length >= 4);
      if (!questionLike) continue;

      let score = 0;
      score += (100 - idx * 3); // recency bias (index 0 is newest)
      score += hasQMark ? 60 : 0;
      score += startsLikeQuestion ? 35 : 0;
      score += hasInterviewCue ? 30 : 0;
      score += dateSpecific ? 70 : 0;
      score += Math.min(words.length, 22);
      score -= partialStub ? 120 : 0;
      score -= words.length <= 2 ? 70 : 0;
      if (score > bestScore) {
        bestScore = score;
        best = text;
      }
    }
    return best;
  }, [isLikelyNoiseSegment]);

  const pickBestRecentContextSeed = useCallback((segments: string[]): string => {
    for (const raw of segments || []) {
      const text = String(raw || "").trim();
      if (!text) continue;
      const normalized = text.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
      const words = normalized.split(" ").filter(Boolean);
      const hasInterviewCue =
        /\b(interview|experience|react|python|fastapi|fast api|fast apis|apis|flask|django|java|javascript|typescript|nodejs|angular|vue|nextjs|spring|aws|azure|gcp|kubernetes|docker|terraform|mongodb|postgres|mysql|redis|kafka|graphql|microservice|serverless|backend|frontend|fullstack|devops|agile|scrum|machine learning|deep learning|llm|openai|pandas|pytorch|tensorflow|spark|snowflake|databricks|bigquery|selenium|jest|pytest|architecture|api|sql|nosql|linux|bash|ci cd|github|gitlab|jenkins|datadog|grafana|prometheus|wipro|anthem|resume|project|role|challenge|design|deploy|build|scalability|performance|system|database|start date|end date|month|year|worked)\b/.test(normalized);
      if (isLikelyNoiseSegment(text) && !hasInterviewCue) continue;
      if (words.length >= 1) return text;
    }
    return "";
  }, [isLikelyNoiseSegment]);

  const isLikelyIncompleteFragment = useCallback((raw: string): boolean => {
    const text = String(raw || "").trim();
    if (!text) return true;
    const normalized = text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    const words = normalized.split(" ").filter(Boolean);
    if (words.length <= 3) return true;
    if (/\?$/.test(text)) return false;
    // Only mark as incomplete if it's a short fragment ending mid-sentence (preposition/conjunction tail)
    if (words.length <= 6 && /\b(on|for|with|to|from|or|also)\s*$/.test(normalized)) return true;
    return false;
  }, []);

  const composeFromRecentFragments = useCallback((segments: string[]): string => {
    const s0 = String(segments?.[0] || "").trim();
    const s1 = String(segments?.[1] || "").trim();
    if (!s0 || !s1) return "";
    if (!isLikelyIncompleteFragment(s0) && !isLikelyIncompleteFragment(s1)) return "";
    const merged = `${s1} ${s0}`.replace(/\s+/g, " ").trim();
    if (!merged) return "";
    if (merged.length > 220) return "";
    return merged;
  }, [isLikelyIncompleteFragment]);

  const extractAnyQuestionCandidates = useCallback((segments: string[]): string[] => {
    const starters = /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|is|are|tell|explain|walk)\b/i;
    const starterSplit = /(?=\b(?:what|why|how|when|where|who|which|do you|have you|can you|could you|would you|are you|is there|tell me about|walk me through|explain)\b)/gi;
    const ordered = [...(segments || [])].reverse(); // oldest -> newest
    const out: string[] = [];
    const seen = new Set<string>();

    for (const raw of ordered) {
      const line = String(raw || "").trim();
      if (!line) continue;
      const parts = line.includes("?")
        ? line.split("?").map((p) => p.trim()).filter(Boolean).map((p) => `${p}?`)
        : line
            .split(starterSplit)
            .map((p) => p.trim())
            .filter(Boolean);

      for (const part of parts) {
        const clean = part.replace(/^interviewer\s*:\s*/i, "").trim();
        if (!clean) continue;
        if (isLikelyNoiseSegment(clean)) continue;
        const normalized = clean.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
        const words = normalized.split(" ").filter(Boolean);
        const firstPersonHeavy =
          /\b(i|my|we|our)\b/.test(normalized)
          && /\b(have|worked|built|developed|implemented|focus|focused)\b/.test(normalized);
        const overLongMonologue = words.length > 30 && !clean.includes("?");
        const looksQuestion = clean.includes("?") || starters.test(normalized);
        const advanced = detectQuestionAdvanced(clean);
        const hasInterviewCue =
          /\b(interview|experience|react|python|fastapi|fast api|fast apis|apis|flask|django|java|javascript|typescript|nodejs|angular|vue|nextjs|spring|aws|azure|gcp|kubernetes|docker|terraform|mongodb|postgres|mysql|redis|kafka|graphql|microservice|serverless|backend|frontend|fullstack|devops|agile|scrum|machine learning|deep learning|llm|openai|pandas|pytorch|tensorflow|spark|snowflake|databricks|bigquery|selenium|jest|pytest|architecture|api|sql|nosql|linux|bash|ci cd|github|gitlab|jenkins|datadog|grafana|prometheus|wipro|anthem|resume|project|role|challenge|design|deploy|build|scalability|performance|system|database|start date|end date|month|year|worked)\b/i.test(normalized);
        const partialStub = /^(when did you|do you have|what was your|have you worked with|tell me about|experience in)\s*$/i.test(normalized);
        const repeatedWordNoise = /\b([a-z]{3,})\s+\1\b/i.test(normalized) && !hasInterviewCue;
        const fillerOnly = /\b(just a minute|one minute|hold on|wait a second)\b/i.test(normalized) && words.length <= 6;
        const highQuality =
          looksQuestion &&
          words.length >= 1 &&
          (advanced.confidence >= 0.5 || hasInterviewCue || /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|is|are)\b/i.test(normalized));
        if (!highQuality || partialStub || repeatedWordNoise || fillerOnly || firstPersonHeavy || overLongMonologue) continue;
        const key = normalizeForDedup(clean);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(clean);
      }
    }

    return out.slice(-6);
  }, [isLikelyNoiseSegment]);

  const { data: meeting, isLoading: meetingLoading } = useQuery<Meeting>({
    queryKey: ["/api/meetings", id],
  });

  const { data: fetchedResponses = [] } = useQuery<Response[]>({
    queryKey: ["/api/meetings", id, "responses"],
  });

  const { data: memoryData } = useQuery<{ slots: MemorySlot[]; rollingSummary: string; saveTranscript: boolean; saveFacts: boolean; incognito: boolean; turnCount: number }>({
    queryKey: ["/api/meetings", id, "memory"],
    enabled: !!meeting && showMemory,
    refetchInterval: showMemory ? 15000 : false,
  });

  const toggleMemoryMutation = useMutation({
    mutationFn: async (data: { saveTranscript?: boolean; saveFacts?: boolean; incognito?: boolean }) => {
      const res = await apiRequest("PATCH", `/api/meetings/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/meetings", id, "memory"] });
    },
  });

  const clearMemoryMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/meetings/${id}/memory`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings", id, "memory"] });
      toast({ title: "Session memory cleared" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/meetings/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/meetings", id] });
    },
  });

  useEffect(() => {
    if (meeting && !initializedFromMeeting) {
      setResponseFormat(meeting.responseFormat || "concise");
      setSelectedModel(meeting.model || "gpt-4o-mini");
      if (meeting.customInstructions) {
        setCustomPrompt(meeting.customInstructions);
      }
      if (meeting.conversationContext) {
        const lines = String(meeting.conversationContext || "")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        conversationContextLinesRef.current = lines.slice(-MAX_CONVERSATION_CONTEXT_LINES);
        setConversationHistory(conversationContextLinesRef.current.join("\n"));
      }
      setInitializedFromMeeting(true);
    }
  }, [meeting, initializedFromMeeting]);

  useEffect(() => {
    meetingIncognitoRef.current = !!meeting?.incognito;
  }, [meeting?.incognito]);

  useEffect(() => {
    checkAzureAvailability().then((available) => {
      setAzureAvailable(available);
      const saved = localStorage.getItem("zoommate-stt-engine");
      if (available && !saved) {
        setSttProvider("azure");
        localStorage.setItem("zoommate-stt-engine", "azure");
      } else if (saved === "azure" && !available) {
        setSttProvider("browser");
      }
    });
  }, []);


  const isAiFeedbackLoop = useCallback((text: string): boolean => {
    // Protect both mic and system audio from echo ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â recentAiOutputRef is populated at assistant_end
    const norm = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
    if (norm.length < 4) return false; // allow single-word utterances through
    const words = norm.split(/\s+/).filter(Boolean);
    if (words.length === 0) return false;
    for (const aiText of recentAiOutputRef.current) {
      const aiNorm = aiText.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
      // For very short phrases (ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°Ãƒâ€šÃ‚Â¤3 words) use substring match against AI output
      if (words.length <= 3) {
        if (aiNorm.includes(norm)) return true;
        continue;
      }
      // For longer text count word overlap ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â include all words (not just length > 3)
      // so short words like "I", "am", "in" contribute to the match score
      let matchCount = 0;
      for (const word of words) {
        if (word.length >= 2 && aiNorm.includes(word)) matchCount++;
      }
      if (matchCount / words.length > 0.45) return true;
    }
    return false;
  }, [audioMode]);

  useEffect(() => {
    // Timer runs from the moment session is launched (not just when mic is on)
    if (sessionLaunched) {
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [sessionLaunched]);

  useEffect(() => {
    localStorage.setItem("zoommate-quick-response", String(quickResponseMode));
  }, [quickResponseMode]);


  useEffect(() => {
    localStorage.setItem("zoommate-safety-guard", String(safetyGuardEnabled));
  }, [safetyGuardEnabled]);

  useEffect(() => {
    localStorage.setItem("zoommate-docs-mode", docsMode);
  }, [docsMode]);

  useEffect(() => {
    if (ENTER_ONLY_ANSWER_MODE) {
      setAutoAnswerEnabled(false);
      return;
    }
    setAutoAnswerEnabled(true);
  }, [audioMode, ENTER_ONLY_ANSWER_MODE]);

  useEffect(() => {
    setResponsesLocal((prev) => {
      if (!fetchedResponses.length) return prev;
      const map = new Map<string, Response>(prev.map((r) => [r.id, r]));
      for (const r of fetchedResponses) {
        map.set(r.id, r);
      }
      return Array.from(map.values()).sort((a, b) => {
        const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bt - at;
      });
    });
  }, [fetchedResponses]);

  useEffect(() => {
    responsesLocalRef.current = responsesLocal;
    if (responsesLocal.length > 0 && responsesLocal[0]?.answer) {
      lastAssistantAnswerRef.current = responsesLocal[0].answer;
    }
    const latestScreen = responsesLocal.find((resp) => resp.responseType === "screen-analysis");
    if (latestScreen?.answer) {
      const nextContext: LatestScreenContext = {
        displayQuestion: String(latestScreen.question || "Screen Capture Analysis"),
        promptQuestion: String(latestScreen.question || "Screen Capture Analysis"),
        answer: String(latestScreen.answer || ""),
        capturedAt: latestScreen.createdAt ? new Date(latestScreen.createdAt).getTime() : Date.now(),
      };
      if (!latestScreenContextRef.current || nextContext.capturedAt >= latestScreenContextRef.current.capturedAt) {
        if (
          latestScreenContextRef.current
          && latestScreenContextRef.current.capturedAt < nextContext.capturedAt
        ) {
          previousScreenContextRef.current = latestScreenContextRef.current;
        }
        latestScreenContextRef.current = nextContext;
      }
    }
  }, [responsesLocal]);

  useEffect(() => {
    streamingAnswerRef.current = streamingAnswer;
  }, [streamingAnswer]);

  useEffect(() => {
    interpretedQuestionRef.current = interpretedQuestion;
  }, [interpretedQuestion]);

  useEffect(() => {
    streamingQuestionRef.current = streamingQuestion;
  }, [streamingQuestion]);

  useEffect(() => {
    const restoreSharedStream = () => {
      const liveStream = getLiveVisionStream();
      if (liveStream) {
        syncVisionStreamState(liveStream);
      } else if (isScreenShareReady || screenShareStream) {
        syncVisionStreamState(null);
      }
    };

    restoreSharedStream();
    window.addEventListener("focus", restoreSharedStream);
    document.addEventListener("visibilitychange", restoreSharedStream);
    const timer = window.setInterval(restoreSharedStream, 1200);
    return () => {
      window.removeEventListener("focus", restoreSharedStream);
      document.removeEventListener("visibilitychange", restoreSharedStream);
      window.clearInterval(timer);
    };
  }, [getLiveVisionStream, isScreenShareReady, screenShareStream, syncVisionStreamState]);

  useEffect(() => {
    const video = sharedScreenVideoRef.current;
    if (!video) return;

    const liveStream = getLiveVisionStream();
    if (!liveStream) {
      video.pause();
      video.srcObject = null;
      return;
    }

    if (video.srcObject !== liveStream) {
      video.srcObject = liveStream;
    }
    video.muted = true;
    video.playsInline = true;
    void video.play().catch(() => undefined);
  }, [getLiveVisionStream, screenShareStream]);

  useEffect(() => {
    syncScreenPreviewTargets();
  }, [screenShareStream, screenShareLabel, isScreenShareReady, syncScreenPreviewTargets]);

  useEffect(() => {
    return () => {
      const popup = screenPreviewPopupRef.current;
      if (popup && !popup.closed) {
        popup.close();
      }
    };
  }, []);

  useEffect(() => {
    const el = transcriptScrollRef.current;
    if (!el) return;
    // Always keep newest transcript at the top.
    el.scrollTop = 0;
  }, [transcriptSegments, interimText]);

  useEffect(() => {
    isAwaitingFirstChunkRef.current = isAwaitingFirstChunk;
  }, [isAwaitingFirstChunk]);


  useEffect(() => {
    if (!id) return;
    fetch(`/api/meetings/${id}/answer-style`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const style = data?.style;
        if (["brief", "standard", "deep", "concise", "star", "bullet", "talking_points", "direct_followup"].includes(style)) {
          setAnswerStyle(style);
        }
      })
      .finally(() => {
        styleInitializedRef.current = true;
      });
  }, [id]);

  useEffect(() => {
    if (!id || !styleInitializedRef.current) return;
    const socket = socketRef.current;
    if (socket && socket.connected) {
      socket.emit("set_answer_style", { meetingId: id, style: answerStyle });
      return;
    }
    fetch(`/api/meetings/${id}/set-answer-style`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ style: answerStyle }),
    }).catch(() => {});
  }, [id, answerStyle]);

  useEffect(() => {
    answerStyleRef.current = answerStyle;
  }, [answerStyle]);

  const isNearBottom = useCallback((el: HTMLDivElement): boolean => {
    return (el.scrollHeight - el.scrollTop - el.clientHeight) <= 80;
  }, []);

  const scheduleAutoScroll = useCallback(() => {
    if (autoScrollTimerRef.current) return;
    autoScrollTimerRef.current = setTimeout(() => {
      const el = scrollRef.current;
      if (el) {
        autoScrollEnabledRef.current = isNearBottom(el);
      }
      if (el && autoScrollEnabledRef.current) {
        el.scrollTop = el.scrollHeight;
      }
      autoScrollTimerRef.current = null;
    }, 180);
  }, [isNearBottom]);

  const handleResponseCardMount = useCallback((id: string, el: HTMLDivElement | null) => {
    responseCardRefs.current[id] = el;
  }, []);

  const highlightAndScrollResponse = useCallback((responseId: string) => {
    if (!responseId) return;
    setHighlightResponseId(responseId);
    const el = responseCardRefs.current[responseId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    setTimeout(() => {
      setHighlightResponseId((current) => (current === responseId ? null : current));
    }, 1800);
  }, []);

  const isApologyResponse = useCallback((text: string): boolean => {
    const t = text.trim().toLowerCase();
    return /^(i['']?m sorry|i am sorry|sorry,|i apologize|my apologies|there seems to be (some )?confusion|i don['']?t (quite )?understand|could you (please )?(clarify|restate|rephrase|elaborate|specify)|it seems (there (is|was) a misunderstanding|like there might be)|i('m| am) not sure (what|which|about)|please (clarify|rephrase|restate|specify)|can you (clarify|rephrase|specify)|i need more (context|clarification)|i('m| am) unable to (understand|determine)|it (looks|seems) like (your|the) question (got cut off|was cut off|is incomplete|wasn't complete|seems cut off)|it seems like (your|the) question|(your|the) question (got|was|seems to have) cut off|i('m| am) not quite sure what (you('re| are)|the question)|could you please specify)/.test(t);
  }, []);

  const appendLocalResponse = useCallback((question: string, answer: string, responseType = "concise") => {
    const q = question.trim();
    const a = answer.trim();
    if (!a) return "";
    if (isApologyResponse(a)) return "";
    // Ref-based dedup fires before state update ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â prevents duplicates when two calls
    // arrive before React commits the first setResponsesLocal update.
    const fp = `${normalizeForDedup(q)}|||${normalizeForDedup(a).slice(0, 120)}`;
    if (lastAppendedFpRef.current === fp) return "";
    lastAppendedFpRef.current = fp;
    setPendingResponse(null);
    lastAnswerWasCodeRef.current = /```/.test(a);
    const tempId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setResponsesLocal((prev) => {
      const newest = prev[0];
      if (
        newest &&
        normalizeForDedup(newest.question || "") === normalizeForDedup(q) &&
        normalizeForDedup(newest.answer || "") === normalizeForDedup(a)
      ) {
        return prev;
      }
      const localResponse: Response = {
        id: tempId,
        meetingId: id || "",
        question: q,
        answer: a,
        responseType,
        createdAt: new Date().toISOString() as any,
      } as Response;
      return [localResponse, ...prev];
    });
    highlightAndScrollResponse(tempId);
    return tempId;
  }, [highlightAndScrollResponse, id, isCodeLikeAnswer]);

  const replaceLatestLocalResponse = useCallback((question: string, answer: string, responseType = "concise") => {
    const q = question.trim();
    const a = answer.trim();
    if (!a) return;
    lastAnswerWasCodeRef.current = /```/.test(a);
    setResponsesLocal((prev) => {
      if (!prev.length) return prev;
      const newest = prev[0];
      const sameQuestion = normalizeForDedup(newest.question || "") === normalizeForDedup(q);
      if (!sameQuestion) return prev;
      const updated: Response = {
        ...newest,
        question: q,
        answer: a,
        responseType,
      } as Response;
      return [updated, ...prev.slice(1)];
    });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      autoScrollEnabledRef.current = isNearBottom(el);
    };
    onScroll();
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [isNearBottom]);

  useEffect(() => {
    scheduleAutoScroll();
  }, [responsesLocal, streamingAnswer, pendingResponse, scheduleAutoScroll]);

  useEffect(() => {
    const list = interviewerQuestionMemoryRef.current
      .filter((q) => q.text && !isLikelyIncompleteFragment(q.text))
      .map((q) => q.text)
      .filter(Boolean)
      .filter((text, idx, arr) => (
        arr.findIndex((t) => normalizeForDedup(t) === normalizeForDedup(text)) === idx
      ))
      .slice(0, 10);
    setRecentQuestions(list);
  }, [transcriptSegments, isLikelyIncompleteFragment]);

  useEffect(() => {
    return () => {
      if (autoScrollTimerRef.current) {
        clearTimeout(autoScrollTimerRef.current);
        autoScrollTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!pendingResponse || responsesLocal.length === 0) return;
    const newest = responsesLocal[0];
    if (!newest?.answer) return;

    const sameQuestion =
      pendingResponse.question &&
      newest.question &&
      normalizeForDedup(newest.question) === normalizeForDedup(pendingResponse.question);

    const overlap = pendingResponse.answer && newest.answer &&
      (wordOverlap(pendingResponse.answer, newest.answer) > 0.7 ||
       wordOverlap(newest.answer, pendingResponse.answer) > 0.7);

    if (sameQuestion || overlap) {
      setPendingResponse(null);
      setStreamingAnswer("");
    }
  }, [responsesLocal, pendingResponse, wordOverlap]);

  useEffect(() => {
    if (!isStreaming) {
      bargeInTriggeredRef.current = false;
    }
  }, [isStreaming]);

  // PiP window ref + content renderer — declared here so broadcast effect below can use them
  const pipWindowRef = useRef<Window | null>(null);

  const renderPipContent = useCallback((pipWin: Window, opts: {
    question: string; answer: string; statusLabel: string; answerStyle: string; isStreaming: boolean;
  }) => {
    const { question, answer, statusLabel, answerStyle, isStreaming } = opts;
    const statusColor = statusLabel === "PAUSED" ? "#f59e0b" : statusLabel === "THINKING" || statusLabel === "ANSWERING" ? "#3b82f6" : "#10b981";
    const styleLabel: Record<string, string> = { concise: "Concise", star: "STAR", bullet: "Bullet", talking_points: "Points", direct_followup: "Direct+", standard: "Standard", brief: "Brief", deep: "Deep" };
    const answerHtml = answer
      ? answer.split("\n").filter(Boolean).map(line => {
          if (/^#{1,3}\s/.test(line)) return `<p style="font-weight:600;color:rgba(255,255,255,0.9);margin:6px 0 2px">${line.replace(/^#+\s/, "")}</p>`;
          if (/^[-*]\s/.test(line)) return `<p style="margin:0 0 3px;padding-left:12px">· ${line.replace(/^[-*]\s/, "")}</p>`;
          if (line.startsWith("```")) return "";
          return `<p style="margin:0 0 4px">${line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</p>`;
        }).join("")
      : `<p style="color:rgba(255,255,255,0.25);font-size:12px">Waiting for speaker question…</p>`;

    pipWin.document.body.innerHTML = `
      <div style="background:rgba(10,10,15,0.97);min-height:100vh;color:rgba(255,255,255,0.88);font-family:ui-sans-serif,system-ui,sans-serif;font-size:13px;line-height:1.55">
        <div style="display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.03)">
          <div style="width:6px;height:6px;border-radius:50%;background:${statusColor}"></div>
          <span style="font-size:10px;font-family:monospace;letter-spacing:.1em;color:rgba(255,255,255,0.35)">${statusLabel}</span>
          <span style="font-size:9px;padding:2px 6px;border-radius:99px;font-family:monospace;background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.45)">${styleLabel[answerStyle] || answerStyle}</span>
          ${isStreaming ? `<span style="display:inline-block;width:4px;height:4px;border-radius:50%;background:#3b82f6;margin-left:4px;animation:pulse 1s infinite"></span>` : ""}
        </div>
        ${question ? `<div style="padding:10px 16px 6px;border-bottom:1px solid rgba(255,255,255,0.04)"><p style="margin:0;font-size:12px;color:rgba(255,255,255,0.45);line-height:1.4">${question}</p></div>` : ""}
        <div style="padding:12px 16px;max-height:400px;overflow-y:auto">${answerHtml}</div>
        <div style="padding:6px 12px;border-top:1px solid rgba(255,255,255,0.06);display:flex;gap:8px;flex-wrap:wrap;font-size:10px;color:rgba(255,255,255,0.25);font-family:monospace">
          <span><span style="color:rgba(255,255,255,0.5)">Enter</span> answer</span>
          <span><span style="color:rgba(255,255,255,0.5)">P</span> pause</span>
          <span><span style="color:rgba(255,255,255,0.5)">R</span> retry</span>
          <span><span style="color:rgba(255,255,255,0.5)">H</span> dim</span>
        </div>
      </div>
      <style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}</style>
    `;

    // Enter key in PiP → trigger answer in main tab
    if (!(pipWin as any).__keyListenerAttached) {
      (pipWin as any).__keyListenerAttached = true;
      pipWin.document.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const ch = new BroadcastChannel("acemate-overlay");
          ch.postMessage({ type: "command", action: "enter" });
          ch.close();
        }
      });
    }
  }, []);

  // Broadcast overlay state to popped-out overlay window + refresh PiP window
  useEffect(() => {
    const ch = new BroadcastChannel("acemate-overlay");
    const state = {
      question: streamingQuestion || interpretedQuestion || "",
      answer: streamingAnswer || pendingResponse?.answer || responsesLocal[0]?.answer || "",
      isStreaming,
      isAwaitingFirstChunk,
      isPaused: isDetectionPaused,
      answerStyle,
      statusLabel: isDetectionPaused ? "PAUSED" : isAwaitingFirstChunk ? "THINKING" : isStreaming ? "ANSWERING" : "READY",
    };
    ch.postMessage(state);
    ch.close();
    // Also update PiP window if open
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      renderPipContent(pipWindowRef.current, state);
    }
  }, [streamingQuestion, interpretedQuestion, streamingAnswer, pendingResponse, responsesLocal, isStreaming, isAwaitingFirstChunk, isDetectionPaused, answerStyle, renderPipContent]);

  // Listen for commands from the popped-out overlay window (e.g. Enter key)
  useEffect(() => {
    const ch = new BroadcastChannel("acemate-overlay");
    ch.onmessage = (e) => {
      if (e.data?.type === "command" && e.data?.action === "enter") {
        submitCurrentQuestionRef.current?.("overlay-popup");
      }
    };
    return () => ch.close();
  }, []);

  useEffect(() => {
    if (transcriptScrollRef.current) {
      transcriptScrollRef.current.scrollTop = 0;
    }
  }, [displayTranscriptSegments, interimText]);

  const abortCurrentStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const flushPendingTranscriptLine = useCallback(() => {
    const pending = pendingTranscriptLineRef.current.trim();
    if (!pending) return;
    const display = pending;
    const alreadyDisplayed = displaySegmentsRef.current[0]
      && normalizeForDedup(displaySegmentsRef.current[0]) === normalizeForDedup(display);
    if (display && !alreadyDisplayed) upsertDisplayTranscriptSegment(display);
    pendingTranscriptLineRef.current = "";
    pendingTranscriptTsRef.current = 0;
    setPendingTranscriptLine("");
  }, [upsertDisplayTranscriptSegment]);

  const schedulePendingTranscriptFlush = useCallback(() => {
    if (pendingTranscriptFlushTimerRef.current) {
      clearTimeout(pendingTranscriptFlushTimerRef.current);
    }
    pendingTranscriptFlushTimerRef.current = setTimeout(() => {
      pendingTranscriptFlushTimerRef.current = null;
      flushPendingTranscriptLine();
    }, TRANSCRIPT_GROUPING_MS);
  }, [flushPendingTranscriptLine]);

  const handleBargeIn = useCallback(() => {
    if (!isStreaming || bargeInTriggeredRef.current) return;
    bargeInTriggeredRef.current = true;
    abortCurrentStream();
    if (id && wsAnswerRef.current?.readyState === WebSocket.OPEN) {
      wsAnswerRef.current.send(JSON.stringify({ type: "cancel", sessionId: id }));
    }
    if (id && socketRef.current?.connected) {
      socketRef.current.emit("barge_in", { meetingId: id });
    }
    fetch(`/api/meetings/${id}/cancel-stream`, { method: "POST", credentials: "include" }).catch(() => {});
  }, [isStreaming, abortCurrentStream, id]);

  const startsWithContinuationJoiner = useCallback((text: string): boolean => {
    return /^(and|or|also|plus|as well as|along with|including|in addition|regarding|about|specifically)\b/i.test(text.trim());
  }, []);

  const updateDraftFromPartial = useCallback((rawPartial: string) => {
    const rawLive = String(rawPartial || "").replace(/\s+/g, " ").trim();
    // Skip heavy normalization for partials — rawLive is always non-empty when a partial
    // arrives, so the cleaned result was always discarded. Use rawLive directly.
    const fastDraft = rawLive;
    const now = Date.now();
    if (!fastDraft) {
      // Only clear the live display if its content is already committed to segments.
      // If the final hasn't arrived yet (interimHasUnsavedContentRef=true), keep the
      // text visible so the user never sees words disappear.
      if (!interimHasUnsavedContentRef.current) {
        setInterimText("");
        interimTextRef.current = "";
        setStagedTranscriptText("");
      }
      latestPartialQuestionCandidateRef.current = "";
      latestPartialQuestionCandidateTsRef.current = 0;
      return;
    }

    // Stale-partial guard: Azure sometimes re-sends a partial AFTER it already emitted
    // a final for the same utterance. Only discard it if the partial is a strict prefix
    // (subset) of what was finalized ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â meaning it arrived late and contains no new words.
    // Do NOT discard if the partial extends beyond the final (that is new speech the user
    // is still saying, e.g. "react" finalized ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ partial "react and django" is legitimate).
    const timeSinceFinal = now - lastFinalizedAtRef.current;
    if (timeSinceFinal < 400 && lastFinalizedTextRef.current) {
      const finalNorm = lastFinalizedTextRef.current.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
      const partialNorm = fastDraft.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
      // Only a stale echo if the partial is fully contained within the final (late arrival)
      if (finalNorm.startsWith(partialNorm) && partialNorm.length > 0) return;
    }
    // Broader stale echo guard: suppress interimText that is identical to (or a prefix of)
    // the most recently committed segment regardless of timing. Azure sometimes replays the
    // full final text as the first partial of the next utterance, causing the same text to
    // appear twice ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â once in the live pulsing row and once in the committed segments list.
    if (segmentsRef.current.length > 0 && timeSinceFinal < 2000) {
      const latestSegNorm = (segmentsRef.current[0] || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
      const draftNorm = fastDraft.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
      if (draftNorm.length > 0 && (latestSegNorm === draftNorm || latestSegNorm.startsWith(draftNorm))) return;
    }

    // Guard: if we're about to overwrite substantial unsaved interim content with
    // genuinely new speech (not a continuation), commit it to segments first so
    // nothing visible in the live row disappears without being saved.
    if (interimHasUnsavedContentRef.current) {
      const oldInterim = interimTextRef.current.trim();
      const oldWordCount = oldInterim.split(/\s+/).filter(Boolean).length;
      if (oldWordCount >= 1) {
        const oldNorm = oldInterim.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
        const newNorm = fastDraft.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
        // If new draft extends the old one, it's a continuation ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â don't commit yet.
        // If new draft is genuinely different speech, commit the old content first.
        const newFirstThree = newNorm.split(/\s+/).slice(0, 3).join(" ");
        // New partial extends old when new starts with old (normal streaming growth),
        // OR when old contains the new partial's start (overlap/redo case).
        const isExtension = newNorm.startsWith(oldNorm)
          || (newFirstThree.length > 3 && oldNorm.includes(newFirstThree));
        if (!isExtension) {
          upsertDisplayTranscriptSegment(oldInterim);
        }
      }
    }

    // Show spoken text immediately before heavy cleanup/noise filtering.
    // Prepend any parked tail fragment so "Tell me about" + "yourself" shows as
    // "Tell me about yourself" in interim instead of just "yourself".
    const tailPrefix = pendingQuestionTailRef.current.join(" ").replace(/\?\s*$/, "").trim();
    const displayDraft = tailPrefix ? `${tailPrefix} ${fastDraft}`.replace(/\s+/g, " ").trim() : fastDraft;
    setInterimText(displayDraft);
    interimTextRef.current = displayDraft;
    setStagedTranscriptText(displayDraft);
    interimHasUnsavedContentRef.current = true;
    questionDraftRef.current = fastDraft;
    lastDraftTextRef.current = fastDraft;
    if (!stableSinceTsRef.current) stableSinceTsRef.current = now;
    lastPartialTsRef.current = now;

    // Keep light memory updates; heavy detection/merge runs on final text path.
    rememberContinuationTopics(rawLive, now);
    rememberInterimKeywords(fastDraft, now);
    const liveCandidate = buildLiveQuestionCandidateFromPartial(fastDraft);
    if (liveCandidate) {
      latestPartialQuestionCandidateRef.current = liveCandidate;
      latestPartialQuestionCandidateTsRef.current = now;
      if (!isStreaming) {
        setInterpretedQuestion(liveCandidate);
      }
    }
    if (id && socketRef.current?.connected) {
      socketRef.current.emit("recognizing_item", {
        meetingId: id,
        text: fastDraft,
        ts: now,
        audioMode,
      });
    }
  }, [
    normalizeTranscriptUtterance,
    rememberContinuationTopics,
    rememberInterimKeywords,
    buildLiveQuestionCandidateFromPartial,
    wordOverlap,
    id,
    audioMode,
    isStreaming,
    upsertDisplayTranscriptSegment,
  ]);

  const flushStreamBuffer = useCallback(() => {
    if (!streamBufferRef.current) return;
    const chunk = streamBufferRef.current;
    streamBufferRef.current = "";
    setStreamingAnswer((prev) => sanitizeDisplayedAnswerText(prev + chunk));
  }, [sanitizeDisplayedAnswerText]);

  const queueStreamFlush = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushStreamBuffer();
      flushTimerRef.current = null;
    }, 80);
  }, [flushStreamBuffer]);

  const clearStreamingRenderTimer = useCallback(() => {
    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    flushStreamBuffer();
  }, [flushStreamBuffer]);

  // Smooth streaming animation: drains wsTextQueueRef character-by-character at 60fps.
  // Adaptive speed: slow typewriter feel when the buffer is small (queue nearly caught up),
  // faster catch-up when the LLM is sending faster than 60fps can reveal.
  const startStreamAnimation = useCallback(() => {
    if (rafPendingRef.current) return; // animation loop already running
    const step = () => {
      rafPendingRef.current = null;
      const queue = wsTextQueueRef.current;
      if (!queue) return;
      // Snappy default (5 chars/frame = ~300 char/s at 60fps), ramp up fast when behind.
      const speed = queue.length > 150 ? 35 : queue.length > 40 ? 15 : 5;
      displayedAccRef.current += queue.slice(0, speed);
      wsTextQueueRef.current = queue.slice(speed);
      setStreamingAnswer(sanitizeDisplayedAnswerText(displayedAccRef.current));
      if (wsTextQueueRef.current) {
        rafPendingRef.current = requestAnimationFrame(step);
      }
    };
    rafPendingRef.current = requestAnimationFrame(step);
  }, [sanitizeDisplayedAnswerText]);

  const showOptimisticAssistantState = useCallback((questionHint?: string) => {
    setIsStreaming(true);
    setIsAwaitingFirstChunk(true);
    isAwaitingFirstChunkRef.current = true;
    setPendingResponse(null);
    if (!streamingAnswerRef.current) {
      setStreamingAnswer("");
    }
    setStreamingQuestion((questionHint || interpretedQuestionRef.current || "Answering...").trim());
  }, []);

  const clearFirstChunkWatchdog = useCallback(() => {
    if (firstChunkWatchdogRef.current) {
      clearTimeout(firstChunkWatchdogRef.current);
      firstChunkWatchdogRef.current = null;
    }
  }, []);

  const startFirstChunkWatchdog = useCallback((source: string) => {
    clearFirstChunkWatchdog();
    firstChunkWatchdogRef.current = setTimeout(() => {
      if (!isAwaitingFirstChunkRef.current) return;
      console.warn(`[ws] first-chunk-timeout source=${source}`);
      toast({
        title: "Slow response from AI",
        description: "Request sent but no streamed chunks yet. Retrying Enter is safe.",
        variant: "destructive",
      });
    }, 10000);
  }, [clearFirstChunkWatchdog, toast]);

  const flushTranscriptPersistQueue = useCallback(async () => {
    if (!id) return;
    const batch = transcriptPersistQueueRef.current.splice(0, transcriptPersistQueueRef.current.length);
    if (!batch.length) return;
    for (const turn of batch) {
      try {
        await fetch(`/api/meetings/${id}/transcript-turn`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(turn),
        });
      } catch (e) {
        console.error("[meeting] transcript turn persist failed", e);
      }
    }
  }, [id]);

  const scheduleTranscriptPersistFlush = useCallback(() => {
    if (transcriptPersistTimerRef.current) return;
    transcriptPersistTimerRef.current = setTimeout(() => {
      transcriptPersistTimerRef.current = null;
      void flushTranscriptPersistQueue();
    }, 4000);
  }, [flushTranscriptPersistQueue]);

  useEffect(() => {
    if (!id) {
      clearFirstChunkWatchdog();
      setWsTransportConnected(false);
      activeWsStreamIdRef.current = "";
      if (wsAnswerRef.current) {
        try { wsAnswerRef.current.close(); } catch {}
        wsAnswerRef.current = null;
      }
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);
    wsAnswerRef.current = ws;

    ws.onopen = () => {
      console.log("[ws] connected /ws (answers)");
      setWsTransportConnected(true);
      ws.send(JSON.stringify({
        type: "session_start",
        sessionId: id,
        userId: (meeting as any)?.userId || undefined,
         }));
    };

                ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data || "{}"));
        if (msg?.sessionId && msg.sessionId !== id) return;

        if (msg.type === "assistant_start") {
          console.log("[ws] assistant_start received", { requestId: msg.requestId, sessionId: msg.sessionId });
          activeWsStreamIdRef.current = String(msg.requestId || "");
          if (activeWsStreamIdRef.current) {
            requestQuestionByIdRef.current[activeWsStreamIdRef.current] =
              pendingQuestionForRequestRef.current || interpretedQuestionRef.current || "";
          }
          setIsStreaming(true);
          setIsAwaitingFirstChunk(true);
          triggerMetricRef.current.t_assistant_start_rendered = Date.now();
          isAwaitingFirstChunkRef.current = true;
          setStreamingQuestion(interpretedQuestionRef.current || "Live answer");
          setPendingResponse(null);
          setStreamingAnswer("");
          streamBufferRef.current = "";
          streamingAccumulatorRef.current = "";
          wsTextQueueRef.current = "";
          displayedAccRef.current = "";
          clearStreamingRenderTimer();
          startFirstChunkWatchdog("assistant_start");
          return;
        }

        if (msg.type === "assistant_chunk") {
          if (activeWsStreamIdRef.current && msg.requestId && msg.requestId !== activeWsStreamIdRef.current) return;
          const chunk = String(msg.text || "");
          if (!chunk) return;
          console.log("[ws] assistant_chunk received", { requestId: msg.requestId, chars: chunk.length });
          if (isAwaitingFirstChunkRef.current) {
            const now = Date.now();
            clearFirstChunkWatchdog();
            triggerMetricRef.current.t_first_token_rendered = now;
            const tDetected = triggerMetricRef.current.t_trigger_decision
              || triggerMetricRef.current.t_partial_detected
              || triggerMetricRef.current.t_final_detected
              || triggerMetricRef.current.t_request_sent
              || now;
            const tRequestSent = triggerMetricRef.current.t_request_sent || now;
            const ttfb = now - tRequestSent;
            console.log(`[perf][client] ws_ttft=${now - tDetected}ms request_to_first_token=${ttfb}ms`);
            setDebugMeta((prev) => ({ ...prev, ttfb, sessionState: interviewStateRef.current }));
            // First chunk: render immediately so TTFT feels instant
            streamingAccumulatorRef.current += chunk;
            displayedAccRef.current += chunk;
            setStreamingAnswer(sanitizeDisplayedAnswerText(displayedAccRef.current));
            setIsAwaitingFirstChunk(false);
            isAwaitingFirstChunkRef.current = false;
            return;
          }
          // Subsequent chunks: accumulate full WS text, queue for smooth reveal
          streamingAccumulatorRef.current += chunk;
          wsTextQueueRef.current += chunk;
          startStreamAnimation();
          return;
        }

        if (msg.type === "assistant_end") {
          if (activeWsStreamIdRef.current && msg.requestId && msg.requestId !== activeWsStreamIdRef.current) return;
          console.log("[ws] assistant_end received", { requestId: msg.requestId, cancelled: !!msg.cancelled });
          if (rafPendingRef.current) {
            cancelAnimationFrame(rafPendingRef.current);
            rafPendingRef.current = null;
          }
          if (flushTimerRef.current) {
            window.clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
          }
          // Flush any text still in the animation queue so the full answer shows immediately
          if (wsTextQueueRef.current) {
            displayedAccRef.current += wsTextQueueRef.current;
            wsTextQueueRef.current = "";
          }
          clearFirstChunkWatchdog();
          const buffered = streamBufferRef.current;
          streamBufferRef.current = "";
          streamingAccumulatorRef.current += buffered;
          const finalAnswer = sanitizeDisplayedAnswerText(streamingAccumulatorRef.current);
          // Layer 2 echo protection: record this answer so isAiFeedbackLoop can filter it if mic picks it up
          if (finalAnswer.trim()) {
            recentAiOutputRef.current = [finalAnswer, ...recentAiOutputRef.current].slice(0, 5);
          }
          if (msg.cancelled) {
            if (msg.requestId) {
              delete requestQuestionByIdRef.current[String(msg.requestId)];
            }
            // This stream was cancelled ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â a new request may have already been re-fired
            // (e.g. continuation combine: "Azure" cancelled ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ "Azure and also AWS" re-fired).
            // Only clear streaming state if we are NOT already awaiting a new answer's first chunk.
            // If isAwaitingFirstChunkRef is true, a new request is live ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â don't wipe its state.
            if (!isAwaitingFirstChunkRef.current) {
              setIsStreaming(false);
              setIsAwaitingFirstChunk(false);
              setStreamingQuestion("");
              setPendingResponse(null);
              setStreamingAnswer("");
              streamingAccumulatorRef.current = "";
              activeWsStreamIdRef.current = "";
            }
            if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
            interviewStateRef.current = "listening";
            lastAnswerDoneTimestampRef.current = Date.now();
            triggerMetricRef.current = {};
            return;
          }

          setStreamingAnswer(finalAnswer);
          setIsStreaming(false);
          setIsAwaitingFirstChunk(false);
          isAwaitingFirstChunkRef.current = false;
          setStreamingQuestion("");
          activeWsStreamIdRef.current = "";
          interpretedQuestionRef.current = "";
          triggerMetricRef.current.t_stream_done_rendered = Date.now();
          // Go straight back to listening ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â no cooldown delay so next question
          // from the interviewer is captured immediately after the answer ends.
          if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
          interviewStateRef.current = "listening";
          lastAnswerDoneTimestampRef.current = Date.now();
          setDebugMeta((prev) => ({ ...prev, sessionState: "listening" }));
          if (triggerMetricRef.current.t_request_sent) {
            const totalLatency = (triggerMetricRef.current.t_stream_done_rendered ?? Date.now()) - triggerMetricRef.current.t_request_sent;
            console.log(`[perf][client] ws_total_render_latency=${totalLatency}ms`);
            setDebugMeta((prev) => ({ ...prev, totalLatency, sessionState: "listening" }));
          }

          const requestId = String(msg.requestId || activeWsStreamIdRef.current || "");
          const questionUsed =
            requestQuestionByIdRef.current[requestId] || interpretedQuestionRef.current || streamingQuestionRef.current;
          if (finalAnswer.trim()) {
            const normalizedUsed = normalizeForDedup(questionUsed || "");
            interviewerQuestionMemoryRef.current = interviewerQuestionMemoryRef.current.map((q) => {
              if (q.answered) return q;
              const same = normalizedUsed && normalizeForDedup(q.text) === normalizedUsed;
              return same ? { ...q, answered: true } : q;
            });
            appendLocalResponse(questionUsed, finalAnswer, responseFormat === "custom" ? "custom" : responseFormat);
            lastCommittedResponseQuestionRef.current = questionUsed;
            lastAssistantAnswerRef.current = finalAnswer;
            // Add AI answer to conversation context so follow-up questions like
            // "how much percentage you said?" can reference it
            appendConversationContextLine("Candidate", finalAnswer.replace(/```[\s\S]*?```/g, "[code]").slice(0, 500));
            fetch(`/api/meetings/${id}/set-last-answer`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ answer: finalAnswer, promptUsed: questionUsed }),
            }).catch(() => {});
          }
          if (requestId) delete requestQuestionByIdRef.current[requestId];
          triggerMetricRef.current = {};
          return;
        }

        if (msg.type === "assistant_refine_start") {
          refineBufferRef.current = "";
          setIsRefining(true);
          return;
        }

        if (msg.type === "assistant_refine_chunk") {
          refineBufferRef.current += String(msg.text || "");
          return;
        }

        if (msg.type === "assistant_refine_end") {
          setIsRefining(false);
          if (!msg.cancelled && refineBufferRef.current.trim()) {
            const refined = sanitizeDisplayedAnswerText(refineBufferRef.current);
            // Use the exact question from the committed fast answer so replaceLatestLocalResponse
            // always finds the right card — interpretedQuestionRef may have changed by now.
            const questionUsed = lastCommittedResponseQuestionRef.current
              || interpretedQuestionRef.current
              || streamingQuestionRef.current
              || "";
            // Replace the fast answer card in-place. Also clear streamingAnswer so the
            // old fast-answer streaming card hides — if left set, newestResponseMatchesStreaming
            // becomes false (refined ≠ fast) and the streaming card reappears as a second card.
            replaceLatestLocalResponse(questionUsed, refined, responseFormat === "custom" ? "custom" : responseFormat);
            setStreamingAnswer("");
            streamingAccumulatorRef.current = "";
            setPendingResponse((prev) => prev ? { ...prev, answer: refined } : prev);
            lastAssistantAnswerRef.current = refined;
            appendConversationContextLine("Candidate", refined.replace(/```[\s\S]*?```/g, "[code]").slice(0, 500));
            fetch(`/api/meetings/${id}/set-last-answer`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ answer: refined, promptUsed: questionUsed }),
            }).catch(() => {});
          }
          refineBufferRef.current = "";
          return;
        }

        if (msg.type === "debug_meta") {
          setDebugMeta((prev) => ({
            ...prev,
            model: msg.model,
            provider: msg.provider,
            tier: msg.tier,
            maxTokens: msg.maxTokens,
            ragChunks: msg.ragChunks,
            answerStyle: msg.style,
            sessionState: interviewStateRef.current,
          }));
          return;
        }

        if (msg.type === "assistant_error" || msg.type === "error") {
          clearFirstChunkWatchdog();
          setIsStreaming(false);
          setIsAwaitingFirstChunk(false);
          isAwaitingFirstChunkRef.current = false;
          activeWsStreamIdRef.current = "";
          // Error: reset state immediately so user can retry
          if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
          interviewStateRef.current = "listening";
          streamBufferRef.current = "";
          wsTextQueueRef.current = "";
          displayedAccRef.current = "";
          if (rafPendingRef.current) {
            cancelAnimationFrame(rafPendingRef.current);
            rafPendingRef.current = null;
          }
          clearStreamingRenderTimer();
          const errorMsg = String(msg.message || "Please try again");
          console.log("[ws] assistant_error", errorMsg);
          toast({ title: "Streaming error", description: errorMsg, variant: "destructive" });
        }
      } catch {}
    };

    ws.onerror = () => {
      console.error("[ws] transport error on /ws");
      setWsTransportConnected(false);
    };

    ws.onclose = () => {
      console.log("[ws] disconnected /ws (answers)");
      clearFirstChunkWatchdog();
      setWsTransportConnected(false);
      if (activeWsStreamIdRef.current) {
        setIsStreaming(false);
        setIsAwaitingFirstChunk(false);
        isAwaitingFirstChunkRef.current = false;
        activeWsStreamIdRef.current = "";
        if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
        interviewStateRef.current = "listening";
      }
    };

    return () => {
      if (wsAnswerRef.current === ws) {
        wsAnswerRef.current = null;
      }
      try { ws.close(); } catch {}
      setWsTransportConnected(false);
      activeWsStreamIdRef.current = "";
    };
  }, [
    id,
        (meeting as any)?.userId,
    clearFirstChunkWatchdog,
    clearStreamingRenderTimer,
    queueStreamFlush,
    sanitizeDisplayedAnswerText,
    startFirstChunkWatchdog,
    appendLocalResponse,
    replaceLatestLocalResponse,
    responseFormat,
    toast,
  ]);

  useEffect(() => {
    if (!id) return;
    const socket = getSocket();
    socketRef.current = socket;

    const onConnect = () => {
      setSocketConnected(true);
      socket.emit("join_meeting", { meetingId: id });
      socket.emit("set_answer_style", { meetingId: id, style: answerStyleRef.current });
    };
    const onDisconnect = () => setSocketConnected(false);

    const onAnswerStyle = ({ meetingId, style }: any) => {
      if (meetingId !== id) return;
      if (["brief", "standard", "deep", "concise", "star", "bullet", "talking_points", "direct_followup"].includes(style)) {
        setAnswerStyle(style);
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("answer_style", onAnswerStyle);

    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("answer_style", onAnswerStyle);
    };
  }, [id]);

  // Returns "code_example" when a question is clearly asking for code, otherwise the current format.
  const resolveFormat = useCallback((question: string): string => {
    if (responseFormat === "custom") return "custom";
    const isCodeQ = /\b(write|build|create|implement|code|program|script|function|class|algorithm|example code|show code|give code|generate code|without (using )?function|without function|in python|in javascript|in typescript|in java|in golang|in go|in rust|in c\+\+|in c#|using (fastapi|django|flask|express|react|node))\b/i.test(question);
    if (isCodeQ) return "code_example";
    return responseFormat;
  }, [responseFormat]);

  const askStreamingQuestion = useCallback(async (question: string, speculative = false) => {
    if (!question.trim()) return;

    if (id) {
      const ws = wsAnswerRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        const cleanedQuestion = question.trim();
        const now = Date.now();
        setLastSubmitSource("interpreted");
        setInterpretedQuestion(cleanedQuestion);
        setStreamingQuestion(cleanedQuestion);
        triggerMetricRef.current.t_trigger_decision = triggerMetricRef.current.t_trigger_decision || now;
        triggerMetricRef.current.t_request_sent = now;
        showOptimisticAssistantState(cleanedQuestion);
        startFirstChunkWatchdog("ask_streaming_question");
        const preparedQuestion =
          speculativePrepareRef.current
          && levenshteinSimilarity(
            speculativePrepareRef.current.norm,
            normalizeQuestionForSimilarity(cleanedQuestion),
          ) >= SIM_SPECULATIVE_REUSE
            ? speculativePrepareRef.current.text
            : undefined;
        ws.send(JSON.stringify({
          type: "question",
          sessionId: id,
          text: cleanedQuestion,
          format: resolveFormat(cleanedQuestion),
          model: selectedModel,
          quickMode: quickResponseMode,
          docsMode,
          metadata: {
            mode: "enter",
            audioMode,
            submitSource: "interpreted",
            customFormatPrompt: responseFormat === "custom" ? customPrompt : undefined,
            docsMode,
            systemPrompt: customPrompt || undefined,
            jobDescription: conversationHistory || undefined,
            preparedQuestion,
            speculative,
          },
        }));
        return;
      }
    }

    toast({ title: "WebSocket not connected", description: "Reconnect and try again.", variant: "destructive" });
  }, [
    audioMode,
    customPrompt,
    docsMode,
    id,
    conversationHistory,
    quickResponseMode,
    resolveFormat,
    selectedModel,
    startFirstChunkWatchdog,
    showOptimisticAssistantState,
    toast,
  ]);

  const submitExplicitQuestion = useCallback((question: string) => {
    const trimmed = String(question || "").trim();
    if (!trimmed || isStreaming) return;
    askStreamingQuestion(trimmed);
  }, [askStreamingQuestion, isStreaming]);

  const handleFinalTurn = useCallback(async (text: string, startMs?: number, endMs?: number, speaker: "interviewer" | "candidate" | "unknown" = "unknown") => {
    const rawFinal = String(text || "").replace(/\s+/g, " ").trim();
    let trimmed = normalizeTranscriptUtterance(rawFinal, "final");

    // Candidate audio: log to context only ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â skip all question detection
    if (speaker === "candidate") {
      if (trimmed && isSubstantiveSegment(trimmed)) {
        appendConversationContextLine("Candidate", trimmed);
      }
      return;
    }

    // Mic-only heuristic: detect candidate self-talk — starts with "I" OR has many "I" words.
    // Only apply this heuristic in mic-only mode (no speaker diarization).
    // In system audio mode, never classify by "I" heuristic — only use explicit speaker labels.
    // When speaker is "unknown", default to treating as interviewer (skip "I" heuristic).
    const selfTalkICount = (trimmed.match(/\bI\b/g) || []).length;
    const isCandidateSpeech = audioMode === "mic" && speaker !== "unknown" && (/^i\b/i.test(trimmed.trim()) || selfTalkICount > 5);
    if (isCandidateSpeech) {
      if (trimmed && isSubstantiveSegment(trimmed)) {
        appendConversationContextLine("Candidate", trimmed);
      }
      return;
    }

    const meaningfulTopics = extractMeaningfulInterviewTopics(trimmed);
    const keepAsMeaningfulFragment =
      meaningfulTopics.length > 0
      || (trimmed.split(/\s+/).filter(Boolean).length <= 3 && isLikelyInterviewTopic(trimmed));
    const normalizedTrimmedBase = trimmed.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
    const incompleteTail =
      /\b(about|with|in|on|for|of|from|to|at|through|by|into|over|under|between|among|the|a|an|your|my|their|our|some|any|this|that|these|those|and|or|but|is|are|have|has|do|does|can|could|would|what|how|where|who|which|why|whether|if|as|also|vs|versus)\s*[.,]?\s*$/.test(normalizedTrimmedBase)
      || /\b(and|or)\s*\?$/.test(trimmed.toLowerCase());
    const questionLike =
      detectQuestion(trimmed)
      || /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|is|are)\b/i.test(normalizedTrimmedBase)
      || /\b(difference|compare|experience|explain|mean)\b/i.test(normalizedTrimmedBase);
    let allowLowerThreshold = false;
    if (incompleteTail && questionLike) {
      const recovered = getRecentInterimKeywordForRestore(trimmed, Date.now());
      if (recovered) {
        trimmed = `${trimmed.replace(/\?\s*$/, "").trim()} ${recovered}`.replace(/\s+/g, " ").trim();
      } else {
        // Recovery failed: attempt detection on original trimmed with a lower confidence threshold
        allowLowerThreshold = true;
      }
    }
    rememberContinuationTopics(trimmed, Date.now());
    if (pendingQuestionTailRef.current.length > 0 && trimmed) {
      // Capture current tail before clearing timer and ref to avoid race condition
      const capturedTail = pendingQuestionTailRef.current;
      if (pendingTailTimerRef.current) { clearTimeout(pendingTailTimerRef.current); pendingTailTimerRef.current = null; }
      const base = capturedTail.join(" ").replace(/\?\s*$/, "").trim();
      trimmed = `${base} ${trimmed}`.replace(/\s+/g, " ").trim();
      pendingQuestionTailRef.current = [];
    }

    // Fragment stitching for pause-split speech:
    // e.g. "tell me about" + pause + "yourself" => "tell me about yourself"
    const prevFinal = normalizeTranscriptUtterance((segmentsRef.current[0] || "").trim(), "final");
    let stitchedFromFragment = false;
    if (trimmed && prevFinal && prevFinal !== trimmed) {
      const currentWordCount = trimmed.split(/\s+/).filter(Boolean).length;
      // Require at least 2 words so bare noise like "And." or "And. And." is never
      // treated as a joiner continuation ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â it would stitch garbage onto the question.
      const currentIsContinuationTail = /^(and|and also|also|plus|as well as|along with|including|in addition|regarding|about|specifically)\b/i.test(trimmed) && currentWordCount >= 2 && currentWordCount <= 10;
      const prevLooksFragment =
        (
          /\b(about|with|on|for|to|in|of)\s*$/i.test(prevFinal)
          || /^(what|why|how|which|who|where|when|explain|describe|tell|walk|talk)\b/i.test(prevFinal)
          // Dedicated partial-phrase patterns: these are fragments regardless of detectQuestion result
          || /\b(tell me about|talk me through|walk me through|tell me|explain|describe|what about|how about)\s*$/i.test(prevFinal)
        );
      const prevIsQuestionLike = detectQuestion(prevFinal) || detectQuestionAdvanced(prevFinal).confidence >= 0.5;
      const currentLooksContinuation =
        startsWithContinuationJoiner(trimmed)
        || currentWordCount <= 4;

      // Guard: if the new segment is itself a standalone question, never stitch it onto
      // the previous one ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â treat it as a fresh question on a new line.
      const currentIsNewQuestion =
        detectQuestion(trimmed) ||
        /^(what|why|how|when|where|who|which|tell me|explain|describe|walk me|talk me|do you|are you|have you|can you|could you|would you|is there|are there)\b/i.test(trimmed.toLowerCase());

      // 10-second combine window: how long since the last segment was committed.
      const msSinceLastSegment = lastSegmentCommittedAtRef.current > 0
        ? Date.now() - lastSegmentCommittedAtRef.current
        : Infinity;

      // Merge "and also <topic>" tails into prior question within 10s, e.g.
      // "Do you have experience in React?" + "and also Flask"
      // Guard: if the continuation itself is a full standalone question, don't stitch.
      if (prevIsQuestionLike && currentIsContinuationTail && !currentIsNewQuestion && msSinceLastSegment <= 10_000) {
        const prevNoQ = prevFinal.replace(/\?\s*$/, "").trim();
        const stitchedTail = `${prevNoQ} ${trimmed}`.replace(/\s+/g, " ").trim();
        const stitchedTailAdv = detectQuestionAdvanced(stitchedTail);
        if (stitchedTailAdv.isQuestion && stitchedTailAdv.confidence >= 0.5) {
          trimmed = stitchedTail.endsWith("?") ? stitchedTail : `${stitchedTail}?`;
          stitchedFromFragment = true;
        }
      }

      // Merge bare short tech-topic fragments (e.g. "AWS", "Django", ".NET") within 10s.
      // Also merge any very short fragment (≤3 words) arriving within 4s of a question —
      // e.g. "roughly", "at peak", "in production", "for this project".
      const isQuickShortFragment = currentWordCount <= 3 && msSinceLastSegment <= 4_000 && !currentIsNewQuestion;
      if (!stitchedFromFragment && !currentIsNewQuestion && prevIsQuestionLike && currentWordCount <= 4 && (keepAsMeaningfulFragment || isQuickShortFragment) && msSinceLastSegment <= 10_000) {
        const prevNoQ = prevFinal.replace(/\?\s*$/, "").trim();
        const joiner = /\b(in|with|on|for|and)\s*$/i.test(prevNoQ) ? "" : " and";
        const stitchedTopic = `${prevNoQ}${joiner} ${trimmed}`.replace(/\s+/g, " ").trim();
        const stitchedTopicAdv = detectQuestionAdvanced(stitchedTopic);
        if (stitchedTopicAdv.isQuestion && stitchedTopicAdv.confidence >= 0.5) {
          trimmed = stitchedTopic.endsWith("?") ? stitchedTopic : `${stitchedTopic}?`;
          stitchedFromFragment = true;
        }
      }

      if (prevLooksFragment && currentLooksContinuation && !currentIsNewQuestion) {
        const stitched = `${prevFinal} ${trimmed}`.replace(/\s+/g, " ").trim();
        const stitchedAdvanced = detectQuestionAdvanced(stitched);
        const stitchedIsQuestion = stitchedAdvanced.isQuestion && stitchedAdvanced.confidence >= 0.5;
        if (stitchedIsQuestion) {
          trimmed = stitched;
          stitchedFromFragment = true;
        }
      }

      // #8 Fallback: bare tech topic + most recent unanswered question from memory.
      // Only fires when the previous question is also tech-related (has extractable topics)
      // to avoid absurd combinations like "tell me about yourself" + "java".
      if (!stitchedFromFragment && !currentIsNewQuestion && keepAsMeaningfulFragment && meaningfulTopics.length > 0) {
        const recentMemQ = interviewerQuestionMemoryRef.current
          .find(q => !q.answered && (Date.now() - q.ts) <= 15_000);
        if (recentMemQ && extractMeaningfulInterviewTopics(recentMemQ.text).length > 0) {
          const prevNoQ = recentMemQ.text.replace(/\?\s*$/, "").trim();
          const joiner = /\b(in|with|on|for|and)\s*$/i.test(prevNoQ) ? "" : " and";
          const stitchedMem = `${prevNoQ}${joiner} ${trimmed}`.replace(/\s+/g, " ").trim();
          const stitchedMemAdv = detectQuestionAdvanced(stitchedMem);
          if (stitchedMemAdv.isQuestion && stitchedMemAdv.confidence >= 0.5) {
            trimmed = stitchedMem.endsWith("?") ? stitchedMem : `${stitchedMem}?`;
            stitchedFromFragment = true;
          }
        }
      }
    }

    const advanced = detectQuestionAdvanced(trimmed);
    const maybeQ = detectQuestion(trimmed) || (advanced.isQuestion && advanced.confidence >= 0.5);
    const normalizedTrimmed = trimmed.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
    const trimmedWordCount = normalizedTrimmed.split(/\s+/).filter(Boolean).length;
    const openEndedJoinerTail =
      /\b(and|or|also|as well as|along with|including|in addition|regarding|about|specifically)\s*\??$/i.test(normalizedTrimmed)
      && trimmedWordCount >= 2
      && trimmedWordCount <= 14
      && !/^(tell me about|walk me through|explain|describe)\b/i.test(normalizedTrimmed);
    if (openEndedJoinerTail) {
      const tailText = trimmed.replace(/\?\s*$/, "").trim();
      // Deduplicate: skip if this tail is already the last entry (prevents "and also and also")
      const lastTail = pendingQuestionTailRef.current[pendingQuestionTailRef.current.length - 1] || "";
      if (normalizeForDedup(lastTail) !== normalizeForDedup(tailText)) {
        pendingQuestionTailRef.current.push(tailText);
      }
      const joinedTail = pendingQuestionTailRef.current.join(" ").trim();
      questionDraftRef.current = joinedTail;
      lastDraftTextRef.current = joinedTail;
      stableSinceTsRef.current = Date.now();
      lastPartialTsRef.current = Date.now();
      setInterimText(joinedTail);
      interimTextRef.current = joinedTail;
      interimHasUnsavedContentRef.current = true;
      // 8s safety flush: start the timer only on the FIRST park ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â don't reset on every
      // additional joiner push so the 8s always counts from when the tail was first parked.
      if (!pendingTailTimerRef.current) pendingTailTimerRef.current = setTimeout(() => {
        pendingTailTimerRef.current = null;
        const flushed = pendingQuestionTailRef.current.join(" ").trim();
        if (!flushed) return;
        pendingQuestionTailRef.current = [];
        questionDraftRef.current = flushed;
        lastDraftTextRef.current = flushed;
        setInterimText("");
        interimTextRef.current = "";
        // Only commit to display if this is substantive content (at least 3 words).
        // Single joiners like "and", "or", "also" are noise and should not pollute the transcript.
        const flushedWordCount = flushed.split(/\s+/).filter(Boolean).length;
        if (flushedWordCount >= 3) {
          upsertDisplayTranscriptSegment(flushed);
          setPendingTranscriptLine(flushed);
          pendingTranscriptLineRef.current = flushed;
          pendingTranscriptTsRef.current = Date.now();
        }
      }, 8_000);
      return;
    }
    if (
      !trimmed
      || ((!isSubstantiveSegment(trimmed) && !maybeQ && !keepAsMeaningfulFragment && !allowLowerThreshold))
      || (isLikelyNoiseSegment(trimmed) && !maybeQ && !keepAsMeaningfulFragment && !allowLowerThreshold)
      || (safetyGuardEnabled && isAiFeedbackLoop(trimmed))
    ) {
      // Dropped finals do NOT clear interimText ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â interimHasUnsavedContentRef stays true
      // so the visible partial text stays on screen until the next real final commits it.
      return;
    }

    // During active answering: stitched continuations always pass through so the combined
    // question is committed. Everything else is kept visible via interimText (not dropped
    // to segmentsRef) to avoid corrupting the stitch context for the next question.
    if (interviewStateRef.current === "answering") {
      if (stitchedFromFragment) {
        // allow ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â confirmed continuation, must update segmentsRef with combined question
      } else if (keepAsMeaningfulFragment) {
        const prevSegIsQ = detectQuestion(segmentsRef.current[0] || "") || detectQuestionAdvanced(segmentsRef.current[0] || "").confidence >= 0.5;
        const hasRecentMemQ = interviewerQuestionMemoryRef.current.some(q => !q.answered && (Date.now() - q.ts) <= 12_000);
        if (!prevSegIsQ && !hasRecentMemQ) return;
      } else {
        return;
      }
    }

    const latest = segmentsRef.current[0];
    if (
      !stitchedFromFragment
      && latest
      && wordOverlap(latest, trimmed) > 0.92
      && !keepAsMeaningfulFragment
      && !shouldReplaceLatestTranscriptLine(latest, trimmed)
    ) {
      return;
    }

    // When stitching combined the fragment into a full question, use the stitched text for display
    // so that pendingTranscriptLineRef gets the full combined question, not just the raw fragment.
    const segmentForDisplay = String(rawFinal || trimmed || "").replace(/\s+/g, " ").trim();
    upsertTranscriptSegment(trimmed);
    // Don't merge two independent questions into one line.
    // Allow grouping only when the pending text is a fragment (not yet a complete question)
    // or when the new segment is not itself a standalone question.
    const pendingIsCompleteQuestion = !!pendingTranscriptLineRef.current
      && (detectQuestion(pendingTranscriptLineRef.current)
        || /[?!]$/.test(pendingTranscriptLineRef.current.trim()));
    const newSegIsQuestion = detectQuestion(segmentForDisplay)
      || /[?]$/.test(segmentForDisplay.trim())
      || /^(what|why|how|when|where|who|which|tell me|explain|describe|walk me|talk me|do you|are you|have you|can you|could you|would you|is there|are there|do i|did you|have you|let'?s talk|talk to me|tell us|and also (do|can|have|tell|what|why|how)|and (do|can|have|tell|what|why|how))\b/i.test(segmentForDisplay.toLowerCase());
    // Joiner phrases ("and also Flask", "and React", "also AWS") should always attach
    // to the previous line even across a long pause ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â use a 12 s window for them.
    const newSegStartsJoiner = /^(and also|and|also|plus)\b/i.test(segmentForDisplay.trim());
    const pendingSegmentIsQuestion = !!pendingTranscriptLineRef.current && detectQuestion(pendingTranscriptLineRef.current);
    const joinerGroupingMs = (newSegStartsJoiner && pendingSegmentIsQuestion) ? 12_000 : TRANSCRIPT_GROUPING_MS;
    const combinedWordCount = `${pendingTranscriptLineRef.current} ${segmentForDisplay}`.split(/\s+/).filter(Boolean).length;
    const shouldGroupWithPending =
      pendingTranscriptLineRef.current
      && !newSegIsQuestion
      && !(pendingIsCompleteQuestion && newSegIsQuestion)
      && combinedWordCount <= 20
      && (Date.now() - pendingTranscriptTsRef.current) <= joinerGroupingMs;
    if (shouldGroupWithPending) {
      const pendingNorm = normalizeForDedup(pendingTranscriptLineRef.current);
      const segNorm = normalizeForDedup(segmentForDisplay);
      const isDuplicateTail = pendingNorm === segNorm || pendingNorm.endsWith(segNorm);
      if (isDuplicateTail) {
        pendingTranscriptTsRef.current = Date.now();
      } else {
        const raw = `${pendingTranscriptLineRef.current} ${segmentForDisplay}`.replace(/\s+/g, " ").trim();
        const deduped = raw.replace(/\b(\w+)(\s+\1)+\b/gi, "$1");
        pendingTranscriptLineRef.current = deduped;
        pendingTranscriptTsRef.current = Date.now();
        setPendingTranscriptLine(deduped);
        upsertDisplayTranscriptSegment(segmentForDisplay);
      }
    } else {
      flushPendingTranscriptLine();
      pendingTranscriptLineRef.current = segmentForDisplay;
      pendingTranscriptTsRef.current = Date.now();
      setPendingTranscriptLine(segmentForDisplay);
      upsertDisplayTranscriptSegment(segmentForDisplay);
    }
    schedulePendingTranscriptFlush();

    // No auto-fire: answers only triggered by Enter key press.

    lastSegmentCommittedAtRef.current = Date.now();
    // If the current interimText extends beyond what was just finalized (user kept speaking),
    // preserve the extra words so nothing disappears from screen.
    const currentInterim = interimTextRef.current.trim();
    const finalWords = trimmed.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean);
    const interimWords = currentInterim.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean);
    // Check that interim starts with all the finalized words and has extra words after.
    const interimStartsWithFinal = finalWords.length > 0 && finalWords.every((w, i) => interimWords[i] === w);
    const interimExtendsBeyondFinal = currentInterim && interimStartsWithFinal && interimWords.length > finalWords.length;
    if (interimExtendsBeyondFinal) {
      // Keep the words spoken after the finalized segment visible (use original casing).
      const originalWords = currentInterim.split(/\s+/).filter(Boolean);
      const residual = originalWords.slice(finalWords.length).join(" ");
      setInterimText(residual);
      interimTextRef.current = residual;
      setStagedTranscriptText(residual);
      interimHasUnsavedContentRef.current = true;
    } else {
      interimHasUnsavedContentRef.current = false;
      setInterimText("");
      interimTextRef.current = "";
      setStagedTranscriptText("");
    }
    latestPartialQuestionCandidateRef.current = "";
    latestPartialQuestionCandidateTsRef.current = 0;
    questionDraftRef.current = trimmed;
    lastDraftTextRef.current = trimmed;
    stableSinceTsRef.current = Date.now();
    lastPartialTsRef.current = Date.now();
    // Mark finalization so updateDraftFromPartial can discard stale post-final echoes
    lastFinalizedTextRef.current = trimmed;
    lastFinalizedAtRef.current = Date.now();

    const isIncompleteFinal = isLikelyIncompleteFragment(trimmed) && !keepAsMeaningfulFragment;
    // No "I" pronoun → very likely interviewer: use higher confidence threshold (interviewer asks direct questions);
    // when "I" is present the speaker may be the candidate, so use a lower threshold.
    const noFirstPerson = selfTalkICount === 0;
    const confidenceThreshold = noFirstPerson ? 0.6 : 0.45;
    const minWords = noFirstPerson ? 2 : 3;
    const finalIsQuestion = (detectQuestion(trimmed) || (advanced.isQuestion && advanced.confidence >= confidenceThreshold)) && !isIncompleteFinal;
    const isSubstantiveStatement = !finalIsQuestion && !isIncompleteFinal && !isLikelyNoiseSegment(trimmed) &&
      trimmed.split(/\s+/).filter(Boolean).length >= minWords;
    if (finalIsQuestion || isSubstantiveStatement) {
      pendingContinuationTopicsRef.current = [];
      rememberBoundaryQuestionCandidate(trimmed, Date.now());
      interviewerQuestionMemoryRef.current = [
        { text: trimmed, answered: false, ts: Date.now() },
        ...interviewerQuestionMemoryRef.current,
      ].slice(0, 30);
      // Invalidate stale interpreted question when a newer transcript question arrives.
      const currentInterpreted = interpretedQuestionRef.current?.trim() || "";
      if (!currentInterpreted || levenshteinSimilarity(
        normalizeQuestionForSimilarity(currentInterpreted),
        normalizeQuestionForSimilarity(trimmed),
      ) < SIM_DEDUP_BLOCK) {
        setInterpretedQuestion(trimmed);
      }
    } else {
      if (keepAsMeaningfulFragment) {
        rememberBoundaryQuestionCandidate(trimmed, Date.now());
      }
      spokenReplyMemoryRef.current = [{ text: trimmed, ts: Date.now() }, ...spokenReplyMemoryRef.current].slice(0, 30);
    }
    // No "I" and not noise → treat as interviewer in conversation context too
    const speakerLabel: "Interviewer" | "Candidate" = (finalIsQuestion || noFirstPerson) ? "Interviewer" : "Candidate";
    appendConversationContextLine(speakerLabel, trimmed);

    // Stage B: reconcile speculative trigger with final transcript.
    const speculative = speculativeQuestionRef.current;
    if (speculative) {
      const finalNorm = normalizeQuestionForSimilarity(trimmed);
      const similarity = finalNorm ? levenshteinSimilarity(speculative.norm, finalNorm) : 0;
      const elapsed = Math.max(0, Date.now() - (speculative.ts || Date.now()));
      const withinWindow = elapsed <= SPECULATIVE_WINDOW_MS;
      const shouldRefine = withinWindow && !speculative.refined && similarity < SIM_REFINEMENT_MAX && maybeQ;
      if (shouldRefine && !isNearDuplicateAskedQuestion(trimmed)) {
        speculative.refined = true;
        if (finalNorm) {
          rememberAskedFingerprint(finalNorm);
        }
        // Do not start a second stream. Tier-1 refinement is already scheduled
        // after Tier-0 completion in the server streaming pipeline.
        setInterpretedQuestion(trimmed);
      } else if (shouldRefine && isNearDuplicateAskedQuestion(trimmed)) {
        // shouldRefine is true but it's a near-duplicate — clear to prevent deadlock
        speculativeQuestionRef.current = null;
      } else if (similarity >= SIM_REFINEMENT_MAX || !withinWindow) {
        speculativeQuestionRef.current = null;
      }
    }

    const finalFingerprint = normalizeQuestionForSimilarity(trimmed);
    const canFinalTrigger = (
      !ENTER_ONLY_ANSWER_MODE
      && autoAnswerEnabled
      && !isStreaming
      && advanced.isQuestion
      && advanced.confidence >= 0.65
      && !!finalFingerprint
      && !isDuplicateRecentAutoTrigger(finalFingerprint, Date.now())
      && !isNearDuplicateAskedQuestion(trimmed)
    );
    // Update debug panel with latest question confidence
    setDebugMeta((prev) => ({ ...prev, questionConf: advanced.confidence, sessionState: interviewStateRef.current }));

    if (canFinalTrigger && id) {
      // Capture state values at detection time (used as fallback if display is empty at fire time)
      const capturedTrimmed = trimmed;
      const capturedId = id;
      const capturedFormat = responseFormat;
      const capturedModel = selectedModel;
      const capturedQuickMode = quickResponseMode;
      const capturedDocsMode = docsMode;
      const capturedCustomPrompt = customPrompt;
      const capturedHistory = conversationHistory;
      const capturedAudioMode = audioMode;

      // Debounce: cancel any pending trigger and start a fresh 700ms window.
      // This lets rapid-fire multi-question sequences accumulate in displaySegmentsRef
      // before we fire, so the AI receives ALL questions together instead of just the first.
      if (autoTriggerDebounceRef.current) clearTimeout(autoTriggerDebounceRef.current);

      autoTriggerDebounceRef.current = setTimeout(() => {
        autoTriggerDebounceRef.current = null;
        // Abort if another trigger already locked state during the debounce window
        if (interviewStateRef.current === "answering") return;

        // Build multi-question text from all consecutive question segments in the display
        // (newest-first in displaySegmentsRef, so reverse to chronological order).
        const QSTART_RE = /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|is|are|tell|walk|explain|give|describe|share|suppose|assume)\b/i;
        const CAND_RE = /^Candidate:\s+/i;
        const collectedQs: string[] = [];
        let fragSkips = 0;
        for (const seg of displaySegmentsRef.current.slice(0, 10)) {
          const s = String(seg || "").trim();
          if (!s || CAND_RE.test(s)) break;
          if (s.includes("?") || QSTART_RE.test(s)) {
            collectedQs.push(s);
            fragSkips = 0;
          } else {
            if (s.split(/\s+/).filter(Boolean).length <= 2 && fragSkips < 2) fragSkips++;
            else break;
          }
        }
        const text = collectedQs.length > 1
          ? collectedQs.slice().reverse().join(" ")
          : capturedTrimmed;

        interviewStateRef.current = "answering";
        rememberAutoTriggerFingerprint(finalFingerprint!, Date.now());
        rememberAskedFingerprint(finalFingerprint!);
        triggerMetricRef.current = { t_trigger_decision: Date.now(), t_final_detected: Date.now() };
        setLastSubmitSource("transcript");
        setInterpretedQuestion(text);
        setStreamingQuestion(text);
        showOptimisticAssistantState(text);
        const ws = wsAnswerRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          startFirstChunkWatchdog("auto_final");
          ws.send(JSON.stringify({
            type: "question",
            sessionId: capturedId,
            text,
            format: capturedFormat === "custom" ? "custom" : capturedFormat,
            model: capturedModel,
            quickMode: capturedQuickMode,
            docsMode: capturedDocsMode,
            metadata: {
              mode: "final",
              audioMode: capturedAudioMode,
              submitSource: "transcript",
              customFormatPrompt: capturedFormat === "custom" ? capturedCustomPrompt : undefined,
              docsMode: capturedDocsMode,
              systemPrompt: capturedCustomPrompt || undefined,
              jobDescription: capturedHistory || undefined,
            },
          }));
          triggerMetricRef.current.t_request_sent = Date.now();
        } else {
          interviewStateRef.current = "listening";
        }
      }, 700);
    }

    try {
      if (id && socketRef.current?.connected) {
        socketRef.current.emit("recognized_item", {
          meetingId: id,
          text: trimmed,
          ts: Date.now(),
          audioMode,
        });
      }
      const turn = { text: trimmed, startMs, endMs };
      if (socketConnected) {
        transcriptPersistQueueRef.current.push(turn);
        scheduleTranscriptPersistFlush();
      } else {
        await fetch(`/api/meetings/${id}/transcript-turn`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(turn),
        });
      }
    } catch (e) {
      console.error("[meeting] turn finalize/detect failed", e);
    }
  }, [
    id,
    audioMode,
        isAiFeedbackLoop,
    normalizeTranscriptUtterance,
    isLikelyNoiseSegment,
    startsWithContinuationJoiner,
    wordOverlap,
    shouldReplaceLatestTranscriptLine,
    socketConnected,
    scheduleTranscriptPersistFlush,
    autoAnswerEnabled,
    isStreaming,
    isNearDuplicateAskedQuestion,
    rememberAskedFingerprint,
    rememberBoundaryQuestionCandidate,
    rememberContinuationTopics,
    getRecentInterimKeywordForRestore,
    rememberAutoTriggerFingerprint,
    isDuplicateRecentAutoTrigger,
    appendConversationContextLine,
    cleanTranscriptForDisplay,
    autocorrectNoisyQuestionWithContext,
    upsertTranscriptSegment,
    upsertDisplayTranscriptSegment,
    replaceLatestDisplayTranscriptSegment,
    flushPendingTranscriptLine,
    schedulePendingTranscriptFlush,
    responseFormat,
    selectedModel,
    quickResponseMode,
    docsMode,
    customPrompt,
    conversationHistory,
    safetyGuardEnabled,
    showOptimisticAssistantState,
    startFirstChunkWatchdog,
  ]);

  const setupAudioAnalyser = useCallback((stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      audioContextRef.current = ctx;
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setAudioLevel(Math.min(100, Math.round(avg * 1.5)));
        animFrameRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();
    } catch (e) {
      console.error("Audio analyser setup failed:", e);
    }
  }, []);

  const cleanupAudioAnalyser = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch (e) {}
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
  }, []);

  const startAzureRecognizer = useCallback(async (mode: "mic" | "system", stream?: MediaStream, speaker: "interviewer" | "candidate" | "unknown" = "unknown") => {
    setSttStatus("connecting");
    setSttError("");
    azureLastCallRef.current = { mode, stream, speaker };
    const scheduleAzureReconnect = () => {
      const alive = mode === "system" ? systemAudioAlive.current : recognitionAlive.current;
      if (!alive) return;
      if (azureReconnectTimerRef.current) clearTimeout(azureReconnectTimerRef.current);
      azureReconnectTimerRef.current = setTimeout(() => {
        const last = azureLastCallRef.current;
        if (!last || !azureStartFnRef.current) return;
        const stillAlive = last.mode === "system" ? systemAudioAlive.current : recognitionAlive.current;
        if (!stillAlive) return;
        console.log("[Azure STT] Auto-reconnecting after disconnect...");
        void azureStartFnRef.current(last.mode, last.stream, last.speaker);
      }, 2500);
    };
    const recognizer = new AzureRecognizer(
      {
        onPartial: (text) => {
          if (speaker !== "candidate" && text?.trim()) {
            handleBargeIn();
          }
          if (speaker !== "candidate") {
            updateDraftFromPartial(text);
          }
        },
        onFinal: (text) => {
          handleFinalTurn(text, undefined, undefined, speaker);
        },
        onError: (error) => {
          const alive = mode === "system" ? systemAudioAlive.current : recognitionAlive.current;
          if (!alive) return; // intentional stop — ignore error
          console.error("[Azure STT] Error (will reconnect):", error);
          setSttError(error);
          setSttStatus("connecting");
          scheduleAzureReconnect();
        },
        onStatusChange: (status) => {
          const alive = mode === "system" ? systemAudioAlive.current : recognitionAlive.current;
          if (status === "connected") {
            console.log("[Azure STT] Connected");
            setSttStatus("connected");
            setSttError("");
            if (azureReconnectTimerRef.current) { clearTimeout(azureReconnectTimerRef.current); azureReconnectTimerRef.current = null; }
          } else if (status === "disconnected" && alive) {
            console.log("[Azure STT] Disconnected — reconnecting...");
            setSttStatus("connecting");
            scheduleAzureReconnect();
          } else if (!alive) {
            setSttStatus("idle");
          }
        },
      },
      {
        language: sttLanguage,
        // Moderate segmentation: reduce early splits while keeping live feel.
        silenceTimeoutMs: mode === "system" ? 2100 : 600,
        phraseHints: buildSpeechPhraseHints(),
        vadEnabled: true,
        vadNoiseFloor: mode === "system" ? 0.02 : 0.008,
      },
    );

    azureRecognizerRef.current = recognizer;

    if (mode === "mic") {
      await recognizer.startFromMic();
    } else if (stream) {
      await recognizer.startFromStream(stream);
    }
  }, [sttLanguage, toast, handleFinalTurn, handleBargeIn, updateDraftFromPartial, buildSpeechPhraseHints]);

  // Keep azureStartFnRef always pointing at the latest startAzureRecognizer so the reconnect
  // timer can call it without a stale closure.
  useEffect(() => { azureStartFnRef.current = startAzureRecognizer; }, [startAzureRecognizer]);

  // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Free-tier tick: deduct 1 min every 60s while listening ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
  const startFreeSessionTick = useCallback(() => {
    if (freeTickIntervalRef.current) return;
    freeTickIntervalRef.current = setInterval(async () => {
      if (!id) return;
      try {
        await fetch(`/api/meetings/${id}/session-tick`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ minutes: 1 }),
        });
      } catch {}
    }, 60_000);
  }, [id]);

  const stopFreeSessionTick = useCallback(() => {
    if (freeTickIntervalRef.current) {
      clearInterval(freeTickIntervalRef.current);
      freeTickIntervalRef.current = null;
    }
  }, []);

  // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Free-timer countdown (per-second UI counter) ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
  const freeCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startFreeCountdown = useCallback(() => {
    if (freeCountdownRef.current) return;
    freeCountdownRef.current = setInterval(() => {
      setFreeSecondsRemaining((prev) => {
        if (prev === null) return null;
        const next = Math.max(0, prev - 1);
        return next;
      });
    }, 1000);
  }, []);

  const stopFreeCountdown = useCallback(() => {
    if (freeCountdownRef.current) {
      clearInterval(freeCountdownRef.current);
      freeCountdownRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!windowResetAt && !isListening) return;
    const timer = setInterval(() => setStatusNowTs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [windowResetAt, isListening]);

  const formatMmSs = useCallback((totalSeconds: number): string => {
    const safe = Math.max(0, Math.floor(totalSeconds));
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
  }, []);

  const freeUsedSeconds = !hasFullAccess && freeSecondsRemaining !== null
    ? Math.max(0, 360 - freeSecondsRemaining)
    : null;
  const freeResetSeconds = windowResetAt
    ? Math.max(0, Math.ceil((new Date(windowResetAt).getTime() - statusNowTs) / 1000))
    : null;

  const refreshSessionAccess = useCallback(async () => {
    if (!id) return null;
    try {
      const r = await fetch(`/api/meetings/${id}/session-access`, { credentials: "include" });
      if (!r.ok) return null;
      const data = await r.json();
      setHasFullAccess(data.hasFullAccess ?? false);
      setFreeSecondsRemaining(data.freeSecondsRemaining ?? null);
      setWindowResetAt(data.windowResetAt ?? null);
      return data;
    } catch {
      return null;
    }
  }, [id]);

  // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Fetch access level on mount ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
  useEffect(() => {
    void refreshSessionAccess();
  }, [refreshSessionAccess]);

  // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Microphone permission request ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
  const handleRequestMicPermission = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      setMicGranted(true);
    } catch {
      toast({ title: "Microphone denied", description: "Please allow microphone access in your browser settings.", variant: "destructive" });
    }
  }, [toast]);

  const startMicListening = useCallback(async () => {
    try {
      if (sttProvider === "azure" && azureAvailable) {
        try {
          // Step 1: get mic stream with echo cancellation OFF so speaker audio leaks through
          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false, // intentionally allow speaker bleed for tab audio capture
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          micStreamRef.current = micStream;

          // Step 2: use existing tab audio stream if user already shared screen
          // (getDisplayMedia popup is NOT triggered on session start — only when user clicks "Share Screen / Tab Audio")
          const tabStream: MediaStream | null = tabAudioStreamRef.current || null;
          // Step 3: start Azure with mixed streams (mic + optional tab audio)
          const streamsToMix = [micStream, ...(tabStream ? [tabStream] : [])].filter(
            (s) => s.getAudioTracks().length > 0,
          );

          setSttStatus("connecting");
          setSttError("");
          const recognizer = new AzureRecognizer(
            {
              onPartial: (text) => {
                if (text?.trim()) handleBargeIn();
                updateDraftFromPartial(text);
              },
              onFinal: (text) => handleFinalTurn(text, undefined, undefined, "unknown"),
              onError: (error) => {
                console.error("[Azure mixed] Error:", error);
                setSttStatus("error");
                setSttError(error);
                toast({ title: "Transcription error", description: error, variant: "destructive" });
              },
              onStatusChange: (status) => {
                if (status === "connected") {
                  setSttStatus("connected");
                  setSttError("");
                } else if (status === "error" || status === "disconnected") {
                  setSttStatus(status === "error" ? "error" : "idle");
                }
              },
            },
            {
              language: sttLanguage,
              silenceTimeoutMs: 600,
              phraseHints: buildSpeechPhraseHints(),
              vadEnabled: true,
              vadNoiseFloor: 0.008,
            },
          );
          azureRecognizerRef.current = recognizer;
          await recognizer.startFromMixedStreams(streamsToMix);

          setupAudioAnalyser(micStream);
          setIsListening(true);
          setAudioMode("mic");
          updateStatusMutation.mutate({ status: "active" });
          toast({
            title: tabStream ? "Mic + Tab audio active" : "Microphone active",
            description: tabStream
              ? "Capturing both your mic and the selected tab's audio for transcription."
              : "Microphone is ready. Listening for audio.",
          });
          return;
        } catch (azureErr: any) {
          console.error("[Azure mic] Failed, falling back:", azureErr.message);
          // Clean up any streams opened before the failure
          micStreamRef.current?.getTracks().forEach((t) => t.stop());
          micStreamRef.current = null;
          tabAudioStreamRef.current?.getTracks().forEach((t) => t.stop());
          tabAudioStreamRef.current = null;
          toast({ title: "Switching to browser speech recognition.", variant: "destructive" });
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,  // allow speaker audio (interviewer voice) to leak into mic for transcription
          noiseSuppression: true,   // remove background noise
          autoGainControl: true,    // normalize mic volume
        },
      });
      setSttStatus("connected");
      setSttError("");
      micStreamRef.current = stream;

      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
        micStreamRef.current = null;
        setSttStatus("error");
        setSttError("Live transcription requires Azure Speech or Browser Speech API.");
        toast({
          title: "Live STT unavailable",
          description: "Enable Azure Speech or use a browser with Web Speech API. Server-side Whisper is batch mode and disabled for live.",
          variant: "destructive",
        });
        return;
      }

      recognitionAlive.current = true;
      recognitionRestartCount.current = 0;
      setupAudioAnalyser(stream);

      stream.getAudioTracks()[0].onended = () => {
        stopListening();
      };

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = sttLanguage;
      recognition.maxAlternatives = 1;
      recognitionRef.current = recognition;

      recognition.onresult = (event: any) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0].transcript;
          if (result.isFinal) {
            handleFinalTurn(text);
          } else {
            interim += text;
          }
        }
        if (interim.trim()) {
          handleBargeIn();
        }
        updateDraftFromPartial(interim);
      };

      recognition.onerror = (event: any) => {
        if (event.error === "no-speech" || event.error === "aborted") return;
        console.error("Speech recognition error:", event.error);
      };

      recognition.onend = () => {
        if (recognitionAlive.current && recognitionRestartCount.current < 200) {
          recognitionRestartCount.current++;
          try {
            setTimeout(() => {
              if (recognitionAlive.current && recognitionRef.current) {
                recognitionRef.current.start();
              }
            }, 100);
          } catch (e) {}
        }
      };

      recognition.start();

      setIsListening(true);
      setAudioMode("mic");
      updateStatusMutation.mutate({ status: "active" });
      toast({
        title: "Microphone active",
        description: "Real-time speech recognition active. Press Enter to answer the latest interviewer question.",
      });
    } catch (error: any) {
      setSttStatus("error");
      setSttError(error?.message || String(error));
      if (error.name === "NotAllowedError") {
        toast({ title: "Microphone access denied", description: "Please allow microphone access in your browser settings.", variant: "destructive" });
      } else {
        toast({ title: "Failed to start microphone", description: error.message, variant: "destructive" });
      }
    }
  }, [toast, setupAudioAnalyser, sttLanguage, sttProvider, azureAvailable, startAzureRecognizer, handleFinalTurn, handleBargeIn, updateDraftFromPartial, buildSpeechPhraseHints]);

  // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Start Session (paid ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â deducts minutes) ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
  const handleStartSession = useCallback(async () => {
    if (!micGranted) { await handleRequestMicPermission(); return; }
    if (!hasFullAccess) {
      toast({ title: "No paid minutes", description: "Purchase minutes or upgrade to use Start Session.", variant: "destructive" });
      return;
    }
    sessionUsagePersistedRef.current = false;
    setLastSessionUsageMinutes(null);
    setElapsedSeconds(0);
    setSessionLaunched(true);
    await startMicListening();
  }, [micGranted, hasFullAccess, handleRequestMicPermission, toast, startMicListening]);

  // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Free Session (6 min per 30 min window) ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
  const handleFreeSession = useCallback(async () => {
    if (!micGranted) { await handleRequestMicPermission(); return; }
    let remaining = freeSecondsRemaining;
    if (remaining === null) {
      const access = await refreshSessionAccess();
      remaining = access?.freeSecondsRemaining ?? null;
    }
    if (remaining !== null && remaining <= 0) {
      setShowUpgradeBanner(true);
      return;
    }
    sessionUsagePersistedRef.current = false;
    setLastSessionUsageMinutes(null);
    setElapsedSeconds(0);
    setSessionLaunched(true);
    await startMicListening();
  }, [micGranted, freeSecondsRemaining, handleRequestMicPermission, refreshSessionAccess, startMicListening]);

  const startSystemAudioListening = useCallback(async () => {
    try {
      setSttStatus("connecting");
      setSttError("");
      const buildDisplayMediaConstraints = (useChromeHints: boolean) => {
        const constraints: any = {
          video: true,
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        };

        if (useChromeHints) {
          // Chromium hints for better tab/system audio capture; unsupported browsers ignore these.
          // Do NOT force current tab; allow the share picker to show Screen / Window / Tab.
          constraints.preferCurrentTab = false;
          // preferCurrentTab conflicts with selfBrowserSurface: "exclude" in Chromium.
          constraints.selfBrowserSurface = "include";
          constraints.surfaceSwitching = "include";
          constraints.systemAudio = "include";
          constraints.monitorTypeSurfaces = "include";
        }

        return constraints;
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia(buildDisplayMediaConstraints(true));
      } catch (err: any) {
        const message = err?.message || String(err);
        const shouldRetry =
          /self-contradictory|preferCurrentTab|selfBrowserSurface|OverconstrainedError|TypeError/i.test(message);
        if (!shouldRetry) {
          throw err;
        }
        // Retry with minimal constraints to avoid Chromium constraint conflicts.
        stream = await navigator.mediaDevices.getDisplayMedia(buildDisplayMediaConstraints(false));
      }
      displayCaptureStreamRef.current = stream;
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        stream.getTracks().forEach(t => t.stop());
        displayCaptureStreamRef.current = null;
        toast({
          title: "No audio detected",
          description: "Please make sure to check 'Share audio' or 'Share tab audio' when sharing your screen. Try sharing a Chrome tab with your meeting open.",
          variant: "destructive",
        });
        return;
      }

      const audioStream = new MediaStream(audioTracks);
      systemAudioStreamRef.current = audioStream;
      systemAudioAlive.current = true;
      setSttStatus("connected");

      setupAudioAnalyser(audioStream);

      audioTracks[0].onended = () => {
        stopListening();
      };

      if (sttProvider === "azure" && azureAvailable) {
        try {
          // Tag system audio as interviewer ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â Q detection always active
          await startAzureRecognizer("system", audioStream, "interviewer");
          setIsListening(true);
          setAudioMode("system");
          updateStatusMutation.mutate({ status: "active" });

          // Start shadow mic recognizer for candidate speech ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â suppress Q detection on your own voice
          try {
            const micShadow = new AzureRecognizer(
              {
                onPartial: () => {},
                onFinal: (text) => { handleFinalTurn(text, undefined, undefined, "candidate"); },
                onError: (err) => { console.warn("[Shadow mic] Error:", err); },
                onStatusChange: (status) => { console.log("[Shadow mic] Status:", status); },
              },
              {
                language: sttLanguage,
                silenceTimeoutMs: 600,
                phraseHints: [],
                vadEnabled: true,
                vadNoiseFloor: 0.008,
              },
            );
            azureMicShadowRef.current = micShadow;
            await micShadow.startFromMic();
            console.log("[Dual STT] Shadow mic started ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â candidate speech will be filtered from Q detection");
          } catch (micErr: any) {
            console.warn("[Dual STT] Shadow mic unavailable, continuing without candidate filtering:", micErr.message);
          }

          toast({
            title: "System audio active",
            description: "Dual-stream active: interviewer audio detected, your voice filtered.",
          });
          return;
        } catch (azureErr: any) {
          console.error("[Azure system] Failed, falling back:", azureErr.message);
          toast({ title: "System audio unavailable", description: "Please try sharing your screen/tab audio again.", variant: "destructive" });
        }
      }

      audioTracks.forEach((t) => t.stop());
      if (displayCaptureStreamRef.current) {
        displayCaptureStreamRef.current.getTracks().forEach((t) => t.stop());
        displayCaptureStreamRef.current = null;
      }
      systemAudioStreamRef.current = null;
      cleanupAudioAnalyser();
      setSttStatus("error");
      setSttError("Live system-audio transcription requires Azure Speech.");
      toast({
        title: "Live system STT unavailable",
        description: "Enable Azure Speech for real-time system audio transcription. Batch upload transcription is disabled in live mode.",
        variant: "destructive",
      });
      return;
    } catch (error: any) {
      setSttStatus("error");
      setSttError(error?.message || String(error));
      if (error.name === "NotAllowedError") {
        toast({ title: "Screen sharing cancelled", description: "You need to share a screen/tab to capture meeting audio.", variant: "destructive" });
      } else {
        toast({ title: "Failed to capture system audio", description: error.message, variant: "destructive" });
      }
    }
  }, [azureAvailable, cleanupAudioAnalyser, setupAudioAnalyser, startAzureRecognizer, sttLanguage, sttProvider, toast, handleFinalTurn]);

  const stopListening = useCallback(() => {
    recognitionAlive.current = false;
    systemAudioAlive.current = false;
    if (azureReconnectTimerRef.current) { clearTimeout(azureReconnectTimerRef.current); azureReconnectTimerRef.current = null; }

    if (systemTimerRef.current) {
      clearTimeout(systemTimerRef.current);
      systemTimerRef.current = null;
    }

    if (azureRecognizerRef.current) {
      azureRecognizerRef.current.stop();
      azureRecognizerRef.current = null;
    }

    if (azureMicShadowRef.current) {
      azureMicShadowRef.current.stop();
      azureMicShadowRef.current = null;
    }

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
      recognitionRef.current = null;
    }

    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      } catch (e) {}
      mediaRecorderRef.current = null;
    }

    if (systemAudioStreamRef.current) {
      systemAudioStreamRef.current.getTracks().forEach(t => t.stop());
      systemAudioStreamRef.current = null;
    }
    if (displayCaptureStreamRef.current) {
      displayCaptureStreamRef.current.getTracks().forEach(t => t.stop());
      displayCaptureStreamRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
    }

    if (tabAudioStreamRef.current) {
      tabAudioStreamRef.current.getTracks().forEach(t => t.stop());
      tabAudioStreamRef.current = null;
    }

    cleanupAudioAnalyser();
    setIsListening(false);
    setSttStatus("idle");
    setSttError("");
    if (transcriptPersistTimerRef.current) {
      clearTimeout(transcriptPersistTimerRef.current);
      transcriptPersistTimerRef.current = null;
    }
    if (pendingTranscriptFlushTimerRef.current) {
      clearTimeout(pendingTranscriptFlushTimerRef.current);
      pendingTranscriptFlushTimerRef.current = null;
    }
    void flushTranscriptPersistQueue();
    stopFreeSessionTick();
    stopFreeCountdown();
  }, [cleanupAudioAnalyser, flushTranscriptPersistQueue, stopFreeSessionTick, stopFreeCountdown]);

  const persistPaidSessionUsage = useCallback(() => {
    if (!id || !hasFullAccess || elapsedSeconds <= 0 || sessionUsagePersistedRef.current) return;
    sessionUsagePersistedRef.current = true;
    const minutesUsed = Math.max(1, Math.ceil(elapsedSeconds / 60));
    setLastSessionUsageMinutes(minutesUsed);
    fetch(`/api/meetings/${id}/session-tick`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minutes: minutesUsed }),
    }).catch(() => {
      sessionUsagePersistedRef.current = false;
    });
  }, [elapsedSeconds, hasFullAccess, id]);

  const handleStopCurrentSession = useCallback(() => {
    setLastSessionUsageMinutes(Math.max(1, Math.ceil(elapsedSeconds / 60)));
    persistPaidSessionUsage();
    stopListening();
  }, [elapsedSeconds, persistPaidSessionUsage, stopListening]);

  // Free-tier countdown: start/stop based on listening state only.
  // freeSecondsRemaining is intentionally excluded from deps — including it would
  // restart the interval every second, causing the countdown to run slower than real time.
  useEffect(() => {
    if (isListening && !hasFullAccess) {
      startFreeCountdown();
      startFreeSessionTick();
    } else {
      stopFreeCountdown();
      stopFreeSessionTick();
    }
    return () => {
      stopFreeCountdown();
      stopFreeSessionTick();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening, hasFullAccess]);

  // Auto-stop when free time runs out, then re-fetch to get updated remaining time from server
  useEffect(() => {
    if (!hasFullAccess && freeSecondsRemaining === 0 && isListening) {
      setLastSessionUsageMinutes(6);
      stopListening();
      setSessionLaunched(false);
      setShowUpgradeBanner(true);
      if (id) {
        // Mark the full 6-minute allocation as used before re-fetching.
        // The per-minute tick fires every 60s, so the last partial minute may not
        // have been recorded yet ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â sending minutes:6 here ensures the server always
        // sees the slot fully consumed (practiceMinutesUsedÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°Ãƒâ€šÃ‚Â¥6), blocking re-entry
        // until the 30-min window resets. The server caps within the window logic,
        // and new windows reset practiceMinutesUsed anyway.
        fetch(`/api/meetings/${id}/session-tick`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ minutes: 6 }),
        })
          .catch(() => {})
          .finally(() => {
            // Re-fetch so the button shows correct disabled/reset-at state
            void refreshSessionAccess();
          });
      }
    }
  }, [freeSecondsRemaining, hasFullAccess, isListening, stopListening, id, refreshSessionAccess]);

  const endSession = useCallback(() => {
    const usedSeconds = elapsedSeconds;
    setLastSessionUsageMinutes(Math.max(1, Math.ceil(usedSeconds / 60)));
    setSessionEndedSeconds(usedSeconds);
    persistPaidSessionUsage();
    stopListening();
    updateStatusMutation.mutate({ status: "completed" });
    setSessionRating(0);
    setSessionFeedback("");
    setFeedbackSubmitted(false);
    setShowSessionEndedScreen(true);
  }, [elapsedSeconds, persistPaidSessionUsage, stopListening, updateStatusMutation]);

  const clearTranscriptSegments = useCallback(() => {
    segmentsRef.current = [];
    displaySegmentsRef.current = [];
    displaySegmentKeysRef.current = [];
    setTranscriptSegments([]);
    setTranscriptSegmentKeys([]);
    setDisplayTranscriptSegments([]);
    setDisplayTranscriptSegmentKeys([]);
    setInterimText("");
    interimTextRef.current = "";
    setStagedTranscriptText("");
    setPendingTranscriptLine("");
    questionDraftRef.current = "";
    pendingQuestionTailRef.current = [];
    if (pendingTailTimerRef.current) { clearTimeout(pendingTailTimerRef.current); pendingTailTimerRef.current = null; }
    lastDraftTextRef.current = "";
    stableSinceTsRef.current = 0;
    lastPartialTsRef.current = 0;
    continuationUntilTsRef.current = 0;
    pendingTranscriptLineRef.current = "";
    pendingTranscriptTsRef.current = 0;
    setInterpretedQuestion("");
    lastProcessedSegmentRef.current = "";
    lastSentSegmentIndexRef.current = -1;
    latestPartialQuestionCandidateRef.current = "";
    latestPartialQuestionCandidateTsRef.current = 0;
  }, []);

  const orchestrateTurn = useCallback(async (
    sourceText: string,
    mode: "pause" | "enter" | "final",
  ): Promise<{
    questions: Array<{ text: string; confidence: number; clean?: string }>;
    primaryQuestion: string;
    shouldAnswerNow: boolean;
    action: "answer" | "rewrite_brief" | "rewrite_deeper" | "wait" | "ignore";
    confidence: number;
  } | null> => {
    const trimmed = sourceText.trim();
    if (!trimmed) return null;
    const res = await fetch(`/api/meetings/${id}/orchestrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ text: trimmed, audioMode, mode, isStreaming }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      questions: Array.isArray(data?.questions) ? data.questions : [],
      primaryQuestion: String(data?.primaryQuestion || ""),
      shouldAnswerNow: !!data?.shouldAnswerNow,
      action: data?.action || "ignore",
      confidence: Number(data?.confidence || 0),
    };
  }, [id, audioMode, isStreaming]);

  const requestWsAnswer = useCallback((
    mode: "pause" | "enter" | "final",
    overrideQuestion?: string,
  ) => {
    if (!id) return false;
    const ws = wsAnswerRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const cleanedOverride = overrideQuestion?.trim() || "";
    if (!cleanedOverride) return false;
    const isRewrite = /^rewrite the last answer/i.test(cleanedOverride);
    const wantsCode = !isRewrite && isStrictCodeOnlyRequest(cleanedOverride);
    const explainFollowup = isExplainFollowup(cleanedOverride) && lastAnswerWasCodeRef.current && !isModifyCodeFollowup(cleanedOverride);
    const lineByLineFollowup = wantsLineByLineExplanation(cleanedOverride);
    const shortContextualFollowup = isShortContextualFollowup(cleanedOverride);
    // Detect "write this without X", "write differently", "write without functions", "rewrite without X" etc.
    const isCodeRewriteFollowup = !isRewrite && /\b(write|rewrite|show|give)\b/i.test(cleanedOverride) && /\b(without|differently|another way|alternative|no functions?|inline|different approach|different way)\b/i.test(cleanedOverride);
    const lastAnswerCode = lastAssistantAnswerRef.current.trim();
    const lastAnswerHasCode = /```/.test(lastAnswerCode);
    const recentScreenAnalysis = latestScreenContextRef.current;
    const previousScreenAnalysis = previousScreenContextRef.current;
    const shouldUseScreenContext =
      (meeting as any)?.sessionMode === "coding" &&
      !!recentScreenAnalysis &&
      (
        !!getLiveVisionStream() ||
        shouldDisplayAnswerAsCode(cleanedOverride, recentScreenAnalysis?.answer || "") ||
        isExplainFollowup(cleanedOverride) ||
        lineByLineFollowup ||
        isModifyCodeFollowup(cleanedOverride) ||
        /\b(code|coding|function|class|logic|algorithm|approach|complexity|optimi[sz]e|fix|modify|change|update|line)\b/i.test(cleanedOverride)
      );

    let questionToSend = wantsCode
      ? `${cleanedOverride}\n\nReturn only a fenced code block. No prose, no explanation, no bullet points. Do not add a plain language label like "python" outside the fence.`
      : explainFollowup
        ? `${cleanedOverride}\n\nExplain the previous code answer in plain language. Start with the explanation, then include the relevant code block.`
        : cleanedOverride;

    // Code rewrite follow-up: inject last answer's code so AI knows what "this code" refers to
    if (!shouldUseScreenContext && isCodeRewriteFollowup && lastAnswerHasCode) {
      questionToSend = [
        "The interviewer is asking for a code rewrite based on the previous answer.",
        `Previous code answer:\n${lastAnswerCode.slice(0, 2400)}`,
        `Interviewer follow-up: ${cleanedOverride}`,
        "Rewrite the code above to satisfy the follow-up request.",
        "Return: 1) one sentence explaining the change, 2) the full updated code in a fenced code block, 3) a brief 'What changed:' note.",
        "Do NOT answer generically — always base your answer on the previous code shown above.",
      ].filter(Boolean).join("\n\n");
    }

    if (!shouldUseScreenContext && shortContextualFollowup && !explainFollowup) {
      const anchorQuestion = interviewerQuestionMemoryRef.current
        .map((q) => cleanDetectedInterviewQuestion(String(q.text || "").trim()))
        .find((q) => !!q && !isLikelyNoiseSegment(q))
        || "";
      const lastAnswer = lastAssistantAnswerRef.current.trim().slice(0, 1200);
      if (anchorQuestion || lastAnswer) {
        questionToSend = [
          "This is a short interviewer follow-up tied to the latest interview context.",
          anchorQuestion ? `Previous interviewer question: ${anchorQuestion}` : "",
          lastAnswer ? `Previous candidate answer: ${lastAnswer}` : "",
          `Current short follow-up: ${cleanedOverride}`,
          "Answer the follow-up directly using that context. Keep it short, natural, and interview-usable.",
          "Do not use coaching/meta phrasing like 'here's how you can respond' or 'you can say'.",
        ].filter(Boolean).join("\n\n");
      }
    }

    if (shouldUseScreenContext) {
      const screenQuestion = String(recentScreenAnalysis?.displayQuestion || "").trim();
      const screenAnswer = String(recentScreenAnalysis?.answer || "").trim().slice(0, 2400);
      const previousScreenAnswer = String(previousScreenAnalysis?.answer || "").trim().slice(0, 1800);
      const allowPreviousScreenComparison = isModifyCodeFollowup(cleanedOverride) || /\b(compare|difference|changed|what changed)\b/i.test(cleanedOverride);
      const isModifyFollowup = isModifyCodeFollowup(cleanedOverride);
      questionToSend = [
        "The interviewer is asking about the code currently visible on the shared coding screen.",
        isModifyFollowup
          ? "Answer in this order: 1) one sentence explaining what you changed and why, 2) the full updated code in a fenced code block with changed lines marked `// ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â Ãƒâ€šÃ‚Â changed`, 3) a brief 'What changed:' summary."
          : "The very first characters of the answer must be ``` with no intro text before it.",
        screenQuestion ? `Latest captured coding prompt: ${screenQuestion}` : "",
        screenAnswer ? `Latest captured code context and answer:\n${screenAnswer}` : "",
        `Current interviewer follow-up: ${questionToSend}`,
        lineByLineFollowup
          ? "Explain the visible code line by line in order, but still return the full referenced code in a fenced code block first. After the code block, explain each important line or block, why it is needed, then add a short approach summary and the time and space complexity."
          : "",
        "Treat the latest captured code as the source of truth for all follow-up answers.",
        "Work only on the currently captured coding problem and captured code. Do not switch to a different example, toy program, unrelated snippet, or older capture unless the interviewer explicitly asked for comparison.",
        "For coding follow-up answers, always include the current referenced code again in a fenced code block. If the interviewer asked for a change, replace the old code with the updated code block.",
        "If you changed the code, briefly explain what changed and why right after the code block.",
        allowPreviousScreenComparison && previousScreenAnswer
          ? `Previous captured code context for comparison:\n${previousScreenAnswer}`
          : "",
        allowPreviousScreenComparison
          ? "Compare the latest captured code against the previous captured code, then explain what changed and why."
          : "",
        "Answer using the visible code context first. If the follow-up implies a code change, provide the updated explanation and code.",
      ].filter(Boolean).join("\n\n");
    }

    const now = Date.now();
    triggerMetricRef.current = { t_trigger_decision: now };
    const submitSource: SubmitSeedSource = mode === "enter" ? "interpreted" : "transcript";
    setLastSubmitSource(submitSource);
    setInterpretedQuestion(cleanedOverride);
    setStreamingQuestion(cleanedOverride);
    triggerMetricRef.current.t_request_sent = now;
    showOptimisticAssistantState(cleanedOverride);
    startFirstChunkWatchdog(`ws_${mode}`);
    console.log(`[submit] transport=ws source=${submitSource} mode=${mode}`, { preview: cleanedOverride.slice(0, 160) });
    const formatToSend = responseFormat === "custom" ? "custom" : responseFormat;
    const preparedQuestion =
      speculativePrepareRef.current
      && levenshteinSimilarity(
        speculativePrepareRef.current.norm,
        normalizeQuestionForSimilarity(cleanedOverride),
      ) >= SIM_SPECULATIVE_REUSE
        ? speculativePrepareRef.current.text
        : undefined;
    ws.send(JSON.stringify({
      type: "question",
      sessionId: id,
      text: questionToSend,
      force: isStreaming,
      format: formatToSend,
      model: selectedModel,
      quickMode: quickResponseMode,
      docsMode,
      metadata: {
        mode,
        audioMode,
        submitSource,
        customFormatPrompt: responseFormat === "custom" ? customPrompt : undefined,
        docsMode,
        systemPrompt: customPrompt || undefined,
        jobDescription: conversationHistory || undefined,
        preparedQuestion,
      },
    }));
    return true;
  }, [
        id,
    audioMode,
    responseFormat,
    selectedModel,
    quickResponseMode,
    docsMode,
    customPrompt,
    conversationHistory,
    showOptimisticAssistantState,
    startFirstChunkWatchdog,
    isStreaming,
    getLiveVisionStream,
    isExplainFollowup,
    isModifyCodeFollowup,
    isShortContextualFollowup,
    wantsLineByLineExplanation,
    interviewerQuestionMemoryRef,
    meeting,
    latestScreenContextRef,
    previousScreenContextRef,
    shouldDisplayAnswerAsCode,
    isStrictCodeOnlyRequest,
  ]);

  const requestSocketAnswer = useCallback((mode: "pause" | "enter" | "final", overrideQuestion?: string) => {
    return requestWsAnswer(mode, overrideQuestion);
  }, [requestWsAnswer]);

  const warmSpeculativeAnswerPath = useCallback(async (question: string) => {
    const cleanedQuestion = String(question || "").trim();
    if (!id || !cleanedQuestion) return;
    const norm = normalizeQuestionForSimilarity(cleanedQuestion);
    if (!norm) return;
    const existing = speculativePrepareRef.current;
    if (existing && existing.norm === norm && (Date.now() - existing.ts) <= SPECULATIVE_WINDOW_MS) {
      return;
    }

    speculativePrepareRef.current = { norm, text: cleanedQuestion, ts: Date.now(), prepared: false };
    speculativeQuestionRef.current = { norm, text: cleanedQuestion, ts: Date.now(), refined: false };

    try {
      await fetch(`/api/meetings/${id}/prepare-answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          question: cleanedQuestion,
          format: responseFormat === "custom" ? "custom" : responseFormat,
          quickMode: quickResponseMode,
          docsMode,
          model: selectedModel,
          systemPrompt: customPrompt || undefined,
          jobDescription: conversationHistory || undefined,
        }),
      });
      if (speculativePrepareRef.current?.norm === norm) {
        speculativePrepareRef.current.prepared = true;
        speculativePrepareRef.current.ts = Date.now();
      }
    } catch {
      // Best-effort warm path only.
    }
  }, [id, responseFormat, quickResponseMode, docsMode, selectedModel, customPrompt, conversationHistory]);

  const triggerQuestionExtraction = useCallback(async (mode: "pause" | "enter" | "final"): Promise<string | null> => {
    // Use pending transcript line (combined multi-segment context) when interim is gone
    let sourceText = (interimText.trim() || pendingTranscriptLineRef.current.trim() || questionDraftRef.current.trim()).trim();
    if (!sourceText) return null;
    const latestFinal = segmentsRef.current[0]?.trim();
    const now = Date.now();

    // If Enter was pressed while Azure is still mid-utterance (interim ends with a dangling
    // preposition/conjunction like "in", "with", "about"), prefer the latest final segment
    // which is the complete previous sentence, rather than sending a truncated interim.
    if (mode === "enter" && latestFinal) {
      const endsIncomplete = /\b(with|on|for|to|of|at|by|from|or|that|a|an|the|is|are|was|have|has)\s*$/i.test(sourceText);
      if (endsIncomplete && latestFinal.split(/\s+/).filter(Boolean).length > sourceText.split(/\s+/).filter(Boolean).length) {
        sourceText = latestFinal;
      }
    }

    const sourceWordCount = sourceText.split(/\s+/).filter(Boolean).length;

    if (/\b(and|or|also)\s*$/i.test(sourceText)) {
      if (latestFinal && !sourceText.toLowerCase().includes(latestFinal.toLowerCase())) {
        sourceText = `${latestFinal} ${sourceText}`.replace(/\s+/g, " ").trim();
      }
    }

    // Compose split questions like "explain about" ... pause ... "python".
    // Do not merge when the current text is already an explicit question.
    const likelyFragmentTail = /\b(about|with|on|for|to|in|of)\s*$/i.test(sourceText);
    const likelyFragmentHead = /^(what|why|how|which|who|where|when|explain|describe|tell|walk|talk)\b/i.test(sourceText);
    const isShortGenericFragment = sourceWordCount <= 2 && /^(tell|explain|describe|walk|talk|what|how|why)\b/i.test(sourceText);
    const sourceLooksLikeQuestion = detectQuestion(sourceText);
    if (latestFinal && latestFinal !== sourceText) {
      if (isShortGenericFragment && detectQuestion(latestFinal)) {
        sourceText = latestFinal;
      }
      const latestCount = latestFinal.split(/\s+/).filter(Boolean).length;
      const shouldMergeWithLatest =
        !sourceLooksLikeQuestion && (
          likelyFragmentTail ||
          (likelyFragmentHead && sourceWordCount <= 5) ||
          (startsWithContinuationJoiner(sourceText) && latestCount <= 10)
        );
      if (shouldMergeWithLatest) {
        sourceText = `${latestFinal} ${sourceText}`.replace(/\s+/g, " ").trim();
      }
    }

    const hasImperative = isImperativePrompt(sourceText);
    if (mode !== "enter") {
      const recent = boundaryQuestionCandidatesRef.current
        .filter((q) => (now - q.ts) <= 5_000)
        .find((q) => normalizeForDedup(q.text) !== normalizeForDedup(sourceText));
      if (recent && !sourceText.toLowerCase().includes(recent.text.toLowerCase())) {
        const combined = `${recent.text.replace(/\?\s*$/, "").trim()} ${sourceText}`.replace(/\s+/g, " ").trim();
        sourceText = combined.endsWith("?") ? combined : `${combined}?`;
      }
    }
    const sourceNorm = normalizeForDedup(sourceText);
    const sourceFingerprint = normalizeQuestionForSimilarity(sourceText);
    const advanced = detectQuestionAdvanced(sourceText);
    if (sourceFingerprint && isRecentDuplicateIntent(sourceFingerprint, mode, now)) {
      return null;
    }

    const maybeWrapHybridFollowups = (baseQuestion: string): { seedText: string; displayQuestion: string; source: "transcript"; multiQuestionMode?: boolean } | null => {
      if (!baseQuestion || mode !== "enter") return null;
      const nowTs = Date.now();
      const baseNorm = normalizeForDedup(baseQuestion);
      const followups = interviewerQuestionMemoryRef.current
        .filter((q) => !q.answered && (nowTs - q.ts) <= HYBRID_FOLLOWUP_WINDOW_MS)
        .map((q) => q.text)
        .filter((q) => normalizeForDedup(q) !== baseNorm)
        .filter((q) => !isLikelyNoiseSegment(q))
        .filter((q) => {
          const norm = q.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
          const wc = norm.split(/\s+/).filter(Boolean).length;
          if (wc < 1 || wc > HYBRID_FOLLOWUP_MAX_WORDS) return false;
          return /^(and also|and|also|plus|in addition|what about|why|how|what|which|where|when|who)\b/i.test(norm) || norm.endsWith("?");
        });
      const deduped: string[] = [];
      for (const f of followups) {
        const key = normalizeForDedup(f);
        if (!key) continue;
        if (deduped.find((x) => normalizeForDedup(x) === key)) continue;
        deduped.push(f);
      }
      if (!deduped.length) return null;
      const questions = [baseQuestion, ...deduped];
      const seed = [
        "Interviewer asked a main question with short follow-ups within the last 30 seconds.",
        "Answer all of them in order using one response.",
        "Questions:",
        ...questions,
      ].join("\n");
      return { seedText: seed, displayQuestion: questions.join("\n"), source: "transcript", multiQuestionMode: true };
    };

    const modeThreshold = mode === "pause" ? 0.45 : mode === "final" ? 0.5 : 0.4;
    if (mode === "pause") {
      const pauseEligible = sourceWordCount >= 1 && !isLikelyNoiseSegment(sourceText);
      const passesQuestionGate = advanced.isQuestion && advanced.confidence >= modeThreshold;
      if (!pauseEligible && !passesQuestionGate && !hasImperative) return null;
    } else if (mode === "final") {
      if (!hasImperative && (!advanced.isQuestion || advanced.confidence < modeThreshold)) {
        return null;
      }
    }

    if (sourceFingerprint && isNearDuplicateAskedQuestion(sourceText)) {
      return null;
    }

    const sameRecentTrigger = sourceFingerprint
      && lastTriggeredNormalizedTextRef.current
      && levenshteinSimilarity(sourceFingerprint, lastTriggeredNormalizedTextRef.current) >= SIM_DEDUP_BLOCK
      && (now - lastTriggerTimestampRef.current) <= 12000;
    if (sameRecentTrigger) {
      return null;
    }

    if ((mode === "pause" || mode === "final") && sourceNorm) {
      const sameRecentAuto = sourceNorm === lastAutoTriggerHashRef.current && (now - lastAutoTriggerTsRef.current) < 1400;
      if (sameRecentAuto) return null;
    }
    if (mode !== "enter" && sourceNorm && sourceNorm === lastExtractedHashRef.current && (now - lastExtractedTsRef.current) < 4000) {
      return null;
    }

    if (mode === "pause") {
      triggerMetricRef.current.t_trigger_decision = triggerMetricRef.current.t_trigger_decision || now;
      triggerMetricRef.current.t_partial_detected = triggerMetricRef.current.t_partial_detected || now;
    } else {
      triggerMetricRef.current.t_trigger_decision = triggerMetricRef.current.t_trigger_decision || now;
      triggerMetricRef.current.t_final_detected = triggerMetricRef.current.t_final_detected || now;
    }

    if (mode !== "enter" && ENTER_ONLY_ANSWER_MODE) {
      // Enter-only mode: skip auto socket answer, fall through to orchestration
      // so interpretedQuestion still gets set for when user presses Enter.
    } else if (requestSocketAnswer(mode, sourceText)) {
      lastExtractedHashRef.current = sourceNorm;
      lastExtractedTsRef.current = now;
      lastTriggeredNormalizedTextRef.current = sourceFingerprint || sourceNorm;
      lastTriggerTimestampRef.current = now;
      if (sourceFingerprint) {
        lastRequestedIntentRef.current = { fp: sourceFingerprint, ts: now, mode };
      }
      if (sourceFingerprint) rememberAskedFingerprint(sourceFingerprint);
      if (mode === "pause" || mode === "final") {
        lastAutoTriggerHashRef.current = sourceNorm;
        lastAutoTriggerTsRef.current = now;
      }
      return sourceText;
    }

    const orchestration = await orchestrateTurn(sourceText, mode);
    lastExtractedHashRef.current = sourceNorm;
    lastExtractedTsRef.current = now;
    if (mode === "pause" || mode === "final") {
      lastAutoTriggerHashRef.current = sourceNorm;
      lastAutoTriggerTsRef.current = now;
    }
    if (!orchestration) return null;
    setInterpretedQuestion(orchestration.primaryQuestion || "");

    if (orchestration.action === "ignore" || orchestration.action === "wait") {
      return orchestration.primaryQuestion || null;
    }

    let questionToAnswer = orchestration.primaryQuestion;
    if (orchestration.action === "rewrite_brief" || orchestration.action === "rewrite_deeper") {
      const style = orchestration.action === "rewrite_brief" ? "briefly in 2-4 bullets" : "with deeper detail and concrete specifics";
      questionToAnswer = `Rewrite the last answer ${style}.\n\nLast answer:\n${lastAssistantAnswerRef.current || ""}`;
    }

    if (!questionToAnswer) return null;
    const normalized = normalizeForDedup(questionToAnswer);
    const duplicateByTime = normalized === lastAnsweredQuestionHashRef.current && (now - lastAnsweredQuestionTsRef.current) <= 12000;
    const duplicateByOverlap = lastAnsweredQuestionHashRef.current && wordOverlap(normalized, lastAnsweredQuestionHashRef.current) > SIM_SPECULATIVE_REUSE && (now - lastAnsweredQuestionTsRef.current) <= 12000;
    if (duplicateByTime || duplicateByOverlap) return null;

    const canAutoAnswer = (mode === "enter") || (!ENTER_ONLY_ANSWER_MODE && autoAnswerEnabled);
    if (canAutoAnswer && orchestration.shouldAnswerNow && !isStreaming && (now - lastAnswerDoneTimestampRef.current) > 600) {
      askStreamingQuestion(questionToAnswer);
      lastAnsweredQuestionHashRef.current = normalized;
      lastAnsweredQuestionTsRef.current = now;
    }

    continuationUntilTsRef.current = now + CONTINUATION_MS;
    return questionToAnswer;
  }, [
    interimText,
    requestSocketAnswer,
    orchestrateTurn,
    wordOverlap,
    autoAnswerEnabled,
    isStreaming,
    askStreamingQuestion,
    isRecentDuplicateIntent,
    isNearDuplicateAskedQuestion,
    isImperativePrompt,
    isLikelyNoiseSegment,
    sanitizeQuestionCandidate,
    dedupeExperienceTopics,
    rememberAskedFingerprint,
  ]);

  const resolveEnterSeed = useCallback((): {
    seedText: string;
    displayQuestion: string;
    source: SubmitSeedSource;
    lastInterviewerQuestion?: string;
    recentSpokenReply?: string;
    multiQuestionMode?: boolean;
  } => {
    const SAME_TURN_APPEND_MS = 15_000;
    const UNANSWERED_TTL_MS = 90_000;
    const CONTINUATION_TOPIC_WINDOW_MS = 12_000;
    const LONG_CONTINUATION_MS = 30_000;
    const PARTIAL_CANDIDATE_TTL_MS = 6_000;
    const REOPEN_CUE_RE = /\b(coming back to|as asked earlier|again about|revisit)\b/i;
    const QUESTION_START_RE = /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|is|are|tell|walk|explain|give|describe|share|suppose|assume)\b/i;
    // resolveEnterSeed is always called from the Enter key path.
    // Keep hybrid follow-up bundling conservative to avoid packaging noisy transcript into one prompt.
    const maybeWrapHybridFollowups = (baseQuestion: string): { seedText: string; displayQuestion: string; source: "transcript"; multiQuestionMode?: boolean } | null => {
      if (!baseQuestion) return null;
      const nowTs = Date.now();
      const baseNorm = normalizeForDedup(baseQuestion);
      const followups = interviewerQuestionMemoryRef.current
        .filter((q) => !q.answered && (nowTs - q.ts) <= HYBRID_FOLLOWUP_WINDOW_MS)
        .map((q) => q.text)
        .filter((q) => normalizeForDedup(q) !== baseNorm)
        .filter((q) => !isLikelyNoiseSegment(q))
        .filter((q) => {
          const norm = q.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
          const wc = norm.split(/\s+/).filter(Boolean).length;
          if (wc < 2 || wc > Math.min(6, HYBRID_FOLLOWUP_MAX_WORDS)) return false;
          const explicitQuestion = norm.endsWith("?") || /^(what about|why|how|what|which|where|when|who)\b/i.test(norm);
          const cleanJoinerTopic = /^(and also|and|also|plus|in addition)\b/i.test(norm)
            && isLikelyInterviewTopic(q.replace(/^(and also|and|also|plus|in addition)\s+/i, "").trim());
          return explicitQuestion || cleanJoinerTopic;
        });
      const deduped: string[] = [];
      for (const f of followups) {
        const key = normalizeForDedup(f);
        if (!key) continue;
        if (deduped.find((x) => normalizeForDedup(x) === key)) continue;
        deduped.push(f);
      }
      if (!deduped.length) return null;
      if (deduped.length > 1) return null;
      const questions = [baseQuestion, ...deduped];
      const seed = [
        "Interviewer asked a main question with short follow-ups within the last 30 seconds.",
        "Answer all of them in order using one response.",
        "Questions:",
        ...questions,
      ].join("\n");
      return { seedText: seed, displayQuestion: questions.join("\n"), source: "transcript", multiQuestionMode: true };
    };
    // Fragment starts with a word that can never begin a standalone sentence ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ natural sentence continuation.
    const SENTENCE_CONTINUATION_RE = /^(with|in|on|at|of|from|to|about|through|during|since|for|by|after|before|between|among|across|over|into|toward|regarding|within|without|against|around|beyond|outside|past|via|working|building|developing|using|handling|managing|implementing|focusing|dealing|involving|relating|covering|including)\b/i;
    // Previous segment ends with a word that cannot close a sentence ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ the next segment MUST continue it.
    const INCOMPLETE_ENDING_RE = /\b(about|with|in|on|for|of|from|to|at|through|by|into|over|under|between|among|the|a|an|your|my|their|his|her|our|some|any|this|that|these|those|and|or|but|is|are|have|has|do|does|can|could|would|will|shall|may|might|what|how|when|where|who|which|why|whether|if|as|than|also|both|either|neither|each|every|such|same)\s*[.,]?\s*$/i;
    const splitExplicitQuestions = (raw: string): string[] => {
      const line = String(raw || "").trim();
      if (!line) return [];
      const chunks = line.includes("?")
        ? line.split("?").map((p) => p.trim()).filter(Boolean).map((p) => `${p}?`)
        : line
          .split(/(?=\b(?:what|why|how|when|where|who|which|do you|does|did|can you|could you|would you|have you|has|is|are|tell me|walk me|explain|give me|describe|share|suppose|assume)\b)/gi)
          .map((p) => p.trim())
          .filter(Boolean);
      return chunks.filter((chunk) => {
        const normalized = chunk.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
        const words = normalized.split(/\s+/).filter(Boolean);
        if (words.length < 2 || words.length > 22) return false;
        if (!QUESTION_START_RE.test(normalized) && !chunk.includes("?")) return false;
        return true;
      });
    };
    const isExplicitQuestion = (value: string): boolean => {
      const s = String(value || "").trim();
      if (!s) return false;
      const q = s.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
      return s.includes("?") || QUESTION_START_RE.test(q);
    };

    // Collect ALL unanswered interviewer questions since the last AI answer.
    // Uses interviewerQuestionMemoryRef (not displaySegmentsRef) so candidate speech
    // segments between questions don't break the chain.
    const sinceTs = lastAnswerDoneTimestampRef.current || 0;
    const unansweredQuestions = interviewerQuestionMemoryRef.current
      .filter((q) => !q.answered && q.ts >= sinceTs)
      .map((q) => q.text.trim())
      .filter(Boolean);
    // De-duplicate by normalised text while preserving chronological order (oldest first)
    const unansweredNormSeen = new Set<string>();
    const unansweredOrdered: string[] = [];
    for (const q of unansweredQuestions.slice().reverse()) {
      const norm = normalizeForDedup(q);
      if (!norm || unansweredNormSeen.has(norm)) continue;
      unansweredNormSeen.add(norm);
      unansweredOrdered.push(q);
    }
    // Also include the latest display question if it's not yet in memory
    // (it may have just arrived and not been committed to memory yet).
    const CANDIDATE_SEG_RE = /^Candidate:\s+/i;
    const latestDisplayQ = displaySegmentsRef.current.find((seg) => {
      const s = String(seg || "").trim();
      return s && !CANDIDATE_SEG_RE.test(s) && (isStrongInterviewerQuestion(s) || isExplicitQuestion(s));
    });
    if (latestDisplayQ) {
      const latestNorm = normalizeForDedup(latestDisplayQ);
      if (latestNorm && !unansweredNormSeen.has(latestNorm)) {
        unansweredOrdered.push(latestDisplayQ.trim());
      }
    }
    if (unansweredOrdered.length === 1) {
      const sanitizedVisible = rewriteMixedTopicQuestion(
        cleanDetectedInterviewQuestion(dedupeExperienceTopics(sanitizeQuestionCandidate(unansweredOrdered[0]))),
      );
      return {
        seedText: sanitizedVisible || unansweredOrdered[0],
        displayQuestion: sanitizedVisible || unansweredOrdered[0],
        source: "transcript",
      };
    }
    if (unansweredOrdered.length > 1) {
      const seedText = unansweredOrdered.join(" ");
      const displayQuestion = unansweredOrdered.join(" / ");
      return { seedText, displayQuestion, source: "transcript" };
    }

    const transcriptQuestions = segmentsRef.current.filter((seg) => isStrongInterviewerQuestion(seg || ""));
    const latestTranscriptQuestion = transcriptQuestions[0] || "";
    const now = Date.now();

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ PRIORITY 1: Follow-up detection ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    // PRIORITY 0: Candidate correction/clarification detection.
    // Only fires when the VERY LATEST segment is candidate speech — meaning the candidate
    // spoke AFTER the interviewer's last question. If the interviewer has spoken since,
    // their question is at index 0 and we fall through to answer it normally.
    const CANDIDATE_PREFIX_RE = /^Candidate:\s+/i;
    const latestCandidateSeg = CANDIDATE_PREFIX_RE.test(segmentsRef.current[0] || "")
      ? segmentsRef.current[0]
      : null;
    if (latestCandidateSeg && lastAssistantAnswerRef.current.trim()) {
      const candidateSpeech = latestCandidateSeg.replace(CANDIDATE_PREFIX_RE, "").trim();
      const isCorrectionOrClarification =
        /^(no\b|no,|no i |no I |actually |not exactly|not directly|i don't|i dont|i didn't|i didnt|i haven't|i havent|well no|not really|i do not|i have not|i haven't|i never|actually i|well i|to be honest|honestly|truthfully|i mean |um no|uh no)/i.test(candidateSpeech)
        || /\b(but i (do|don't|have|haven't|can|can't)|however i|although i|though i)\b/i.test(candidateSpeech);
      if (isCorrectionOrClarification && candidateSpeech.split(/\s+/).filter(Boolean).length >= 3) {
        const prevAnswer = lastAssistantAnswerRef.current.trim().slice(0, 400);
        const seed = [
          `The candidate just said: "${candidateSpeech}"`,
          `This corrects or clarifies the previous suggested answer.`,
          `Previous answer: "${prevAnswer}"`,
          `Rewrite the answer from the candidate's ACTUAL perspective based on what they said.`,
          `Keep it interview-ready, honest, and positive (e.g. pivot to related experience they do have).`,
        ].join("\n");
        return {
          seedText: seed,
          displayQuestion: candidateSpeech,
          source: "memory-followup" as SubmitSeedSource,
          recentSpokenReply: candidateSpeech,
          lastInterviewerQuestion: (interviewerQuestionMemoryRef.current[0]?.text || "").slice(0, 300),
        };
      }
    }

    // If the current live text is a short follow-up query ("why?", "how so?",
    // "what about that?"), answer it using previous Q&A context immediately.
    const currentLiveText =
      pendingTranscriptLineRef.current.trim()
      || questionDraftRef.current.trim()
      || interimTextRef.current.trim();
    // If the live text starts with a continuation joiner ("and django", "also flask", "plus aws"),
    // it is a question EXTENSION to be combined with the prior transcript question, NOT a follow-up
    // on the previous AI answer. Skip follow-up detection entirely for these phrases.
    const liveStartsJoiner = /^(and\b|and also\b|also\b|plus\b|or\b)/i.test(currentLiveText.trim());
    const hasRecentAnswerContext = lastAssistantAnswerRef.current.trim().length > 0 || responsesLocalRef.current.length > 0;
    if (currentLiveText && lastAssistantAnswerRef.current.trim() && !liveStartsJoiner) {
      const fuResult = isFollowUp(currentLiveText);
      // Guard: single follow-up words like "more", "next", "proceed" should only trigger
      // if there is a recent answered question to provide context.
      const isSingleWordNoContext = fuResult.reason === "very_short_followup_cue" && !hasRecentAnswerContext;
      if (fuResult.isFollowUp && !isSingleWordNoContext) {
        return {
          seedText: currentLiveText,
          displayQuestion: currentLiveText,
          source: "memory-followup",
          recentSpokenReply: lastAssistantAnswerRef.current.trim().slice(0, 800),
        };
      }
    }

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ PRIORITY 2: Strong interviewer question anywhere in recent transcript ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    // If the latest segment is NOT a question (e.g. it's the candidate's own speech)
    // but an earlier segment IS a clear interviewer question, use that instead.
    // EXCEPTION: if the current live text is a short tech-topic fragment ("Flask", "Django",
    // "and also React"), skip PRIORITY 2 so the combination logic below can append it
    // to the prior question instead of discarding it.
    const liveIsTechFragment =
      currentLiveText.trim().length > 0
      && extractMeaningfulInterviewTopics(currentLiveText).length > 0
      && currentLiveText.trim().split(/\s+/).filter(Boolean).length <= 6;
    if (latestTranscriptQuestion && !liveIsTechFragment) {
      const latestSegIsQuestion = isStrongInterviewerQuestion(segmentsRef.current[0] || "");
      const latestQNorm = normalizeForDedup(latestTranscriptQuestion);
      const latestSegNorm = normalizeForDedup(segmentsRef.current[0] || "");
      const questionIsElsewhere = !latestSegIsQuestion || latestQNorm !== latestSegNorm;
      if (questionIsElsewhere) {
        const sanitized = rewriteMixedTopicQuestion(
          cleanDetectedInterviewQuestion(dedupeExperienceTopics(sanitizeQuestionCandidate(latestTranscriptQuestion)))
        );
        return {
          seedText: sanitized || latestTranscriptQuestion,
          displayQuestion: sanitized || latestTranscriptQuestion,
          source: "transcript",
        };
      }
    }

    // PRIORITY 2.5: Trust the LLM — send latest interviewer utterance directly.
    // The LLM knows from context whether something is a question or implicit prompt.
    // We don't need regex to detect "is this a question?" — just send it.
    // Only skip if: it's candidate's own speech, it's noise, or it's the same as last Enter.
    const latestSeg = (segmentsRef.current[0] || "").trim();
    const latestSegNormSimple = latestSeg.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
    const latestSegWords = latestSegNormSimple.split(/\s+/).filter(Boolean).length;
    const latestSegIsNew = normalizeForDedup(latestSeg) !== normalizeForDedup(lastEnterSeedRef.current.text || "");
    const latestSegIsInterviewer =
      !CANDIDATE_PREFIX_RE.test(latestSeg)
      && latestSegWords >= 3
      && !isLikelyNoiseSegment(latestSeg)
      && !(/^(i |we |my |our )/i.test(latestSegNormSimple));
    if (latestSegIsInterviewer && latestSegIsNew) {
      const cleaned = rewriteMixedTopicQuestion(
        cleanDetectedInterviewQuestion(dedupeExperienceTopics(sanitizeQuestionCandidate(latestSeg)))
      );
      return { seedText: cleaned || latestSeg, displayQuestion: cleaned || latestSeg, source: "transcript" };
    }

    const freshPartialCandidate =
      latestPartialQuestionCandidateRef.current
      && (now - latestPartialQuestionCandidateTsRef.current) <= PARTIAL_CANDIDATE_TTL_MS
        ? latestPartialQuestionCandidateRef.current.trim()
        : "";
    if (freshPartialCandidate) {
      const partialNorm = normalizeForDedup(freshPartialCandidate);
      const lastEnterNorm = normalizeForDedup(lastEnterSeedRef.current.text || "");
      const isNewVsLastEnter = partialNorm && partialNorm !== lastEnterNorm;
      // If the partial candidate starts with a continuation joiner ("and also flask", "and django"),
      // do NOT return it directly ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â fall through so the latestStartsJoiner path can combine it
      // with the prior committed question.
      const partialStartsJoiner = /^(and also|and|also|plus|or)\b/i.test(freshPartialCandidate.trim());
      if (isNewVsLastEnter && !partialStartsJoiner) {
        return { seedText: freshPartialCandidate, displayQuestion: freshPartialCandidate, source: "transcript" };
      }
    }
    // Compute prevEndsIncomplete here (before the if-block below) so it's in scope throughout.
    // Uses the second-most-recent committed segment to detect mid-sentence splits.
    const _prevSegForFrag = (segmentsRef.current[1] || "").trim();
    const prevEndsIncomplete = !!_prevSegForFrag && INCOMPLETE_ENDING_RE.test(_prevSegForFrag) && !_prevSegForFrag.includes("?");
    // Hard latest-line priority:
    // take newest captured line first, then rewrite it to a clean question if needed.
    const latestRawLine = autocorrectNoisyQuestionWithContext(
      (pendingTranscriptLineRef.current.trim() || questionDraftRef.current.trim() || interimTextRef.current.trim() || segmentsRef.current[0]?.trim() || ""),
    );
    if (latestRawLine) {
      const latestSanitized = rewriteMixedTopicQuestion(cleanDetectedInterviewQuestion(dedupeExperienceTopics(sanitizeQuestionCandidate(latestRawLine))));
      const now = Date.now();
      const latestClean = (latestSanitized || latestRawLine).replace(/[?.,;:!]+$/g, "").trim();
      const latestNorm = latestClean.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
      const latestWordCount = latestNorm.split(/\s+/).filter(Boolean).length;
      const latestLooksExplicit = isExplicitQuestion(latestSanitized || latestRawLine) || QUESTION_START_RE.test(latestNorm);
      const latestStartsJoiner = /^(and also|and|also|plus|as well as|along with|including|in addition)\b/i.test(latestNorm);
      // Also treat longer utterances as fragments when the previous segment clearly ended mid-sentence.
      const latestIsShortFragment = latestWordCount >= 1 && (latestWordCount <= 10 || prevEndsIncomplete) && !latestLooksExplicit;
      if ((latestStartsJoiner && !latestLooksExplicit) || latestIsShortFragment) {
        const recentExplicitQuestion =
          boundaryQuestionCandidatesRef.current
            .filter((q) => (now - q.ts) <= LONG_CONTINUATION_MS)
            .map((q) => q.text)
            .find((q) => isExplicitQuestion(q) && normalizeForDedup(q) !== normalizeForDedup(latestClean))
          ||
          segmentsRef.current
            .slice(0, 12)
            .filter((line) => normalizeForDedup(String(line || "")) !== normalizeForDedup(latestClean))
            .map((line) => splitExplicitQuestions(String(line || "")))
            .find((chunks) => chunks.length > 0)?.slice(-1)[0] ||
          "";

        if (recentExplicitQuestion) {
          const base = recentExplicitQuestion.replace(/\?\s*$/, "").trim();
          const continuation = latestClean
            .replace(/^(and also|and|also|plus|as well as|along with|including|in addition)\b\s*/i, "")
            .replace(/[?.,;:!]+$/g, "")
            .trim();
          const continuationKey = normalizeForDedup(continuation);
          if (continuation && continuationKey && !normalizeForDedup(base).includes(continuationKey)) {
            const baseIsComplete = base.includes("?") || base.split(/\s+/).filter(Boolean).length >= 6;
            const isSentenceCont = SENTENCE_CONTINUATION_RE.test(continuation.trim());
            const baseEndsIncomplete = INCOMPLETE_ENDING_RE.test(base.trim());
            const connector = (latestStartsJoiner && !isSentenceCont && !baseEndsIncomplete) ? " and also " : (baseIsComplete && !isSentenceCont && !baseEndsIncomplete) ? " and also " : " ";
            const combined = `${base}${connector}${continuation}`.replace(/\s+/g, " ").trim();
            const withQ = combined.endsWith("?") ? combined : `${combined}?`;
            return { seedText: withQ, displayQuestion: withQ, source: "memory-followup" };
          }
        }
      }

      const latestRawExplicit = splitExplicitQuestions(latestSanitized || latestRawLine)
        .map((q) => rewriteMixedTopicQuestion(cleanDetectedInterviewQuestion(q)))
        .filter(Boolean);
      if (latestRawExplicit.length === 1) {
        return { seedText: latestRawExplicit[0], displayQuestion: latestRawExplicit[0], source: "transcript" };
      }
      if (latestRawExplicit.length > 1) {
        // Send all questions joined — server's extractInterviewerQuestions splits on "?" and
        // builds a multiQuestionBlock so the AI answers every question, not just the last one.
        const seedText = latestRawExplicit.join(" ");
        const displayQuestion = latestRawExplicit.join(" / ");
        return { seedText, displayQuestion, source: "transcript" };
      }

      if (!latestLooksExplicit) {
        const rewrittenLatest = buildQuestionFromMeaningfulFragment(latestSanitized || latestRawLine);
        if (rewrittenLatest) {
          const rewriteNorm = normalizeForDedup(rewrittenLatest);
          const lastEnterNorm = normalizeForDedup(lastEnterSeedRef.current.text || "");
          if (rewriteNorm && rewriteNorm !== lastEnterNorm) {
            return { seedText: rewrittenLatest, displayQuestion: rewrittenLatest, source: "fallback" };
          }
        }
      }
    }
    const recentSegments = segmentsRef.current
      .slice(0, 10)
      .map((s) => rewriteMixedTopicQuestion(cleanDetectedInterviewQuestion(dedupeExperienceTopics(sanitizeQuestionCandidate(autocorrectNoisyQuestionWithContext(String(s || "").trim()))))))
      .filter(Boolean);
    const topQuestionWindow = recentSegments.slice(0, 8);
    const topWindowQuestionNorms = new Set(
      extractAnyQuestionCandidates(topQuestionWindow)
        .map((q) => normalizeForDedup(q))
        .filter(Boolean),
    );
    const latestUtterance = recentSegments[0] || "";
    const topContextJoined = topQuestionWindow.join(" ").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    const topContextTokens = new Set(
      topContextJoined
        .split(/\s+/)
        .filter((w) => w.length > 3 && !/^(what|why|how|when|where|who|which|tell|walk|explain|about|have|has|does|did|would|could|should|with|from|into|that|this)$/.test(w)),
    );
    const freshDraft = autocorrectNoisyQuestionWithContext(questionDraftRef.current.trim());
    const pendingTail = autocorrectNoisyQuestionWithContext(pendingQuestionTailRef.current.join(" ").trim());
    const freshDraftWordCount = freshDraft.split(/\s+/).filter(Boolean).length;
    const freshPartialActive = now - lastPartialTsRef.current <= 1200;
    const latestWordCount = latestUtterance.split(/\s+/).filter(Boolean).length;
    const freshIsShortTail = freshDraftWordCount > 0 && freshDraftWordCount <= 2;
    const latestIsShortTail = latestWordCount > 0 && latestWordCount <= 2;
    const latestLooksLikeContinuationTail =
      /^(and|and also|also)\b/i.test(latestUtterance) && latestWordCount >= 2 && latestWordCount <= 6;
    const freshLooksLikeContinuationTail =
      /^(and|and also|also)\b/i.test(freshDraft) && freshDraftWordCount >= 2 && freshDraftWordCount <= 6;
    const bestRecentQuestion = pickBestRecentQuestionSeed(recentSegments);
    const bestRecentContext = pickBestRecentContextSeed(recentSegments);
    const composedFromFragments = composeFromRecentFragments(recentSegments);
    const recentContextWindow = recentSegments
      .filter((seg) => !!seg && !isLikelyNoiseSegment(seg))
      .slice(0, 8);
    const contextualFollowupSeed = recentContextWindow.join(" ").replace(/\s+/g, " ").trim();
    const recentContinuationTail = recentSegments.find((seg) => {
      const s = String(seg || "").trim();
      if (!s) return false;
      if (isLikelyNoiseSegment(s) && !/^(and|and also|also)\b/i.test(s)) return false;
      const q = s.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
      const wc = q.split(/\s+/).filter(Boolean).length;
      return /^(and|and also|also)\b/i.test(q) && wc >= 2 && wc <= 8;
    }) || "";
    const freshPendingTopics = pendingContinuationTopicsRef.current
      .filter((x) => (now - x.ts) <= CONTINUATION_TOPIC_WINDOW_MS)
      .map((x) => x.topic)
      .filter(Boolean);
    const mergeExplicitQuestionWithPendingTopics = (questionText: string): string => {
      const base = String(questionText || "").trim();
      if (!base || !freshPendingTopics.length) return base;
      const normalized = base.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
      const isExperienceQuestion =
        /\b(experience|worked with|familiar with|knowledge of|used)\b/i.test(base)
        || /^(do|does|did|have|has|can|could|would|is|are)\b/i.test(normalized);
      if (!isExperienceQuestion) return base;
      const baseNoQ = base.replace(/\?\s*$/, "").trim();
      const mergedTopics = freshPendingTopics
        .filter((topic, idx, arr) => arr.findIndex((x) => normalizeForDedup(x) === normalizeForDedup(topic)) === idx)
        .filter((topic) => isLikelyInterviewTopic(topic))
        .filter((topic) => !new RegExp(`\\b${topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(baseNoQ))
        .slice(0, 2);
      if (!mergedTopics.length) return base;

      // Consume continuation topics once merged to avoid bleed into later questions.
      pendingContinuationTopicsRef.current = pendingContinuationTopicsRef.current.filter((x) => (now - x.ts) > CONTINUATION_TOPIC_WINDOW_MS);
      const merged = `${baseNoQ} and ${mergedTopics.join(" and ")}`.replace(/\s+/g, " ").trim();
      return merged.endsWith("?") ? merged : `${merged}?`;
    };
    const latestDirectQuestion = recentSegments.find((seg) => {
      const s = String(seg || "").trim();
      if (!s) return false;
      const q = s.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
      const wc = q.split(/\s+/).filter(Boolean).length;
      return wc >= 2 && wc <= 10 && (s.includes("?") || /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|tell|walk|explain)\b/.test(q));
    }) || "";
    const latestUtteranceNorm = normalizeForDedup(latestUtterance);
    const latestStartsJoinerTail =
      /^(and also|and|also|plus|as well as|along with|including|in addition)\b/i.test(latestUtterance.trim());
    // Detect mid-sentence splits caused by speech pauses: newest segment starts with a preposition
    // or gerund that cannot begin a standalone sentence (e.g. "with machine learning", "working on it").
    const latestStartsSentenceCont = !latestStartsJoinerTail && SENTENCE_CONTINUATION_RE.test(latestUtterance.trim());
    // prevEndsIncomplete is declared earlier in this function (before the latestRawLine block).
    // Use the topQuestionWindow version here for continuation detection since it has processed segments.
    const prevSegment = (topQuestionWindow[1] || "").trim();
    const prevEndsIncompleteRefined = !!prevSegment && INCOMPLETE_ENDING_RE.test(prevSegment) && !prevSegment.includes("?");
    const withinContinuationWindow = (now - lastPartialTsRef.current) <= CONTINUATION_MS;
    if ((latestStartsJoinerTail || latestStartsSentenceCont || prevEndsIncompleteRefined) && withinContinuationWindow) {
      const previousLine = prevEndsIncompleteRefined
        ? prevSegment  // already have it
        : (topQuestionWindow
            .slice(1)
            .map((line) => splitExplicitQuestions(line))
            .find((chunks) => chunks.length > 0)
            ?.[0] || "");
      const base = previousLine.replace(/\?\s*$/, "").trim();
      const continuation = latestUtterance
        .replace(/^(and also|and|also|plus|as well as|along with|including|in addition)\b\s*/i, "")
        .replace(/[?.,;:!]+$/g, "")
        .trim();
      if (base && continuation && normalizeForDedup(base) !== normalizeForDedup(continuation)) {
        const isSentCont = latestStartsSentenceCont || prevEndsIncompleteRefined;
        const connector = isSentCont ? " " : " and also ";
        const combined = `${base}${connector}${continuation}`.replace(/\s+/g, " ").trim();
        const withQ = combined.endsWith("?") ? combined : `${combined}?`;
        return { seedText: withQ, displayQuestion: withQ, source: "transcript" };
      }
    }
    // Strict latest-turn-window behavior:
    // 1) scan newest lines in order for explicit question and use first match
    // 2) if no explicit question in latest turn window, fall back to follow-up context
    // 3) only then use broader ranking/older fallback logic
    const latestLineExplicitQuestions = splitExplicitQuestions(latestUtterance);
    if (latestLineExplicitQuestions.length === 1) {
      return { seedText: latestLineExplicitQuestions[0], displayQuestion: latestLineExplicitQuestions[0], source: "transcript" };
    }
    if (latestLineExplicitQuestions.length > 1) {
      const seedText = latestLineExplicitQuestions.join(" ");
      const displayQuestion = latestLineExplicitQuestions.join(" / ");
      return { seedText, displayQuestion, source: "transcript" };
    }
    // If latest line is a short topic fragment (single word or short tail),
    // attach it to the previous explicit question chain.
    const latestFragmentBase = latestUtterance
      .replace(/^(and also|and|also|plus|as well as|along with|including|in addition)\b\s*/i, "")
      .replace(/[?.,;:!]+$/g, "")
      .trim();
    const latestFragmentNorm = latestFragmentBase.toLowerCase().replace(/[^\w\s.+#/-]/g, " ").replace(/\s+/g, " ").trim();
    const latestFragmentWords = latestFragmentNorm.split(/\s+/).filter(Boolean);
    const fragmentStop = new Set(["and", "also", "or", "yes", "no", "ok", "okay", "hmm", "uh", "um", "the", "a", "an", "in", "on", "with", "for", "to", "of", "experience"]);
    const latestLooksLikeTopicFragment =
      !!latestFragmentNorm
      && latestFragmentWords.length >= 1
      && latestFragmentWords.length <= 10
      && !QUESTION_START_RE.test(latestFragmentNorm)
      && !latestFragmentWords.every((w) => fragmentStop.has(w));
    if (latestLooksLikeTopicFragment) {
      const previousExplicit = topQuestionWindow
        .slice(1)
        .map((line) => splitExplicitQuestions(line))
        .find((chunks) => chunks.length > 0);
      if (previousExplicit && previousExplicit.length) {
        const base = previousExplicit[previousExplicit.length - 1].replace(/\?\s*$/, "").trim();
        if (base) {
          const baseNorm = normalizeForDedup(base);
          const fragNorm = normalizeForDedup(latestFragmentBase);
          const alreadyInBase = !!fragNorm && !!baseNorm && baseNorm.includes(fragNorm);
          if (!alreadyInBase) {
            const baseIsComplete = base.includes("?") || base.split(/\s+/).filter(Boolean).length >= 6;
            const isSentenceCont = SENTENCE_CONTINUATION_RE.test(latestFragmentBase.trim());
            const baseEndsIncomplete = INCOMPLETE_ENDING_RE.test(base.trim());
            const connector = (latestStartsJoinerTail && !isSentenceCont && !baseEndsIncomplete) ? " and also " : (baseIsComplete && !isSentenceCont && !baseEndsIncomplete) ? " and also " : " ";
            const combined = `${base}${connector}${latestFragmentBase}`.replace(/\s+/g, " ").trim();
            const withQ = combined.endsWith("?") ? combined : `${combined}?`;
            return { seedText: withQ, displayQuestion: withQ, source: "transcript" };
          }
        }
      }
      // No previous explicit question: synthesize from any meaningful fragment.
      const synthesized = buildQuestionFromMeaningfulFragment(latestFragmentBase);
      if (synthesized) {
        return { seedText: synthesized, displayQuestion: synthesized, source: "fallback" };
      }
    }
    // Low-confidence/new-question override:
    // If the newest line looks question-like (even if weak/confidence low),
    // still answer it when it is new vs the last Enter seed.
    const latestLooseNorm = latestUtterance.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
    const latestLooseWords = latestLooseNorm.split(/\s+/).filter(Boolean).length;
    const latestLooksQuestionLikeLoose =
      latestUtterance.includes("?")
      || /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|is|are|tell|walk|explain|describe|share|give|talk|elaborate|discuss)\b/i.test(latestLooseNorm);
    const lastEnterNorm = normalizeForDedup(lastEnterSeedRef.current.text || "");
    const latestIsNewSinceLastEnter =
      !!latestLooseNorm
      && latestLooseNorm !== lastEnterNorm
      && levenshteinSimilarity(latestLooseNorm, lastEnterNorm || "") < 0.9;
    if (latestLooksQuestionLikeLoose && latestLooseWords >= 2 && latestIsNewSinceLastEnter) {
      const withQ = latestUtterance.trim().endsWith("?") ? latestUtterance.trim() : `${latestUtterance.trim()}?`;
      return { seedText: withQ, displayQuestion: withQ, source: "transcript" };
    }
    // Substantive interviewer statement fallback:
    // Catches cases like "Describe your experience with X", "Your background in Y",
    // "So about your Python work" — no question words but clearly an interview prompt.
    // Requires ≥5 words, not first-person (not candidate's own speech), not noise.
    const latestIsSubstantiveStatement =
      latestLooseWords >= 5
      && !isLikelyNoiseSegment(latestUtterance)
      && !(/^(i |we |my |our |candidate:)/i.test(latestLooseNorm));
    if (latestIsSubstantiveStatement && latestIsNewSinceLastEnter) {
      const cleaned = rewriteMixedTopicQuestion(
        cleanDetectedInterviewQuestion(dedupeExperienceTopics(sanitizeQuestionCandidate(latestUtterance.trim())))
      );
      return { seedText: cleaned || latestUtterance.trim(), displayQuestion: cleaned || latestUtterance.trim(), source: "transcript" };
    }
    const topExplicitCandidates: Array<{ q: string; score: number }> = [];
    for (let idx = 0; idx < topQuestionWindow.length; idx += 1) {
      const line = topQuestionWindow[idx] || "";
      const chunks = splitExplicitQuestions(line);
      for (const q of chunks) {
        const normalized = q.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
        if (!normalized) continue;
        const adv = detectQuestionAdvanced(q);
        const hasStrongStarter = /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|is|are)\b/i.test(normalized);
        const hasTechCue = /\b(difference between|s3|bucket|azure|aws|gcp|google cloud|python|flask|fastapi|fast api|react|angular|vue|next\.?js|django|express|spring|node\.?js|database|sql|mysql|postgresql|mongodb|redis|kafka|rabbitmq|docker|kubernetes|k8s|terraform|jenkins|github actions|gitlab|ci\/cd|kotlin|java|golang|go|typescript|javascript|rust|scala|swift|dotnet|\.net|graphql|grpc|rest|api|apis|microservices|serverless|lambda|ec2|ecs|eks|machine learning|ml|deep learning|pytorch|tensorflow|pandas|numpy|spark|pyspark|airflow|elasticsearch|kibana|grafana|prometheus|jwt|oauth|rbac|iam|vpc|celery|nginx|linux|devops)\b/i.test(normalized);
        const noisePenalty = isLikelyNoiseSegment(q) ? 0.7 : 0;
        const recency = 1 - (idx * 0.08);
        const score = recency + (adv.confidence * 0.5) + (hasStrongStarter ? 0.35 : 0) + (hasTechCue ? 0.2 : 0) - noisePenalty;
        topExplicitCandidates.push({ q, score });
      }
    }
    topExplicitCandidates.sort((a, b) => b.score - a.score);
    const bestTopExplicit = topExplicitCandidates.find((x) => isStrongInterviewerQuestion(x.q)) || topExplicitCandidates[0];
    if (bestTopExplicit?.q) {
      return { seedText: bestTopExplicit.q, displayQuestion: bestTopExplicit.q, source: "transcript" };
    }

    const extractProperQuestionsFromNoisyWindow = (): string[] => {
      const window = recentSegments.slice(0, 12);
      const starterSplit = /(?=\b(?:what|why|how|when|where|who|which|do you|does|did|can you|could you|would you|have you|has|is|are|tell me|walk me|explain)\b)/gi;
      const out: Array<{ q: string; score: number }> = [];

      for (let idx = 0; idx < window.length; idx += 1) {
        const raw = String(window[idx] || "").trim();
        if (!raw) continue;

        // Remove common filler/noise scaffolding but preserve semantic content.
        const cleanedLine = raw
          .replace(/\b(uh+|umm+|mmm+|hmm+|like|you know|okay+|ok+|right+)\b/gi, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (!cleanedLine) continue;

        const chunks = cleanedLine.includes("?")
          ? cleanedLine.split("?").map((p) => p.trim()).filter(Boolean).map((p) => `${p}?`)
          : cleanedLine.split(starterSplit).map((p) => p.trim()).filter(Boolean);

        for (const chunk of chunks) {
          const normalized = chunk.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
          const words = normalized.split(/\s+/).filter(Boolean);
          if (words.length < 3 || words.length > 24) continue;

          const startsQuestion = /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|is|are|tell|walk|explain)\b/i.test(normalized);
          const hasQuestionCue = chunk.includes("?") || startsQuestion;
          if (!hasQuestionCue) continue;

          // Skip obvious candidate monologue lines unless they are explicit questions.
          const firstPersonHeavy = /\b(i|my|we|our)\b/i.test(normalized) && !startsQuestion;
          if (firstPersonHeavy) continue;

          const adv = detectQuestionAdvanced(chunk);
          const recency = Math.max(0, 1 - idx * 0.12);
          const score = (0.6 * recency) + (0.4 * (adv.isQuestion ? adv.confidence : 0.45));
          const withQ = chunk.trim().endsWith("?") ? chunk.trim() : `${chunk.trim()}?`;
          out.push({ q: withQ, score });
        }
      }

      const dedup = new Map<string, { q: string; score: number }>();
      for (const item of out) {
        const key = normalizeForDedup(item.q);
        const prev = dedup.get(key);
        if (!prev || item.score > prev.score) dedup.set(key, item);
      }
      return Array.from(dedup.values())
        .sort((a, b) => b.score - a.score)
        .map((x) => x.q)
        .slice(0, 3);
    };
    const properQuestionsFromNoisyWindow = extractProperQuestionsFromNoisyWindow();
    if (properQuestionsFromNoisyWindow.length) {
      const best = properQuestionsFromNoisyWindow[0];
      const hybrid = maybeWrapHybridFollowups(best);
      if (hybrid) return { seedText: hybrid.seedText, displayQuestion: hybrid.displayQuestion, source: hybrid.source, multiQuestionMode: hybrid.multiQuestionMode };
      return { seedText: best, displayQuestion: best, source: "transcript" };
    }

    // Interim text fallback: if the question is still being transcribed (not yet committed to
    // segmentsRef), use currentLiveText directly as the seed so Enter fires immediately.
    // Only use if it's substantive (≥4 words, not noise, not pure first-person candidate speech).
    if (currentLiveText) {
      const liveWords = currentLiveText.trim().split(/\s+/).filter(Boolean);
      const liveNorm = currentLiveText.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
      const liveIsSubstantive =
        liveWords.length >= 4
        && !isLikelyNoiseSegment(currentLiveText)
        && !(/^(i |we |my |our )/i.test(liveNorm));
      const liveIsNewVsLastEnter =
        normalizeForDedup(currentLiveText) !== normalizeForDedup(lastEnterSeedRef.current.text || "");
      if (liveIsSubstantive && liveIsNewVsLastEnter) {
        const liveCleaned = rewriteMixedTopicQuestion(
          cleanDetectedInterviewQuestion(dedupeExperienceTopics(sanitizeQuestionCandidate(currentLiveText)))
        );
        const liveWithQ = (liveCleaned || currentLiveText).trim();
        return { seedText: liveWithQ, displayQuestion: liveWithQ, source: "transcript" };
      }
    }

    // No explicit question found in latest turn window -> follow up on latest context.
    if (contextualFollowupSeed) {
      const followupSeed = [
        "No explicit question detected in latest turn window.",
        "Provide a concise, natural follow-up response based on this latest interviewer context:",
        contextualFollowupSeed,
      ].join("\n");
      return {
        seedText: followupSeed,
        displayQuestion: contextualFollowupSeed,
        source: "memory-followup",
      };
    }

    const buildTopWindowCombinedExperienceQuestion = (): string => {
      const window = topQuestionWindow.map((s) => String(s || "").trim()).filter(Boolean);
      if (!window.length) return "";

      const normalizeTopic = (value: string): string => {
        const v = value.toLowerCase().replace(/[^\w\s.+#/-]/g, " ").replace(/\s+/g, " ").trim();
        if (!v) return "";
        if (/^(reaction|react js|reactjs|react jay es|preact)$/.test(v)) return "React";
        if (/^(fast api|fast apis|fastapi)$/.test(v)) return "FastAPI";
        if (/^(rest api|rest apis|restful)$/.test(v)) return "REST APIs";
        if (/^(foster|flast|flash)$/.test(v)) return "Flask";
        if (/^(dot net|dotnet|\.net)$/.test(v)) return ".NET";
        if (/^(postgres|postgresql)$/.test(v)) return "PostgreSQL";
        if (/^(mongo|mongodb)$/.test(v)) return "MongoDB";
        if (/^(js|javascript)$/.test(v)) return "JavaScript";
        if (/^(ts|typescript)$/.test(v)) return "TypeScript";
        return value.trim();
      };

      const topics: string[] = [];
      const addTopic = (raw: string) => {
        const cleaned = String(raw || "")
          .replace(/^(and|and also|also|plus|including|along with|as well as|in addition)\b\s*/i, "")
          .replace(/[?.,;:!]+$/g, "")
          .trim();
        if (!cleaned) return;
        const aliased = normalizeTopic(cleaned);
        if (!aliased) return;
        const words = aliased.split(/\s+/).filter(Boolean).length;
        if (words < 1 || words > 6) return;
        if (/^(in|on|with|for|to|of|and|or|also|experience)$/i.test(aliased)) return;
        if (topics.find((t) => normalizeForDedup(t) === normalizeForDedup(aliased))) return;
        topics.push(aliased);
      };

      for (const line of window) {
        const s = line.toLowerCase();
        if (!/\b(do you have experience in|have you worked with|experience in)\b/i.test(s)) continue;
        const m = line.match(/\b(?:do you have experience in|have you worked with|experience in)\s+(.+)$/i);
        if (!m?.[1]) continue;
        m[1]
          .split(/\s*(?:,|and also|and|&|\/|\+|or)\s*/i)
          .forEach(addTopic);
      }

      if (topics.length >= 2) {
        if (topics.length === 2) return `Do you have experience in ${topics[0]} and ${topics[1]}?`;
        const last = topics[topics.length - 1];
        const head = topics.slice(0, -1).join(", ");
        return `Do you have experience in ${head}, and ${last}?`;
      }
      return "";
    };
    const topWindowCombinedExperienceQuestion = buildTopWindowCombinedExperienceQuestion();
    if (topWindowCombinedExperienceQuestion) {
      return {
        seedText: topWindowCombinedExperienceQuestion,
        displayQuestion: topWindowCombinedExperienceQuestion,
        source: "transcript",
      };
    }
    const buildRankedQuestionCandidates = () => {
      const candidateMap = new Map<string, { text: string; score: number; clarity: number; idx: number }>();
      for (let idx = 0; idx < Math.min(12, recentSegments.length); idx += 1) {
        const seg = String(recentSegments[idx] || "").trim();
        if (!seg) continue;
        const chunks = splitExplicitQuestions(seg);
        for (const chunk of chunks) {
          const canonicalChunk = chunk
            .replace(/\breaction\b/gi, "React")
            .replace(/\bpreact\b/gi, "React")
            .replace(/\breact\s*js\b/gi, "React");
          const normalized = normalizeForDedup(canonicalChunk);
          if (!normalized) continue;
          const adv = detectQuestionAdvanced(canonicalChunk);
          const clarity = adv.isQuestion ? adv.confidence : 0;
          const words = normalized.split(/\s+/).filter(Boolean);
          if (words.length < 2 || words.length > 24) continue;

          const recency = Math.max(0, 1 - idx * 0.12);
          const chunkTokens = words.filter((w) => w.length > 3);
          const overlapHits = chunkTokens.filter((w) => topContextTokens.has(w)).length;
          const topicContinuity = chunkTokens.length ? (overlapHits / chunkTokens.length) : 0;
          const explicitBonus = canonicalChunk.includes("?") ? 0.08 : 0;
          const whBonus = /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|is|are|tell|walk|explain)\b/i.test(canonicalChunk.trim()) ? 0.06 : 0;
          const combinedExperienceBonus = /\b(do you have experience in|have you worked with|experience in)\b/i.test(canonicalChunk)
            && /\b(and|and also|,)\b/i.test(canonicalChunk)
            ? 0.18
            : 0;
          const score = (0.5 * recency) + (0.35 * clarity) + (0.15 * topicContinuity) + explicitBonus + whBonus + combinedExperienceBonus;
          const prev = candidateMap.get(normalized);
          if (!prev || score > prev.score) {
            candidateMap.set(normalized, { text: canonicalChunk, score, clarity, idx });
          }
        }
      }
      return Array.from(candidateMap.values()).sort((a, b) => b.score - a.score);
    };
    const rankedQuestionCandidates = buildRankedQuestionCandidates();
    const bestRankedQuestion = rankedQuestionCandidates[0];
    const hasHighConfidenceQuestion = !!bestRankedQuestion && bestRankedQuestion.score >= 0.62;
    if (hasHighConfidenceQuestion) {
      const rankedQuestion = bestRankedQuestion!.text.trim();
      const hybrid = maybeWrapHybridFollowups(rankedQuestion);
      if (hybrid) return { seedText: hybrid.seedText, displayQuestion: hybrid.displayQuestion, source: hybrid.source, multiQuestionMode: hybrid.multiQuestionMode };
      return { seedText: rankedQuestion, displayQuestion: rankedQuestion, source: "transcript" };
    }
    const latestHeuristicQuestion =
      recentSegments.find((seg) =>
        /\b(do you have experience in|have you worked with|tell me about yourself|what'?s your name|from what month to what month)\b/i.test(seg),
      ) || "";
    const transcriptCandidate = latestTranscriptQuestion || latestHeuristicQuestion;
    const interpreted = interpretedQuestionRef.current?.trim() || "";
    const latestReopenCue = recentSegments.find((seg) => REOPEN_CUE_RE.test(String(seg || ""))) || "";
    const freshUnansweredPool = interviewerQuestionMemoryRef.current
      .filter((q) => (now - q.ts) <= UNANSWERED_TTL_MS);
    const unanswered = [...freshUnansweredPool]
      .sort((a, b) => b.ts - a.ts)
      .find((q) => !q.answered)?.text || "";
    const recentReply = spokenReplyMemoryRef.current[0]?.text || "";
    const isLikelySameQuestionExpansion = (prevQuestion: string, newUtterance: string): boolean => {
      const prev = normalizeForDedup(prevQuestion || "");
      const curr = normalizeForDedup(newUtterance || "");
      if (!prev || !curr) return false;
      if (/^(and also|and|also|plus|as well as|along with|including|in addition)\b/i.test(curr)) return true;

      const stop = new Set(["the", "a", "an", "in", "on", "at", "to", "for", "of", "with", "and", "or", "is", "are", "do", "does", "did", "can", "could", "would", "have", "has", "what", "why", "how", "when", "where", "who", "which", "tell", "explain", "about"]);
      const prevWords = prev.split(/\s+/).filter((w) => w.length > 2 && !stop.has(w));
      const currWords = curr.split(/\s+/).filter((w) => w.length > 2 && !stop.has(w));
      if (!prevWords.length || !currWords.length) return false;
      const prevSet = new Set(prevWords);
      const hits = currWords.filter((w) => prevSet.has(w)).length;
      const overlap = hits / Math.max(1, Math.min(prevWords.length, currWords.length));
      return overlap >= 0.34;
    };
    const recentBoundaryQuestion = boundaryQuestionCandidatesRef.current
      .filter((q) => (now - q.ts) <= 120_000)
      .map((q) => q.text)
      .find((q) => !!q && !isLikelyNoiseSegment(q)) || "";
    const inferQuestionFromShortFragments = (): string => {
      const windowSegs = recentSegments.slice(0, 6).map((s) => String(s || "").trim()).filter(Boolean);
      if (!windowSegs.length) return "";

      const hasExperienceStub = windowSegs.some((s) =>
        /\b(do you have experience in|do i have experience in|have experience in|experience in)\b/i.test(s),
      );
      const topics: string[] = [];
      for (const raw of windowSegs) {
        if (!raw) continue;
        if (isLikelyNoiseSegment(raw)) continue;
        const normalized = raw.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
        if (!normalized) continue;
        if (/^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|is|are)\b/.test(normalized)) continue;
        if (/\b(tell me about|from what month|start date|end date)\b/.test(normalized)) continue;
        let cleaned = raw
          .replace(/^(and also|and|also|plus|as well as|along with|including|in addition)\b\s*/i, "")
          .replace(/[?.,;:!]+$/g, "")
          .trim();
        if (!cleaned) continue;
        const wc = cleaned.split(/\s+/).filter(Boolean).length;
        if (wc > 4) continue;
        const key = normalizeForDedup(cleaned);
        if (!key || topics.find((t) => normalizeForDedup(t) === key)) continue;
        topics.push(cleaned);
      }

      if (topics.length >= 2) {
        return `Do you have experience with ${topics.slice(0, 3).join(" and ")}?`;
      }
      if (topics.length === 1 && hasExperienceStub) {
        return `Do you have experience with ${topics[0]}?`;
      }
      return "";
    };
    const inferSemanticQuestionFromConversation = (): string => {
      const windowSegs = recentSegments
        .slice(0, 8)
        .map((s) => String(s || "").trim())
        .filter(Boolean)
        .filter((s) => !isLikelyNoiseSegment(s));
      if (!windowSegs.length) return "";

      const explicitInWindow = windowSegs.find((s) => isExplicitQuestion(s));
      if (explicitInWindow) return "";

      const joined = windowSegs.join(" ").replace(/\s+/g, " ").trim();
      if (!joined) return "";

      const yearsMatch = joined.match(/(\d+\+?\s+years?)/i);
      const yearsPhrase = yearsMatch ? yearsMatch[1] : "";

      const topicPatterns: Array<{ re: RegExp; label: string }> = [
        { re: /\bpython\b/i, label: "Python" },
        { re: /\bflask\b/i, label: "Flask" },
        { re: /\bfastapi|fast api|fast apis\b/i, label: "FastAPI" },
        { re: /\bdjango\b/i, label: "Django" },
        { re: /\breact\b/i, label: "React" },
        { re: /\bdatabase|mysql|postgres|postgresql|mongodb|oracle|sql\b/i, label: "databases" },
        { re: /\bmicroservices?\b/i, label: "microservices" },
        { re: /\bdata engineer|data engineering|etl|pyspark|spark\b/i, label: "data engineering" },
      ];

      const topics = topicPatterns
        .filter((t) => t.re.test(joined))
        .map((t) => t.label)
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .slice(0, 4);

      if (!topics.length) return "";
      if (yearsPhrase) {
        return `You've been working with ${topics.join(", ")} for about ${yearsPhrase}. Can you share your hands-on experience with these?`;
      }
      return `Can you share your experience working with ${topics.join(", ")}?`;
    };

    const buildCleanEnterQuestion = (): string => {
      const window = recentSegments.slice(0, 20).map((s) => String(s || "").trim()).filter(Boolean);
      if (!window.length) return "";

      const extractLatestExplicitQuestion = (): string => {
        const starterSplit = /(?=\b(?:what|why|how|when|where|who|which|do you|does|did|can you|could you|would you|have you|has|is|are|tell me|walk me|explain)\b)/gi;
        for (const raw of recentSegments.slice(0, 8)) {
          const line = String(raw || "").trim();
          if (!line || isLikelyNoiseSegment(line)) continue;
          const chunks = line.includes("?")
            ? line.split("?").map((p) => p.trim()).filter(Boolean).map((p) => `${p}?`)
            : line.split(starterSplit).map((p) => p.trim()).filter(Boolean);
          for (const chunk of chunks.reverse()) {
            const normalized = chunk.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
            const words = normalized.split(/\s+/).filter(Boolean);
            const explicit =
              chunk.includes("?")
              || /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|is|are|tell|walk|explain)\b/i.test(normalized);
            if (!explicit) continue;
            if (words.length < 2 || words.length > 22) continue;
            if (/\b(i|my|we|our)\b/.test(normalized) && words.length > 6) continue;
            return chunk;
          }
        }
        return "";
      };

      const latestExplicit = extractLatestExplicitQuestion();
      if (latestExplicit) {
        return enrichQuestionWithContinuations(latestExplicit);
      }

      const buildCanonicalExperienceQuestion = (): string => {
        const joined = window.join(" ").toLowerCase();
        const hasExperienceIntent = /\b(do you have experience|have you worked with|experience in)\b/i.test(joined);
        if (!hasExperienceIntent) return "";

        const topicCounts = new Map<string, number>();
        const topicAlias = (value: string): string => {
          const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
          if (!normalized) return "";
          if (/^(fast api|fast apis|fastapi)$/.test(normalized)) return "FastAPI";
          if (/^(rest api|rest apis|restful|restful api|restful apis)$/.test(normalized)) return "REST APIs";
          if (/^(dot net|dotnet|\.net)$/.test(normalized)) return ".NET";
          if (/^(js|javascript)$/.test(normalized)) return "JavaScript";
          if (/^(ts|typescript)$/.test(normalized)) return "TypeScript";
          if (/^(postgres|postgresql)$/.test(normalized)) return "PostgreSQL";
          if (/^(mongo|mongodb)$/.test(normalized)) return "MongoDB";
          if (/^(aws)$/.test(normalized)) return "AWS";
          if (/^(gcp)$/.test(normalized)) return "GCP";
          if (/^(k8s)$/.test(normalized)) return "Kubernetes";
          if (/^(foster|flast|flash)$/.test(normalized)) return "Flask";
          return value.trim();
        };
        const ignoreTopic = (value: string): boolean => {
          const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
          if (!normalized) return true;
          if (normalized.length <= 1) return true;
          if (/^(fast|simple|brief|background|experience|project|projects|building|build|calculator|about|and|also|in|on|with|for|to|of)$/.test(normalized)) return true;
          return false;
        };
        const addTopic = (value: string) => {
          const cleaned = String(value || "")
            .replace(/^(and|or|also|plus|including|along with|as well as|in addition)\b\s*/i, "")
            .replace(/\b(do you have experience|have you worked with|experience in|familiar with|comfortable with|knowledge of)\b/gi, "")
            .replace(/[?.,;:!]+$/g, "")
            .replace(/\s+/g, " ")
            .trim();
          if (!cleaned) return;
          const aliased = topicAlias(cleaned);
          if (ignoreTopic(aliased)) return;
          const words = aliased.split(/\s+/).filter(Boolean);
          if (words.length === 0 || words.length > 6) return;
          if (/^(in|on|with|for|to|of|and|or|also)$/i.test(aliased)) return;
          const key = normalizeForDedup(aliased);
          if (!key) return;
          topicCounts.set(aliased, (topicCounts.get(aliased) || 0) + 1);
        };

        for (const line of window) {
          const text = String(line || "").trim();
          if (!text) continue;

          const intentMatch = text.match(/\b(?:experience in|worked with|familiar with|comfortable with|knowledge of)\s+(.+)$/i);
          if (intentMatch?.[1]) {
            intentMatch[1]
              .split(/\s*(?:,|and|&|\/|\+|or)\s*/i)
              .forEach(addTopic);
          }

          const continuationMatch = text.match(/^(?:and|and also|also|plus|including|along with|as well as|in addition)\s+(.+)$/i);
          if (continuationMatch?.[1]) {
            continuationMatch[1]
              .split(/\s*(?:,|and|&|\/|\+|or)\s*/i)
              .forEach(addTopic);
          }
        }

        const strongMentionLines = window
          .map((line) => String(line || "").trim())
          .filter((line) => /\b(do you have experience|have you worked with|experience in)\b/i.test(line));
        const topics = Array.from(topicCounts.entries())
          .filter(([topic, count]) => {
            if (count >= 2) return true;
            return strongMentionLines.some((line) => new RegExp(`\\b${topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(line));
          })
          .sort((a, b) => b[1] - a[1])
          .map(([topic]) => topic)
          .slice(0, 4);

        if (!topics.length) return "";
        if (topics.length === 1) return `Do you have experience in ${topics[0]}?`;
        if (topics.length === 2) return `Do you have experience in ${topics[0]} and ${topics[1]}?`;
        const last = topics[topics.length - 1];
        const first = topics.slice(0, -1).join(", ");
        return `Do you have experience in ${first}, and ${last}?`;
      };

      const canonicalExperienceQuestion = buildCanonicalExperienceQuestion();
      if (canonicalExperienceQuestion) return canonicalExperienceQuestion;

      const candidates = extractAnyQuestionCandidates(window)
        .filter((q, idx, arr) => arr.findIndex((x) => normalizeForDedup(x) === normalizeForDedup(q)) === idx);
      if (candidates.length) {
        const latestExplicit = [...candidates].reverse().find((q) => isExplicitQuestion(q)) || candidates[candidates.length - 1];
        return enrichQuestionWithContinuations(latestExplicit);
      }

      const inferredFromShort = inferQuestionFromShortFragments();
      if (inferredFromShort) return inferredFromShort;

      const inferredSemantic = inferSemanticQuestionFromConversation();
      if (inferredSemantic) return inferredSemantic;

      const joined = window
        .filter((s) => !isLikelyNoiseSegment(s))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (!joined) return "";

      const topicPatterns: Array<{ re: RegExp; label: string }> = [
        { re: /\breact\b/i, label: "React" },
        { re: /\bflask\b/i, label: "Flask" },
        { re: /\bfastapi|fast api|fast apis\b/i, label: "FastAPI" },
        { re: /\bdjango\b/i, label: "Django" },
        { re: /\bpython\b/i, label: "Python" },
        { re: /\bdatabase|databases|sql|postgres|mysql|mongodb|oracle\b/i, label: "databases" },
        { re: /\bkubernetes|docker|aws|azure|terraform|ansible\b/i, label: "cloud and DevOps" },
      ];
      const topic = topicPatterns.find((t) => t.re.test(joined))?.label || "";
      if (topic) return `Can you share your hands-on experience with ${topic}?`;
      return "";
    };

    const enrichQuestionWithContinuations = (baseQuestion: string): string => {
      const base = String(baseQuestion || "").trim();
      if (!base) return "";

      const baseNorm = normalizeForDedup(base);

      const extras: Array<{ text: string; hadJoiner: boolean }> = [];
      for (const raw of recentSegments.slice(0, 8)) {
        const text = String(raw || "").trim();
        if (!text) continue;
        if (normalizeForDedup(text) === baseNorm) continue;
        if (isLikelyNoiseSegment(text)) continue;
        if (isExplicitQuestion(text)) continue;

        const normalized = text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
        const words = normalized.split(/\s+/).filter(Boolean);
        const startsJoiner = /^(and also|and|also|plus|as well as|along with|including|in addition)\b/i.test(normalized);
        // Accept any meaningful continuation ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â not just tech terms.
        const contStopwords = new Set(["i","me","my","we","our","you","your","he","she","it","they","them","the","a","an","and","or","but","in","on","at","to","for","of","with","by","from","up","into","yes","no","ok","okay","hmm","uh","um","so","as","if","then","that","this","these","those","is","am","are","was","were","be","been","being","also","just","very","really","quite","well"]);
        const hasMeaningfulContent = words.filter(w => w.length >= 3 && !contStopwords.has(w)).length >= 1;
        if (!hasMeaningfulContent) continue;
        // Joiner fragments always attach; non-joiner continuations must be short (ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°Ãƒâ€šÃ‚Â¤6 words).
        if (!startsJoiner && words.length > 6) continue;

        const cleaned = text
          .replace(/^(and also|and|also|plus|as well as|along with|including|in addition)\b\s*/i, "")
          .replace(/[?.,;:!]+$/g, "")
          .trim();
        if (!cleaned) continue;
        if (extras.find((x) => normalizeForDedup(x.text) === normalizeForDedup(cleaned))) continue;
        extras.push({ text: cleaned, hadJoiner: startsJoiner });
      }

      if (!extras.length) return base;
      const baseNoQ = base.replace(/\?\s*$/, "").trim();
      const baseIsComplete = base.includes("?") || baseNoQ.split(/\s+/).filter(Boolean).length >= 6;
      // Smart connector:
      //   hadJoiner ("and also X") ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ "and also"
      //   fragment starts with preposition/gerund ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ space (natural sentence continuation)
      //   complete base + standalone topic ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ "and also"
      //   incomplete base + any continuation ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ space
      const merged = extras.reduce((acc, { text: extraText, hadJoiner }) => {
        const isSentenceCont = SENTENCE_CONTINUATION_RE.test(extraText.trim());
        const connector = (hadJoiner && !isSentenceCont) ? " and also " : (baseIsComplete && !isSentenceCont) ? " and also " : " ";
        return `${acc}${connector}${extraText}`;
      }, baseNoQ).replace(/\s+/g, " ").trim();
      return merged.endsWith("?") ? merged : `${merged}?`;
    };

    // If a question ended with a continuation tail (e.g. "and also"),
    // combine it immediately with new words from partial/final transcript.
    if (pendingTail) {
      const pendingNorm = normalizeForDedup(pendingTail);
      const continuationCandidates = [freshDraft, interimText, latestUtterance]
        .map((v) => String(v || "").trim())
        .filter(Boolean);
      const tailContinuation = continuationCandidates.find((c) => normalizeForDedup(c) !== pendingNorm) || "";
      if (tailContinuation) {
        const cleanedContinuation = tailContinuation
          .replace(/^(and|and also|also)\b\s*/i, "")
          .trim();
        const combinedPending = `${pendingTail.replace(/\?\s*$/, "").trim()} ${cleanedContinuation || tailContinuation}`.replace(/\s+/g, " ").trim();
        const combinedQuestion = combinedPending.endsWith("?") ? combinedPending : `${combinedPending}?`;
        return { seedText: combinedQuestion, displayQuestion: combinedQuestion, source: "transcript" };
      }
    }

    if (
      bestRecentQuestion &&
      topWindowQuestionNorms.has(normalizeForDedup(bestRecentQuestion)) &&
      latestIsShortTail &&
      (!isLikelyNoiseSegment(latestUtterance) || latestLooksLikeContinuationTail) &&
      normalizeForDedup(bestRecentQuestion) !== normalizeForDedup(latestUtterance)
    ) {
      const mergedTail = `${bestRecentQuestion} ${latestUtterance}`.replace(/\s+/g, " ").trim();
      return { seedText: mergedTail, displayQuestion: mergedTail, source: "transcript" };
    }

    if (
      bestRecentQuestion &&
      topWindowQuestionNorms.has(normalizeForDedup(bestRecentQuestion)) &&
      freshPartialActive &&
      (freshIsShortTail || freshLooksLikeContinuationTail) &&
      (!isLikelyNoiseSegment(freshDraft) || freshLooksLikeContinuationTail) &&
      normalizeForDedup(bestRecentQuestion) !== normalizeForDedup(freshDraft)
    ) {
      const mergedTail = `${bestRecentQuestion} ${freshDraft}`.replace(/\s+/g, " ").trim();
      return { seedText: mergedTail, displayQuestion: mergedTail, source: "transcript" };
    }

    if (freshPartialActive && freshDraftWordCount >= 1 && !isLikelyNoiseSegment(freshDraft)) {
      return { seedText: freshDraft, displayQuestion: freshDraft, source: "transcript" };
    }

    // Strict Enter normalization: always prefer a clean inferred interviewer question.
    const cleanEnterQuestion = buildCleanEnterQuestion();
    if (cleanEnterQuestion) {
      const mergedQuestion = mergeExplicitQuestionWithPendingTopics(cleanEnterQuestion);
      const hybrid = maybeWrapHybridFollowups(mergedQuestion);
      if (hybrid) return { seedText: hybrid.seedText, displayQuestion: hybrid.displayQuestion, source: hybrid.source, multiQuestionMode: hybrid.multiQuestionMode };
      return { seedText: mergedQuestion, displayQuestion: mergedQuestion, source: "transcript" };
    }

    if (recentBoundaryQuestion) {
      if (recentContinuationTail) {
        const mergedBoundary = `${recentBoundaryQuestion.replace(/\?\s*$/, "").trim()} ${recentContinuationTail.replace(/^(and|and also|also)\b\s*/i, "").trim()}`.replace(/\s+/g, " ").trim();
        const withQ = mergedBoundary.endsWith("?") ? mergedBoundary : `${mergedBoundary}?`;
        const hybrid = maybeWrapHybridFollowups(withQ);
        if (hybrid) return { seedText: hybrid.seedText, displayQuestion: hybrid.displayQuestion, source: hybrid.source, multiQuestionMode: hybrid.multiQuestionMode };
        return { seedText: withQ, displayQuestion: withQ, source: "transcript" };
      }
      const hybrid = maybeWrapHybridFollowups(recentBoundaryQuestion);
      if (hybrid) return { seedText: hybrid.seedText, displayQuestion: hybrid.displayQuestion, source: hybrid.source, multiQuestionMode: hybrid.multiQuestionMode };
      return { seedText: recentBoundaryQuestion, displayQuestion: recentBoundaryQuestion, source: "transcript" };
    }

    if (latestDirectQuestion) {
      const mergedQuestion = mergeExplicitQuestionWithPendingTopics(
        enrichQuestionWithContinuations(latestDirectQuestion),
      );
      const hybrid = maybeWrapHybridFollowups(mergedQuestion);
      if (hybrid) return { seedText: hybrid.seedText, displayQuestion: hybrid.displayQuestion, source: hybrid.source, multiQuestionMode: hybrid.multiQuestionMode };
      return { seedText: mergedQuestion, displayQuestion: mergedQuestion, source: "transcript" };
    }

    const contextQuestions = extractAnyQuestionCandidates(recentSegments)
      .filter((q, idx, arr) => arr.findIndex((x) => normalizeForDedup(x) === normalizeForDedup(q)) === idx);
    // Multi-question mode: combine all questions/topic fragments from the last 8 segments.
    // Case A ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â two or more fully explicit questions (e.g. "Do you know Flask?" + "What about Django?")
    // Case B ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â one explicit question + one or more continuation fragments within recent segments
    //           (e.g. "Do you have experience in Flask?" then 7s later "and also Django")
    const shortWindowAll = recentSegments.slice(0, 8);
    const shortWindowQuestions = extractAnyQuestionCandidates(shortWindowAll)
      .filter((q, idx, arr) => arr.findIndex((x) => normalizeForDedup(x) === normalizeForDedup(q)) === idx)
      .filter((q) => isExplicitQuestion(q));
    // Continuation fragments: short segments that extend the previous question meaningfully.
    // Accepts any content ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â not just tech terms ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â so "feeling good", "since 2020", etc. attach too.
    const contFragStopwords = new Set(["i","me","my","we","our","you","your","he","she","it","they","them","the","a","an","and","or","but","in","on","at","to","for","of","with","by","from","up","into","yes","no","ok","okay","hmm","uh","um","so","as","if","then","that","this","these","those","is","am","are","was","were","be","been","being","also","just","very","really","quite","well"]);
    const continuationFragments = shortWindowAll
      .filter((seg) => !isExplicitQuestion(seg) && !isLikelyNoiseSegment(seg))
      .filter((seg) => {
        const s = seg.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
        const words = s.split(/\s+/).filter(Boolean);
        const startsJoiner = /^(and also|and|also|plus|as well as)\b/i.test(s);
        const hasMeaningful = words.filter(w => w.length >= 3 && !contFragStopwords.has(w)).length >= 1;
        return hasMeaningful && (startsJoiner || words.length <= 6);
      })
      .filter((seg, idx, arr) => arr.findIndex((x) => normalizeForDedup(x) === normalizeForDedup(seg)) === idx);
    const noisyWindowRatio = shortWindowAll.filter((seg) => isLikelyNoiseSegment(seg)).length / Math.max(1, shortWindowAll.length);
    const isNoisyWindow = noisyWindowRatio >= 0.35;
    const hasCaseA = shortWindowQuestions.length >= 2;
    const hasCaseB = shortWindowQuestions.length >= 1 && continuationFragments.length >= 1;
    if ((hasCaseA || hasCaseB) && !isNoisyWindow) {
      // Build combined question list: explicit questions + topic fragments stitched naturally
      const allTopics = [...shortWindowQuestions];
      if (hasCaseB && !hasCaseA) {
        // Stitch continuations onto the primary question rather than listing separately
        const primary = shortWindowQuestions[0].replace(/\?\s*$/, "").trim();
        const primaryIsComplete = primary.split(/\s+/).filter(Boolean).length >= 6;
        const stitched = continuationFragments.reduce((acc, f) => {
          const hadJoiner = /^(and also|and|also|plus|as well as)\b/i.test(f.trim());
          const cleaned = f.replace(/^(and also?|also|plus|as well as)\s*/i, "").trim();
          if (!cleaned) return acc;
          const isSentenceCont = SENTENCE_CONTINUATION_RE.test(cleaned.trim());
          const connector = (hadJoiner && !isSentenceCont) ? " and also " : (primaryIsComplete && !isSentenceCont) ? " and also " : " ";
          return `${acc}${connector}${cleaned}`;
        }, primary).replace(/\s+/g, " ").trim() + "?";
        return {
          seedText: stitched,
          displayQuestion: stitched,
          source: "transcript",
        };
      }
      const multiSeed = [
        "Interviewer asked multiple questions in one turn.",
        "Auto-correct obvious transcript/ASR errors in each question before answering.",
        "Answer all of them in order using one natural candidate response.",
        "Questions:",
        ...allTopics,
      ].join("\n");
      return {
        seedText: multiSeed,
        displayQuestion: allTopics.join("\n"),
        source: "transcript",
        multiQuestionMode: true,
      };
    }
    if (contextQuestions.length >= 1) {
      const latestExplicit = [...contextQuestions].reverse().find((q) => isExplicitQuestion(q)) || "";
      if (latestExplicit) {
        const mergedQuestion = mergeExplicitQuestionWithPendingTopics(
          enrichQuestionWithContinuations(latestExplicit),
        );
        const hybrid = maybeWrapHybridFollowups(mergedQuestion);
        if (hybrid) return { seedText: hybrid.seedText, displayQuestion: hybrid.displayQuestion, source: hybrid.source, multiQuestionMode: hybrid.multiQuestionMode };
        return { seedText: mergedQuestion, displayQuestion: mergedQuestion, source: "transcript" };
      }
      const hybrid = maybeWrapHybridFollowups(contextQuestions[contextQuestions.length - 1]);
      if (hybrid) return { seedText: hybrid.seedText, displayQuestion: hybrid.displayQuestion, source: hybrid.source, multiQuestionMode: hybrid.multiQuestionMode };
      return { seedText: contextQuestions[contextQuestions.length - 1], displayQuestion: contextQuestions[contextQuestions.length - 1], source: "transcript" };
    }

    const noNewUtteranceSinceLastEnter =
      !freshPartialActive &&
      latestUtteranceNorm
      && lastEnterSeedRef.current.text
      && normalizeForDedup(lastEnterSeedRef.current.text) === latestUtteranceNorm
      && (now - lastEnterSeedRef.current.ts) <= 30000;
    const hasRecentPreviousEnter =
      !!lastEnterSeedRef.current.text &&
      (now - lastEnterSeedRef.current.ts) <= SAME_TURN_APPEND_MS;
    const latestLooksExplicitNewQuestion = isExplicitQuestion(latestUtterance);
    const latestExtendsPreviousQuestion =
      hasRecentPreviousEnter &&
      !!latestUtterance &&
      isLikelySameQuestionExpansion(lastEnterSeedRef.current.text, latestUtterance);
    const hasNewDetailAfterEnter =
      hasRecentPreviousEnter &&
      !!latestUtterance &&
      normalizeForDedup(lastEnterSeedRef.current.text) !== latestUtteranceNorm &&
      !isLikelyNoiseSegment(latestUtterance) &&
      (!latestLooksExplicitNewQuestion || latestExtendsPreviousQuestion);

    const hasContinuationTailAfterEnter =
      hasRecentPreviousEnter &&
      !!recentContinuationTail &&
      normalizeForDedup(lastEnterSeedRef.current.text) !== normalizeForDedup(recentContinuationTail);

    if (noNewUtteranceSinceLastEnter) {
      const followupSeed = [
        `Continue from latest interviewer context: ${latestUtterance}`,
        "Provide a stronger follow-up answer with more concrete details, still concise and first-person.",
      ].join("\n");
      return { seedText: followupSeed, displayQuestion: latestUtterance, source: "memory-followup" };
    }

    // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Second-Enter combine: collect ALL new segments since last Enter and merge ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
    // If the interviewer kept speaking after the first Enter, gather every new committed segment
    // and combine it with the previous Enter question for a single cohesive answer.
    if (hasRecentPreviousEnter && lastEnterSegmentCountRef.current > 0) {
      const newSegmentCount = segmentsRef.current.length - lastEnterSegmentCountRef.current;
      if (newSegmentCount > 0) {
        // Segments are newest-first; the NEW ones are at the front.
        const rawNewSegs = segmentsRef.current.slice(0, newSegmentCount);
        const newSegs = rawNewSegs
          .map((s) => autocorrectNoisyQuestionWithContext(cleanTranscriptForDisplay(String(s || "").trim()) || String(s || "").trim()))
          .filter(Boolean)
          .filter((s, idx, arr) => arr.findIndex((x) => normalizeForDedup(x) === normalizeForDedup(s)) === idx);
        if (newSegs.length > 0) {
          const prevQ = lastEnterSeedRef.current.text.replace(/\?\s*$/, "").trim();
          // Build the combined question: prevQ + each new chunk in order (reverse since newest-first)
          const newChunks = [...newSegs].reverse();
          const combined = newChunks.reduce((acc, chunk) => {
            const chunkClean = chunk.replace(/^(and also|and|also|plus)\s*/i, "").replace(/\?\s*$/, "").trim();
            if (!chunkClean || normalizeForDedup(acc).includes(normalizeForDedup(chunkClean))) return acc;
            return `${acc} and also ${chunkClean}`;
          }, prevQ).replace(/\s+/g, " ").trim();
          const withQ = combined.endsWith("?") ? combined : `${combined}?`;
          return { seedText: withQ, displayQuestion: withQ, source: "memory-followup" };
        }
      }
    }

    if (hasContinuationTailAfterEnter) {
      const combinedTail = `${lastEnterSeedRef.current.text} ${recentContinuationTail}`.replace(/\s+/g, " ").trim();
      return {
        seedText: combinedTail,
        displayQuestion: combinedTail,
        source: "memory-followup",
      };
    }

    if (hasNewDetailAfterEnter) {
      const appendedContext = [lastEnterSeedRef.current.text, ...recentContextWindow]
        .map((s) => String(s || "").trim())
        .filter(Boolean)
        .filter((s, idx, arr) => arr.findIndex((x) => normalizeForDedup(x) === normalizeForDedup(s)) === idx)
        .slice(0, 8)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      const combinedContext = [
        `Previous interviewer question: ${lastEnterSeedRef.current.text}`,
        `New added interviewer detail: ${latestUtterance}`,
        appendedContext ? `Same-turn context: ${appendedContext}` : "",
        "Answer by combining both in one cohesive response.",
      ].join("\n");
      return {
        seedText: combinedContext,
        displayQuestion: appendedContext || `${lastEnterSeedRef.current.text} + ${latestUtterance}`,
        source: "memory-followup",
      };
    }

    // No explicit question detected: follow up on latest interviewer conversation context.
    // latest-turn follow-up has already been handled above.

    if (bestRecentQuestion) {
      const mergedQuestion = mergeExplicitQuestionWithPendingTopics(
        enrichQuestionWithContinuations(bestRecentQuestion),
      );
      if (topWindowQuestionNorms.has(normalizeForDedup(bestRecentQuestion))) {
        return { seedText: mergedQuestion, displayQuestion: mergedQuestion, source: "transcript" };
      }
    }

    if (composedFromFragments) {
      return { seedText: composedFromFragments, displayQuestion: composedFromFragments, source: "transcript" };
    }

    if (latestUtterance && !isLikelyNoiseSegment(latestUtterance)) {
      return { seedText: latestUtterance, displayQuestion: latestUtterance, source: "transcript" };
    }

    if (bestRecentContext) {
      return { seedText: bestRecentContext, displayQuestion: bestRecentContext, source: "transcript" };
    }

    if (transcriptCandidate) {
      // Fallback to detected transcript question candidates if latest utterance is empty.
      return { seedText: transcriptCandidate, displayQuestion: transcriptCandidate, source: "transcript" };
    }

    // Enter-mode single-word fallback: if user presses Enter with only one captured token,
    // still submit it instead of dropping due to question/noise heuristics.
    const singleTokenFallback = autocorrectNoisyQuestionWithContext((freshDraft || latestUtterance || interimText || "").trim());
    if (singleTokenFallback) {
      const tokenCount = singleTokenFallback.split(/\s+/).filter(Boolean).length;
      if (tokenCount >= 1 && tokenCount <= 8) {
        const synthesized = buildQuestionFromMeaningfulFragment(singleTokenFallback);
        if (synthesized) return { seedText: synthesized, displayQuestion: synthesized, source: "fallback" };
      }
    }

    if (unanswered && latestReopenCue) {
      if (recentReply && isShortAffirmativeReply(recentReply)) {
        const followupSeed = [
          `Interviewer question: ${unanswered}`,
          `Candidate short spoken reply: ${recentReply}`,
          "Generate a complete interview answer that uses the question and this confirmation.",
        ].join("\n");
        return {
          seedText: followupSeed,
          displayQuestion: unanswered,
          source: "memory-followup",
          lastInterviewerQuestion: unanswered,
          recentSpokenReply: recentReply,
        };
      }
    }

    if (interpreted && interpreted !== INTERPRETED_PLACEHOLDER && !isGenericInterpretedSeed(interpreted)) {
      return { seedText: interpreted, displayQuestion: interpreted, source: "interpreted" };
    }

    const fallback = pendingTranscriptLineRef.current.trim()
      || segmentsRef.current[0]?.trim()
      || questionDraftRef.current.trim()
      || interimText.trim()
      || "[Continue with latest interviewer context]";
    if (fallback && fallback !== "[Continue with latest interviewer context]") {
      return { seedText: fallback, displayQuestion: fallback, source: "fallback" };
    }

    if (unanswered && latestReopenCue) {
      return {
        seedText: unanswered,
        displayQuestion: unanswered,
        source: "memory-followup",
        lastInterviewerQuestion: unanswered,
      };
    }

    return { seedText: fallback, displayQuestion: fallback, source: "fallback" };
  }, [
    INTERPRETED_PLACEHOLDER,
    isShortAffirmativeReply,
    isGenericInterpretedSeed,
    isStrongInterviewerQuestion,
    pickBestRecentQuestionSeed,
    pickBestRecentContextSeed,
    composeFromRecentFragments,
    buildQuestionFromMeaningfulFragment,
    extractAnyQuestionCandidates,
    isLikelyNoiseSegment,
    isLikelyIncompleteFragment,
    cleanTranscriptForDisplay,
    autocorrectNoisyQuestionWithContext,
  ]);

  const submitCurrentQuestion = useCallback((sourceLabel?: string) => {
    console.log("[submit] submitCurrentQuestion called", sourceLabel || "");
    const pendingSnapshot = pendingTranscriptLineRef.current.trim();
    const draftSnapshot = questionDraftRef.current.trim();
    const interimSnapshot = interimTextRef.current.trim();
    const latestSegmentSnapshot = segmentsRef.current[0]?.trim() || "";
    flushPendingTranscriptLine();
    let rawManualText = sourceLabel === "enter_key"
      ? (
        pendingSnapshot
        || draftSnapshot
        || interimSnapshot
        || latestSegmentSnapshot
        || ""
      )
      : "";
    // If there is still-visible interimText that wasn't committed (residual words the user
    // kept speaking after the last final), append it to the seed so Enter captures everything.
    if (sourceLabel === "enter_key" && rawManualText && interimHasUnsavedContentRef.current) {
      const residual = interimSnapshot;
      if (residual) {
        const rawNorm = rawManualText.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
        const residualNorm = residual.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
        if (residualNorm && !rawNorm.includes(residualNorm)) {
          rawManualText = `${rawManualText.replace(/\?\s*$/, "").trim()} ${residual}`.replace(/\s+/g, " ").trim();
        }
      }
    }
    const immediateManualText = rawManualText
      ? autocorrectNoisyQuestionWithContext(rawManualText)
      : "";
    const manualQuestionCandidates = immediateManualText
      ? extractAnyQuestionCandidates([immediateManualText])
      : [];
    const manualExplicitQuestion = manualQuestionCandidates[manualQuestionCandidates.length - 1] || "";
    const manualWordCount = immediateManualText.split(/\s+/).filter(Boolean).length;
    // If the latest text starts with a continuation joiner ("and also flask", "also django", etc.)
    // it needs to be combined with the previous question ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â let resolveEnterSeed() handle that.
    const immediateStartsJoiner = /^(and\b|and also\b|also\b|plus\b)/i.test(immediateManualText.trim());
    const immediateManualLooksLikeQuestion =
      !!manualExplicitQuestion
      || /\?/.test(immediateManualText)
      || /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|is|are|tell|walk|explain|write|build|create|implement|design|show|give|list|describe|define|compare|difference|code|generate|make|find)\b/i.test(immediateManualText.trim());
    // Only use the immediate text directly if it looks like a question OR is short enough
    // to be a topic fragment. Long non-question text (candidate speech) must go through
    // resolveEnterSeed() so the question-priority scan picks up the real interviewer question.
    const shouldUseImmediateManualText =
      !!immediateManualText
      && !immediateStartsJoiner
      && (
        immediateManualLooksLikeQuestion
        || manualWordCount <= 12
      );
    let seed = shouldUseImmediateManualText
      ? {
        seedText: manualExplicitQuestion || immediateManualText,
        displayQuestion: manualExplicitQuestion || immediateManualText,
        source: "transcript" as SubmitSeedSource,
      }
      : resolveEnterSeed();

    // If the live partial starts with a continuation joiner ("and fastapi", "also AWS", etc.)
    // but isn't the primary seed, combine it with the resolved seed so we answer the full
    // combined question instead of just the earlier segment.
    if (immediateStartsJoiner && immediateManualText && seed.seedText) {
      const joinContent = immediateManualText.replace(/^(and\s+also\s+|and\s+|also\s+|plus\s+)/i, "").trim();
      const seedLower = seed.seedText.toLowerCase();
      if (joinContent && !seedLower.includes(joinContent.toLowerCase())) {
        const combined = `${seed.seedText.replace(/\?\s*$/, "").trim()} and ${joinContent}`;
        seed = { ...seed, seedText: combined, displayQuestion: combined };
      }
    }

    // If the live partial is a very short fragment (1-3 words, no question words) used as the
    // seed standalone, it's almost certainly a continuation tag ("fastapi", "AWS", "also Flask")
    // added after the main question was already committed. Combine with the prior segment.
    if (
      shouldUseImmediateManualText
      && !immediateStartsJoiner
      && manualWordCount <= 3
      && !manualExplicitQuestion
      && !/\b(what|how|why|when|where|who|which|can|could|do|does|did|is|are|was|were|have|has|tell|explain|describe)\b/i.test(immediateManualText)
    ) {
      const priorSegment = segmentsRef.current[0]?.trim() || pendingTranscriptLineRef.current.trim();
      if (priorSegment && !priorSegment.toLowerCase().includes(immediateManualText.toLowerCase())) {
        const combined = `${priorSegment.replace(/\?\s*$/, "").trim()} and ${immediateManualText}`;
        seed = { seedText: combined, displayQuestion: combined, source: "transcript" as SubmitSeedSource };
      }
    }

    const sanitizedSeedText = seed.multiQuestionMode
      ? (seed.seedText || "")
      : sanitizeMergedSeed(seed.seedText || "");
    const sanitizedDisplay = seed.multiQuestionMode
      ? (seed.displayQuestion || "")
      : (sanitizeMergedSeed(seed.displayQuestion || "") || sanitizedSeedText);
    const correctedSeedText = autocorrectNoisyQuestionWithContext(sanitizedSeedText || seed.seedText || "");
    const correctedDisplay = autocorrectNoisyQuestionWithContext(sanitizedDisplay || seed.displayQuestion || correctedSeedText);
    const safeSeedText = seed.multiQuestionMode
      ? (correctedSeedText || sanitizedSeedText || seed.seedText)
      : dedupeExperienceTopics(correctedSeedText || sanitizedSeedText || seed.seedText || "");
    const safeDisplayQuestion = seed.multiQuestionMode
      ? (correctedDisplay || sanitizedDisplay || seed.displayQuestion)
      : dedupeExperienceTopics(correctedDisplay || sanitizedDisplay || seed.displayQuestion || safeSeedText || "");
    const safeSeed = {
      ...seed,
      seedText: safeSeedText,
      displayQuestion: safeDisplayQuestion,
    };
    const now = Date.now();
    const seedFingerprint = normalizeQuestionForSimilarity(safeSeed.displayQuestion || safeSeed.seedText || "");
    const allowsSameTurnFollowup =
      safeSeed.source === "memory-followup"
      && /\b(new added interviewer detail|continue from latest interviewer context|answer by combining both)\b/i.test(safeSeed.seedText || "");

    if (
      sourceLabel !== "enter_key"
      && 
      seedFingerprint
      && !safeSeed.multiQuestionMode
      && !allowsSameTurnFollowup
      && isRecentDuplicateIntent(seedFingerprint, "enter", now)
    ) {
      // Silent duplicate suppression: keep current UI/stream state unchanged.
      return;
    }

    setLastSubmitSource(safeSeed.source);
    lastEnterSeedRef.current = { text: safeSeed.displayQuestion || safeSeed.seedText || "", ts: now };
    lastEnterSegmentCountRef.current = segmentsRef.current.length;
    // Record the question being answered in conversation history so follow-ups have context
    const questionForHistory = (safeSeed.displayQuestion || safeSeed.seedText || "").trim();
    if (questionForHistory && questionForHistory !== "[Continue with latest interviewer context]") {
      appendConversationContextLine("Interviewer", questionForHistory.slice(0, 400));
    }
    setInterpretedQuestion(safeSeed.displayQuestion || INTERPRETED_PLACEHOLDER);
    setStreamingQuestion(safeSeed.displayQuestion || "Answering...");
    showOptimisticAssistantState(safeSeed.displayQuestion || "Answering...");

    const ws = wsAnswerRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && id) {
      triggerMetricRef.current = { t_trigger_decision: now };
      triggerMetricRef.current.t_request_sent = now;
      if (isStreaming || isAwaitingFirstChunk) {
        try {
          ws.send(JSON.stringify({ type: "cancel", sessionId: id }));
        } catch {}
      }
      startFirstChunkWatchdog(safeSeed.source);
      pendingQuestionForRequestRef.current = safeSeed.displayQuestion || safeSeed.seedText || "";
      console.log(`[submit] chosen seed source=${safeSeed.source}`, { transport: "ws", preview: safeSeed.seedText.slice(0, 160) });
      ws.send(JSON.stringify({
        type: "question",
        sessionId: id,
        text: safeSeed.seedText,
        force: true,
        format: resolveFormat(safeSeed.seedText),
        model: selectedModel,
        quickMode: quickResponseMode,
        docsMode,
        metadata: {
          mode: "enter",
          audioMode,
          submitSource: safeSeed.source,
          lastInterviewerQuestion: safeSeed.lastInterviewerQuestion,
          recentSpokenReply: safeSeed.recentSpokenReply,
          multiQuestionMode: !!safeSeed.multiQuestionMode,
          customFormatPrompt: responseFormat === "custom" ? customPrompt : undefined,
          docsMode,
          systemPrompt: customPrompt || undefined,
          jobDescription: conversationHistory || undefined,
          // Send recent transcript (chronological order) so AI has full interview context.
          liveTranscript: segmentsRef.current.slice().reverse().join("\n") || undefined,
        },
      }));
      if (seedFingerprint) {
        lastRequestedIntentRef.current = { fp: seedFingerprint, ts: now, mode: "enter" };
        rememberAskedFingerprint(seedFingerprint);
      }
      return;
    }

    clearFirstChunkWatchdog();
    setIsStreaming(false);
    setIsAwaitingFirstChunk(false);
    toast({ title: "WebSocket not connected", description: "Reconnect and try again.", variant: "destructive" });
  }, [
    flushPendingTranscriptLine,
    resolveEnterSeed,
    sanitizeMergedSeed,
    dedupeExperienceTopics,
    autocorrectNoisyQuestionWithContext,
    extractAnyQuestionCandidates,
    id,
    responseFormat,
    selectedModel,
    quickResponseMode,
    docsMode,
    audioMode,
    customPrompt,
    conversationHistory,
    clearFirstChunkWatchdog,
    showOptimisticAssistantState,
    startFirstChunkWatchdog,
    toast,
    INTERPRETED_PLACEHOLDER,
    isStreaming,
    isAwaitingFirstChunk,
    isRecentDuplicateIntent,
    rememberAskedFingerprint,
    appendConversationContextLine,
  ]);

  // Keep a stable ref so handleFinalTurn can call submitCurrentQuestion
  // without it being in the dependency array (avoids stale closure issues).
  submitCurrentQuestionRef.current = submitCurrentQuestion;

  const handleSendTranscript = useCallback(async () => {
    console.log("[submit] Generate Answer from Transcript clicked");
    submitCurrentQuestion("generate_from_transcript");
  }, [submitCurrentQuestion]);

  const handleTranscriptKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const tagName = target?.tagName?.toLowerCase();
    if (tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable) {
      return;
    }

    if ((e.key === "Enter" || e.key === " ") && !e.shiftKey) {
      e.preventDefault();
      // Clear any stale pending window so state is clean.
      if (pendingEnterRef.current) {
        clearTimeout(pendingEnterRef.current.timer);
        pendingEnterRef.current = null;
      }
      // Only Enter fires an answer ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â no auto-fire of any kind.
      submitCurrentQuestion("enter_key");
    }
  }, [
    submitCurrentQuestion,
    interimText,
  ]);

  useEffect(() => {
    window.addEventListener("keydown", handleTranscriptKeyDown);
    return () => window.removeEventListener("keydown", handleTranscriptKeyDown);
  }, [handleTranscriptKeyDown]);

  // Ctrl+Shift+D toggles the debug panel
  // Ctrl+Shift+O toggles the reading pane overlay
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "D") {
        e.preventDefault();
        setShowDebugPanel((v) => !v);
      }
      if (e.ctrlKey && e.shiftKey && e.key === "O") {
        e.preventDefault();
        setShowReadingPane((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!id || !isListening) return;
    const timer = setInterval(() => {
      const now = Date.now();
      let draft = (questionDraftRef.current.trim() || interimText.trim()).trim();
      if (!draft) return;
      const stable = now - stableSinceTsRef.current >= STABLE_MS;
      if (!stable) return;

      // If the draft ends mid-sentence (dangling preposition/article/conjunction) OR looks
      // like a sentence tail ("one over the other", "into your application"), prefer the
      // last finalized segment so speculative starts with a complete question.
      const draftEndsIncomplete =
        /\b(with|on|for|to|of|at|by|from|or|that|a|an|the|is|are|was|have|has)\s*$/i.test(draft)
        || /\b(one over the other|into your application|in your application|in your project|over the other|each other|one another|than the other)\s*$/i.test(draft);
      const latestFinalForSpec = segmentsRef.current[0]?.trim();
      if (draftEndsIncomplete && latestFinalForSpec && latestFinalForSpec.split(/\s+/).filter(Boolean).length > draft.split(/\s+/).filter(Boolean).length) {
        draft = latestFinalForSpec;
      }

      const wordCount = draft.split(/\s+/).filter(Boolean).length;
      if (wordCount < 3) return;
      if (isLikelyNoiseSegment(draft)) return;
      const advanced = detectQuestionAdvanced(draft);
      const looksQuestionLike =
        advanced.confidence >= 0.45
        || detectQuestion(draft)
        || /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|is|are|tell|walk|explain)\b/i.test(draft);
      if (!looksQuestionLike) return;
      const normalizedDraft = normalizeQuestionForSimilarity(draft);
      if (!normalizedDraft) return;
      const existing = speculativePrepareRef.current;
      if (existing && existing.norm === normalizedDraft && (now - existing.ts) <= SPECULATIVE_WINDOW_MS) return;
      void warmSpeculativeAnswerPath(draft);
    }, 250);
    return () => clearInterval(timer);
  }, [id, isListening, interimText, warmSpeculativeAnswerPath, isLikelyNoiseSegment, STABLE_MS]);

  useEffect(() => {
    if (ENTER_ONLY_ANSWER_MODE) return;
    if (!isListening || !autoAnswerEnabled) return;
    if (!transcriptSegments[0]) return;
    // If handleFinalTurn already has a debounce pending (multi-question accumulation mode),
    // skip this effect-based trigger entirely — the debounce will fire with all questions.
    if (autoTriggerDebounceRef.current) return;
    void triggerQuestionExtraction("final");
  }, [transcriptSegments, isListening, autoAnswerEnabled, triggerQuestionExtraction, ENTER_ONLY_ANSWER_MODE]);

  useEffect(() => {
    return () => {
      clearFirstChunkWatchdog();
      clearStreamingRenderTimer();
      recognitionAlive.current = false;
      systemAudioAlive.current = false;
      if (azureRecognizerRef.current) {
        azureRecognizerRef.current.stop();
        azureRecognizerRef.current = null;
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (e) {}
        recognitionRef.current = null;
      }
      if (mediaRecorderRef.current) {
        try { mediaRecorderRef.current.stop(); } catch (e) {}
        mediaRecorderRef.current = null;
      }
      if (systemAudioStreamRef.current) {
        systemAudioStreamRef.current.getTracks().forEach(t => t.stop());
        systemAudioStreamRef.current = null;
      }
      if (displayCaptureStreamRef.current) {
        displayCaptureStreamRef.current.getTracks().forEach(t => t.stop());
        displayCaptureStreamRef.current = null;
      }
      if (visionCaptureStreamRef.current) {
        visionCaptureStreamRef.current.getTracks().forEach((track) => track.stop());
        visionCaptureStreamRef.current = null;
      }
      (window as ScreenShareWindow).__zoommateVisionStream = null;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioContextRef.current) {
        try { audioContextRef.current.close(); } catch (e) {}
      }
      if (transcriptPersistTimerRef.current) {
        clearTimeout(transcriptPersistTimerRef.current);
        transcriptPersistTimerRef.current = null;
      }
      void flushTranscriptPersistQueue();
    };
  }, []);

  const handleDeepRerun = useCallback((question: string) => {
    const deepModel = "gpt-5";
    updateStatusMutation.mutate({ model: deepModel });
    setSelectedModel(deepModel);
    askStreamingQuestion(question);
  }, [askStreamingQuestion]);

  const handleCopilotAsk = () => {
    console.log("[submit] send icon clicked");
    submitCurrentQuestion("send_icon");
  };

  // Retry: re-sends the last interpreted question
  const handleRetry = useCallback(() => {
    const q = interpretedQuestionRef.current || streamingQuestionRef.current;
    if (!q || isStreaming) return;
    askStreamingQuestion(q);
  }, [askStreamingQuestion, isStreaming]);

  const handlePopOutOverlay = useCallback(async () => {
    // Use Document Picture-in-Picture API — stays on top of ALL windows/tabs/apps
    const pip = (window as any).documentPictureInPicture;
    if (pip) {
      try {
        const pipWin: Window = await pip.requestWindow({ width: 460, height: 520 });
        pipWindowRef.current = pipWin;
        pipWin.document.documentElement.style.background = "rgba(10,10,15,0.97)";
        pipWin.document.body.style.margin = "0";
        renderPipContent(pipWin, {
          question: streamingQuestion || interpretedQuestion || "",
          answer: streamingAnswer || pendingResponse?.answer || responsesLocal[0]?.answer || "",
          statusLabel: isDetectionPaused ? "PAUSED" : isAwaitingFirstChunk ? "THINKING" : isStreaming ? "ANSWERING" : "READY",
          answerStyle,
          isStreaming,
        });
        pipWin.addEventListener("pagehide", () => { pipWindowRef.current = null; });
        setShowReadingPane(false);
        return;
      } catch {
        // fall through to popup fallback
      }
    }
    // Fallback: regular popup window
    const popup = window.open(
      "/overlay",
      "acemate-overlay",
      "width=460,height=540,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no",
    );
    if (!popup) {
      toast({
        title: "Popup blocked",
        description: "Allow popups for this site in your browser settings, then try again.",
        variant: "destructive",
      });
      return;
    }
    setShowReadingPane(false);
  }, [toast, renderPipContent, streamingQuestion, interpretedQuestion, streamingAnswer, pendingResponse, responsesLocal, isDetectionPaused, isAwaitingFirstChunk, isStreaming, answerStyle]);

  // Pause/resume: toggles auto-answer detection without stopping STT
  const handleTogglePause = useCallback(() => {
    setIsDetectionPaused((v) => {
      const next = !v;
      setAutoAnswerEnabled(!next);
      setDebugMeta((prev) => ({ ...prev, sessionState: next ? "paused" : interviewStateRef.current }));
      return next;
    });
  }, []);

  const buildScreenAnalysisContext = useCallback(() => {
    const interpreted = interpretedQuestionRef.current.trim();
    const streamQuestion = streamingQuestionRef.current.trim();
    const latestQuestion = interpreted || streamQuestion || recentQuestions[0] || "";
    const latestQuestionLooksCodeRelated =
      isCodeRequestQuestion(latestQuestion)
      || isExplainFollowup(latestQuestion)
      || wantsLineByLineExplanation(latestQuestion)
      || isModifyCodeFollowup(latestQuestion);
    const shouldUseCodingCapturePrompt =
      (meeting as any)?.sessionMode === "coding"
      || latestQuestionLooksCodeRelated
      || !(meeting as any)?.sessionMode  // default to coding prompt when no session mode set
      || (meeting as any)?.sessionMode === "screenshare"; // screenshare almost always has code
    const displayQuestion = (meeting as any)?.sessionMode === "coding"
      ? "Screen Capture Analysis"
      : (latestQuestion || "Screen Capture Analysis");

    if (shouldUseCodingCapturePrompt) {
      return {
        displayQuestion,
        promptQuestion: [
        "This is a live coding interview screen.",
        "Ignore live transcript for capture analysis. Infer the required answer from the visible coding problem statement, code, editor, examples, constraints, and edits on screen.",
        "Focus on the current visible code and problem statement.",
        "Base the answer primarily on the current captured screen, not on older captures or earlier answers.",
        "Trust the visible screen as the source of truth.",
        "Treat the latest captured code as the source of truth.",
        "Write the explanation in first person, as if I am saying it in the interview.",
        "If the visible screen shows updated requirements or modified code, answer the updated version shown on screen.",
        "OUTPUT FORMAT (follow this order every time):",
        "1. Explanation first (2-3 sentences): Start with a plain-text explanation of the approach or what changed ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â in first person. Never start with a code block.",
        "2. Code block: Provide the complete solution or updated code in a fenced code block.",
        "3. What changed (for follow-ups/modifications): After the code block, add a short 'What changed:' section listing each modified line or block and exactly why it was changed.",
        "4. Complexity: One short line on time/space complexity when relevant.",
        "If the interviewer asks about a specific line or block, quote that line and explain why it is used.",
        "If the interviewer asks to modify, fix, optimize, or update code, list every changed line in 'What changed:' with a clear reason.",
        "Keep the response short and directly usable.",
        "Do not give generic interview coaching, planning bullets, or meta-advice unless the screen truly lacks enough code/problem detail to solve.",
      ].filter(Boolean).join("\n"),
      };
    }
    const explanationFirstSuffix = [
      "OUTPUT FORMAT (always follow this order):",
      "1. Explanation first (2-3 sentences): plain-text explanation of the approach, algorithm, or what is on screen ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â in first person. NEVER start with a code block.",
      "2. Code block: complete solution or relevant code in a fenced code block (e.g. ```python).",
      "3. What changed (for modifications): list each changed line and why.",
      "4. Complexity: one line on time/space complexity when relevant.",
    ].join("\n");

    if ((meeting as any)?.sessionMode === "screenshare") {
      return {
        displayQuestion,
        promptQuestion: [
          latestQuestion
            ? `Analyze what is on the screen and help me respond. Current interviewer question: ${latestQuestion}`
            : "Analyze what is on the screen and help me respond.",
          "Base the answer on the current captured screen only.",
          explanationFirstSuffix,
        ].join("\n"),
      };
    }
    return {
      displayQuestion,
      promptQuestion: [
        latestQuestion
          ? `Analyze this screen and help me respond. Current interviewer question: ${latestQuestion}`
          : "Analyze this screen and help me respond.",
        "Base the answer on the current captured screen only.",
        explanationFirstSuffix,
      ].join("\n"),
    };
  }, [meeting, recentQuestions, isCodeRequestQuestion, isExplainFollowup, wantsLineByLineExplanation, isModifyCodeFollowup]);

  const stopVisionScreenShare = useCallback(() => {
    const stream = getLiveVisionStream();
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    syncVisionStreamState(null);
  }, [getLiveVisionStream, syncVisionStreamState]);

  const startVisionScreenShare = useCallback(async () => {
    const existingStream = getLiveVisionStream();
    const existingTrack = existingStream?.getVideoTracks?.()[0];
    if (existingStream && existingTrack && existingTrack.readyState === "live") {
      syncVisionStreamState(existingStream);
      return;
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.onended = () => {
        const current = visionCaptureStreamRef.current || (window as ScreenShareWindow).__zoommateVisionStream || null;
        if (current === stream) {
          syncVisionStreamState(null);
        }
      };
    }
    syncVisionStreamState(stream);
  }, [getLiveVisionStream, syncVisionStreamState]);

  const captureSharedFrame = useCallback(async (): Promise<string> => {
    const stream = getLiveVisionStream();
    if (!stream) {
      throw new Error("Share a screen first");
    }

    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) {
      throw new Error("No active shared screen found");
    }

    const ImageCaptureCtor = (window as WindowWithImageCapture).ImageCapture;
    if (ImageCaptureCtor) {
      try {
        const imageCapture = new ImageCaptureCtor(videoTrack);
        const bitmap = await imageCapture.grabFrame();
        const sourceWidth = bitmap.width || 1280;
        const sourceHeight = bitmap.height || 720;
        const scale = Math.min(1, SCREEN_CAPTURE_MAX_WIDTH / Math.max(sourceWidth, 1));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(sourceWidth * scale));
        canvas.height = Math.max(1, Math.round(sourceHeight * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Failed to prepare capture canvas");
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", SCREEN_CAPTURE_JPEG_QUALITY);
      } catch {
        // Fallback to video->canvas path below.
      }
    }
    const video = await ensureSharedScreenVideoReady();
    await waitForFreshSharedScreenFrame(video);

    const settings = videoTrack.getSettings();
    const sourceWidth = Number(settings.width) || video.videoWidth || 1280;
    const sourceHeight = Number(settings.height) || video.videoHeight || 720;
    const scale = Math.min(1, SCREEN_CAPTURE_MAX_WIDTH / Math.max(sourceWidth, 1));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to prepare capture canvas");
    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", SCREEN_CAPTURE_JPEG_QUALITY);
  }, [ensureSharedScreenVideoReady, getLiveVisionStream, waitForFreshSharedScreenFrame]);

  const refreshScreenThumbnail = useCallback(async () => {
    const stream = getLiveVisionStream();
    if (!stream) return;
    try {
      const image = await captureSharedFrame();
      setScreenShareThumbnail(image);
    } catch {
      // Ignore preview refresh errors; capture action will surface them when needed.
    }
  }, [captureSharedFrame, getLiveVisionStream]);

  useEffect(() => {
    if (!isScreenShareReady || screenShareThumbnail) return;
    const timer = window.setTimeout(() => {
      void refreshScreenThumbnail();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [isScreenShareReady, refreshScreenThumbnail, screenShareThumbnail]);

  const submitScreenAnalysis = useCallback(async (image: string) => {
    if (!id) return;
    setIsScreenAnalyzing(true);
    const captureTs = Date.now();
    const { promptQuestion, displayQuestion } = buildScreenAnalysisContext();

    // Optimistically add a streaming placeholder response
    const placeholderId = `screen-stream-${captureTs}`;
    const placeholder: any = {
      id: placeholderId,
      question: displayQuestion,
      answer: "",
      responseType: "screen-analysis",
      createdAt: new Date().toISOString(),
      _streaming: true,
    };
    setResponsesLocal((prev) => [placeholder, ...prev]);
    highlightAndScrollResponse(placeholderId);

    try {
      const res = await fetch(`/api/meetings/${id}/analyze-screen-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          image,
          question: promptQuestion,
          displayQuestion,
          liveTranscript: segmentsRef.current.slice().reverse().join("\n") || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Screen analysis failed" }));
        throw new Error(err.message || "Screen analysis failed");
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamedAnswer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) continue;
          if (trimmed.startsWith("data: ")) {
            try {
              const json = JSON.parse(trimmed.slice(6));
              if (json.chunk) {
                streamedAnswer += json.chunk;
                setResponsesLocal((prev) =>
                  prev.map((r) => r.id === placeholderId ? { ...r, answer: streamedAnswer } : r)
                );
              } else if (json.response) {
                const serverResponse = json.response;
                const normalizedResponse = ((meeting as any)?.sessionMode === "coding")
                  ? { ...serverResponse, question: displayQuestion }
                  : serverResponse;
                if (
                  latestScreenContextRef.current &&
                  latestScreenContextRef.current.capturedAt <= captureTs
                ) {
                  previousScreenContextRef.current = latestScreenContextRef.current;
                }
                latestScreenContextRef.current = {
                  displayQuestion: String(normalizedResponse.question || displayQuestion || "Screen Capture Analysis"),
                  promptQuestion,
                  answer: String(normalizedResponse.answer || streamedAnswer),
                  capturedAt: normalizedResponse.createdAt ? new Date(normalizedResponse.createdAt).getTime() : captureTs,
                };
                setResponsesLocal((prev) => {
                  const without = prev.filter((r) => r.id !== placeholderId && r.id !== normalizedResponse.id);
                  const next = [{ ...normalizedResponse, _streaming: false }, ...without];
                  return next.sort((a: any, b: any) => {
                    const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    return bt - at;
                  });
                });
                queryClient.invalidateQueries({ queryKey: ["/api/meetings", id, "responses"] });
                highlightAndScrollResponse(normalizedResponse.id);
              } else if (json.message) {
                throw new Error(json.message);
              }
            } catch (parseErr: any) {
              if (parseErr?.message && !parseErr.message.includes("JSON")) throw parseErr;
            }
          }
        }
      }
      toast({ title: "Screen analyzed" });
    } catch (error: any) {
      setResponsesLocal((prev) => prev.filter((r) => r.id !== placeholderId));
      toast({
        title: "Screen analysis failed",
        description: error?.message || "Could not analyze the selected screen",
        variant: "destructive",
      });
    } finally {
      setIsScreenAnalyzing(false);
    }
  }, [buildScreenAnalysisContext, highlightAndScrollResponse, id, meeting, toast]);

  const handleAddToMultiCapture = useCallback(async () => {
    if (!isScreenShareReady) {
      toast({ title: "Share your screen first", variant: "destructive" });
      return;
    }
    try {
      const liveStream = getLiveVisionStream();
      if (!liveStream) {
        toast({ title: "No screen share active", variant: "destructive" });
        return;
      }
      syncVisionStreamState(liveStream);
      const image = await captureSharedFrame();
      setMultiCaptureQueue((prev) => {
        if (prev.length >= 6) {
          toast({ title: "Max 6 captures", description: "Analyze or clear before adding more." });
          return prev;
        }
        toast({ title: `Capture ${prev.length + 1} added`, description: `${prev.length + 1} screenshot${prev.length + 1 > 1 ? "s" : ""} queued — add more or click Analyze All` });
        return [...prev, image];
      });
    } catch (error: any) {
      toast({ title: "Capture failed", description: error?.message, variant: "destructive" });
    }
  }, [captureSharedFrame, getLiveVisionStream, isScreenShareReady, syncVisionStreamState, toast]);

  const submitMultiScreenAnalysis = useCallback(async () => {
    if (!id || multiCaptureQueue.length === 0) return;
    setIsMultiAnalyzing(true);
    const captureTs = Date.now();
    const { promptQuestion, displayQuestion } = buildScreenAnalysisContext();
    const effectiveDisplay = `Multi-Screen Analysis (${multiCaptureQueue.length} captures)`;

    const placeholderId = `multi-stream-${captureTs}`;
    const placeholder: any = {
      id: placeholderId,
      question: effectiveDisplay,
      answer: "",
      responseType: "screen-analysis",
      createdAt: new Date().toISOString(),
      _streaming: true,
    };
    setResponsesLocal((prev) => [placeholder, ...prev]);
    highlightAndScrollResponse(placeholderId);
    const queueSnapshot = [...multiCaptureQueue];
    setMultiCaptureQueue([]);

    try {
      const res = await fetch(`/api/meetings/${id}/analyze-multi-screen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          images: queueSnapshot,
          question: promptQuestion,
          displayQuestion: effectiveDisplay,
          liveTranscript: segmentsRef.current.slice().reverse().join("\n") || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Multi-screen analysis failed" }));
        throw new Error(err.message || "Multi-screen analysis failed");
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamedAnswer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) continue;
          if (trimmed.startsWith("data: ")) {
            try {
              const json = JSON.parse(trimmed.slice(6));
              if (json.chunk) {
                streamedAnswer += json.chunk;
                setResponsesLocal((prev) =>
                  prev.map((r) => r.id === placeholderId ? { ...r, answer: streamedAnswer } : r)
                );
              } else if (json.response) {
                const serverResponse = json.response;
                latestScreenContextRef.current = {
                  displayQuestion: effectiveDisplay,
                  promptQuestion,
                  answer: String(serverResponse.answer || streamedAnswer),
                  capturedAt: serverResponse.createdAt ? new Date(serverResponse.createdAt).getTime() : captureTs,
                };
                setResponsesLocal((prev) => {
                  const without = prev.filter((r) => r.id !== placeholderId && r.id !== serverResponse.id);
                  return [{ ...serverResponse, _streaming: false }, ...without].sort((a: any, b: any) => {
                    const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    return bt - at;
                  });
                });
                queryClient.invalidateQueries({ queryKey: ["/api/meetings", id, "responses"] });
                highlightAndScrollResponse(serverResponse.id);
              } else if (json.message) {
                throw new Error(json.message);
              }
            } catch (parseErr: any) {
              if (parseErr?.message && !parseErr.message.includes("JSON")) throw parseErr;
            }
          }
        }
      }
      toast({ title: `${queueSnapshot.length} screens analyzed` });
    } catch (error: any) {
      setResponsesLocal((prev) => prev.filter((r) => r.id !== placeholderId));
      toast({ title: "Multi-screen analysis failed", description: error?.message, variant: "destructive" });
    } finally {
      setIsMultiAnalyzing(false);
    }
  }, [buildScreenAnalysisContext, highlightAndScrollResponse, id, multiCaptureQueue, toast]);

  const handleStartScreenShare = useCallback(async () => {
    try {
      await startVisionScreenShare();
      window.setTimeout(() => {
        void refreshScreenThumbnail();
      }, 300);
      toast({ title: "Screen sharing ready" });
    } catch (error: any) {
      if (error?.name === "NotAllowedError") {
        toast({ title: "Screen share cancelled", description: "Choose a screen or tab to enable capture.", variant: "destructive" });
        return;
      }
      toast({
        title: "Screen share failed",
        description: error?.message || "Could not start screen sharing",
        variant: "destructive",
      });
    }
  }, [refreshScreenThumbnail, startVisionScreenShare, toast]);

  const handleScreenCapture = useCallback(async () => {
    try {
      const liveStream = getLiveVisionStream();
      if (!liveStream) {
        toast({
          title: "Share screen first",
          description: "Click Share Screen once, choose the tab, then use Capture to analyze it.",
          variant: "destructive",
        });
        return;
      }

      syncVisionStreamState(liveStream);
      const image = await captureSharedFrame();
      setScreenShareThumbnail(image);
      await submitScreenAnalysis(image);
    } catch (error: any) {
      if (error?.name === "NotAllowedError") {
        toast({ title: "Screen capture cancelled", description: "Choose a screen or tab to capture.", variant: "destructive" });
        return;
      }
      toast({
        title: "Screen capture failed",
        description: error?.message || "Could not capture the shared screen",
        variant: "destructive",
      });
    }
  }, [captureSharedFrame, getLiveVisionStream, submitScreenAnalysis, syncVisionStreamState, toast]);

  const handleScreenshotFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please select an image file.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      if (!dataUrl) return;
      setScreenShareThumbnail(dataUrl);
      await submitScreenAnalysis(dataUrl);
    };
    reader.readAsDataURL(file);
  }, [submitScreenAnalysis, toast]);

  const handleScreenshotUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleScreenshotFile(file);
    e.target.value = "";
  }, [handleScreenshotFile]);

  // Ctrl+V / Cmd+V paste support ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â paste a screenshot from clipboard
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items || []);
      const imageItem = items.find((item) => item.type.startsWith("image/"));
      if (!imageItem) return;
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (file) await handleScreenshotFile(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handleScreenshotFile]);

  const handleToggleScreenPreviewPopup = useCallback(() => {
    const existing = screenPreviewPopupRef.current;
    if (existing && !existing.closed) {
      existing.close();
      screenPreviewPopupRef.current = null;
      setIsScreenPreviewPopupOpen(false);
      return;
    }

    const popup = window.open("", "zoommate-screen-preview", "width=960,height=640,resizable=yes,scrollbars=no");
    if (!popup) {
      toast({
        title: "Popup blocked",
        description: "Allow popups for this site to open the detachable screen preview.",
        variant: "destructive",
      });
      return;
    }

    popup.document.title = "Zoom Mate Screen Preview";
    popup.document.body.innerHTML = "";
    popup.document.body.style.margin = "0";
    popup.document.body.style.background = "#0b0f19";
    popup.document.body.style.display = "flex";
    popup.document.body.style.flexDirection = "column";
    popup.document.body.style.height = "100vh";

    const header = popup.document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.padding = "10px 14px";
    header.style.color = "#e5e7eb";
    header.style.fontFamily = "ui-sans-serif, system-ui, sans-serif";
    header.style.fontSize = "14px";
    header.style.borderBottom = "1px solid rgba(255,255,255,0.08)";

    const label = popup.document.createElement("div");
    label.textContent = screenShareLabel || "Shared screen live preview";
    label.style.overflow = "hidden";
    label.style.textOverflow = "ellipsis";
    label.style.whiteSpace = "nowrap";

    const closeButton = popup.document.createElement("button");
    closeButton.textContent = "Close";
    closeButton.style.background = "#2563eb";
    closeButton.style.color = "#fff";
    closeButton.style.border = "0";
    closeButton.style.borderRadius = "8px";
    closeButton.style.padding = "6px 10px";
    closeButton.style.cursor = "pointer";
    closeButton.onclick = () => popup.close();

    header.appendChild(label);
    header.appendChild(closeButton);

    const video = popup.document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.controls = false;
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.objectFit = "contain";
    video.style.background = "#000";
    video.style.flex = "1";

    popup.document.body.appendChild(header);
    popup.document.body.appendChild(video);
    (popup as ScreenPreviewPopupWindow).__zoommatePreviewVideo = video;
    (popup as ScreenPreviewPopupWindow).__zoommatePreviewLabel = label;
    popup.onbeforeunload = () => {
      if (screenPreviewPopupRef.current === popup) {
        screenPreviewPopupRef.current = null;
        setIsScreenPreviewPopupOpen(false);
      }
    };

    screenPreviewPopupRef.current = popup as ScreenPreviewPopupWindow;
    setIsScreenPreviewPopupOpen(true);
    syncScreenPreviewTargets();
  }, [screenShareLabel, syncScreenPreviewTargets, toast]);

  const copyToClipboard = (text: string, responseId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(responseId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  if (meetingLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 text-center max-w-sm">
          <h2 className="font-bold text-lg mb-2">Session not found</h2>
          <p className="text-sm text-muted-foreground mb-4">This session doesn't exist or has been deleted.</p>
          <Link href="/dashboard">
            <Button>Back to Dashboard</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const debugPanelData: DebugPanelData = {
    sttMode: audioMode,
    sttProvider,
    sttStatus,
    lastPartial: interimText,
    lastFinal: transcriptSegments[0] || "",
    questionConf: typeof debugMeta.questionConf === "number" ? debugMeta.questionConf : null,
    ragChunks: typeof debugMeta.ragChunks === "number" ? debugMeta.ragChunks : null,
    model: debugMeta.model || selectedModel,
    provider: debugMeta.provider || "",
    tier: debugMeta.tier || "",
    maxTokens: typeof debugMeta.maxTokens === "number" ? debugMeta.maxTokens : null,
    ttfb: typeof debugMeta.ttfb === "number" ? debugMeta.ttfb : null,
    totalLatency: typeof debugMeta.totalLatency === "number" ? debugMeta.totalLatency : null,
    sessionState: interviewStateRef.current,
    answerStyle: debugMeta.answerStyle || answerStyle,
    isStreaming,
    isDualStream: !!azureMicShadowRef.current,
  };

  if (showSessionEndedScreen) {
    const hrs = Math.floor(sessionEndedSeconds / 3600);
    const mins = Math.floor((sessionEndedSeconds % 3600) / 60);
    const secs = sessionEndedSeconds % 60;
    const durationStr = `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm flex flex-col items-center gap-6">
          <div className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center">
            <CheckCircle className="w-9 h-9 text-white" />
          </div>
          <div className="text-center">
            <h2 className="text-xl font-bold">Session Ended</h2>
            <p className="text-sm text-muted-foreground mt-1">Your session has been ended.</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Duration</p>
            <p className="text-2xl font-mono font-semibold text-primary mt-1">{durationStr}</p>
          </div>
          <div className="w-full border-t" />
          <div className="w-full space-y-4">
            <h3 className="text-sm font-semibold text-center">How was your session?</h3>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Rating:</p>
              <div className="flex gap-1">
                {[1,2,3,4,5].map((star) => (
                  <button key={star} onClick={() => setSessionRating(star)} className="p-0.5">
                    <Star className={`w-6 h-6 ${star <= sessionRating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Feedback (optional):</p>
              <textarea
                className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none h-24 focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="Share your thoughts about this session..."
                value={sessionFeedback}
                onChange={(e) => setSessionFeedback(e.target.value)}
              />
            </div>
            {feedbackSubmitted ? (
              <p className="text-xs text-center text-green-600 font-medium">Thanks for your feedback!</p>
            ) : (
              <Button
                className="w-full"
                onClick={() => setFeedbackSubmitted(true)}
              >
                Submit Feedback
              </Button>
            )}
          </div>
          <div className="w-full mt-2">
            <Button
              variant="outline"
              className="w-full border-red-400 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 flex items-center gap-2"
              onClick={() => setLocation("/dashboard")}
            >
              <XCircle className="w-4 h-4" />
              Leave Space
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-background flex flex-col">
      {showDebugPanel && (
        <DebugPanel data={debugPanelData} onClose={() => setShowDebugPanel(false)} />
      )}
      {showReadingPane && (
        <ReadingPane
          question={streamingQuestion || interpretedQuestion || ""}
          answer={streamingAnswer || pendingResponse?.answer || responsesLocal[0]?.answer || ""}
          isStreaming={isStreaming}
          isAwaitingFirstChunk={isAwaitingFirstChunk}
          isPaused={isDetectionPaused}
          answerStyle={answerStyle}
          onPause={handleTogglePause}
          onResume={handleTogglePause}
          onRetry={handleRetry}
          onSetStyle={(s) => { setAnswerStyle(s); }}
          onClose={() => setShowReadingPane(false)}
          onPopOut={handlePopOutOverlay}
        />
      )}
      {false ? (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="w-full max-w-md space-y-4 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/5 flex items-center justify-center mx-auto mb-2">
              <Sparkles className="w-8 h-8 text-primary/30" />
            </div>
            <h2 className="text-lg font-semibold" data-testid="text-ready-title">Start Listening</h2>
            <p className="text-sm text-muted-foreground">Choose how you want to capture audio, then Zoom Mate will transcribe and answer automatically.</p>
            <div className="flex flex-col gap-3 mt-6">
              <Button
                onClick={startMicListening}
                className="w-full"
                data-testid="button-listen-mic"
              >
                <Mic className="w-4 h-4 mr-2" />
                Start Microphone
              </Button>
              <Button
                onClick={startSystemAudioListening}
                variant="outline"
                className="w-full"
                data-testid="button-listen-system"
              >
                <Monitor className="w-4 h-4 mr-2" />
                System Audio (Zoom/Teams)
              </Button>
              <p className="text-[11px] text-muted-foreground text-center leading-snug mt-1">
                A browser tab-share prompt will appear - select the tab running your interview call to capture interviewer audio.
              </p>
            </div>
            <div className="mt-4">
              <label className="text-xs text-muted-foreground block mb-1.5">Speech Language</label>
              <select
                value={sttLanguage}
                onChange={(e) => {
                  setSttLanguage(e.target.value);
                  localStorage.setItem("zoommate-stt-lang", e.target.value);
                }}
                className="w-full text-sm bg-background border rounded-md px-3 py-1.5"
                data-testid="select-stt-language"
              >
                <option value="en-US">English (US)</option>
                <option value="en-GB">English (UK)</option>
                <option value="en-IN">English (India)</option>
                <option value="en-AU">English (Australia)</option>
                <option value="hi-IN">Hindi</option>
                <option value="es-ES">Spanish</option>
                <option value="fr-FR">French</option>
                <option value="de-DE">German</option>
                <option value="zh-CN">Chinese (Mandarin)</option>
                <option value="ja-JP">Japanese</option>
                <option value="ko-KR">Korean</option>
                <option value="pt-BR">Portuguese (Brazil)</option>
                <option value="ar-SA">Arabic</option>
                <option value="te-IN">Telugu</option>
                <option value="ta-IN">Tamil</option>
                <option value="bn-IN">Bengali</option>
                <option value="mr-IN">Marathi</option>
                <option value="gu-IN">Gujarati</option>
                <option value="kn-IN">Kannada</option>
                <option value="ml-IN">Malayalam</option>
              </select>
            </div>
            <div className="mt-3">
              <label className="text-xs text-muted-foreground block mb-1.5">Transcription Engine</label>
              <select
                value={sttProvider}
                onChange={(e) => {
                  const val = e.target.value as "azure" | "browser";
                  setSttProvider(val);
                  localStorage.setItem("zoommate-stt-engine", val);
                }}
                className="w-full text-sm bg-background border rounded-md px-3 py-1.5"
                data-testid="select-stt-provider"
              >
                {azureAvailable && <option value="azure">Azure Speech (recommended)</option>}
                <option value="browser">Browser Speech API</option>
              </select>
              {sttProvider === "azure" && (
                <p className="text-xs text-emerald-500 mt-1 flex items-center gap-1">
                  <Cloud className="w-3 h-3" /> Azure Speech active - smooth real-time partials + finals
                </p>
              )}
              {sttProvider === "browser" && (
                <p className="text-xs text-muted-foreground mt-1">Browser Web Speech API - Chrome only, instant but may restart</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              {sttProvider === "azure"
                ? "Azure Speech provides smooth real-time transcription with partial updates for both microphone and system audio."
                : <>
                    <strong>Microphone</strong> uses browser speech recognition for real-time results (Chrome best). <strong>System Audio</strong> live mode requires Azure Speech.
                  </>
              }
            </p>
            <p className="text-[11px] text-amber-600 mt-1">
              Mic mode cannot reliably auto-detect interviewer questions. Use System Audio for accurate question detection.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="border-b px-4 py-1.5 flex items-center justify-end shrink-0 gap-2">
            <Button
              variant={showReadingPane ? "default" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowReadingPane((v) => !v)}
              title="Toggle reading overlay (Ctrl+Shift+O)"
            >
              <Eye className="w-3 h-3 mr-1" /> Overlay
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={endSession} data-testid="button-end-session">
              End Session
            </Button>
          </div>
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div className="w-full h-full flex flex-col lg:flex-row overflow-hidden">
              <div
                className="lg:w-[360px] xl:w-[400px] lg:min-w-[280px] lg:max-w-[640px] shrink-0 border-b lg:border-b-0 lg:border-r flex flex-col lg:resize-x lg:overflow-auto"
                style={{ minHeight: 0 }}
              >
                <div className="px-3 py-2 border-b shrink-0 flex items-center justify-between">
                  <h3 className="text-xs font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wider">
                    <Eye className="w-3 h-3" />
                    Live Transcript
                    {isListening && (
                      <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${!hasFullAccess && freeSecondsRemaining !== null && freeSecondsRemaining <= 60 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>
                        {!hasFullAccess && freeSecondsRemaining !== null
                          ? `${formatMmSs(freeSecondsRemaining)} left`
                          : formatMmSs(elapsedSeconds)}
                      </span>
                    )}
                  </h3>
                  {isListening && (
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px] h-4 px-1.5">Listening</Badge>
                    </div>
                  )}
                  {displayTranscriptSegments.length > 0 && (
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{displayTranscriptSegments.length}</Badge>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto px-3 py-2" ref={transcriptScrollRef} style={{ minHeight: 0 }}>
                  {showUpgradeBanner && (
                    <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-center space-y-2">
                      <p className="text-xs font-semibold text-destructive">Free trial ended</p>
                      <p className="text-xs text-muted-foreground">
                        Your 6-minute free session is over.
                        {freeResetSeconds !== null && (
                          <> Free trial resets in {formatMmSs(freeResetSeconds)}.</>
                        )}
                      </p>
                      {lastSessionUsageMinutes !== null && (
                        <p className="text-[11px] font-medium text-foreground/80">
                          You used {lastSessionUsageMinutes} minute{lastSessionUsageMinutes === 1 ? "" : "s"} in the last session.
                        </p>
                      )}
                      <Button size="sm" className="w-full" onClick={() => window.location.href = "/pricing"}>
                        Upgrade for full access
                      </Button>
                      <Button size="sm" variant="ghost" className="w-full text-xs" onClick={() => setShowUpgradeBanner(false)}>
                        Dismiss
                      </Button>
                    </div>
                  )}
                {!isListening && !sessionLaunched && (
                    <div className="mb-3 rounded-lg border bg-card p-4 space-y-4">
                      {/* Header */}
                      <div className="flex items-center gap-2 border-b pb-2">
                        <Zap className="w-4 h-4 text-primary" />
                        <p className="text-sm font-semibold">Session Settings</p>
                      </div>

                      {/* Microphone Access */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium">Microphone Access</p>
                          <span className="text-[10px] bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 px-1.5 py-0.5 rounded font-medium">Required</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground">Allow microphone so Zoommate can capture your interview audio in real time.</p>
                        {micGranted ? (
                          <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 font-medium">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                            Access Granted
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" className="w-full text-xs h-8" onClick={handleRequestMicPermission}>
                            <Mic className="w-3.5 h-3.5 mr-1.5" />
                            Grant Microphone Access
                          </Button>
                        )}
                      </div>

                      {/* Screen Share */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium">Screen Share</p>
                          <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-medium">Optional</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground">Capture audio from Zoom, Teams, or Meet by sharing your screen/tab.</p>
                        <Button size="sm" variant="outline" className="w-full text-xs h-8" onClick={startSystemAudioListening}>
                          <Monitor className="w-3.5 h-3.5 mr-1.5" />
                          Share Screen / Tab Audio
                        </Button>
                      </div>

                      {/* Session Limit */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium">Session Limit</p>
                          {hasFullAccess ? (
                            <span className="text-xs font-semibold text-primary">{sessionLimitMinutes} min</span>
                          ) : (
                            <span className="text-xs font-semibold text-amber-500">6 min</span>
                          )}
                        </div>
                        {hasFullAccess ? (
                          <input
                            type="range"
                            min={5}
                            max={120}
                            step={5}
                            value={sessionLimitMinutes}
                            onChange={(e) => setSessionLimitMinutes(Number(e.target.value))}
                            className="w-full accent-primary"
                          />
                        ) : (
                          <p className="text-[11px] text-muted-foreground">Free trial sessions are fixed at 6 minutes. Upgrade for full access.</p>
                        )}
                      </div>

                      {/* Action Buttons */}
                      <div className="space-y-2 pt-1">
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            className="w-full text-xs h-9 bg-blue-600 hover:bg-blue-700 text-white"
                            onClick={handleStartSession}
                            disabled={!micGranted || !hasFullAccess}
                            data-testid="button-start-session"
                          >
                            <Zap className="w-3.5 h-3.5 mr-1.5" />
                            Start Session
                          </Button>
                          <Button
                            className="w-full text-xs h-9 bg-amber-500 hover:bg-amber-600 text-white"
                            onClick={handleFreeSession}
                            disabled={!micGranted || (freeSecondsRemaining !== null && freeSecondsRemaining <= 0)}
                            data-testid="button-free-session"
                          >
                            <Mic className="w-3.5 h-3.5 mr-1.5" />
                            Free Session
                          </Button>
                        </div>
                        {!hasFullAccess && (
                          <p className="text-[10px] text-center text-muted-foreground">
                            {(freeSecondsRemaining ?? 0) > 0
                              ? `${formatMmSs(360 - (freeSecondsRemaining ?? 0))} used - ${formatMmSs(freeSecondsRemaining ?? 0)} left`
                              : (freeResetSeconds !== null
                                ? `Free trial resets in ${formatMmSs(freeResetSeconds)}`
                                : "Free trial used - upgrade for full access")}
                          </p>
                        )}
                        {lastSessionUsageMinutes !== null && (
                          <p className="text-[10px] text-center text-muted-foreground">
                            Last session used {lastSessionUsageMinutes} minute{lastSessionUsageMinutes === 1 ? "" : "s"}.
                          </p>
                        )}
                        <Button
                          variant="outline"
                          className="w-full text-xs h-8 border-red-400 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20"
                          onClick={() => setLocation("/dashboard")}
                        >
                          Leave Space
                        </Button>
                      </div>
                    </div>
                  )}
                {!isListening && sessionLaunched && (
                    <div className="mb-3 rounded-lg border border-dashed p-3 text-center space-y-2">
                      <p className="text-xs text-muted-foreground" data-testid="text-ready-title">
                        Start listening to capture interviewer audio.
                        {!hasFullAccess && freeSecondsRemaining !== null && (
                          <span className="block mt-1 font-medium text-primary">
                            Free session: {formatMmSs(360 - freeSecondsRemaining)} / 6:00 used
                          </span>
                        )}
                      </p>
                      <div className="flex flex-col gap-2">
                        <Button onClick={startMicListening} className="w-full" data-testid="button-listen-mic">
                          <Mic className="w-4 h-4 mr-2" />
                          Start Microphone
                        </Button>
                        <Button onClick={startSystemAudioListening} variant="outline" className="w-full" data-testid="button-listen-system">
                          <Monitor className="w-4 h-4 mr-2" />
                          System Audio (Zoom/Teams)
                        </Button>
                      </div>
                      <div className="pt-2">
                        <label className="text-xs text-muted-foreground block mb-1.5">Speech Language</label>
                        <select
                          value={sttLanguage}
                          onChange={(e) => {
                            setSttLanguage(e.target.value);
                            localStorage.setItem("zoommate-stt-lang", e.target.value);
                          }}
                          className="w-full text-sm bg-background border rounded-md px-3 py-1.5"
                          data-testid="select-stt-language"
                        >
                          <option value="en-US">English (US)</option>
                          <option value="en-GB">English (UK)</option>
                          <option value="en-IN">English (India)</option>
                          <option value="en-AU">English (Australia)</option>
                          <option value="hi-IN">Hindi</option>
                          <option value="es-ES">Spanish</option>
                          <option value="fr-FR">French</option>
                          <option value="de-DE">German</option>
                          <option value="zh-CN">Chinese (Mandarin)</option>
                          <option value="ja-JP">Japanese</option>
                          <option value="ko-KR">Korean</option>
                          <option value="pt-BR">Portuguese (Brazil)</option>
                          <option value="ar-SA">Arabic</option>
                          <option value="te-IN">Telugu</option>
                          <option value="ta-IN">Tamil</option>
                          <option value="bn-IN">Bengali</option>
                          <option value="mr-IN">Marathi</option>
                          <option value="gu-IN">Gujarati</option>
                          <option value="kn-IN">Kannada</option>
                          <option value="ml-IN">Malayalam</option>
                        </select>
                      </div>
                    </div>
                  )}
                  {displayTranscriptSegments.length > 0 || interimText || stagedTranscriptText || pendingTranscriptLine ? (
                    <div className="space-y-1">
                      {(() => {
                        const activeLiveText = [interimText || stagedTranscriptText]
                          .filter(Boolean)
                          .join(" ")
                          .replace(/\s+/g, " ")
                          .trim();
                        const latestSeg = displayTranscriptSegments[0];
                        const isStaleEcho = !!activeLiveText && !!latestSeg
                          && normalizeForDedup(latestSeg) === normalizeForDedup(activeLiveText);
                        const liveText = isStaleEcho ? "" : activeLiveText;
                        const rows = (liveText
                          ? [liveText, ...displayTranscriptSegments.filter((seg) => normalizeForDedup(seg) !== normalizeForDedup(liveText))]
                          : displayTranscriptSegments).slice(0, 15);
                        return rows.map((seg, i) => {
                          const adv = detectQuestionAdvanced(seg);
                          const isQ = detectQuestion(seg) || (adv.isQuestion && adv.confidence >= 0.5);
                          return (
                            <motion.div
                              key={i === 0 && liveText ? "live-current" : (displayTranscriptSegmentKeys[liveText ? i - 1 : i] || `${seg}-${i}`)}
                              initial={{ opacity: 0, x: -8 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ duration: 0.15 }}
                              className={`text-sm leading-relaxed rounded px-2 py-1 ${isQ ? "text-foreground font-medium bg-primary/8 border-l-2 border-primary" : "text-foreground/80"}`}
                              data-testid={i === 0 && liveText ? "text-segment-live" : `text-segment-${i}`}
                            >
                              {isQ && <MessageSquare className="w-3 h-3 text-primary inline mr-1.5 align-text-bottom" />}
                              {seg}
                            </motion.div>
                          );
                        });
                      })()}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center py-8">
                      <div className="relative mb-3">
                        <Mic className="w-6 h-6 text-muted-foreground/20" />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-8 h-8 rounded-full border border-primary/20 animate-ping" />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {audioMode === "system"
                          ? "Capturing system audio..."
                          : "Listening for speech..."}
                      </p>
                    </div>
                  )}
                </div>

                <div className="p-3 border-t space-y-2 shrink-0">
                  <Button
                    className="w-full h-10 text-sm"
                    variant="secondary"
                    onClick={handleSendTranscript}
                    disabled={isStreaming}
                    data-testid="button-send-transcript"
                  >
                    <Sparkles className="w-3 h-3 mr-1.5" />
                    Generate Answer from Transcript
                  </Button>
                  <div className="flex items-center gap-2">
                  <Button
                    size="icon"
                    className="h-10 w-10 shrink-0"
                    onClick={handleCopilotAsk}
                    disabled={isStreaming}
                    data-testid="button-ask"
                  >
                      {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </Button>
                  </div>
                  <p className="text-center text-xs text-muted-foreground/70">
                    <kbd className="px-1 py-0.5 border rounded font-mono bg-muted text-[10px]">Enter</kbd> to generate answer from live conversation
                  </p>
                </div>
              </div>

              {(meeting as any)?.sessionMode === "coding" && (
                <div
                  className="lg:w-[400px] xl:w-[480px] lg:min-w-[320px] lg:max-w-[760px] shrink-0 border-b lg:border-b-0 lg:border-r flex flex-col lg:resize-x lg:overflow-auto"
                  style={{ minHeight: 0 }}
                >
                  <LiveCodeEditor
                    onAskCode={(code, question) => {
                      const prompt = `\`\`\`${code}\`\`\`\n\n${question}`;
                      askStreamingQuestion(prompt);
                    }}
                    isStreaming={isStreaming}
                  />
                </div>
              )}

              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="shrink-0 border-b px-4 py-1.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">AI Insights</h3>
                    <Button
                      size="sm"
                      variant={isScreenShareReady ? "default" : "outline"}
                      className="h-7 text-xs"
                      onClick={isScreenShareReady ? stopVisionScreenShare : handleStartScreenShare}
                      disabled={isScreenAnalyzing || !isListening}
                      data-testid="button-screen-share"
                    >
                      <Monitor className="w-3 h-3 mr-1.5" />
                      {isScreenShareReady ? "Screen On" : "Share Screen"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={handleScreenCapture}
                      disabled={isStreaming || isScreenAnalyzing || isMultiAnalyzing || !isListening}
                      data-testid="button-screen-capture"
                    >
                      {isScreenAnalyzing ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <ScanSearch className="w-3 h-3 mr-1.5" />}
                      Capture
                    </Button>
                    <div className="relative">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={handleAddToMultiCapture}
                        disabled={isStreaming || isScreenAnalyzing || isMultiAnalyzing || !isListening || !isScreenShareReady}
                        title="Add to multi-capture queue"
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        Add
                      </Button>
                      {multiCaptureQueue.length > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                          {multiCaptureQueue.length}
                        </span>
                      )}
                    </div>
                    {multiCaptureQueue.length > 0 && (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="default"
                          className="h-7 text-xs"
                          onClick={submitMultiScreenAnalysis}
                          disabled={isMultiAnalyzing || isScreenAnalyzing}
                        >
                          {isMultiAnalyzing ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Images className="w-3 h-3 mr-1.5" />}
                          Analyze All ({multiCaptureQueue.length})
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => setMultiCaptureQueue([])}
                          title="Clear queue"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 text-xs"
                      onClick={handleSendTranscript}
                      disabled={isStreaming || !isListening}
                    >
                      <Zap className="w-3 h-3 mr-1.5" />
                      Generate
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setShowResponseHistory((v) => !v)}
                  >
                    {showResponseHistory ? "Hide History" : `View History (${responsesLocal.length})`}
                  </Button>
                </div>
                <div
                  className="flex-1 overflow-y-auto min-h-0 p-3"
                  ref={scrollRef}
                  onScroll={() => {
                    if (!scrollRef.current) return;
                    autoScrollEnabledRef.current = isNearBottom(scrollRef.current);
                  }}
                >
                  {responsesLocal.length > 0 || shouldShowStreamingCard ? (
                    <div className="space-y-3">
                      {shouldShowStreamingCard && (
                        <div data-testid="card-streaming-response">
                          {(streamingAnswer || pendingResponse?.answer) ? (
                            <div>
                              <MarkdownRenderer
                                content={streamingDisplayAsCode
                                  ? enforceCodeOnlyDisplay(streamingDisplayAnswer, streamingDisplayQuestion)
                                  : streamingDisplayAnswer}
                                streaming={isStreaming}
                              />
                              {isStreaming && !isRefining && <span className="stream-cursor" />}
                              {isRefining && (
                                <span className="text-[11px] text-muted-foreground ml-2" style={{ animation: "thinking-pulse 1.4s ease-in-out infinite" }}>refining…</span>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 py-2" data-testid="badge-streaming-status">
                              {[0, 1, 2].map((i) => (
                                <span
                                  key={i}
                                  className="inline-block w-1.5 h-1.5 rounded-full bg-primary/60"
                                  style={{ animation: "thinking-pulse 1.2s ease-in-out infinite", animationDelay: `${i * 0.18}s` }}
                                />
                              ))}
                              <span className="text-xs text-muted-foreground">Generating…</span>
                            </div>
                          )}
                        </div>
                      )}

                      {(showResponseHistory ? responsesLocal.slice(0, 6) : responsesLocal.slice(0, 1))
                        .map((resp) => {
                          const displayAsCode = shouldDisplayAnswerAsCode(resp.question, resp.answer);
                          const content = displayAsCode
                            ? enforceCodeOnlyDisplay(resp.answer, resp.question)
                            : resp.answer;
                          return (
                            <ResponseCard
                              key={resp.id}
                              resp={resp}
                              isHighlighted={highlightResponseId === resp.id}
                              content={content}
                              onMount={handleResponseCardMount}
                            />
                          );
                        })}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center py-12">
                      <div className="w-12 h-12 rounded-full bg-primary/5 flex items-center justify-center mb-3">
                        <Sparkles className="w-6 h-6 text-primary/20" />
                      </div>
                      <p className="text-xs text-muted-foreground max-w-[200px]" data-testid="text-ready-state">
                        Press Enter to answer the latest interviewer question
                      </p>
                    </div>
                  )}
                </div>
                {/* ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Manual type-and-send box ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ */}
                <div className="shrink-0 border-t px-3 py-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={manualTypeText}
                    onChange={(e) => setManualTypeText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && manualTypeText.trim() && !isStreaming) {
                        e.preventDefault();
                        submitExplicitQuestion(manualTypeText.trim());
                        setManualTypeText("");
                      }
                    }}
                    placeholder="Type a question and press Enter..."
                    disabled={isStreaming}
                    className="flex-1 h-8 rounded-md border border-input bg-background px-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                  />
                  <Button
                    size="sm"
                    className="h-8 px-3"
                    disabled={isStreaming || !manualTypeText.trim()}
                    onClick={() => {
                      if (!manualTypeText.trim()) return;
                      submitExplicitQuestion(manualTypeText.trim());
                      setManualTypeText("");
                    }}
                  >
                    <Send className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              <div
                className="lg:w-[300px] xl:w-[340px] lg:min-w-[260px] lg:max-w-[560px] shrink-0 border-l flex flex-col lg:resize-x lg:overflow-auto"
                style={{ minHeight: 0 }}
              >
                <div className="px-3 py-2 border-b space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Shared Screen</h3>
                    <div className="flex items-center gap-2">
                      {isScreenShareReady ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={handleToggleScreenPreviewPopup}
                          title={isScreenPreviewPopupOpen ? "Close popup preview" : "Open popup preview"}
                        >
                          {isScreenPreviewPopupOpen ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                        </Button>
                      ) : null}
                      <Badge variant={isScreenShareReady ? "default" : "secondary"} className="text-[10px] h-5 px-1.5">
                        {isScreenShareReady ? "On" : "Off"}
                      </Badge>
                    </div>
                  </div>
                  {screenShareLabel && (
                    <p className="text-[11px] text-muted-foreground truncate" title={screenShareLabel}>
                      {screenShareLabel}
                    </p>
                  )}
                  <div className="rounded-lg overflow-hidden border bg-black/95 aspect-video relative">
                    {isScreenShareReady ? (
                      <video
                        ref={sharedScreenPreviewVideoRef}
                        className="h-full w-full object-contain"
                        muted
                        playsInline
                        autoPlay
                      />
                    ) : null}
                    {!isScreenShareReady && screenShareThumbnail ? (
                      <img
                        src={screenShareThumbnail}
                        alt="Shared screen snapshot"
                        className="h-full w-full object-contain"
                      />
                    ) : null}
                    {!isScreenShareReady && (
                      <div className="absolute inset-0 flex items-center justify-center text-center px-4">
                        <p className="text-xs text-white/70">Share a tab or screen to preview it here.</p>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={isScreenShareReady ? "default" : "outline"}
                      className="h-8 text-xs flex-1"
                      onClick={isScreenShareReady ? stopVisionScreenShare : handleStartScreenShare}
                      disabled={isScreenAnalyzing}
                    >
                      <Monitor className="w-3 h-3 mr-1.5" />
                      {isScreenShareReady ? "Stop Sharing" : "Share Screen"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs flex-1"
                      onClick={handleScreenCapture}
                      disabled={isScreenAnalyzing}
                    >
                      {isScreenAnalyzing ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <ScanSearch className="w-3 h-3 mr-1.5" />}
                      Capture
                    </Button>
                  </div>
                </div>
                <div className="px-3 py-2 border-b">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent Questions</h3>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2" style={{ minHeight: 0 }}>
                  {recentQuestions.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Questions will appear here as you ask them.</p>
                  ) : (
                    recentQuestions.map((text, idx) => (
                      <div
                        key={`${idx}-${text.slice(0, 20)}`}
                        className="flex items-start gap-1 group"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedQuestionFilter(text);
                          }}
                          className={`flex-1 text-left text-xs leading-relaxed transition-colors ${
                            normalizeForDedup(text) === normalizeForDedup(selectedQuestionFilter)
                              ? "text-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {text}
                        </button>
                        <button
                          type="button"
                          title="Re-answer this question"
                          disabled={isStreaming}
                          onClick={() => submitExplicitQuestion(text)}
                          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-primary hover:text-primary/80 disabled:opacity-30 mt-0.5"
                        >
                          <Send className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <div className="border-t px-3 py-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">History</h4>
                </div>
                <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2" style={{ minHeight: 0 }}>
                  {selectedQuestionFilter ? (
                    responsesLocal
                      .filter((resp) => normalizeForDedup(resp.question || "") === normalizeForDedup(selectedQuestionFilter))
                      .map((resp) => (
                        <div key={resp.id} className="text-xs text-muted-foreground leading-relaxed border rounded-md p-2 bg-muted/20">
                          {shouldDisplayAnswerAsCode(resp.question, resp.answer) ? (
                            <MarkdownRenderer content={enforceCodeOnlyDisplay(resp.answer, resp.question)} />
                          ) : (
                            <MarkdownRenderer content={resp.answer} />
                          )}
                        </div>
                      ))
                  ) : (
                    <p className="text-xs text-muted-foreground">Select a question to view its answer history.</p>
                  )}
                </div>
              </div>

              <AnimatePresence>
                {showMemory && (
                  <motion.div
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: 280, opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="border-l flex flex-col overflow-hidden shrink-0"
                    data-testid="memory-panel"
                  >
                    <div className="p-3 border-b flex items-center justify-between gap-2 flex-wrap">
                      <h3 className="text-xs font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wider">
                        <Database className="w-3 h-3" />
                        Memory
                      </h3>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => clearMemoryMutation.mutate()}
                          disabled={clearMemoryMutation.isPending}
                          title="Clear session memory"
                          data-testid="button-clear-memory"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setShowMemory(false)}
                          data-testid="button-close-memory"
                        >
                          <Minimize2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-3" style={{ minHeight: 0 }}>
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5">
                            <Eye className="w-3 h-3" />
                            Save Transcript
                          </span>
                          <Switch
                            checked={meeting?.saveTranscript ?? true}
                            onCheckedChange={(val) => toggleMemoryMutation.mutate({ saveTranscript: val })}
                            disabled={meeting?.incognito}
                            data-testid="toggle-save-transcript"
                          />
                        </label>
                        <label className="text-xs text-muted-foreground flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5">
                            <Brain className="w-3 h-3" />
                            Save Facts
                          </span>
                          <Switch
                            checked={meeting?.saveFacts ?? true}
                            onCheckedChange={(val) => toggleMemoryMutation.mutate({ saveFacts: val })}
                            disabled={meeting?.incognito}
                            data-testid="toggle-save-facts"
                          />
                        </label>
                      </div>

                      {memoryData?.slots && memoryData.slots.length > 0 && (
                        <div className="space-y-1.5">
                          <h4 className="text-xs font-semibold text-muted-foreground">Extracted Facts</h4>
                          {memoryData.slots.map((slot) => (
                            <div
                              key={slot.id}
                              className="p-2 rounded-md border text-xs bg-muted/30"
                              data-testid={`memory-slot-${slot.slotKey}`}
                            >
                              <span className="font-medium capitalize">{slot.slotKey.replace(/_/g, " ")}</span>
                              <p className="text-muted-foreground mt-0.5 break-words">{slot.slotValue}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {memoryData?.rollingSummary && (
                        <div className="space-y-1">
                          <h4 className="text-xs font-semibold text-muted-foreground">Session Summary</h4>
                          <p className="text-xs text-muted-foreground leading-relaxed bg-muted/30 rounded-md p-2">
                            {memoryData.rollingSummary}
                          </p>
                        </div>
                      )}

                      {memoryData && memoryData.slots.length === 0 && !memoryData.rollingSummary && (
                        <div className="text-center py-6">
                          <Database className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
                          <p className="text-xs text-muted-foreground">No memory data yet. Facts will be extracted as questions are answered.</p>
                        </div>
                      )}

                      {!memoryData && (
                        <div className="flex items-center justify-center py-6">
                          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
                          <AnimatePresence>
                                          {showCoaching && (
                          <motion.div initial={{ width: 0, opacity: 0 }} animate={{ width: 280, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="border-l flex flex-col overflow-hidden shrink-0" data-testid="coaching-panel">
                                              <div className="p-3 border-b flex items-center justify-between gap-2">
                                                                    <h3 className="text-xs font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wider"><Sparkles className="w-3 h-3" />Coaching</h3>
                                                                    <Button variant="ghost" size="icon" onClick={() => setShowCoaching(false)} data-testid="button-close-coaching"><Minimize2 className="w-3 h-3" /></Button>
                                                                  </div>
          
                            <div className="flex-1 overflow-y-auto p-3 space-y-4">
                    {coachingMetrics.totalAnswered > 0 && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="p-2 rounded-md border bg-muted/30 text-center">
                            <p className="text-lg font-bold">{coachingMetrics.totalAnswered}</p>
                            <p className="text-xs text-muted-foreground">Answered</p>
                          </div>
                          <div className="p-2 rounded-md border bg-muted/30 text-center">
                            <p className="text-lg font-bold">{Math.round(coachingMetrics.avgResponseMs / 1000)}s</p>
                            <p className="text-xs text-muted-foreground">Avg Response</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="p-2 rounded-md border bg-muted/30 text-center">
                            <p className="text-lg font-bold">{coachingMetrics.starCount}</p>
                            <p className="text-xs text-muted-foreground">Structured</p>
                          </div>
                          <div className="p-2 rounded-md border bg-muted/30 text-center">
                            <p className="text-lg font-bold">{coachingMetrics.bulletCount}</p>
                            <p className="text-xs text-muted-foreground">Bullet Points</p>
                          </div>
                        </div>
                      </div>
                    )}
                    {coachingMetrics.followUpSuggestions.length > 0 && (
                      <div className="space-y-1.5">
                        <h4 className="text-xs font-semibold text-muted-foreground">Follow-up Questions</h4>
                        {coachingMetrics.followUpSuggestions.map((suggestion, i) => (
                          <div
                            key={i}
                            className="p-2 rounded-md border text-xs bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                            onClick={() => askStreamingQuestion(suggestion)}
                            data-testid={`coaching-suggestion-${i}`}
                          >
                            {suggestion}
                          </div>
                        ))}
                      </div>
                    )}
                    {coachingMetrics.totalAnswered === 0 && (
                      <div className="text-center py-6">
                        <Sparkles className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
                        <p className="text-xs text-muted-foreground">Coaching tips will appear as you answer questions.</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    )}
    <video
      ref={sharedScreenVideoRef}
      className="hidden"
      muted
      playsInline
      aria-hidden="true"
    />
  </div>
  );
}
