import { buildSystemPrompt, buildMessages, buildTier0Prompt } from "./prompt";
import { resolveLLMConfig, useMaxCompletionTokens, supportsTemperature } from "./llmRouter";
import { streamOpenAI, generateOpenAI, streamGemini, generateGemini } from "./llmStream";
import { storage } from "./storage";
import { GoogleGenerativeAI } from "@google/generative-ai";

export { getAvailableModels } from "./llmRouter";

function resolveVisionModel(model: string | undefined | null): string {
  const value = String(model || "").trim();
  if (!value || value === "automatic") return "gpt-4o-mini";
  return value;
}

function resolveFastCodingVisionModel(model: string | undefined | null): string {
  const value = String(model || "").trim();
  if (!value || value === "automatic") return "gpt-4o-mini";
  // Keep coding screen capture on the low-latency vision path unless a mini-tier model
  // was already selected explicitly.
  if (/mini/i.test(value)) return value;
  return "gpt-4o-mini";
}

export async function generateResponse(
  question: string,
  format: string,
  meetingType: string,
  customInstructions?: string | null,
  documentContext?: string,
  conversationContext?: string,
  model?: string
): Promise<string> {
  const selectedModel = model || (await storage.getSetting("default_model")) || "gpt-4o";
  const config = await resolveLLMConfig(selectedModel);
  const systemPrompt = buildSystemPrompt(format, meetingType, customInstructions, documentContext, conversationContext);

  if (config.provider === "gemini") {
    return generateGemini(config.apiKey, config.model, systemPrompt, question);
  }
  const messages = buildMessages(systemPrompt, question);
  return generateOpenAI(config.apiKey, config.model, messages);
}

export async function* generateStreamingResponse(
  question: string,
  format: string,
  meetingType: string,
  customInstructions?: string | null,
  documentContext?: string,
  conversationContext?: string,
  model?: string,
  memoryContext?: string,
  rollingSummary?: string,
) {
  const selectedModel = model || (await storage.getSetting("default_model")) || "gpt-4o-mini";
  const config = await resolveLLMConfig(selectedModel);
  const systemPrompt = buildSystemPrompt(format, meetingType, customInstructions, documentContext, conversationContext, memoryContext, rollingSummary);

  if (config.provider === "gemini") {
    yield* streamGemini(config.apiKey, config.model, systemPrompt, question, format);
  } else {
    const messages = buildMessages(systemPrompt, question);
    yield* streamOpenAI(config.apiKey, config.model, messages, format);
  }
}

export interface QuickStreamOptions {
  question: string;
  format: string;
  meetingType: string;
  model: string;
  customInstructions?: string | null;
  documentContext?: string;
  conversationContext?: string;
}

export async function* generateTier0Stream(opts: QuickStreamOptions) {
  const config = await resolveLLMConfig(opts.model);
  const systemPrompt = buildTier0Prompt(opts.format, opts.meetingType);

  if (config.provider === "gemini") {
    yield* streamGemini(config.apiKey, config.model, systemPrompt, opts.question, opts.format);
  } else {
    const messages = buildMessages(systemPrompt, opts.question);
    yield* streamOpenAI(config.apiKey, config.model, messages, opts.format, true);
  }
}

export async function* generateEnrichedStream(opts: QuickStreamOptions) {
  const config = await resolveLLMConfig(opts.model);
  const systemPrompt = buildSystemPrompt(
    opts.format,
    opts.meetingType,
    opts.customInstructions,
    opts.documentContext,
    opts.conversationContext
  );

  if (config.provider === "gemini") {
    yield* streamGemini(config.apiKey, config.model, systemPrompt, opts.question, opts.format);
  } else {
    const messages = buildMessages(systemPrompt, opts.question);
    yield* streamOpenAI(config.apiKey, config.model, messages, opts.format);
  }
}

export async function analyzeScreen(
  imagePayload: string,
  question: string,
  meetingType: string,
  documentContext?: string,
  model?: string,
  sessionMode?: string
): Promise<string> {
  const codingLikeQuestion = /\b(code|coding|leetcode|linked list|tree|graph|array|function|class|algorithm|complexity|optimi[sz]e|fix|modify|update|convert|line by line|bug|debug|implement|explain|what is|what does|how does|how do|what are|solve|solution|approach|this code|the code|this function|this class|this method|what this|why this|what happened|what changed|line|block|loop|recursive|iteration)\b/i.test(question || "");
  // Default to coding mode for screen captures — almost all interview screen captures have code.
  // Only exclude if the question is explicitly non-coding (design doc, resume, etc.)
  const isExplicitlyNonCoding = /\b(resume|linkedin|job description|behavioural|behavioral|salary|offer|culture|tell me about yourself)\b/i.test(question || "");
  const isCodingCapture = sessionMode === "coding" || codingLikeQuestion || !isExplicitlyNonCoding;
  const defaultModel = await storage.getSetting("default_model");
  const selectedModel = isCodingCapture
    ? resolveFastCodingVisionModel(model || defaultModel || "gpt-4o-mini")
    : resolveVisionModel(model || defaultModel || "gpt-4o-mini");
  const config = await resolveLLMConfig(selectedModel);

  const imageMatch = String(imagePayload || "").match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
  const imageMimeType = imageMatch?.[1] || "image/png";
  const imageBase64 = imageMatch?.[2] || String(imagePayload || "");
  const imageDataUrl = imageMatch?.[0] || `data:${imageMimeType};base64,${imageBase64}`;

  const screenPrompt = isCodingCapture
    ? `You are Zoom Mate analyzing a coding interview screen capture. Solve or explain the visible coding problem directly from the screen. Treat only the currently visible screen as the source of truth. Ignore any older captured code, previous examples, prior answers, or unrelated snippets if the visible screen has changed. Work only on the currently visible coding problem and currently visible code.

IMPORTANT — speak always as the candidate in first person. Never refer to "the code" from the outside. Say "I", "my", "I missed", "I forgot", "I need to", etc.

OUTPUT FORMAT (always follow this order):
1. **Bug/error catch (if any errors or issues are visible):** Before the code, write 1-2 natural sentences as the candidate catching their own mistake — e.g. "Oh wait, I see I forgot to add a semicolon at the end of line 5." or "I missed closing the bracket here — let me fix that." Sound natural, like you just noticed it yourself in a real interview.
2. **Code block:** Provide the complete corrected or solved code in a fenced code block (e.g. \`\`\`python).
3. **Explanation below code (2-3 sentences):** After the code block, briefly explain the approach or what was fixed — in first person.
4. **What changed:** After the explanation, add a short "What changed:" section listing each modified line or block and exactly why.
5. **Complexity line:** One short line on time/space complexity when relevant.

For follow-up or modification questions: clearly state what line/block was changed and why in the "What changed:" section.
For line-by-line explanation questions: after the code block, explain each key line or block clearly.
Never answer with interview coaching, planning bullets, or generic summaries when a coding problem is visible.
${documentContext ? `\n\nUser's background: ${documentContext}` : ""}`
    : `You are Zoom Mate, an AI interview copilot analyzing a screen capture. The user is in a ${meetingType} and needs help understanding or responding to what's on screen.

OUTPUT FORMAT (always follow this order):
1. **Explanation first (2-3 sentences):** Start with a plain-text explanation of what is visible and what the response/approach is — in first person. Never start with a code block.
2. **Code block (if applicable):** If the screen contains code or a coding problem, provide the solution or modified code in a fenced code block after the explanation.
3. **Key notes:** Any important points about the approach, changes, or next steps.

Use only the currently visible screen as the source of truth. Provide a clear, actionable response the candidate can use immediately.${documentContext ? `\n\nUser's background: ${documentContext}` : ""}`;

  if (config.provider === "gemini") {
    const client = new GoogleGenerativeAI(config.apiKey);
    const genModel = client.getGenerativeModel({
      model: config.model,
      systemInstruction: screenPrompt,
    });
    const result = await genModel.generateContent([
      { text: question || "What's on the screen? Help me respond to this." },
      {
        inlineData: {
          mimeType: imageMimeType,
          data: imageBase64,
        },
      },
    ]);
    return result.response.text() || "I couldn't analyze the screen. Please try again.";
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: screenPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: question || "What's on the screen? Help me respond to this." },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      ...(useMaxCompletionTokens(config.model) ? { max_completion_tokens: 2048 } : { max_tokens: 2048 }),
      ...(supportsTemperature(config.model) ? { temperature: 0.7 } : {}),
    }),
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
  return result.choices?.[0]?.message?.content || "I couldn't analyze the screen. Please try again.";
}

export async function* analyzeScreenStream(
  imagePayload: string,
  question: string,
  meetingType: string,
  documentContext?: string,
  model?: string,
  sessionMode?: string,
  liveTranscript?: string,
): AsyncGenerator<string> {
  const codingLikeQuestion = /\b(code|coding|leetcode|linked list|tree|graph|array|function|class|algorithm|complexity|optimi[sz]e|fix|modify|update|convert|line by line|bug|debug|implement|explain|what is|what does|how does|how do|what are|solve|solution|approach|this code|the code|this function|this class|this method|what this|why this|what happened|what changed|line|block|loop|recursive|iteration)\b/i.test(question || "");
  const isExplicitlyNonCoding = /\b(resume|linkedin|job description|behavioural|behavioral|salary|offer|culture|tell me about yourself)\b/i.test(question || "");
  const isCodingCapture = sessionMode === "coding" || codingLikeQuestion || !isExplicitlyNonCoding;
  const defaultModel = await storage.getSetting("default_model");
  const selectedModel = isCodingCapture
    ? resolveFastCodingVisionModel(model || defaultModel || "gpt-4o-mini")
    : resolveVisionModel(model || defaultModel || "gpt-4o-mini");
  const config = await resolveLLMConfig(selectedModel);

  const imageMatch = String(imagePayload || "").match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
  const imageMimeType = imageMatch?.[1] || "image/png";
  const imageBase64 = imageMatch?.[2] || String(imagePayload || "");
  const imageDataUrl = imageMatch?.[0] || `data:${imageMimeType};base64,${imageBase64}`;

  const screenPrompt = isCodingCapture
    ? `You are Zoom Mate analyzing a coding interview screen capture. Solve or explain the visible coding problem directly from the screen. Treat only the currently visible screen as the source of truth. Ignore any older captured code, previous examples, prior answers, or unrelated snippets if the visible screen has changed. Work only on the currently visible coding problem and currently visible code.

IMPORTANT — speak always as the candidate in first person. Never refer to "the code" from the outside. Say "I", "my", "I missed", "I forgot", "I need to", etc.

OUTPUT FORMAT (always follow this order):
1. **Bug/error catch (if any errors or issues are visible):** Before the code, write 1-2 natural sentences as the candidate catching their own mistake — e.g. "Oh wait, I see I forgot to add a semicolon at the end of line 5." or "I missed closing the bracket here — let me fix that." Sound natural, like you just noticed it yourself in a real interview.
2. **Code block:** Provide the complete corrected or solved code in a fenced code block (e.g. \`\`\`python).
3. **Explanation below code (2-3 sentences):** After the code block, briefly explain the approach or what was fixed — in first person.
4. **What changed:** After the explanation, add a short "What changed:" section listing each modified line or block and exactly why.
5. **Complexity line:** One short line on time/space complexity when relevant.

For follow-up or modification questions: clearly state what line/block was changed and why in the "What changed:" section.
For line-by-line explanation questions: after the code block, explain each key line or block clearly.
Never answer with interview coaching, planning bullets, or generic summaries when a coding problem is visible.
${documentContext ? `\n\nUser's background: ${documentContext}` : ""}${liveTranscript ? `\n\nRecent interview conversation (use this to understand what was discussed and asked before the screen capture — answer based on this full context):\n${liveTranscript}` : ""}`
    : `You are Zoom Mate, an AI interview copilot analyzing a screen capture. The user is in a ${meetingType} and needs help understanding or responding to what's on screen.

OUTPUT FORMAT (always follow this order):
1. **Explanation first (2-3 sentences):** Start with a plain-text explanation of what is visible and what the response/approach is — in first person. Never start with a code block.
2. **Code block (if applicable):** If the screen contains code or a coding problem, provide the solution or modified code in a fenced code block after the explanation.
3. **Key notes:** Any important points about the approach, changes, or next steps.

Use only the currently visible screen as the source of truth. Provide a clear, actionable response the candidate can use immediately.${documentContext ? `\n\nUser's background: ${documentContext}` : ""}${liveTranscript ? `\n\nRecent interview conversation (use this to understand what was discussed and asked before the screen capture — answer based on this full context):\n${liveTranscript}` : ""}`;

  if (config.provider === "gemini") {
    const client = new GoogleGenerativeAI(config.apiKey);
    const genModel = client.getGenerativeModel({
      model: config.model,
      systemInstruction: screenPrompt,
    });
    const result = await genModel.generateContentStream([
      { text: question || "What's on the screen? Help me respond to this." },
      { inlineData: { mimeType: imageMimeType, data: imageBase64 } },
    ]);
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) yield text;
    }
    return;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      messages: [
        { role: "system", content: screenPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: question || "What's on the screen? Help me respond to this." },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      ...(useMaxCompletionTokens(config.model) ? { max_completion_tokens: 2048 } : { max_tokens: 2048 }),
      ...(supportsTemperature(config.model) ? { temperature: 0.7 } : {}),
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    let errMsg = `OpenAI API error (${response.status})`;
    try { const errJson = JSON.parse(errText); errMsg = errJson.error?.message || errMsg; } catch {}
    throw new Error(errMsg);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (trimmed.startsWith("data: ")) {
        try {
          const json = JSON.parse(trimmed.slice(6));
          const text = json.choices?.[0]?.delta?.content;
          if (text) yield text;
        } catch {}
      }
    }
  }
}

export async function* analyzeMultiScreenStream(
  imagePayloads: string[],
  question: string,
  meetingType: string,
  documentContext?: string,
  model?: string,
  sessionMode?: string,
  liveTranscript?: string,
): AsyncGenerator<string> {
  const defaultModel = await storage.getSetting("default_model");
  const selectedModel = resolveFastCodingVisionModel(model || defaultModel || "gpt-4o-mini");
  const config = await resolveLLMConfig(selectedModel);

  const images = imagePayloads.map((payload) => {
    const match = String(payload || "").match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
    return {
      mimeType: match?.[1] || "image/png",
      base64: match?.[2] || String(payload || ""),
      dataUrl: match?.[0] || `data:image/png;base64,${payload}`,
    };
  });

  const screenPrompt = `You are Zoom Mate analyzing ${images.length} screen captures taken in sequence. The images show different parts or scroll positions of the same screen/codebase. Treat them together as one complete view.

IMPORTANT: Analyze ALL ${images.length} images together to get the full picture before answering. The code or content may span across multiple screenshots.

IMPORTANT — speak always as the candidate in first person. Say "I", "my", "I missed", "I need to", etc.

OUTPUT FORMAT (always follow this exact order):
1. **Summary of what's visible across all captures (1-2 sentences):** Briefly describe what you see across all images combined.
2. **Bug/error catch (if any errors or issues are visible):** 1-2 natural sentences catching any mistakes — e.g. "Oh wait, I see I forgot to handle the null case in the second screenshot."
3. **Code block:** Provide the complete corrected or solved code in a fenced code block (e.g. \`\`\`python). Combine all code visible across all images.
4. **Explanation (2-3 sentences):** Explain the approach or what was fixed — in first person.
5. **What changed:** List each modified line/block and exactly why.
6. **Complexity line:** One short line on time/space complexity when relevant.
${documentContext ? `\n\nUser's background: ${documentContext}` : ""}${liveTranscript ? `\n\nRecent interview conversation:\n${liveTranscript}` : ""}`;

  if (config.provider === "gemini") {
    const client = new GoogleGenerativeAI(config.apiKey);
    const genModel = client.getGenerativeModel({ model: config.model, systemInstruction: screenPrompt });
    const parts: any[] = [{ text: question || "Analyze all these screen captures and help me respond." }];
    for (const img of images) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
    }
    const result = await genModel.generateContentStream(parts);
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) yield text;
    }
    return;
  }

  // Build content array: text question + all images
  const userContent: any[] = [
    { type: "text", text: question || "Analyze all these screen captures together and help me respond." },
    ...images.map((img, i) => ({
      type: "image_url",
      image_url: { url: img.dataUrl, detail: "high" },
    })),
  ];

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      messages: [
        { role: "system", content: screenPrompt },
        { role: "user", content: userContent },
      ],
      ...(useMaxCompletionTokens(config.model) ? { max_completion_tokens: 3000 } : { max_tokens: 3000 }),
      ...(supportsTemperature(config.model) ? { temperature: 0.7 } : {}),
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    let errMsg = `OpenAI API error (${response.status})`;
    try { const errJson = JSON.parse(errText); errMsg = errJson.error?.message || errMsg; } catch {}
    throw new Error(errMsg);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (trimmed.startsWith("data: ")) {
        try {
          const json = JSON.parse(trimmed.slice(6));
          const text = json.choices?.[0]?.delta?.content;
          if (text) yield text;
        } catch {}
      }
    }
  }
}

export async function extractQuestionsWithLLM(transcript: string, model?: string): Promise<string[]> {
  const defaultModel = await storage.getSetting("default_model");
  const selectedModel = model || defaultModel || "gpt-4o-mini";
  const config = await resolveLLMConfig(selectedModel);

  const systemPrompt = `You are a transcript processor. Extract the core technical or behavioral questions from this messy audio transcript. Ignore filler words, stuttering, and rhetorical questions. 
Return ONLY a valid JSON object with a single key "questions" containing an array of strings: {"questions": ["Question 1?", "Question 2?"]}. 
If there are no substantive questions found, output {"questions": []}.`;

  try {
    if (config.provider === "gemini") {
      const client = new GoogleGenerativeAI(config.apiKey);
      const genModel = client.getGenerativeModel({
        model: config.model,
        systemInstruction: systemPrompt,
        generationConfig: { responseMimeType: "application/json" }
      });
      const result = await genModel.generateContent(transcript || " ");
      const text = result.response.text();
      const parsed = JSON.parse(text);
      return Array.isArray(parsed.questions) ? parsed.questions : [];
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: transcript || " " },
        ],
        response_format: { type: "json_object" },
        ...(useMaxCompletionTokens(config.model) ? { max_completion_tokens: 500 } : { max_tokens: 500 }),
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error (${response.status})`);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || '{"questions": []}';
    const parsed = JSON.parse(content);
    return Array.isArray(parsed.questions) ? parsed.questions : [];
  } catch (err: any) {
    console.error("[extractQuestionsWithLLM] Failed:", err);
    return []; // Return empty array to fallback gracefully
  }
}
