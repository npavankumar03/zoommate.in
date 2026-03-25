import { storage } from "../storage";
import { decryptSettingValue } from "../settingsCrypto";

const DEEPGRAM_TOKEN_TTL_SEC = 60;

async function getDeepgramApiKey(): Promise<string | null> {
  const rawValue = await storage.getSetting("deepgram_api_key");
  const apiKey = decryptSettingValue(rawValue);
  return apiKey ? apiKey.trim() : null;
}

export async function getDeepgramStatus(): Promise<{ configured: boolean }> {
  const apiKey = await getDeepgramApiKey();
  return { configured: !!apiKey };
}

export async function mintDeepgramToken(): Promise<{ token: string; expiresInSeconds: number } | null> {
  const apiKey = await getDeepgramApiKey();
  if (!apiKey) return null;

  const response = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ttl_seconds: DEEPGRAM_TOKEN_TTL_SEC }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Deepgram auth grant failed status=${response.status} body=${body.slice(0, 180)}`);
  }

  const data = await response.json() as { access_token?: string; expires_in?: number | null };
  const token = String(data.access_token || "").trim();
  if (!token) {
    throw new Error("Deepgram auth grant returned an empty token");
  }

  return {
    token,
    expiresInSeconds: Math.max(1, Number(data.expires_in) || DEEPGRAM_TOKEN_TTL_SEC),
  };
}
