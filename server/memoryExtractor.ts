import { storage } from "./storage";
import { getPrewarmedOpenAIKey } from "./llmRouter";
import { MEMORY_SLOT_KEYS, type MemorySlotKey } from "@shared/schema";
import { indexDocumentForRag } from "./rag";

const EXTRACTION_MODEL = "gpt-4o-mini";

const MEMORY_EXTRACTOR_PROMPT = `You extract stable candidate facts from the snippet. Only include explicitly stated facts. Prefer newest explicit statements if conflicts exist. Return JSON only with keys employer, client, role_title, domain, tech_stack, achievements. Use null for missing values. tech_stack and achievements should be arrays or null.`;

const SUMMARY_UPDATER_PROMPT = `You maintain a rolling summary <= 900 chars. Keep stable facts: employer/client/role/stack/metrics. Remove filler. Do not invent. Output plain text only.`;

interface ExtractionResult {
  employer?: string | null;
  client?: string | null;
  role_title?: string | null;
  domain?: string | null;
  tech_stack?: string[] | null;
  achievements?: string[] | null;
}

async function callCheapModel(systemPrompt: string, userMessage: string): Promise<string> {
  const apiKey = getPrewarmedOpenAIKey() || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("No API key for memory extraction");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EXTRACTION_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 500,
      temperature: 0,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Memory extraction API error: ${res.status} ${errText.slice(0, 200)}`);
  }

  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content?.trim() || "";
}

export async function extractMemorySlots(
  userId: string,
  meetingId: string,
  question: string,
  answer: string,
  responseId?: string,
): Promise<void> {
  try {
    const snippet = `[User Question]: ${question}\n[Assistant Answer]: ${answer}`;
    const raw = await callCheapModel(MEMORY_EXTRACTOR_PROMPT, snippet);

    let jsonStr = raw;
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();

    let parsed: ExtractionResult;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      console.log("[memory] Failed to parse extraction JSON:", raw.slice(0, 200));
      return;
    }

    const slotEntries: Array<{ key: MemorySlotKey; value: string }> = [];

    for (const key of MEMORY_SLOT_KEYS) {
      const val = parsed[key as keyof ExtractionResult];
      if (val === null || val === undefined) continue;

      if (Array.isArray(val)) {
        if (val.length > 0) {
          slotEntries.push({ key, value: val.join(", ") });
        }
      } else if (typeof val === "string" && val.trim()) {
        slotEntries.push({ key, value: val.trim() });
      }
    }

    for (const entry of slotEntries) {
      await storage.upsertMemorySlot({
        userId,
        meetingId,
        slotKey: entry.key,
        slotValue: entry.value,
        confidence: 0.9,
        sourceType: "extraction",
        sourceResponseId: responseId || null,
      });
    }

    if (slotEntries.length > 0) {
      console.log(`[memory] Extracted ${slotEntries.length} slots: ${slotEntries.map(e => e.key).join(", ")}`);
    }
  } catch (err: any) {
    console.error("[memory] Extraction failed:", err.message);
  }
}

export async function updateRollingSummary(
  meetingId: string,
  currentSummary: string,
  recentTurns: string,
): Promise<string> {
  try {
    const userMsg = currentSummary
      ? `Current summary:\n${currentSummary}\n\nNew turns:\n${recentTurns}`
      : `New turns:\n${recentTurns}`;

    const newSummary = await callCheapModel(SUMMARY_UPDATER_PROMPT, userMsg);

    if (newSummary && newSummary.length <= 1000) {
      await storage.updateMeeting(meetingId, { rollingSummary: newSummary });
      console.log(`[memory] Summary updated for meeting ${meetingId} (${newSummary.length} chars)`);
      return newSummary;
    }
    return currentSummary;
  } catch (err: any) {
    console.error("[memory] Summary update failed:", err.message);
    return currentSummary;
  }
}

export async function formatMemorySlotsForPrompt(userId: string, meetingId?: string): Promise<string> {
  const slots = meetingId
    ? await storage.getMemorySlots(userId, meetingId)
    : await storage.getActiveMemorySlots(userId);
  if (slots.length === 0) return "";

  const lines = slots.map(s => `${s.slotKey}: ${s.slotValue}`);
  return `<MEMORY_SLOTS>\n${lines.join("\n")}\n</MEMORY_SLOTS>`;
}

// Index accumulated Q&A pairs as a searchable past-answers document.
// Enables semantic retrieval of relevant past answers when the same topic
// comes up again — grounds future answers in what was already said.
async function indexPastAnswers(
  userId: string,
  meetingId: string,
  conversationContext: string,
): Promise<void> {
  try {
    if (!conversationContext.trim()) return;

    const docName = `_session_answers_${meetingId}`;
    const allDocs = await storage.getDocuments(userId);
    const existing = allDocs.find((d: any) => d.name === docName);

    // Delete old version so we replace with fresh accumulated content
    if (existing) await storage.deleteDocument(existing.id);

    const newDoc = await storage.createDocument({
      userId,
      name: docName,
      content: conversationContext.slice(0, 8000),
      type: "past_answers",
    } as any);

    await indexDocumentForRag((newDoc as any).id);
    console.log(`[memory] Past answers re-indexed for meeting ${meetingId}`);
  } catch (err: any) {
    console.error("[memory] Past answer indexing failed:", err.message);
  }
}

export async function processPostAnswerMemory(
  userId: string,
  meetingId: string,
  question: string,
  answer: string,
  responseId?: string,
  meeting?: { incognito: boolean; saveFacts: boolean; rollingSummary: string; turnCount: number; conversationContext: string },
): Promise<void> {
  if (meeting?.incognito) return;

  const promises: Promise<any>[] = [];

  if (meeting?.saveFacts !== false) {
    promises.push(extractMemorySlots(userId, meetingId, question, answer, responseId));
  }

  const turnCount = (meeting?.turnCount || 0) + 1;
  await storage.updateMeeting(meetingId, { turnCount });

  if (turnCount % 3 === 0) {
    const recentTurns = `[Q]: ${question}\n[A]: ${answer}`;
    promises.push(updateRollingSummary(meetingId, meeting?.rollingSummary || "", recentTurns));
    // Re-index past answers every 3 turns for semantic retrieval
    if (meeting?.conversationContext) {
      promises.push(indexPastAnswers(userId, meetingId, meeting.conversationContext));
    }
  }

  await Promise.allSettled(promises);
}
