import { LruTtlCache, type CacheProbe } from "./lruTtl";

type ProviderResolution = {
  provider: "openai" | "gemini";
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  streaming: boolean;
  timeoutMs: number;
};

const settingsCache = new LruTtlCache<string, any>("settingsCache", 1000, 10 * 60 * 1000);
const promptTemplateCache = new LruTtlCache<string, string>("promptTemplateCache", 256, 60 * 60 * 1000);
const providerResolutionCache = new LruTtlCache<string, ProviderResolution>("providerResolutionCache", 1000, 10 * 60 * 1000);
const docRetrievalCache = new LruTtlCache<string, string>("docRetrievalCache", 512, 3 * 60 * 1000);
const conversationSummaryCache = new LruTtlCache<string, string>("conversationSummaryCache", 1000, 5 * 60 * 1000);

export type HotPathCacheName =
  | "settings"
  | "promptTemplate"
  | "providerResolution"
  | "docRetrieval"
  | "conversationSummary";

export type HotPathCacheMetrics = {
  settings: "hit" | "miss";
  promptTemplate: "hit" | "miss";
  providerResolution: "hit" | "miss" | "na";
  docRetrieval: "hit" | "miss" | "skip";
  conversationSummary: "hit" | "miss";
};

export function defaultHotPathMetrics(): HotPathCacheMetrics {
  return {
    settings: "miss",
    promptTemplate: "miss",
    providerResolution: "na",
    docRetrieval: "skip",
    conversationSummary: "miss",
  };
}

export function logHotPathMetrics(requestId: string, scope: string, metrics: HotPathCacheMetrics): void {
  console.log(
    `[cache][${scope}] requestId=${requestId} settings=${metrics.settings} promptTemplate=${metrics.promptTemplate} providerResolution=${metrics.providerResolution} docRetrieval=${metrics.docRetrieval} conversationSummary=${metrics.conversationSummary}`,
  );
}

export async function getOrLoadSettings<T>(
  userId: string,
  sessionId: string,
  loader: () => Promise<T> | T,
): Promise<CacheProbe<T>> {
  const key = `${userId}:${sessionId}`;
  return settingsCache.getOrLoad(key, loader) as Promise<CacheProbe<T>>;
}

export function setSettings<T>(userId: string, sessionId: string, value: T): void {
  settingsCache.set(`${userId}:${sessionId}`, value);
}

export function invalidateSettings(userId: string, sessionId: string): void {
  settingsCache.delete(`${userId}:${sessionId}`);
}

export function getOrLoadPromptTemplate(
  formatMode: string,
  loader: () => string,
): CacheProbe<string> {
  const cached = promptTemplateCache.get(formatMode);
  if (cached !== undefined) {
    return { value: cached, hit: true };
  }
  const value = loader();
  promptTemplateCache.set(formatMode, value);
  return { value, hit: false };
}

export async function getOrLoadProviderResolution(
  userId: string,
  model: string,
  useCase: string,
  loader: () => Promise<ProviderResolution>,
): Promise<CacheProbe<ProviderResolution>> {
  const key = `${userId}:${useCase}:${model}`;
  return providerResolutionCache.getOrLoad(key, loader);
}

export async function getOrLoadDocRetrieval(
  sessionId: string,
  questionFingerprint: string,
  docScope: string,
  loader: () => Promise<string>,
): Promise<CacheProbe<string>> {
  const key = `${sessionId}:${questionFingerprint}:${docScope}`;
  return docRetrievalCache.getOrLoad(key, loader, 3 * 60 * 1000);
}

export function getOrLoadConversationSummary(
  sessionId: string,
  loader: () => string,
): CacheProbe<string> {
  const cached = conversationSummaryCache.get(sessionId);
  if (cached !== undefined) {
    return { value: cached, hit: true };
  }
  const value = loader();
  conversationSummaryCache.set(sessionId, value, 5 * 60 * 1000);
  return { value, hit: false };
}

export function refreshConversationSummary(sessionId: string, summary: string): void {
  conversationSummaryCache.set(sessionId, summary || "", 5 * 60 * 1000);
}

