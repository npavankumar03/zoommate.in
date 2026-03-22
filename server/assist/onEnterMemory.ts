export type Role = "interviewer" | "candidate";

export interface Message {
  role: Role;
  content: string;
  ts: number;
}

const sessions: Record<string, Message[]> = {};

export function addMessage(sessionId: string, role: Role, content: string, ts = Date.now()) {
  const clean = String(content || "").trim();
  if (!clean) return;
  if (!sessions[sessionId]) sessions[sessionId] = [];
  sessions[sessionId].push({ role, content: clean, ts });
}

export function getMemory(sessionId: string): Message[] {
  return sessions[sessionId] || [];
}

export function getLastMessage(sessionId: string, role: Role): Message | undefined {
  const list = sessions[sessionId] || [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].role === role) return list[i];
  }
  return undefined;
}
