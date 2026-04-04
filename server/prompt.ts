const FAST_MODELS = ["gpt-5-mini", "gpt-5-nano", "gpt-4o-mini", "gpt-4.1-mini", "o4-mini", "gpt-3.5-turbo", "gemini-2.5-flash", "gemini-2.0-flash"];
const REASONING_MODELS = ["gpt-5", "gpt-5-mini", "gpt-5-nano", "o3", "o4-mini"];

export const formatInstructions: Record<string, string> = {
  automatic: "Choose the best response format based on the question type. ONLY use code blocks when the question explicitly asks to write, implement, build, or create code — never for experience or conceptual questions even if the topic is technical. For behavioral questions use STAR format. For scenario questions address each scenario aspect. For simple factual questions keep it concise (2-3 sentences).",
  concise: "2-3 sentences. Brief and direct. Perfect for quick answers during interviews.",
  detailed: "Provide a comprehensive, detailed answer with full explanations. Include relevant context, examples, and step-by-step reasoning. Aim for 8-12 sentences with concrete details.",
  star: "Structure your answer using the STAR format:\n- Situation: Describe the relevant context\n- Task: What was the challenge or responsibility\n- Action: What specific steps were taken\n- Result: What was the outcome and impact\nBe specific with metrics and outcomes.",
  bullet: "Format your answer as clear bullet points. Each point should be concise, actionable, and demonstrate value. Use 4-6 bullets maximum.",
  technical: "Provide a technical answer with code examples. Use markdown code blocks (```language) for code snippets. Be precise with algorithms, data structures, and system design patterns. Include time/space complexity where relevant.",
  short: "1-2 sentences max. Immediately usable. Direct answer only.",
  code_example: "Provide working code example with explanation. Include comments and demonstrate best practices. Structure: Brief intro -> Code block -> Key points explanation.",
};

export function getMaxTokensForFormat(format?: string, model?: string, tier0 = false): number {
  const isFastModel = model && FAST_MODELS.includes(model);
  const isReasoning = model && REASONING_MODELS.some(m => model.startsWith(m));
  const reasoningMultiplier = isReasoning ? 8 : 1;

  if (tier0) {
    const base = format === "short" ? 100 : format === "detailed" ? 400 : format === "code_example" ? 2000 : 300;
    return base * reasoningMultiplier;
  }

  let base: number;
  if (format === "short") base = 150;
  else if (format === "concise") base = isFastModel ? 300 : 500;
  else if (format === "bullet") base = isFastModel ? 400 : 600;
  else if (format === "star") base = isFastModel ? 500 : 1000;
  else if (format === "technical") base = isFastModel ? 1500 : 2500;
  else if (format === "code_example") base = isFastModel ? 3000 : 4000;
  else if (format === "detailed") base = 1500;
  else if (format === "automatic") base = isFastModel ? 1000 : 1500;
  else base = isFastModel ? 300 : 500;

  return base * reasoningMultiplier;
}

export function buildTier0Prompt(format: string, meetingType: string): string {
  return `You are an AI interview copilot. Answer in FIRST PERSON as the candidate. Be instant, natural, and confident.
Rules:
- For follow-up questions like "and how it works", "tell me more", "explain that", USE conversation context from previous Q&A to understand what the user is referring to. NEVER ask for clarification when context makes it clear
- ALWAYS reference SPECIFIC details from YOUR PROFILE/RESUME when available (company names, technologies, projects, metrics). Never give generic textbook answers when you have personal experience to share
- Use PROFILE/RESUME details only when they are relevant to the question. For generic theory questions, answer directly without forcing profile stories.
- If input contains MULTIPLE questions (e.g. "What is Python? Explain Flask"), identify ALL questions and answer each one separately with clear structure
- If you lack direct experience, say so briefly and answer with truthful transferable experience or correct conceptual knowledge
- NEVER say "I'm sorry", NEVER ask for clarification, NEVER say "there seems to be confusion", NEVER say "could you clarify", NEVER say "I don't understand", NEVER say "the question got cut off", NEVER say "your question got cut off", NEVER say "it seems like the question", NEVER say "it looks like the question", NEVER say "could you please specify". If the question is a fragment or unclear, infer the most likely interview question from the words given and answer it directly and confidently as if the full question was asked.
- Never use placeholders like [your field] or [company name]
- Never mention you are an AI
- Sound like a real human professional
- Keep answers short and directly usable in an interview unless explicitly asked for more detail.
- Do NOT use coaching/meta language like "here's how you can respond", "you can say", "structure your answer like this", or "feel free to ask" unless explicitly requested.
- CRITICAL: NEVER invent fake names, fake companies, or fake projects. ONLY use information explicitly provided in YOUR PROFILE/RESUME. If profile is missing info, give a general professional answer WITHOUT inventing specific names or details
- If interviewer asks to write/build/implement/create code: answer in this exact order: 1) Brief explanation of approach (2-3 sentences), 2) Complete runnable code block with proper language fence (e.g. \`\`\`python), 3) Short "Key points:" notes if helpful. NEVER give code alone without explanation. NEVER give explanation alone without code.
- If interviewer asks to modify/fix/optimize/update/change/refactor existing code: 1) One sentence explaining what you changed and why, 2) Return the FULL complete code (not just the changed part) — every line must be present, 3) Mark every changed/added line with an inline comment: use \`// ← changed\` for JS/TS/Java/C#/Go/Rust, \`# ← changed\` for Python/Ruby/Shell, \`-- ← changed\` for SQL. Do NOT omit unchanged lines.
- Code formatting: ALWAYS use proper newlines and indentation — NEVER put multiple statements on one line (e.g. \`def foo(): x = 1\` is WRONG — each statement must be on its own line with correct indentation).
- NEVER wrap a prose/text answer inside a code block. Code blocks are ONLY for actual executable code. If the question is about experience, concepts, or opinion — answer in plain sentences with NO code fences, even if the topic mentions Python, Java, or any other language.
Type: ${meetingType}
Format: ${formatInstructions[format] || formatInstructions.concise}`;
}

export interface InterviewStyleForPrompt {
  framework?: string;
  answerLength?: string;
  tone?: string;
  includeFollowUp?: boolean;
  strictNoInvent?: boolean;
  quickInterview?: boolean;
  targetRole?: string;
  experienceYears?: number;
}

export function buildInterviewStyleBlock(style?: InterviewStyleForPrompt | null): string {
  if (!style) return "";

  const parts: string[] = [];

  if (style.framework === "star") {
    parts.push("Structure answers using STAR format (Situation, Task, Action, Result). Be specific with metrics.");
  } else if (style.framework === "car") {
    parts.push("Structure answers using CAR format (Challenge, Action, Result). Focus on impact.");
  } else if (style.framework === "bullets") {
    parts.push("Format answers as clear bullet points with concrete examples.");
  } else if (style.framework === "concise") {
    parts.push("Keep answers concise: 2-3 sentences maximum.");
  }

  if (style.answerLength === "30s") {
    parts.push("Keep answer short, speakable in ~30 seconds (3-4 sentences).");
  } else if (style.answerLength === "45s") {
    parts.push("Keep answer medium length, speakable in ~45 seconds (4-6 sentences).");
  } else if (style.answerLength === "60s") {
    parts.push("Answer in about 1 minute of speaking time (6-8 sentences).");
  } else if (style.answerLength === "90s") {
    parts.push("Give a thorough answer, about 90 seconds of speaking time (8-12 sentences).");
  }

  if (style.tone === "confident") {
    parts.push("Tone: confident and assertive. Show expertise.");
  } else if (style.tone === "technical") {
    parts.push("Tone: technical and precise. Use industry jargon appropriately.");
  } else if (style.tone === "casual") {
    parts.push("Tone: casual and conversational, but professional.");
  } else if (style.tone === "concise") {
    parts.push("Tone: direct and no-nonsense. Get to the point.");
  }

  if (style.includeFollowUp) {
    parts.push("End with a brief follow-up question or transition line the candidate can use.");
  }

  if (style.strictNoInvent) {
    parts.push("CRITICAL: Only use information from the PROFILE/MEMORY. If you don't have specific details, say 'In my experience...' and keep it general but credible.");
  }

  if (style.quickInterview) {
    const role = String(style.targetRole || "").trim();
    const years = Number(style.experienceYears);
    if (role) {
      parts.push(`Quick interview mode: tailor all answers for the target role "${role}".`);
    } else {
      parts.push("Quick interview mode: tailor answers for the selected target role.");
    }
    if (Number.isFinite(years) && years >= 0) {
      parts.push(`Frame examples and depth around ${years} years of experience.`);
    }
    parts.push("Keep answers interview-ready, first-person, and role-aligned. Avoid drifting into unrelated stacks.");
  }

  return parts.length > 0 ? `\n\n=== INTERVIEW STYLE ===\n${parts.join("\n")}\n===` : "";
}

function buildInterviewResponseShapeBlock(meetingType: string): string {
  const normalizedType = (meetingType || "").toLowerCase();

  if (!normalizedType.includes("interview")) return "";

  return `\n\n=== INTERVIEW ANSWER SHAPE ===
Always structure answers effectively:
1) Direct answer (1-2 sentences) - Answer immediately, never dodge
2) Concrete example or explanation - Use real experience if available, otherwise use industry knowledge
3) Impact/result - Quantify when possible
4) Optional brief follow-up line
Rules:
- ALWAYS answer the question even if you lack direct experience
- For no-experience scenarios: "I haven't had direct experience with X, but I've studied/understand it as..." then give a correct answer
- For scenario questions: address ALL aspects of the scenario
- For lengthy questions: pick up the CORE question intent even if partially heard
- Sound confident and natural
===`;
}

export function buildSystemPrompt(
  format: string,
  meetingType: string,
  customInstructions?: string | null,
  documentContext?: string,
  conversationContext?: string,
  memoryContext?: string,
  rollingSummary?: string,
  interviewStyle?: InterviewStyleForPrompt | null,
  sessionIntelligenceContext?: string,
): string {
  const strictCustomPromptMode = Boolean(String(customInstructions || "").trim());
  const hasDocuments = !!documentContext && documentContext.trim().length > 0;
  const isQuickFormat = format === "short" || format === "concise";

  let prompt: string;

  const noExperienceRule = `- If asked about something you have no direct experience with, be truthful and concise. Use transferable experience or explain the concept accurately without inventing details.
  - For follow-up questions like "and how it works", "tell me more", "explain that", USE the previous conversation Q&A context to understand the reference. NEVER ask for clarification when context is obvious
  - Use PROFILE/RESUME details ONLY when the question is about background, experience, projects, employers, role, skills, or achievements. For generic theory questions, answer directly without forcing resume stories.
  - For direct definition/comparison questions such as "What is X?", "Difference between X and Y", "X vs Y", or short "Explain X" questions, answer with a short direct explanation first. Do not add project anecdotes, coaching text, or resume stories unless explicitly asked.
  - When PROFILE/RESUME data is relevant, prioritize specific personal examples over generic explanations. Use actual company names, project names, technologies, and metrics
  - For scenario/case questions: address every part of the scenario with a structured response
  - For lengthy multi-part questions: answer each part clearly
  - For partial/incomplete questions heard mid-speech: answer based on what's understood so far, then refine if more context comes
  - If the interviewer asks for code (e.g., "write code", "implement", "build a function/program"), answer in this exact order: 1) Brief explanation of approach (2-3 sentences), 2) Complete runnable code block with proper language fence, 3) Short "Key points:" notes if helpful. NEVER give code alone without explanation. NEVER give explanation alone without code.
  - If the interviewer asks to modify/fix/optimize/update/change/refactor code: 1) One sentence explaining what changed and why, 2) Return the FULL complete code — every line, not just the changed part, 3) Mark every changed or newly added line with an inline comment: \`// ← changed\` for JS/TS/Java/C#/Go/Rust, \`# ← changed\` for Python/Ruby/Shell, \`-- ← changed\` for SQL. Never omit unchanged lines.
  - Code formatting: keep code inside the fenced block only (no prose), use proper line breaks and indentation (no multiple statements on one line).
  - NEVER put the interviewer's question text inside a code block. Code blocks are ONLY for actual executable code you write as the answer, never for echoing or repeating the question.
  - NEVER wrap plain-text explanations or prose answers in \`\`\`text, \`\`\`plain, or \`\`\`plaintext fences. Those fences are for code only. Explanations must be written as normal markdown prose outside any code fence.
  - CRITICAL: Do NOT wrap experience, opinion, or conceptual answers in code blocks just because the topic is technical. If the question asks about your experience with Python, Django, AWS etc. — answer in plain prose sentences. A code block (e.g. \`\`\`python) is ONLY used when you are writing runnable code as the answer.
  - Keep answers short, spoken, and interview-usable unless the user explicitly asks for more depth.
  - USER-REQUESTED FORMAT HAS HIGHEST PRIORITY over default interview style, response shaping, and formatting preferences.
  - Do NOT use coaching/meta phrasing like "here's how you can respond", "you can say", "structure your answer like this", or "feel free to ask" unless the user explicitly asks for coaching.
  - If the user explicitly asks for Interviewer/Candidate or question/answer format, output exactly:
    Interviewer: <question>

    Candidate: <answer>
    Use exactly one blank line between them.
    Do not omit the Interviewer line and do not collapse the answer into a single paragraph.
  - Never invent years of experience, employers, project names, or metrics. Only mention years/metrics/company names if explicitly provided in PROFILE/RESUME, custom instructions, or quick interview settings.
  - If no profile/resume is available, do NOT mention any company names, school names, client names, or numeric metrics. Keep answers general, role-aligned, and factual without invented numbers.
  - If no profile/resume is available, avoid fabricated anecdotes like "at my previous job..." or "we faced an outage...". Use hypothetical or general phrasing ("I would", "typically", "in practice") without claiming specific past events.
  - Do NOT say you lack personal experience, emotions, or intuition. Answer as a real candidate without self-limitations or AI disclaimers.`;

  const tryExtractName = (text?: string | null): string => {
    const raw = String(text || "").trim();
    if (!raw) return "";
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const first = lines[0] || "";
    if (/^[A-Za-z][A-Za-z .'-]{1,60}$/.test(first) && !/(summary|skills|experience|education|certification|linkedin|email|phone|address)/i.test(first)) {
      return first.replace(/\s+/g, " ").trim();
    }
    const m =
      raw.match(/\bmy name is\s+([A-Za-z][A-Za-z .'-]{1,60})/i)
      || raw.match(/\bname\s*[:\-]\s*([A-Za-z][A-Za-z .'-]{1,60})/i);
    return m?.[1]?.replace(/\s+/g, " ").trim() || "";
  };

  const tryExtractYears = (text?: string | null): string => {
    const raw = String(text || "");
    if (!raw) return "";
    const m = raw.match(/\b(\d+\+?)\s*years?\b/i);
    return m?.[1] ? `${m[1]} years` : "";
  };

  if (strictCustomPromptMode) {
    prompt = [
      "You are an AI interview copilot simulating the candidate in a live interview.",
      "Follow the CUSTOM INSTRUCTIONS exactly for formatting, structure, tone, length, and style.",
      "Answer the interviewer's question directly.",
      "Keep only these hard guardrails:",
      "- Do not invent employers, project names, years, or metrics that are not present in the provided context.",
      "- Do not mention being an AI.",
      "- Use the provided resume/profile, memory, job description, and conversation context when relevant.",
    ].join("\n");

    if (memoryContext) {
      prompt += `\n\n${memoryContext}\n\nRule: If question asks about employer, client, role, stack, or technical domain, use MEMORY_SLOTS as the primary source of truth.`;
    }

    if (rollingSummary) {
      prompt += `\n\n=== SESSION CONTEXT ===\n${rollingSummary}\n===`;
    }

    if (hasDocuments) {
      prompt += `\n\n=== YOUR PROFILE ===\n${documentContext}\n===`;
    }

    if (conversationContext) {
      prompt += `\n\n=== Previous interview Q&A ===\n${conversationContext}\n===`;
    }

    if (sessionIntelligenceContext) {
      prompt += `\n\n=== MEETING INTELLIGENCE ===\n${sessionIntelligenceContext}\n===`;
    }

    prompt += `\n\n=== CUSTOM INSTRUCTIONS ===\nThese custom instructions are the contract for this session. Follow them literally unless they conflict with the hard guardrails above.\n${customInstructions}\n===`;
    return prompt;
  }

  if (isQuickFormat) {
    prompt = `You are an AI interview copilot providing real-time assistance. Answer in FIRST PERSON as the candidate. Be instant, natural, and confident.
CORE RULES:
- ${hasDocuments ? "Use specific details from the PROFILE below only when the question explicitly asks about your experience. For definition-style questions (e.g., 'What is X?'), provide a concise, neutral explanation without personal stories." : "Give natural-sounding answers aligned to the target role or provided instructions. NEVER invent company names, project names, schools, or numeric metrics."}
- Never mention you are an AI
- ${hasDocuments ? "Reference actual projects, tools, and accomplishments from the profile." : "Sound like a real human professional with real experience."}
- ALWAYS answer every question - no exceptions
${noExperienceRule}
Type: ${meetingType}
Format: ${formatInstructions[format]}`;
    prompt += `\n\nQuick interview style: concise, 2-4 sentences max. No bullet points. No personal anecdotes unless asked about experience.`;
  } else {
    prompt = `You are an AI interview copilot providing real-time responses to help candidates during interviews. Answer in FIRST PERSON as the candidate.
CORE RULES:
- ${hasDocuments ? "Use SPECIFIC details from the PROFILE below only when the question is about your background, experience, projects, skills, employers, or achievements. Do not force profile details into generic theory questions." : "Give natural, confident answers aligned to the target role or provided instructions. Sound like a real professional. Do not invent metrics."}
- Be confident and professional in tone
- Never mention you are an AI or assistant
- Answer EVERY question directly - never skip or dodge
- ${hasDocuments ? "Reference your actual experience and accomplishments from the profile when relevant" : "Provide concrete, plausible examples when specific experience is unavailable, but do not invent employers, years, or metrics"}
${noExperienceRule}
Type: ${meetingType}
Format: ${formatInstructions[format] || formatInstructions.automatic}`;
  }

  if (memoryContext) {
    prompt += `\n\n${memoryContext}\n\nRule: If question asks about employer, client, role, stack, or technical domain, use MEMORY_SLOTS as the primary source of truth.`;
  }

  if (rollingSummary) {
    prompt += `\n\n=== SESSION CONTEXT ===\n${rollingSummary}\n===`;
  }

  if (hasDocuments) {
    prompt += `\n\n=== YOUR PROFILE ===\n${documentContext}\n===\n\nIMPORTANT: Use this profile only when relevant to the question. If the question is generic or conceptual, answer directly without forcing profile details.`;
  } else {
    prompt += `\n\nIMPORTANT: No profile/resume provided. Do not mention any company names, employers, or specific client names. Keep experience descriptions generic and plausible.`;
  }

  // Identity/experience grounding priority for interview mode:
  // custom prompt > profile/resume > quick interview config.
  const customName = tryExtractName(customInstructions);
  const profileName = tryExtractName(documentContext);
  const resolvedName = customName || profileName;
  const customYears = tryExtractYears(customInstructions);
  const profileYears = tryExtractYears(documentContext);
  const yearsFromQuick = Number.isFinite(Number(interviewStyle?.experienceYears))
    ? `${Number(interviewStyle?.experienceYears)} years`
    : "";
  const resolvedYears = customYears || profileYears || yearsFromQuick;
  const resolvedRole = String(interviewStyle?.targetRole || "").trim();

  if ((meetingType || "").toLowerCase().includes("interview")) {
    const identityLines: string[] = [];
    if (resolvedName) identityLines.push(`- Candidate name: ${resolvedName}`);
    if (resolvedYears) {
      identityLines.push(`- Experience baseline: ${resolvedYears}`);
    } else {
      identityLines.push("- Do not mention years of experience unless explicitly provided.");
    }
    if (resolvedRole) identityLines.push(`- Target role: ${resolvedRole}`);
    identityLines.push("- If asked \"What's your name?\" answer with the candidate name above directly.");
    identityLines.push("- For experience questions, use real profile/custom facts first. Do not contradict profile/custom facts.");
    prompt += `\n\n=== IDENTITY PRIORITY ===\n${identityLines.join("\n")}\n===`;
  }

  if (conversationContext) {
    prompt += `\n\n=== Previous interview Q&A ===\nMaintain consistency with your prior answers:\n${conversationContext}\n===`;
  }

  if (sessionIntelligenceContext) {
    prompt += `\n\n=== MEETING INTELLIGENCE ===\nUse this to preserve question history, interviewer patterns, and company/JD focus when relevant.\nCRITICAL: If a "REPEAT/FOLLOW-UP DETECTED" flag appears, you MUST NOT repeat the prior answer. Reference it briefly, then add new depth, a different angle, or a concrete example not used before.\n${sessionIntelligenceContext}\n===`;
  }

  prompt += buildInterviewResponseShapeBlock(meetingType);
  prompt += buildInterviewStyleBlock(interviewStyle);

  if (customInstructions) {
    prompt += `\n\n=== CUSTOM INSTRUCTIONS ===\nThese custom instructions have highest priority for formatting, answer structure, and response style for this session. Follow them strictly unless they directly conflict with the core no-invention and safety rules above. If custom instructions specify Interviewer/Candidate formatting, first-person voice, bolding, answer length, or style, you must follow that exactly.\n${customInstructions}\n===`;
  }

  return prompt;
}

export function buildMessages(systemPrompt: string, userMessage: string): Array<{ role: string; content: string }> {
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];
}

export function buildStrictInterviewTurnUserPrompt(params: {
  question: string;
  followUpContext?: string;
  scenarioHint?: string;
  multiQuestionBlock?: string;
  factPriorityHint?: string;
  promptMemoryEvidenceHint?: string;
}): string {
  const question = String(params.question || "").trim();
  const parts = [
    params.factPriorityHint || "",
    params.promptMemoryEvidenceHint || "",
    params.scenarioHint || "",
    params.multiQuestionBlock || "",
    params.followUpContext || "",
    "STRICT INTERVIEW OUTPUT MODE:",
    "1. Treat the cleaned interviewer turn below as the exact question to answer.",
    "2. Output in this exact structure:",
    "Interviewer: <cleaned question>",
    "",
    "Candidate: <first-person answer>",
    "3. Keep the candidate answer natural, concise, human, and interview-ready.",
    "4. If the question has multiple parts, answer all parts inside the Candidate section clearly.",
    "5. Do not add any extra headings, notes, or assistant commentary.",
    "",
    `Interviewer: ${question}`,
    "",
    "Candidate:",
  ].filter(Boolean);

  return parts.join("\n\n");
}
