import { GoogleGenerativeAI } from "@google/generative-ai";
import { useMaxCompletionTokens, supportsTemperature } from "./llmRouter";
import { getMaxTokensForFormat } from "./prompt";
import https from "https";

export async function* streamOpenAIFast(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  agent: https.Agent
): AsyncGenerator<string> {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  const body = JSON.stringify({
    model,
    messages,
    stream: true,
    max_tokens: maxTokens,
    temperature: 0.5,
  });

  const response = await new Promise<any>((resolve, reject) => {
    const req = https.request({
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      agent,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(body),
      },
    }, resolve);
    req.on("error", reject);
    req.end(body);
  });

  if (response.statusCode !== 200) {
    let errBody = "";
    for await (const chunk of response) errBody += chunk;
    let msg = `OpenAI API error (${response.statusCode})`;
    try { msg = JSON.parse(errBody).error?.message || msg; } catch {}
    throw new Error(msg);
  }

  let buffer = "";
  for await (const rawChunk of response) {
    buffer += rawChunk.toString();
    const parts = buffer.split("\n");
    buffer = parts.pop() || "";
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch {}
    }
  }
}

export async function* streamOpenAI(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  format?: string,
  tier0 = false
): AsyncGenerator<string> {
  const maxTokens = getMaxTokensForFormat(format, model, tier0);
  const isNewer = useMaxCompletionTokens(model);

  const body: Record<string, any> = {
    model,
    messages,
    stream: true,
    ...(isNewer ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
    ...(supportsTemperature(model) ? { temperature: 0.5 } : {}),
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    let errMsg = `OpenAI API error (${response.status})`;
    try {
      const errJson = JSON.parse(errText);
      errMsg = errJson.error?.message || errMsg;
    } catch {}
    throw new Error(errMsg);
  }

  if (!response.body) throw new Error("No response body from OpenAI");

  const decoder = new TextDecoder();
  let buffer = "";
  const nodeStream = response.body as any;

  for await (const rawChunk of nodeStream) {
    const text = typeof rawChunk === "string" ? rawChunk : decoder.decode(rawChunk, { stream: true });
    buffer += text;
    const parts = buffer.split("\n");
    buffer = parts.pop() || "";

    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") return;

      try {
        const parsed = JSON.parse(data);
        if (parsed.error) {
          throw new Error(parsed.error.message || JSON.stringify(parsed.error));
        }
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          yield content;
        }
      } catch (e: any) {
        if (e.message && !e.message.includes("Unexpected")) {
          throw e;
        }
      }
    }
  }

  if (buffer.trim()) {
    const remaining = buffer.trim();
    if (remaining.startsWith("data: ")) {
      const data = remaining.slice(6);
      if (data !== "[DONE]") {
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {}
      }
    }
  }
}

export async function generateOpenAI(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const isNewer = useMaxCompletionTokens(model);

  const body: Record<string, any> = {
    model,
    messages,
    ...(isNewer ? { max_completion_tokens: 2048 } : { max_tokens: 2048 }),
    ...(supportsTemperature(model) ? { temperature: 0.7 } : {}),
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    let errMsg = `OpenAI API error (${response.status})`;
    try {
      const errJson = JSON.parse(errText);
      errMsg = errJson.error?.message || errMsg;
    } catch {}
    throw new Error(errMsg);
  }

  const result = await response.json();
  return result.choices?.[0]?.message?.content || "I couldn't generate a response. Please try again.";
}

export async function* streamGemini(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  format?: string
): AsyncGenerator<string> {
  try {
    const client = new GoogleGenerativeAI(apiKey);
    const maxTokens = getMaxTokensForFormat(format, model);
    const genModel = client.getGenerativeModel({
      model,
      systemInstruction: systemPrompt,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.5,
      },
    });
    const result = await genModel.generateContentStream(userMessage);
    for await (const chunk of result.stream) {
      try {
        const text = chunk.text();
        if (text) {
          yield text;
        }
      } catch (chunkErr) {
        console.error("Gemini chunk error:", chunkErr);
      }
    }
  } catch (error: any) {
    console.error("Gemini streaming error:", error);
    if (error.message?.includes("API key")) {
      throw new Error("Gemini API key is invalid or expired. Please update it in Admin > Settings.");
    }
    if (error.message?.includes("not found") || error.message?.includes("not supported")) {
      throw new Error(`Model "${model}" is not available. Try a different Gemini model.`);
    }
    throw new Error(`Gemini error: ${error.message || "Unknown error"}`);
  }
}

export async function generateGemini(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const client = new GoogleGenerativeAI(apiKey);
  const genModel = client.getGenerativeModel({
    model,
    systemInstruction: systemPrompt,
  });
  const result = await genModel.generateContent(userMessage);
  return result.response.text() || "I couldn't generate a response. Please try again.";
}
