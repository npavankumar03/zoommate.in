import { storage } from "../storage";
import { decryptSettingValue } from "../settingsCrypto";

type CachedAzureToken = { token: string; region: string; expiresAt: number };
const cachedTokensByRegion = new Map<string, CachedAzureToken>();

const TOKEN_LIFETIME_SEC = 600;
const RATE_LIMIT_WINDOW = 60_000;
const MAX_TOKENS_PER_WINDOW = 10;

const rateLimiter = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimiter.get(userId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    rateLimiter.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= MAX_TOKENS_PER_WINDOW) {
    return false;
  }
  entry.count++;
  return true;
}

export async function getAzureConfig(): Promise<{ key: string; region: string } | null> {
  const [rawKey, rawRegion] = await Promise.all([
    storage.getSetting("azure_speech_key"),
    storage.getSetting("azure_speech_region"),
  ]);
  const key = decryptSettingValue(rawKey);
  const region = (rawRegion || "eastus").trim() || "eastus";
  if (!key || !region) return null;
  return { key, region };
}

type AzureConfigExpanded = { key: string; primaryRegion: string; regions: string[] };

export type AzureTokenHints = {
  countryCode?: string | null;
  preferredRegion?: string | null;
};

async function getAzureConfigExpanded(): Promise<AzureConfigExpanded | null> {
  const [rawKey, rawRegion] = await Promise.all([
    storage.getSetting("azure_speech_key"),
    storage.getSetting("azure_speech_region"),
  ]);
  const key = decryptSettingValue(rawKey);
  if (!key) return null;
  const raw = String(rawRegion || "eastus");
  const list = raw
    .split(/[,\s]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  const regions = list.length ? Array.from(new Set(list)) : ["eastus"];
  const primaryRegion = regions[0];
  return { key, primaryRegion, regions };
}

function geoPriorityRegions(countryCode?: string | null): string[] {
  const cc = String(countryCode || "").trim().toUpperCase();
  if (!cc) return [];
  if (cc === "US" || cc === "CA") return ["eastus", "centralus", "westus2", "westus"];
  if (["GB", "IE", "FR", "DE", "NL", "ES", "IT", "SE", "NO", "DK", "FI", "CH", "BE", "AT"].includes(cc)) {
    return ["westeurope", "northeurope", "uksouth"];
  }
  if (["IN", "AE", "SA", "QA", "OM", "SG", "MY", "TH", "ID", "PH", "VN"].includes(cc)) {
    return ["centralindia", "southindia", "southeastasia", "eastasia"];
  }
  if (["JP", "KR", "TW", "HK", "CN"].includes(cc)) return ["japaneast", "japanwest", "koreacentral", "eastasia"];
  if (["AU", "NZ"].includes(cc)) return ["australiaeast", "australiasoutheast", "southeastasia"];
  if (["BR", "AR", "CL", "CO", "PE", "MX"].includes(cc)) return ["brazilsouth", "southcentralus", "eastus"];
  return [];
}

function orderRegions(config: AzureConfigExpanded, hints?: AzureTokenHints): string[] {
  const ordered: string[] = [];
  const push = (r?: string | null) => {
    const region = String(r || "").trim().toLowerCase();
    if (!region) return;
    if (!config.regions.includes(region)) return;
    if (!ordered.includes(region)) ordered.push(region);
  };

  push(hints?.preferredRegion || null);
  for (const geo of geoPriorityRegions(hints?.countryCode)) push(geo);
  for (const region of config.regions) push(region);
  push(config.primaryRegion);
  return ordered.length ? ordered : [config.primaryRegion];
}

async function mintTokenForRegion(key: string, region: string): Promise<{ token: string; region: string }> {
  const stsUrl = `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
  const response = await fetch(stsUrl, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Azure STS failed region=${region} status=${response.status} body=${body.slice(0, 180)}`);
  }
  const token = await response.text();
  return { token, region };
}

export async function mintAzureToken(
  userId: string,
  hints?: AzureTokenHints,
): Promise<{ token: string; region: string; expiresInSeconds: number } | null> {
  if (!checkRateLimit(userId)) {
    throw new Error("Rate limit exceeded for token requests");
  }

  const config = await getAzureConfigExpanded();
  if (!config) return null;

  const regions = orderRegions(config, hints);
  const now = Date.now();

  // Fast path: return valid cached token from best-ordered region.
  for (const region of regions) {
    const cached = cachedTokensByRegion.get(region);
    if (cached && now < cached.expiresAt) {
      return {
        token: cached.token,
        region: cached.region,
        expiresInSeconds: Math.floor((cached.expiresAt - now) / 1000),
      };
    }
  }

  let lastError: Error | null = null;
  for (const region of regions) {
    try {
      const minted = await mintTokenForRegion(config.key, region);
      const expiresAt = Date.now() + TOKEN_LIFETIME_SEC * 1000;
      const cached: CachedAzureToken = { token: minted.token, region: minted.region, expiresAt };
      cachedTokensByRegion.set(region, cached);
      console.log(
        `[azureToken] Minted token user=${userId} region=${region} country=${hints?.countryCode || "unknown"} expires_in=${TOKEN_LIFETIME_SEC}s`,
      );
      return {
        token: minted.token,
        region: minted.region,
        expiresInSeconds: TOKEN_LIFETIME_SEC,
      };
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[azureToken] Region attempt failed region=${region}: ${lastError.message}`);
    }
  }

  throw lastError || new Error("Azure STS failed for all configured regions");
}

export async function getAzureStatus(): Promise<{
  configured: boolean;
  region: string | null;
  keySet: boolean;
  regions?: string[];
}> {
  const config = await getAzureConfigExpanded();
  return {
    configured: !!config,
    region: config?.primaryRegion || null,
    keySet: !!config?.key,
    regions: config?.regions || [],
  };
}
