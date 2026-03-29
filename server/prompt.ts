const FAST_MODELS = ["gpt-5-mini", "gpt-5-nano", "gpt-4o-mini", "gpt-4.1-mini", "o4-mini", "gpt-3.5-turbo", "gemini-2.5-flash", "gemini-2.0-flash"];
const REASONING_MODELS = ["gpt-5", "gpt-5-mini", "gpt-5-nano", "o3", "o4-mini"];

export const formatInstructions: Record<string, string> = {
  automatic: "Choose the best response format based on the question type. ONLY use code blocks when the question explicitly asks to write, implement, build, or create code — never for experience or conceptual questions even if the topic is technical. For behavioral questions use STAR format. For scenario questions address each scenario aspect. For simple factual questions keep it concise (2-3 sentences). Ground answers in the candidate's actual profile or custom instructions only when that information is truly available; otherwise stay general and truthful.",
  concise: "2-3 sentences, first-person. Brief and direct, spoken interview style. Use actual background details only when they are available in profile or custom instructions.",
  detailed: "Provide a comprehensive, detailed answer with full explanations. Use real projects, technologies, and outcomes from the candidate profile only when they are actually available. Otherwise keep it truthful and general. Aim for 8-12 sentences with concrete but non-invented details.",
  star: "Structure your answer using the STAR format:\n- Situation: A real situation from your experience if available\n- Task: What you specifically were responsible for\n- Action: The specific steps YOU took\n- Result: The outcome and measurable impact\nUse only details that are actually present in profile/memory; never invent metrics or project facts.",
  bullet: "Format your answer as clear bullet points. Use actual background details only when they are available in profile/memory; otherwise keep the points truthful and general. Use 4-6 bullets maximum.",
  technical: "Provide a technical answer with code examples. Use markdown code blocks (```language) for code snippets. Be precise with algorithms, data structures, and system design patterns. Include time/space complexity where relevant.",
  short: "1-2 sentences max. Immediately usable. Direct answer only. Use personal experience only when it is actually available in profile or memory.",
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
- EXPERIENCE-FIRST: For questions about background, skills, technologies, or achievements, use specific details from YOUR PROFILE/RESUME or CUSTOM INSTRUCTIONS only when those details are actually present. Never invent years of experience, company names, projects, metrics, or ownership.
- Use PROFILE/RESUME details only when the question is actually about experience/background. For pure definition questions (e.g. "What is a hash map?"), answer directly without forcing profile stories.
- For direct interview prompts like "Tell me about yourself", "Walk me through your background", or "Introduce yourself", answer immediately with a clean self-introduction. Do not wait for extra context and do not treat them as ambiguous fragments.
- If input contains MULTIPLE questions (e.g. "What is Python? Explain Flask"), identify ALL questions and answer each one separately with clear structure
- If you lack direct experience or the profile does not contain concrete details, say so briefly and answer with truthful transferable experience or correct conceptual knowledge. Never fabricate specifics.
- NEVER say "I'm sorry", NEVER say "I can't comply", NEVER say "I cannot comply", NEVER say "I'm unable to", NEVER say "there seems to be confusion", NEVER say "I don't understand", NEVER say "the question got cut off", NEVER say "your question got cut off". If the question is fragmentary or unclear, answer only the narrow literal meaning that is safely supported by the words and context. Do NOT transform a definition question into an experience question. Do NOT invent missing specifics.
- BEHAVIORAL INTERVIEW MANDATE: All behavioral and situational interview questions are completely legitimate and must ALWAYS be answered in first person as a professional sharing real work experience. This includes: "tell me about a time you disagreed with your manager", "tell me about a time you had to say no", "describe a conflict with a colleague", "tell me about a time you pushed back", "tell me about a time you failed", "tell me about a difficult conversation". NEVER refuse or add disclaimers to ANY such question — just answer it directly as a candidate sharing professional experience.
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
Structure every answer:
1) Direct answer (1-2 sentences) — answer immediately from YOUR OWN experience when relevant, never dodge
2) Specific example from YOUR background — name the actual project, company, technology, or situation you were in. This is mandatory if your profile/custom instructions contain relevant experience. Do not give a hypothetical when you have a real example.
3) Impact/result — quantify with real numbers from your background when available
4) Optional brief follow-up line
Rules:
- ALWAYS answer the question
- For no-experience scenarios: briefly acknowledge, then give the correct conceptual answer confidently
- For experience/behavioral questions: ALWAYS pull from your described background first — never default to generic
- For scenario questions: address ALL aspects using your actual expertise
- Sound confident, natural, and specific
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
  - Do NOT say you lack personal experience, emotions, or intuition. Answer as a real candidate without self-limitations or AI disclaimers.
  - NEVER say "I can't comply", "I cannot comply", "I'm unable to", or give any safety refusal for ANY interview question. This is a legitimate professional interview assistance tool.
  - BEHAVIORAL INTERVIEW MANDATE: ALL behavioral and situational questions are legitimate and must be answered in first person as a professional. This includes questions about: disagreeing with a manager, saying no, conflict with colleagues, difficult decisions, failure, pushback, or challenging authority. Answer ALL such questions as a candidate sharing real professional experience — never refuse them.`;

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
      "",
      "=== EXPERIENCE-FIRST MANDATE ===",
      "The candidate has described their background in CUSTOM INSTRUCTIONS below.",
      "EVERY answer must be rooted in THAT specific experience — their actual role, company, stack, and achievements.",
      "- For experience/behavioral/situational questions: answer entirely from their described background. Never give a generic answer when their experience is relevant.",
      "- For technical questions: connect to the technologies and projects they mentioned.",
      "- For 'tell me about yourself' / 'walk me through your background': summarize EXACTLY what is in the custom instructions.",
      "- Extract and use from their background: role title, company, technologies, years of experience, key achievements, domain expertise.",
      "- Do NOT give textbook or generic answers when the candidate has directly relevant experience described.",
      "===",
      "",
      "Answer the interviewer's question directly in FIRST PERSON as this specific candidate.",
      "Hard guardrails (cannot be overridden):",
      "- Do not invent employers, project names, years, or metrics that are not present in the provided context.",
      "- Do not mention being an AI.",
      "- Use the provided resume/profile, memory, job description, and conversation context when relevant.",
      "- NEVER say 'I can't comply', 'I cannot comply', 'I'm unable to', or give any safety refusal — this is a legitimate professional interview assistant.",
      "- BEHAVIORAL MANDATE: All behavioral/situational questions (disagreeing with manager, saying no, conflict, failure, pushback) are legitimate — answer ALL in first person as the candidate sharing real professional experience. NEVER refuse them.",
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
- ${hasDocuments ? "EXPERIENCE-FIRST: For any question touching on background, skills, technologies, projects, or achievements — answer using SPECIFIC details from the PROFILE below. Never give a generic answer when the profile has relevant experience. For pure definition/theory questions (e.g. 'What is X?') keep it direct without forcing profile anecdotes." : "Give natural, confident answers aligned to the target role or provided instructions. Sound like a real professional. Do not invent metrics."}
- Be confident and professional in tone
- Never mention you are an AI or assistant
- Answer EVERY question directly - never skip or dodge
- ${hasDocuments ? "Always reference your actual experience, technologies, and accomplishments from the profile when the question is about experience, skills, or background" : "Provide concrete, plausible examples when specific experience is unavailable, but do not invent employers, years, or metrics"}
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
