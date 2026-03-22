import { storage } from "./storage";
import http from "http";
import https from "https";

export const OPENAI_MODELS = ["gpt-5", "gpt-5-mini", "gpt-5-nano", "o3", "o4-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"];
export const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"];

const NEWER_OPENAI_MODELS = ["gpt-5", "gpt-5-mini", "gpt-5-nano", "o3", "o4-mini", "gpt-4.1", "gpt-4.1-mini"];
const NO_TEMPERATURE_MODELS = ["gpt-5", "gpt-5-mini", "gpt-5-nano", "o3", "o4-mini"];

export const FAST_MODEL = "gpt-4o-mini";

export const keepAliveAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 10,
});

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const settingsCache = new Map<string, CacheEntry<string | undefined>>();
const SETTINGS_TTL = 10 * 60 * 1000;
const configCache = new Map<string, CacheEntry<LLMConfig>>();
const CONFIG_TTL = 10 * 60 * 1000;

let _prewarmedKey: string | null = null;
let _prewarmedAt = 0;
const PREWARM_TTL = 30 * 60 * 1000;
let _prewarmInterval: ReturnType<typeof setInterval> | null = null;

export function getPrewarmedOpenAIKey(): string | null {
  if (_prewarmedKey) {
    if (Date.now() - _prewarmedAt > PREWARM_TTL) {
      prewarmApiKey();
    }
    return _prewarmedKey;
  }
  prewarmApiKey();
  return _prewarmedKey || process.env.OPENAI_API_KEY || null;
}

export async function prewarmApiKey(): Promise<void> {
  try {
    const customKey = await storage.getSetting("openai_api_key");
    _prewarmedKey = customKey || process.env.OPENAI_API_KEY || null;
    _prewarmedAt = Date.now();
    if (_prewarmedKey) console.log("[prewarm] OpenAI API key cached");
    if (!_prewarmInterval) {
      _prewarmInterval = setInterval(() => prewarmApiKey(), 10 * 60 * 1000);
    }
  } catch {}
}

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.value;
  if (entry) cache.delete(key);
  return undefined;
}

function setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttl: number) {
  cache.set(key, { value, expiresAt: Date.now() + ttl });
}

export function invalidateSettingsCache() {
  settingsCache.clear();
  configCache.clear();
  _prewarmedKey = null;
  _prewarmedAt = 0;
  prewarmApiKey();
}

async function getCachedSetting(key: string): Promise<string | undefined> {
  const cached = getCached(settingsCache, key);
  if (cached !== undefined) return cached;
  const value = await storage.getSetting(key);
  const result = value || undefined;
  setCache(settingsCache, key, result, SETTINGS_TTL);
  return result;
}

export function getAvailableModels() {
  return {
    openai: OPENAI_MODELS,
    gemini: GEMINI_MODELS,
  };
}

export function isGeminiModel(model: string): boolean {
  return model.startsWith("gemini");
}

export function useMaxCompletionTokens(model: string): boolean {
  return NEWER_OPENAI_MODELS.some(m => model.startsWith(m));
}

export function supportsTemperature(model: string): boolean {
  return !NO_TEMPERATURE_MODELS.some(m => model.startsWith(m));
}

export interface LLMConfig {
  provider: "openai" | "gemini";
  model: string;
  apiKey: string;
}

export async function resolveLLMConfig(selectedModel: string): Promise<LLMConfig> {
  const cacheKey = `config:${selectedModel}`;
  const cached = getCached(configCache, cacheKey);
  if (cached) return cached;

  let config: LLMConfig;

  if (isGeminiModel(selectedModel)) {
    const geminiKey = await getCachedSetting("gemini_api_key");
    if (geminiKey) {
      config = { provider: "gemini", model: selectedModel, apiKey: geminiKey };
    } else {
      const openaiKey = await getOpenAIKey();
      if (openaiKey) {
        config = { provider: "openai", model: "gpt-4o", apiKey: openaiKey };
      } else {
        throw new Error("No API keys configured. Add keys in Admin > Settings.");
      }
    }
  } else {
    const openaiKey = await getOpenAIKey();
    if (openaiKey) {
      config = { provider: "openai", model: selectedModel, apiKey: openaiKey };
    } else {
      const geminiKey = await getCachedSetting("gemini_api_key");
      if (geminiKey) {
        config = { provider: "gemini", model: "gemini-2.5-flash", apiKey: geminiKey };
      } else {
        throw new Error("No API keys configured. Add keys in Admin > Settings.");
      }
    }
  }

  setCache(configCache, cacheKey, config, CONFIG_TTL);
  return config;
}

export async function getOpenAIKey(): Promise<string | undefined> {
  const customKey = await getCachedSetting("openai_api_key");
  return customKey || process.env.OPENAI_API_KEY || undefined;
}

export async function getGeminiKey(): Promise<string | undefined> {
  return await getCachedSetting("gemini_api_key") || undefined;
}
