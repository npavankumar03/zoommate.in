export type SttProvider = "azure" | "deepgram" | "browser";

export type SttConfig = {
  azureAvailable: boolean;
  deepgramAvailable: boolean;
  defaultProvider: SttProvider;
};

function normalizeSttProvider(value: unknown): SttProvider {
  return value === "azure" || value === "deepgram" || value === "browser"
    ? value
    : "browser";
}

export async function fetchSttConfig(): Promise<SttConfig> {
  const response = await fetch("/api/speech/stt/config", { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Failed to load STT config (status=${response.status})`);
  }

  const data = await response.json();
  return {
    azureAvailable: data.azureAvailable === true,
    deepgramAvailable: data.deepgramAvailable === true,
    defaultProvider: normalizeSttProvider(data.defaultProvider),
  };
}
