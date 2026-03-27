import {
  users, documents, documentChunks, meetings, assistants, responses, appSettings, creditLogs, announcements, memorySlots,
  llmRouterConfig, llmCallMetrics, transcriptTurns,
  type User, type InsertUser,
  type Document, type InsertDocument,
  type DocumentChunk,
  type Meeting, type InsertMeeting,
  type Assistant, type InsertAssistant,
  type InterviewStyle,
  type Response, type InsertResponse,
  type CreditLog, type InsertCreditLog,
  type Announcement, type InsertAnnouncement,
  type MemorySlot, type InsertMemorySlot,
  type LLMRouterConfig, type InsertLLMRouterConfig,
  type LLMCallMetric, type InsertLLMCallMetric,
  type TranscriptTurn, type InsertTranscriptTurn,
  type LLMUseCase,
} from "@shared/schema";
import { db, pool } from "./db";
import { eq, desc, sql, count, and, gte, lt, inArray } from "drizzle-orm";

function toInterviewStyle(value: unknown): InterviewStyle | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const out: InterviewStyle = {};

  if (input.framework === "bullets" || input.framework === "star" || input.framework === "car" || input.framework === "concise") {
    out.framework = input.framework;
  }
  if (input.answerLength === "30s" || input.answerLength === "45s" || input.answerLength === "60s" || input.answerLength === "90s") {
    out.answerLength = input.answerLength;
  }
  if (input.tone === "confident" || input.tone === "technical" || input.tone === "concise" || input.tone === "casual") {
    out.tone = input.tone;
  }
  if (typeof input.includeFollowUp === "boolean") {
    out.includeFollowUp = input.includeFollowUp;
  }
  if (typeof input.strictNoInvent === "boolean") {
    out.strictNoInvent = input.strictNoInvent;
  }

  return Object.keys(out).length > 0 ? out : null;
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByGoogleId(googleId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, data: Partial<User>): Promise<User>;
  getAllUsers(): Promise<User[]>;
  getUserCount(): Promise<number>;

  getDocuments(userId: string): Promise<Document[]>;
  getDocument(id: string): Promise<Document | undefined>;
  createDocument(doc: InsertDocument): Promise<Document>;
  deleteDocument(id: string): Promise<void>;
  replaceDocumentChunks(documentId: string, userId: string, chunks: Array<{ chunkIndex: number; content: string; embedding: number[] }>): Promise<void>;
  getDocumentChunks(userId: string, documentIds?: string[]): Promise<DocumentChunk[]>;
  searchDocumentChunks(userId: string, queryEmbedding: number[], documentIds?: string[], limit?: number): Promise<Array<{ chunk: DocumentChunk; score: number }>>;
  deleteDocumentChunksByDocument(documentId: string): Promise<void>;

  getMeetings(userId: string): Promise<Meeting[]>;
  getAllMeetings(): Promise<Meeting[]>;
  getMeeting(id: string): Promise<Meeting | undefined>;
  createMeeting(meeting: InsertMeeting): Promise<Meeting>;
  updateMeeting(id: string, data: Partial<Meeting>): Promise<Meeting>;
  deleteMeeting(id: string): Promise<void>;
  getMeetingCount(): Promise<number>;

  getAssistants(userId: string): Promise<Assistant[]>;
  getAssistant(id: string): Promise<Assistant | undefined>;
  createAssistant(assistant: InsertAssistant): Promise<Assistant>;
  updateAssistant(id: string, data: Partial<Assistant>): Promise<Assistant>;
  deleteAssistant(id: string): Promise<void>;

  getResponses(meetingId: string): Promise<Response[]>;
  createResponse(response: InsertResponse): Promise<Response>;
  getResponseByHash(meetingId: string, questionHash: string): Promise<Response | undefined>;
  getResponseCount(): Promise<number>;

  getSetting(key: string): Promise<string | undefined>;
  setSetting(key: string, value: string): Promise<void>;
  getAllSettings(): Promise<Record<string, string>>;

  createCreditLog(log: InsertCreditLog): Promise<CreditLog>;
  getCreditLogs(userId: string): Promise<CreditLog[]>;
  getAllCreditLogs(): Promise<CreditLog[]>;

  getAnnouncements(): Promise<Announcement[]>;
  getActiveAnnouncements(): Promise<Announcement[]>;
  createAnnouncement(data: InsertAnnouncement): Promise<Announcement>;
  updateAnnouncement(id: string, data: Partial<Announcement>): Promise<Announcement>;
  deleteAnnouncement(id: string): Promise<void>;

  getAdvancedStats(): Promise<{
    totalUsers: number;
    activeUsers: number;
    paidUsers: number;
    totalSessions: number;
    activeSessions: number;
    totalResponses: number;
    totalCredits: number;
    totalReferralCredits: number;
    newUsersToday: number;
    newUsersThisWeek: number;
    revenueEstimate: number;
  }>;

  deleteUser(id: string): Promise<void>;
  bulkUpdateUserStatus(userIds: string[], status: string): Promise<void>;

  getMemorySlots(userId: string, meetingId?: string): Promise<MemorySlot[]>;
  getActiveMemorySlots(userId: string): Promise<MemorySlot[]>;
  upsertMemorySlot(slot: InsertMemorySlot): Promise<MemorySlot>;
  deleteMemorySlotsByMeeting(meetingId: string): Promise<void>;
  deleteMemorySlotsByUser(userId: string): Promise<void>;
  cleanupOldMemorySlots(retentionDays: number): Promise<number>;
  cleanupOldResponses(retentionDays: number): Promise<number>;
  exportUserData(userId: string): Promise<{ meetings: Meeting[]; responses: Response[]; memorySlots: MemorySlot[]; documents: Document[] }>;

  getRouterConfig(useCase: string): Promise<LLMRouterConfig | undefined>;
  getAllRouterConfigs(): Promise<LLMRouterConfig[]>;
  upsertRouterConfig(config: InsertLLMRouterConfig): Promise<LLMRouterConfig>;
  deleteRouterConfig(useCase: string): Promise<void>;

  createCallMetric(metric: InsertLLMCallMetric): Promise<LLMCallMetric>;
  getCallMetrics(limit?: number): Promise<LLMCallMetric[]>;

  createTranscriptTurn(turn: InsertTranscriptTurn): Promise<TranscriptTurn>;
  getTranscriptTurns(meetingId: string): Promise<TranscriptTurn[]>;
  getRecentTranscriptTurns(meetingId: string, limit: number): Promise<TranscriptTurn[]>;
  deleteTranscriptTurns(meetingId: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.googleId, googleId));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUser(id: string, data: Partial<User>): Promise<User> {
    const [updated] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return updated;
  }

  // Atomically increment minutesUsed using a SQL expression to avoid read-modify-write race conditions
  async incrementMinutesUsed(id: string, minutes: number): Promise<{ minutesUsed: number; minutesPurchased: number }> {
    const [updated] = await db
      .update(users)
      .set({ minutesUsed: sql`COALESCE(${users.minutesUsed}, 0) + ${minutes}` })
      .where(eq(users.id, id))
      .returning({ minutesUsed: users.minutesUsed, minutesPurchased: users.minutesPurchased });
    return updated;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }

  async getUserCount(): Promise<number> {
    const [result] = await db.select({ count: count() }).from(users);
    return result.count;
  }

  async getDocuments(userId: string): Promise<Document[]> {
    return db.select().from(documents).where(eq(documents.userId, userId)).orderBy(desc(documents.createdAt));
  }

  async getDocument(id: string): Promise<Document | undefined> {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id));
    return doc || undefined;
  }

  async createDocument(doc: InsertDocument): Promise<Document> {
    const [created] = await db.insert(documents).values(doc).returning();
    return created;
  }

  async deleteDocument(id: string): Promise<void> {
    await db.delete(documentChunks).where(eq(documentChunks.documentId, id));
    await db.delete(documents).where(eq(documents.id, id));
  }

  async replaceDocumentChunks(documentId: string, userId: string, chunks: Array<{ chunkIndex: number; content: string; embedding: number[] }>): Promise<void> {
    await db.delete(documentChunks).where(eq(documentChunks.documentId, documentId));
    if (!chunks.length) return;
    await db.insert(documentChunks).values(
      chunks.map((chunk) => ({
        documentId,
        userId,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        embedding: chunk.embedding,
      })),
    );
  }

  async getDocumentChunks(userId: string, documentIds?: string[]): Promise<DocumentChunk[]> {
    if (documentIds && documentIds.length > 0) {
      return db.select().from(documentChunks)
        .where(and(eq(documentChunks.userId, userId), inArray(documentChunks.documentId, documentIds)))
        .orderBy(documentChunks.documentId, documentChunks.chunkIndex);
    }
    return db.select().from(documentChunks)
      .where(eq(documentChunks.userId, userId))
      .orderBy(documentChunks.documentId, documentChunks.chunkIndex);
  }

  async searchDocumentChunks(userId: string, queryEmbedding: number[], documentIds?: string[], limit = 6): Promise<Array<{ chunk: DocumentChunk; score: number }>> {
    if (!queryEmbedding.length) return [];
    const chunks = await this.getDocumentChunks(userId, documentIds);
    const dot = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + value * (b[index] || 0), 0);
    const magnitude = (values: number[]) => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
    const queryMagnitude = magnitude(queryEmbedding);

    return chunks
      .map((chunk) => {
        const embedding = Array.isArray(chunk.embedding) ? chunk.embedding : [];
        if (!embedding.length) return null;
        const denom = queryMagnitude * magnitude(embedding);
        const score = denom > 0 ? dot(queryEmbedding, embedding) / denom : 0;
        return { chunk, score };
      })
      .filter((item): item is { chunk: DocumentChunk; score: number } => item !== null && item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, limit));
  }

  async deleteDocumentChunksByDocument(documentId: string): Promise<void> {
    await db.delete(documentChunks).where(eq(documentChunks.documentId, documentId));
  }

  async getMeetings(userId: string): Promise<Meeting[]> {
    return db.select().from(meetings).where(eq(meetings.userId, userId)).orderBy(desc(meetings.createdAt));
  }

  async getAllMeetings(): Promise<Meeting[]> {
    return db.select().from(meetings).orderBy(desc(meetings.createdAt));
  }

  async getMeeting(id: string): Promise<Meeting | undefined> {
    const [meeting] = await db.select().from(meetings).where(eq(meetings.id, id));
    return meeting || undefined;
  }

  async createMeeting(meeting: InsertMeeting): Promise<Meeting> {
    const payload = {
      ...meeting,
      interviewStyle: toInterviewStyle(meeting.interviewStyle),
    };
    const [created] = await db.insert(meetings).values(payload).returning();
    return created;
  }

  async updateMeeting(id: string, data: Partial<Meeting>): Promise<Meeting> {
    const [updated] = await db.update(meetings).set(data).where(eq(meetings.id, id)).returning();
    return updated;
  }

  async deleteMeeting(id: string): Promise<void> {
    await db.delete(memorySlots).where(eq(memorySlots.meetingId, id));
    await db.delete(responses).where(eq(responses.meetingId, id));
    await db.delete(meetings).where(eq(meetings.id, id));
  }

  async getMeetingCount(): Promise<number> {
    const [result] = await db.select({ count: count() }).from(meetings);
    return result.count;
  }

  async getAssistants(userId: string): Promise<Assistant[]> {
    return db.select().from(assistants).where(eq(assistants.userId, userId)).orderBy(desc(assistants.updatedAt), desc(assistants.createdAt));
  }

  async getAssistant(id: string): Promise<Assistant | undefined> {
    const [assistant] = await db.select().from(assistants).where(eq(assistants.id, id));
    return assistant || undefined;
  }

  async createAssistant(assistant: InsertAssistant): Promise<Assistant> {
    const payload = {
      ...assistant,
      interviewStyle: toInterviewStyle(assistant.interviewStyle),
    };
    const [created] = await db.insert(assistants).values(payload).returning();
    return created;
  }

  async updateAssistant(id: string, data: Partial<Assistant>): Promise<Assistant> {
    const payload: Partial<Assistant> = {
      ...data,
      updatedAt: new Date(),
    };
    if ("interviewStyle" in payload) {
      payload.interviewStyle = toInterviewStyle(payload.interviewStyle);
    }
    const [updated] = await db.update(assistants).set(payload).where(eq(assistants.id, id)).returning();
    return updated;
  }

  async deleteAssistant(id: string): Promise<void> {
    await db.delete(assistants).where(eq(assistants.id, id));
  }

  async getResponses(meetingId: string): Promise<Response[]> {
    return db.select().from(responses).where(eq(responses.meetingId, meetingId)).orderBy(desc(responses.createdAt));
  }

  async createResponse(response: InsertResponse): Promise<Response> {
    const [created] = await db.insert(responses).values(response).returning();
    return created;
  }

  async getResponseByHash(meetingId: string, questionHash: string): Promise<Response | undefined> {
    const [row] = await db.select().from(responses)
      .where(and(eq(responses.meetingId, meetingId), eq(responses.questionHash, questionHash)))
      .limit(1);
    return row;
  }

  async getResponseCount(): Promise<number> {
    const [result] = await db.select({ count: count() }).from(responses);
    return result.count;
  }

  async getSetting(key: string): Promise<string | undefined> {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
    return row?.value;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await db
      .insert(appSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } });
  }

  async getAllSettings(): Promise<Record<string, string>> {
    const rows = await db.select().from(appSettings);
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  async createCreditLog(log: InsertCreditLog): Promise<CreditLog> {
    const [created] = await db.insert(creditLogs).values(log).returning();
    return created;
  }

  async getCreditLogs(userId: string): Promise<CreditLog[]> {
    return db.select().from(creditLogs).where(eq(creditLogs.userId, userId)).orderBy(desc(creditLogs.createdAt));
  }

  async getAllCreditLogs(): Promise<CreditLog[]> {
    return db.select().from(creditLogs).orderBy(desc(creditLogs.createdAt));
  }

  async getAnnouncements(): Promise<Announcement[]> {
    return db.select().from(announcements).orderBy(desc(announcements.createdAt));
  }

  async getActiveAnnouncements(): Promise<Announcement[]> {
    return db.select().from(announcements).where(eq(announcements.isActive, true)).orderBy(desc(announcements.createdAt));
  }

  async createAnnouncement(data: InsertAnnouncement): Promise<Announcement> {
    const [created] = await db.insert(announcements).values(data).returning();
    return created;
  }

  async updateAnnouncement(id: string, data: Partial<Announcement>): Promise<Announcement> {
    const [updated] = await db.update(announcements).set(data).where(eq(announcements.id, id)).returning();
    return updated;
  }

  async deleteAnnouncement(id: string): Promise<void> {
    await db.delete(announcements).where(eq(announcements.id, id));
  }

  async getAdvancedStats() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);

    const [userCount] = await db.select({ count: count() }).from(users);
    const [activeCount] = await db.select({ count: count() }).from(users).where(eq(users.status, "active"));
    const [paidCount] = await db.select({ count: count() }).from(users).where(sql`${users.plan} != 'free'`);
    const [sessionCount] = await db.select({ count: count() }).from(meetings);
    const [activeSessionCount] = await db.select({ count: count() }).from(meetings).where(eq(meetings.status, "active"));
    const [responseCount] = await db.select({ count: count() }).from(responses);

    const [creditsResult] = await db.select({ total: sql<number>`COALESCE(SUM(${users.minutesPurchased}), 0)` }).from(users);
    const [referralResult] = await db.select({ total: sql<number>`COALESCE(SUM(${users.referralCredits}), 0)` }).from(users);

    const [newTodayResult] = await db.select({ count: count() }).from(users).where(gte(users.createdAt, todayStart));
    const [newWeekResult] = await db.select({ count: count() }).from(users).where(gte(users.createdAt, weekStart));

    const [standardCount] = await db.select({ count: count() }).from(users).where(eq(users.plan, "standard"));
    const [enterpriseCount] = await db.select({ count: count() }).from(users).where(eq(users.plan, "enterprise"));
    const revenueEstimate = (standardCount.count * 14.99) + (enterpriseCount.count * 49.99);

    return {
      totalUsers: userCount.count,
      activeUsers: activeCount.count,
      paidUsers: paidCount.count,
      totalSessions: sessionCount.count,
      activeSessions: activeSessionCount.count,
      totalResponses: responseCount.count,
      totalCredits: Number(creditsResult.total),
      totalReferralCredits: Number(referralResult.total),
      newUsersToday: newTodayResult.count,
      newUsersThisWeek: newWeekResult.count,
      revenueEstimate,
    };
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(documentChunks).where(eq(documentChunks.userId, id));
    await db.delete(memorySlots).where(eq(memorySlots.userId, id));
    await db.delete(creditLogs).where(eq(creditLogs.userId, id));
    await db.delete(responses).where(sql`${responses.meetingId} IN (SELECT id FROM meetings WHERE user_id = ${id})`);
    await db.delete(meetings).where(eq(meetings.userId, id));
    await db.delete(assistants).where(eq(assistants.userId, id));
    await db.delete(documents).where(eq(documents.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }

  async bulkUpdateUserStatus(userIds: string[], status: string): Promise<void> {
    for (const uid of userIds) {
      await db.update(users).set({ status }).where(eq(users.id, uid));
    }
  }

  async getMemorySlots(userId: string, meetingId?: string): Promise<MemorySlot[]> {
    if (meetingId) {
      return db.select().from(memorySlots)
        .where(and(eq(memorySlots.userId, userId), eq(memorySlots.meetingId, meetingId)))
        .orderBy(desc(memorySlots.updatedAt));
    }
    return db.select().from(memorySlots)
      .where(eq(memorySlots.userId, userId))
      .orderBy(desc(memorySlots.updatedAt));
  }

  async getActiveMemorySlots(userId: string): Promise<MemorySlot[]> {
    return db.select().from(memorySlots)
      .where(and(eq(memorySlots.userId, userId), eq(memorySlots.isActive, true)))
      .orderBy(desc(memorySlots.updatedAt));
  }

  async upsertMemorySlot(slot: InsertMemorySlot): Promise<MemorySlot> {
    const existing = await db.select().from(memorySlots)
      .where(and(
        eq(memorySlots.userId, slot.userId),
        eq(memorySlots.slotKey, slot.slotKey),
        eq(memorySlots.isActive, true),
      ))
      .limit(1);

    if (existing.length > 0) {
      const [updated] = await db.update(memorySlots)
        .set({
          slotValue: slot.slotValue,
          confidence: slot.confidence ?? 0.8,
          sourceType: slot.sourceType ?? "extraction",
          sourceResponseId: slot.sourceResponseId,
          meetingId: slot.meetingId,
          updatedAt: new Date(),
        })
        .where(eq(memorySlots.id, existing[0].id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(memorySlots).values(slot).returning();
    return created;
  }

  async deleteMemorySlotsByMeeting(meetingId: string): Promise<void> {
    await db.delete(memorySlots).where(eq(memorySlots.meetingId, meetingId));
  }

  async deleteMemorySlotsByUser(userId: string): Promise<void> {
    await db.delete(memorySlots).where(eq(memorySlots.userId, userId));
  }

  async cleanupOldMemorySlots(retentionDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const result = await db.delete(memorySlots).where(lt(memorySlots.updatedAt, cutoff)).returning();
    return result.length;
  }

  async cleanupOldResponses(retentionDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const result = await db.delete(responses).where(lt(responses.createdAt, cutoff)).returning();
    return result.length;
  }

  async exportUserData(userId: string): Promise<{ meetings: Meeting[]; responses: Response[]; memorySlots: MemorySlot[]; documents: Document[] }> {
    const userMeetings = await this.getMeetings(userId);
    const userDocs = await this.getDocuments(userId);
    const userSlots = await this.getMemorySlots(userId);
    const allResponses: Response[] = [];
    for (const m of userMeetings) {
      const r = await this.getResponses(m.id);
      allResponses.push(...r);
    }
    return { meetings: userMeetings, responses: allResponses, memorySlots: userSlots, documents: userDocs };
  }

  async getRouterConfig(useCase: string): Promise<LLMRouterConfig | undefined> {
    const [config] = await db.select().from(llmRouterConfig).where(eq(llmRouterConfig.useCase, useCase));
    return config || undefined;
  }

  async getAllRouterConfigs(): Promise<LLMRouterConfig[]> {
    return db.select().from(llmRouterConfig).orderBy(llmRouterConfig.useCase);
  }

  async upsertRouterConfig(config: InsertLLMRouterConfig): Promise<LLMRouterConfig> {
    const existing = await this.getRouterConfig(config.useCase);
    if (existing) {
      const [updated] = await db.update(llmRouterConfig)
        .set({
          primaryProvider: config.primaryProvider,
          primaryModel: config.primaryModel,
          fallbackProvider: config.fallbackProvider,
          fallbackModel: config.fallbackModel,
          timeoutMs: config.timeoutMs,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          streamingEnabled: config.streamingEnabled,
        })
        .where(eq(llmRouterConfig.useCase, config.useCase))
        .returning();
      return updated;
    }
    const [created] = await db.insert(llmRouterConfig).values(config).returning();
    return created;
  }

  async deleteRouterConfig(useCase: string): Promise<void> {
    await db.delete(llmRouterConfig).where(eq(llmRouterConfig.useCase, useCase));
  }

  async createCallMetric(metric: InsertLLMCallMetric): Promise<LLMCallMetric> {
    const [created] = await db.insert(llmCallMetrics).values(metric).returning();
    return created;
  }

  async getCallMetrics(limit = 100): Promise<LLMCallMetric[]> {
    return db.select().from(llmCallMetrics).orderBy(desc(llmCallMetrics.createdAt)).limit(limit);
  }

  async createTranscriptTurn(turn: InsertTranscriptTurn): Promise<TranscriptTurn> {
    const [created] = await db.insert(transcriptTurns).values(turn).returning();
    return created;
  }

  async getTranscriptTurns(meetingId: string): Promise<TranscriptTurn[]> {
    return db.select().from(transcriptTurns)
      .where(eq(transcriptTurns.meetingId, meetingId))
      .orderBy(transcriptTurns.turnIndex);
  }

  async getRecentTranscriptTurns(meetingId: string, limit: number): Promise<TranscriptTurn[]> {
    return db.select().from(transcriptTurns)
      .where(eq(transcriptTurns.meetingId, meetingId))
      .orderBy(desc(transcriptTurns.turnIndex))
      .limit(limit);
  }

  async deleteTranscriptTurns(meetingId: string): Promise<void> {
    await db.delete(transcriptTurns).where(eq(transcriptTurns.meetingId, meetingId));
  }
}

export const storage = new DatabaseStorage();
