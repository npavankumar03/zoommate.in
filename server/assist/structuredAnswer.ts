/**
 * Structured Answer — returns coding answers as typed JSON instead of streamed text.
 *
 * Fixes over the user-supplied prompt/code:
 *   - `client.responses.create` does not exist → use `chat.completions.create`
 *   - model "gpt-5.4" does not exist → resolved via existing resolveLLMConfig
 *   - `response.output_text` does not exist → `choices[0].message.content`
 *   - missing `response_format: { type: "json_object" }` → added (prevents markdown wrapping)
 *   - follow-up prompt was a static string with un-substituted `{{placeholders}}` → now a function
 *   - `followup: true` was hardcoded in schema description → now dynamically injected
 *   - Gemini support added via `responseMimeType: "application/json"`
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { resolveLLMConfig, useMaxCompletionTokens, supportsTemperature } from "../llmRouter";
import type { TechnicalIntent } from "@shared/technicalIntent";

// ── Schema types ──────────────────────────────────────────────────────────────

export type CodingAnswer = {
  mode:            "coding";
  intent:          TechnicalIntent;
  title:           string;
  language:        string;
  followup:        boolean;
  followupLabel:   string;
  approach:        string;
  timeComplexity:  string;
  spaceComplexity: string;
  code:            string;
  whatChanged:     string;
  edgeCases:       string[];
  notes:           string[];
};

export type GeneralAnswer = {
  mode: "general";
  text: string;
};

export type StructuredAnswer = CodingAnswer | GeneralAnswer;

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `
You are the response formatter for an AI interview assistant.
Return coding answers in strict JSON so the frontend can render them cleanly.

RULES:
1. Return valid JSON only — no markdown fences, no prose outside the JSON object.
2. If the question is a coding / technical implementation question, return the coding schema.
3. Otherwise return the general schema.
4. "code" must be plain source code — no triple-backtick fencing inside the string.
5. For follow-up modifications set followup=true and fill in whatChanged.
6. Keep approach, edgeCases, and notes concise and interview-friendly.

CODING SCHEMA:
{
  "mode": "coding",
  "intent": "coding_implement | coding_explain | coding_modify | coding_optimize | coding_debug | coding_compare | complexity_followup | language_translate | sql_query | backend_design | frontend_design | system_design",
  "title": "short descriptive title",
  "language": "python | javascript | typescript | java | go | cpp | etc.",
  "followup": false,
  "followupLabel": "",
  "approach": "1-3 sentence explanation of the algorithm",
  "timeComplexity": "O(...)",
  "spaceComplexity": "O(...)",
  "code": "complete source code as a plain string",
  "whatChanged": "",
  "edgeCases": ["edge case 1", "edge case 2"],
  "notes": ["note 1"]
}

GENERAL SCHEMA:
{
  "mode": "general",
  "text": "answer text"
}
`.trim();

// ── Follow-up system prompt (substitutes real state values, not {{literals}}) ──

function buildFollowUpSystemPrompt(
  priorSummary:    string,
  priorLanguage:   string,
  priorTime:       string,
  priorSpace:      string,
  followUpQuestion: string,
): string {
  return `
You are answering a coding interview follow-up.

Current technical state:
- prior solution: ${priorSummary || "unknown"}
- prior language: ${priorLanguage || "unknown"}
- prior time complexity: ${priorTime || "unknown"}
- prior space complexity: ${priorSpace || "unknown"}

New user follow-up:
${followUpQuestion}

RULES:
1. Return valid JSON only — no markdown fences.
2. Set followup = true.
3. Explain what changed in the whatChanged field.
4. Preserve continuity — update language/complexity/code as needed.
5. "code" is a plain source code string, not fenced markdown.

Return the coding JSON schema exactly.
`.trim();
}

// ── JSON extractor (fallback for models that wrap despite instructions) ───────

function safeJsonParse(text: string): unknown {
  // Try raw first
  try { return JSON.parse(text); } catch {}

  // Strip markdown fences if the model disobeyed
  const cleaned = text
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/```\s*$/m, "")
    .trim();
  try { return JSON.parse(cleaned); } catch {}

  // Extract first { ... } block
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch {}
  }

  throw new Error(`Model returned non-JSON output: ${text.slice(0, 200)}`);
}

function validateAnswer(parsed: unknown): StructuredAnswer {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Model returned non-object JSON");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.mode !== "coding" && obj.mode !== "general") {
    throw new Error(`Invalid mode: ${obj.mode}`);
  }
  if (obj.mode === "general") {
    return { mode: "general", text: String(obj.text || "") };
  }
  return {
    mode:            "coding",
    intent:          (obj.intent as TechnicalIntent) || "coding_implement",
    title:           String(obj.title || ""),
    language:        String(obj.language || "text"),
    followup:        Boolean(obj.followup),
    followupLabel:   String(obj.followupLabel || ""),
    approach:        String(obj.approach || ""),
    timeComplexity:  String(obj.timeComplexity || ""),
    spaceComplexity: String(obj.spaceComplexity || ""),
    code:            String(obj.code || ""),
    whatChanged:     String(obj.whatChanged || ""),
    edgeCases:       Array.isArray(obj.edgeCases) ? obj.edgeCases.map(String) : [],
    notes:           Array.isArray(obj.notes)     ? obj.notes.map(String)     : [],
  };
}

// ── OpenAI caller (chat.completions, not the non-existent responses API) ─────

async function callOpenAIJson(
  apiKey: string,
  model:  string,
  systemPrompt: string,
  userMessage:  string,
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userMessage  },
    ],
    // Forces the model to return valid JSON — eliminates markdown wrapping
    response_format: { type: "json_object" },
    ...(useMaxCompletionTokens(model)
      ? { max_completion_tokens: 1200 }
      : { max_tokens: 1200 }),
    ...(supportsTemperature(model) ? { temperature: 0.2 } : {}),
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    let errMsg = `OpenAI API error (${res.status})`;
    try { errMsg = (JSON.parse(errText) as any).error?.message || errMsg; } catch {}
    throw new Error(errMsg);
  }

  const json = await res.json() as any;
  // Correct field path: choices[0].message.content
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty content");
  return content;
}

// ── Gemini caller (responseMimeType for reliable JSON) ────────────────────────

async function callGeminiJson(
  apiKey: string,
  model:  string,
  systemPrompt: string,
  userMessage:  string,
): Promise<string> {
  const client = new GoogleGenerativeAI(apiKey);
  const genModel = client.getGenerativeModel({
    model,
    systemInstruction: systemPrompt,
    generationConfig: {
      // Gemini's equivalent of response_format: json_object
      responseMimeType: "application/json",
      temperature: 0.2,
      maxOutputTokens: 1200,
    },
  });
  const result = await genModel.generateContent(userMessage);
  const text = result.response.text();
  if (!text) throw new Error("Gemini returned empty content");
  return text;
}

// ── Input / output types ──────────────────────────────────────────────────────

export type StructuredAnswerInput = {
  question:     string;
  priorContext?: string;
  languageHint?: string;
  isFollowup?:  boolean;
  /** Populated from CodingProblemState when available */
  priorState?: {
    summary:   string;
    language:  string;
    time:      string;
    space:     string;
  };
  /** Model override — falls back to user's configured default */
  model?: string;
};

// ── Main exported function ────────────────────────────────────────────────────

export async function getStructuredInterviewAnswer(
  input: StructuredAnswerInput,
): Promise<StructuredAnswer> {
  const { question, priorContext = "", languageHint = "", isFollowup = false, priorState, model } = input;

  const selectedModel = model || "gpt-4o";
  const config = await resolveLLMConfig(selectedModel);

  // Choose system prompt — follow-up uses the state-aware template with real values
  const systemPrompt = isFollowup && priorState
    ? buildFollowUpSystemPrompt(
        priorState.summary,
        priorState.language,
        priorState.time,
        priorState.space,
        question,
      )
    : SYSTEM_PROMPT;

  const userMessage = isFollowup && priorState
    // For follow-ups the state is already injected in the system prompt
    ? `Question: ${question}\n\nReturn strict JSON only.`
    : [
        `Question:\n${question}`,
        priorContext  ? `Prior context:\n${priorContext}`   : "",
        languageHint  ? `Language hint: ${languageHint}`   : "",
        isFollowup    ? `Is follow-up: true`                : "",
        "\nReturn strict JSON only.",
      ].filter(Boolean).join("\n\n");

  let rawText: string;
  if (config.provider === "gemini") {
    rawText = await callGeminiJson(config.apiKey, config.model, systemPrompt, userMessage);
  } else {
    rawText = await callOpenAIJson(config.apiKey, config.model, systemPrompt, userMessage);
  }

  const parsed = safeJsonParse(rawText);
  return validateAnswer(parsed);
}
