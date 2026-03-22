import { storage } from "./storage";
import { getPrewarmedOpenAIKey, getGeminiKey, getAvailableModels, isGeminiModel, useMaxCompletionTokens, supportsTemperature } from "./llmRouter";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { LLMUseCase, LLMRouterConfig } from "@shared/schema";
import { analyzeQuestionDepth } from "@shared/questionDetection";
import https from "https";
import { getOrLoadProviderResolution } from "./cache/hotPathCache";

const routerCache = new Map<string, { config: LLMRouterConfig; ts: number }>();
const ROUTER_CACHE_TTL = 5 * 60 * 1000;

const DEFAULT_CONFIGS: Record<string, Partial<LLMRouterConfig>> = {
  QUESTION_CLASSIFIER: { primaryProvider: "openai", primaryModel: "gpt-4o-mini", temperature: 0, maxTokens: 150, streamingEnabled: false, timeoutMs: 5000 },
  QUESTION_NORMALIZER: { primaryProvider: "openai", primaryModel: "gpt-4o-mini", temperature: 0, maxTokens: 200, streamingEnabled: false, timeoutMs: 5000 },
  QUESTION_EXTRACTOR: { primaryProvider: "openai", primaryModel: "gpt-4o-mini", temperature: 0, maxTokens: 250, streamingEnabled: false, timeoutMs: 5000 },
  QUESTION_COMPOSER: { primaryProvider: "openai", primaryModel: "gpt-4o-mini", temperature: 0, maxTokens: 120, streamingEnabled: false, timeoutMs: 5000 },
  LIVE_INTERVIEW_ANSWER: { primaryProvider: "openai", primaryModel: "gpt-4o-mini", temperature: 0.5, maxTokens: 600, streamingEnabled: true, timeoutMs: 30000 },
  SUMMARY_UPDATER: { primaryProvider: "openai", primaryModel: "gpt-4o-mini", temperature: 0, maxTokens: 400, streamingEnabled: false, timeoutMs: 10000 },
  FACT_EXTRACTOR: { primaryProvider: "openai", primaryModel: "gpt-4o-mini", temperature: 0, maxTokens: 500, streamingEnabled: false, timeoutMs: 10000 },
  CODING_ASSIST: { primaryProvider: "openai", primaryModel: "gpt-4o-mini", temperature: 0.3, maxTokens: 900, streamingEnabled: true, timeoutMs: 20000 },
  ADMIN_TEST_PROMPT: { primaryProvider: "openai", primaryModel: "gpt-4o", temperature: 0.5, maxTokens: 1000, streamingEnabled: false, timeoutMs: 30000 },
};

type AnswerRoutingTier = "fast" | "medium" | "large";

function pickAvailableModel(preferred: string[], fallback = "gpt-4o-mini"): string {
  const models = getAvailableModels();
  const available = new Set([...models.openai, ...models.gemini]);
  for (const model of preferred) {
    if (available.has(model)) return model;
  }
  return fallback;
}

function chooseAnswerRoutingTier(
  question: string,
  options?: { sessionMode?: string; multiQuestionCount?: number; isComplexTurn?: boolean },
): AnswerRoutingTier {
  const text = String(question || "").trim();
  const normalized = text.toLowerCase();
  const depth = analyzeQuestionDepth(text);
  const isCoding =
    options?.sessionMode === "coding" ||
    /\b(code|coding|implement|leetcode|hackerrank|algorithm|time complexity|space complexity|refactor|debug|fix this|modify this|line by line)\b/i.test(text);
  const isDeepReasoning =
    /\b(system design|architecture|distributed|scal(e|ing)|trade[- ]?off|fault tolerant|high availability|under the hood|deep dive)\b/i.test(text);
  const isMultiQuestion = (options?.multiQuestionCount || 0) >= 2 || /\b(and also|also|along with|plus)\b/i.test(normalized);

  if (isCoding || isDeepReasoning || depth === "deep" || (options?.isComplexTurn && depth !== "simple")) {
    return "large";
  }
  if (depth === "complex" || depth === "moderate" || isMultiQuestion) {
    return "medium";
  }
  return "fast";
}

export function resolveAutomaticInterviewModel(
  question: string,
  options?: { sessionMode?: string; multiQuestionCount?: number; isComplexTurn?: boolean },
): string {
  const tier = chooseAnswerRoutingTier(question, options);
  // All tiers prefer gpt-4o-mini; fall back to Gemini only if OpenAI key is absent.
  if (tier === "large") {
    return pickAvailableModel(["gpt-4o-mini", "gemini-2.0-flash"]);
  }
  if (tier === "medium") {
    return pickAvailableModel(["gpt-4o-mini", "gemini-2.0-flash"]);
  }
  return pickAvailableModel(["gpt-4o-mini", "gemini-2.0-flash"]);
}

export function invalidateRouterCache() {
  routerCache.clear();
}

export async function getUseCaseConfig(useCase: LLMUseCase): Promise<{
  provider: "openai" | "gemini";
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  streaming: boolean;
  timeoutMs: number;
}> {
  return getUseCaseConfigWithScope(useCase, "global", undefined);
}

export async function getUseCaseConfigWithScope(
  useCase: LLMUseCase,
  userId: string,
  requestedModel?: string,
): Promise<{
  provider: "openai" | "gemini";
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  streaming: boolean;
  timeoutMs: number;
}> {
  const cached = routerCache.get(useCase);
  let config: LLMRouterConfig;
  if (cached && Date.now() - cached.ts < ROUTER_CACHE_TTL) {
    config = cached.config;
  } else {
    const fromDb = await storage.getRouterConfig(useCase);
    if (fromDb) {
      config = fromDb;
    } else {
      const defaults = DEFAULT_CONFIGS[useCase] || DEFAULT_CONFIGS.LIVE_INTERVIEW_ANSWER;
      config = {
        id: "",
        useCase,
        primaryProvider: defaults.primaryProvider || "openai",
        primaryModel: defaults.primaryModel || "gpt-4o-mini",
        fallbackProvider: defaults.fallbackProvider || null,
        fallbackModel: defaults.fallbackModel || null,
        timeoutMs: defaults.timeoutMs || 30000,
        temperature: defaults.temperature ?? 0.5,
        maxTokens: defaults.maxTokens || 500,
        streamingEnabled: defaults.streamingEnabled || false,
        createdAt: null,
      };
    }
    routerCache.set(useCase, { config, ts: Date.now() });
  }

  const modelForCache = requestedModel || config.primaryModel || "gpt-4o-mini";
  const probe = await getOrLoadProviderResolution(
    userId || "global",
    modelForCache,
    useCase,
    () => resolveProvider(config, requestedModel),
  );
  console.log(
    `[cache][providerResolution] useCase=${useCase} user=${userId || "global"} model=${modelForCache} status=${probe.hit ? "hit" : "miss"}`,
  );
  return probe.value;
}

async function resolveProvider(config: LLMRouterConfig, requestedModel?: string): Promise<{
  provider: "openai" | "gemini";
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  streaming: boolean;
  timeoutMs: number;
}> {
  const base = {
    temperature: config.temperature ?? 0.5,
    maxTokens: config.maxTokens ?? 500,
    streaming: config.streamingEnabled ?? false,
    timeoutMs: config.timeoutMs ?? 30000,
  };

  const provider = config.primaryProvider as "openai" | "gemini";
  const model = requestedModel || config.primaryModel;

  if (provider === "gemini" || isGeminiModel(model)) {
    const geminiKey = await getGeminiKey();
    if (geminiKey) {
      return { ...base, provider: "gemini", model, apiKey: geminiKey };
    }
    const openaiKey = getPrewarmedOpenAIKey() || process.env.OPENAI_API_KEY;
    if (openaiKey) {
      const fb = config.fallbackModel || "gpt-4o-mini";
      return { ...base, provider: "openai", model: fb, apiKey: openaiKey };
    }
  } else {
    const openaiKey = getPrewarmedOpenAIKey() || process.env.OPENAI_API_KEY;
    if (openaiKey) {
      return { ...base, provider: "openai", model, apiKey: openaiKey };
    }
    const geminiKey = await getGeminiKey();
    if (geminiKey) {
      const fb = config.fallbackModel || "gemini-2.0-flash";
      return { ...base, provider: "gemini", model: fb, apiKey: geminiKey };
    }
  }

  throw new Error("No API keys configured. Add keys in Admin > Settings.");
}

export async function callLLM(
  useCase: LLMUseCase,
  systemPrompt: string,
  userMessage: string,
  sessionId?: string,
  overrides?: { model?: string; maxTokens?: number; temperature?: number; cacheUserId?: string },
): Promise<string> {
  const config = await getUseCaseConfigWithScope(useCase, overrides?.cacheUserId || "global", overrides?.model);
  const model = config.model;
  const maxTokens = overrides?.maxTokens || config.maxTokens;
  const temperature = overrides?.temperature ?? config.temperature;
  const t0 = Date.now();

  try {
    let result: string;

    if (config.provider === "gemini") {
      const client = new GoogleGenerativeAI(config.apiKey);
      const genModel = client.getGenerativeModel({
        model,
        systemInstruction: systemPrompt,
        generationConfig: { maxOutputTokens: maxTokens, temperature },
      });
      const response = await genModel.generateContent(userMessage);
      result = response.response.text() || "";
    } else {
      const isNewer = useMaxCompletionTokens(model);
      const body: Record<string, any> = {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        ...(isNewer ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
        ...(supportsTemperature(model) ? { temperature } : {}),
      };

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`LLM API error (${response.status}): ${errText.slice(0, 200)}`);
      }

      const data = await response.json() as any;
      result = data.choices?.[0]?.message?.content?.trim() || "";
    }

    const latency = Date.now() - t0;
    storage.createCallMetric({
      sessionId: sessionId || null,
      useCase,
      provider: config.provider,
      model,
      latencyMs: latency,
      success: true,
    }).catch(() => {});

    return result;
  } catch (err: any) {
    const latency = Date.now() - t0;
    storage.createCallMetric({
      sessionId: sessionId || null,
      useCase,
      provider: config.provider,
      model,
      latencyMs: latency,
      success: false,
      errorCode: err.message?.slice(0, 100),
    }).catch(() => {});

    if (config.provider === "openai") {
      try {
        const geminiKey = await getGeminiKey();
        if (geminiKey) {
          console.log(`[router] Fallback: ${useCase} openai→gemini`);
          const client = new GoogleGenerativeAI(geminiKey);
          const fbModel = "gemini-2.5-flash";
          const genModel = client.getGenerativeModel({
            model: fbModel,
            systemInstruction: systemPrompt,
            generationConfig: { maxOutputTokens: maxTokens, temperature },
          });
          const response = await genModel.generateContent(userMessage);
          return response.response.text() || "";
        }
      } catch {}
    }

    throw err;
  }
}

export async function* streamLLM(
  useCase: LLMUseCase,
  systemPrompt: string,
  userMessage: string,
  sessionId?: string,
  overrides?: { model?: string; maxTokens?: number; temperature?: number; cacheUserId?: string },
  abortSignal?: AbortSignal,
): AsyncGenerator<string> {
  const config = await getUseCaseConfigWithScope(useCase, overrides?.cacheUserId || "global", overrides?.model);
  const model = config.model;
  const maxTokens = overrides?.maxTokens || config.maxTokens;
  const temperature = overrides?.temperature ?? config.temperature;
  const t0 = Date.now();
  let ttft: number | undefined;
  let totalChars = 0;
  let yieldedAny = false;

  try {
    if (config.provider === "gemini") {
      const client = new GoogleGenerativeAI(config.apiKey);
      const genModel = client.getGenerativeModel({
        model,
        systemInstruction: systemPrompt,
        generationConfig: { maxOutputTokens: maxTokens, temperature },
      });
      const result = await genModel.generateContentStream(userMessage);
      for await (const chunk of result.stream) {
        if (abortSignal?.aborted) break;
        const text = chunk.text();
        if (text) {
          if (!ttft) ttft = Date.now() - t0;
          totalChars += text.length;
          yieldedAny = true;
          yield text;
        }
      }
    } else {
      const isNewer = useMaxCompletionTokens(model);
      const body: Record<string, any> = {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        stream: true,
        ...(isNewer ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
        ...(supportsTemperature(model) ? { temperature } : {}),
      };

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: abortSignal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`LLM API error (${response.status}): ${errText.slice(0, 200)}`);
      }

      if (!response.body) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      const nodeStream = response.body as any;
      const debugRaw = process.env.DEBUG_LLM_STREAM === "1";

      for await (const rawChunk of nodeStream) {
        if (abortSignal?.aborted) break;
        const text = typeof rawChunk === "string" ? rawChunk : decoder.decode(rawChunk, { stream: true });
        if (debugRaw && text) {
          console.log(`[llm][stream][raw] ${text.slice(0, 1000)}`);
        }
        buffer += text;
        const parts = buffer.split("\n");
        buffer = parts.pop() || "";

        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (debugRaw) {
            console.log(`[llm][stream][data] ${data.slice(0, 1000)}`);
          }
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta || {};
            const deltaContent = delta?.content;
            let content: string =
              (typeof deltaContent === "string" ? deltaContent : "") ||
              (typeof delta?.text === "string" ? delta.text : "") ||
              (typeof delta?.reasoning === "string" ? delta.reasoning : "") ||
              (typeof delta?.reasoning_content === "string" ? delta.reasoning_content : "") ||
              (typeof parsed.choices?.[0]?.message?.content === "string" ? parsed.choices[0].message.content : "");
            if (!content && Array.isArray(deltaContent)) {
              content = deltaContent
                .map((item: any) => {
                  if (typeof item === "string") return item;
                  if (typeof item?.text === "string") return item.text;
                  if (typeof item?.content === "string") return item.content;
                  return "";
                })
                .filter(Boolean)
                .join("");
            }
            if (content) {
              if (!ttft) ttft = Date.now() - t0;
              totalChars += content.length;
              yieldedAny = true;
              yield content;
            }
          } catch {}
        }
      }
    }

    if (!yieldedAny && !abortSignal?.aborted) {
      const fallback = await callLLM(useCase, systemPrompt, userMessage, sessionId, overrides);
      const text = String(fallback || "").trim();
      if (text) {
        if (!ttft) ttft = Date.now() - t0;
        totalChars += text.length;
        yieldedAny = true;
        console.warn(`[llm][stream] Empty stream fallback used useCase=${useCase} model=${model}`);
        yield text;
      }
    }

    const latency = Date.now() - t0;
    storage.createCallMetric({
      sessionId: sessionId || null,
      useCase,
      provider: config.provider,
      model,
      latencyMs: latency,
      ttftMs: ttft || null,
      success: true,
      tokensEstimate: Math.ceil(totalChars / 4),
    }).catch(() => {});
  } catch (err: any) {
    if (err.name === "AbortError") return;
    const latency = Date.now() - t0;
    storage.createCallMetric({
      sessionId: sessionId || null,
      useCase,
      provider: config.provider,
      model,
      latencyMs: latency,
      ttftMs: ttft || null,
      success: false,
      errorCode: err.message?.slice(0, 100),
    }).catch(() => {});
    throw err;
  }
}

export async function seedDefaultRouterConfigs(): Promise<void> {
  try {
    const existing = await storage.getAllRouterConfigs();
    const existingCases = new Set(existing.map(c => c.useCase));

    for (const [useCase, defaults] of Object.entries(DEFAULT_CONFIGS)) {
      if (!existingCases.has(useCase)) {
        await storage.upsertRouterConfig({
          useCase,
          primaryProvider: defaults.primaryProvider || "openai",
          primaryModel: defaults.primaryModel || "gpt-4o-mini",
          fallbackProvider: defaults.fallbackProvider || undefined,
          fallbackModel: defaults.fallbackModel || undefined,
          timeoutMs: defaults.timeoutMs || 30000,
          temperature: defaults.temperature ?? 0.5,
          maxTokens: defaults.maxTokens || 500,
          streamingEnabled: defaults.streamingEnabled || false,
        });
      }
    }
    console.log("[router] Default configs seeded");
  } catch (err: any) {
    console.error("[router] Failed to seed configs:", err.message);
  }
}
