import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean, real, json } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const ANSWER_STYLES = ["brief", "standard", "deep", "concise", "star", "bullet", "talking_points", "direct_followup"] as const;
export type AnswerStyle = typeof ANSWER_STYLES[number];

export const session = pgTable("session", {
  sid: varchar("sid").primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
});

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull().default(""),
  googleId: text("google_id").unique(),
  email: text("email"),
  emailVerified: boolean("email_verified").notNull().default(false),
  firstName: text("first_name"),
  lastName: text("last_name"),
  role: text("role").notNull().default("user"),
  minutesUsed: integer("minutes_used").notNull().default(0),
  minutesPurchased: integer("minutes_purchased").notNull().default(0),
  referralCredits: integer("referral_credits").notNull().default(0),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  plan: text("plan").notNull().default("free"),
  status: text("status").notNull().default("active"),
  lastLoginAt: timestamp("last_login_at"),
  practiceWindowStart: timestamp("practice_window_start"),
  practiceMinutesUsed: integer("practice_minutes_used").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const emailVerificationCodes = pgTable("email_verification_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  email: text("email").notNull(),
  code: text("code").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const documents = pgTable("documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  content: text("content").notNull(),
  type: text("type").notNull().default("general"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const documentChunks = pgTable("document_chunks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").notNull(),
  userId: varchar("user_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  embedding: json("embedding").$type<number[]>().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const meetings = pgTable("meetings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  title: text("title").notNull(),
  type: text("type").notNull().default("interview"),
  responseFormat: text("response_format").notNull().default("concise"),
  customInstructions: text("custom_instructions"),
  documentIds: text("document_ids").array().default(sql`'{}'::text[]`),
  model: text("model").notNull().default("gpt-4o"),
  status: text("status").notNull().default("setup"),
  totalMinutes: integer("total_minutes").notNull().default(0),
  conversationContext: text("conversation_context").notNull().default(""),
  rollingSummary: text("rolling_summary").notNull().default(""),
  saveTranscript: boolean("save_transcript").notNull().default(true),
  saveFacts: boolean("save_facts").notNull().default(true),
  incognito: boolean("incognito").notNull().default(false),
  turnCount: integer("turn_count").notNull().default(0),
  interviewStyle: json("interview_style").$type<InterviewStyle>(),
  sessionMode: text("session_mode").notNull().default("interview"),
  isPractice: boolean("is_practice").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const assistants = pgTable("assistants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  copilotType: text("copilot_type").notNull().default("custom"),
  responseFormat: text("response_format").notNull().default("concise"),
  customInstructions: text("custom_instructions"),
  documentIds: text("document_ids").array().default(sql`'{}'::text[]`),
  model: text("model").notNull().default("automatic"),
  sessionMode: text("session_mode").notNull().default("interview"),
  interviewStyle: json("interview_style").$type<InterviewStyle>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const responses = pgTable("responses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  meetingId: varchar("meeting_id").notNull(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  responseType: text("response_type").notNull().default("auto"),
  questionHash: text("question_hash"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const creditLogs = pgTable("credit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  adminId: varchar("admin_id").notNull(),
  type: text("type").notNull(),
  amount: integer("amount").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const announcements = pgTable("announcements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: text("type").notNull().default("info"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const memorySlots = pgTable("memory_slots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  meetingId: varchar("meeting_id"),
  slotKey: text("slot_key").notNull(),
  slotValue: text("slot_value").notNull(),
  confidence: real("confidence").notNull().default(0.8),
  sourceType: text("source_type").notNull().default("extraction"),
  sourceResponseId: varchar("source_response_id"),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  documents: many(documents),
  meetings: many(meetings),
  assistants: many(assistants),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  user: one(users, { fields: [documents.userId], references: [users.id] }),
}));

export const documentChunksRelations = relations(documentChunks, ({ one }) => ({
  user: one(users, { fields: [documentChunks.userId], references: [users.id] }),
  document: one(documents, { fields: [documentChunks.documentId], references: [documents.id] }),
}));

export const meetingsRelations = relations(meetings, ({ one, many }) => ({
  user: one(users, { fields: [meetings.userId], references: [users.id] }),
  responses: many(responses),
}));

export const assistantsRelations = relations(assistants, ({ one }) => ({
  user: one(users, { fields: [assistants.userId], references: [users.id] }),
}));

export const responsesRelations = relations(responses, ({ one }) => ({
  meeting: one(meetings, { fields: [responses.meetingId], references: [meetings.id] }),
}));

export const creditLogsRelations = relations(creditLogs, ({ one }) => ({
  user: one(users, { fields: [creditLogs.userId], references: [users.id] }),
}));

export const memorySlotsRelations = relations(memorySlots, ({ one }) => ({
  user: one(users, { fields: [memorySlots.userId], references: [users.id] }),
  meeting: one(meetings, { fields: [memorySlots.meetingId], references: [meetings.id] }),
}));

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  email: true,
  googleId: true,
  firstName: true,
  lastName: true,
}).partial({ password: true, email: true, googleId: true, firstName: true, lastName: true });

export const insertDocumentSchema = createInsertSchema(documents).pick({
  userId: true,
  name: true,
  content: true,
  type: true,
});

export const insertDocumentChunkSchema = createInsertSchema(documentChunks).pick({
  documentId: true,
  userId: true,
  chunkIndex: true,
  content: true,
  embedding: true,
});

export const insertMeetingSchema = createInsertSchema(meetings).pick({
  userId: true,
  title: true,
  type: true,
  responseFormat: true,
  customInstructions: true,
  documentIds: true,
  model: true,
  sessionMode: true,
  interviewStyle: true,
  isPractice: true,
});

export const insertAssistantSchema = createInsertSchema(assistants).pick({
  userId: true,
  name: true,
  copilotType: true,
  responseFormat: true,
  customInstructions: true,
  documentIds: true,
  model: true,
  sessionMode: true,
  interviewStyle: true,
});

export const insertResponseSchema = createInsertSchema(responses).pick({
  meetingId: true,
  question: true,
  answer: true,
  responseType: true,
  questionHash: true,
});

export const insertCreditLogSchema = createInsertSchema(creditLogs).pick({
  userId: true,
  adminId: true,
  type: true,
  amount: true,
  reason: true,
});

export const insertAnnouncementSchema = createInsertSchema(announcements).pick({
  title: true,
  message: true,
  type: true,
});

export const insertMemorySlotSchema = createInsertSchema(memorySlots).pick({
  userId: true,
  meetingId: true,
  slotKey: true,
  slotValue: true,
  confidence: true,
  sourceType: true,
  sourceResponseId: true,
});

export const LLM_USE_CASES = [
  "QUESTION_CLASSIFIER",
  "QUESTION_NORMALIZER",
  "QUESTION_EXTRACTOR",
  "QUESTION_COMPOSER",
  "LIVE_INTERVIEW_ANSWER",
  "SUMMARY_UPDATER",
  "FACT_EXTRACTOR",
  "CODING_ASSIST",
  "ADMIN_TEST_PROMPT",
] as const;
export type LLMUseCase = typeof LLM_USE_CASES[number];

export const llmRouterConfig = pgTable("llm_router_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  useCase: text("use_case").notNull().unique(),
  primaryProvider: text("primary_provider").notNull().default("openai"),
  primaryModel: text("primary_model").notNull().default("gpt-4o-mini"),
  fallbackProvider: text("fallback_provider"),
  fallbackModel: text("fallback_model"),
  timeoutMs: integer("timeout_ms").notNull().default(30000),
  temperature: real("temperature").notNull().default(0.5),
  maxTokens: integer("max_tokens").notNull().default(500),
  streamingEnabled: boolean("streaming_enabled").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const llmCallMetrics = pgTable("llm_call_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id"),
  useCase: text("use_case").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  ttftMs: integer("ttft_ms"),
  success: boolean("success").notNull().default(true),
  errorCode: text("error_code"),
  tokensEstimate: integer("tokens_estimate"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const transcriptTurns = pgTable("transcript_turns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  meetingId: varchar("meeting_id").notNull(),
  turnIndex: integer("turn_index").notNull(),
  speaker: text("speaker").notNull().default("unknown"),
  text: text("text").notNull(),
  startMs: integer("start_ms"),
  endMs: integer("end_ms"),
  confidence: real("confidence"),
  isQuestion: boolean("is_question").notNull().default(false),
  questionType: text("question_type"),
  cleanQuestion: text("clean_question"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLLMRouterConfigSchema = createInsertSchema(llmRouterConfig).pick({
  useCase: true,
  primaryProvider: true,
  primaryModel: true,
  fallbackProvider: true,
  fallbackModel: true,
  timeoutMs: true,
  temperature: true,
  maxTokens: true,
  streamingEnabled: true,
});

export const insertLLMCallMetricsSchema = createInsertSchema(llmCallMetrics).pick({
  sessionId: true,
  useCase: true,
  provider: true,
  model: true,
  latencyMs: true,
  ttftMs: true,
  success: true,
  errorCode: true,
  tokensEstimate: true,
});

export const insertTranscriptTurnSchema = createInsertSchema(transcriptTurns).pick({
  meetingId: true,
  turnIndex: true,
  speaker: true,
  text: true,
  startMs: true,
  endMs: true,
  confidence: true,
  isQuestion: true,
  questionType: true,
  cleanQuestion: true,
});

export const transcriptTurnsRelations = relations(transcriptTurns, ({ one }) => ({
  meeting: one(meetings, { fields: [transcriptTurns.meetingId], references: [meetings.id] }),
}));

export interface InterviewStyle {
  framework?: "bullets" | "star" | "car" | "concise";
  answerLength?: "30s" | "45s" | "60s" | "90s";
  tone?: "confident" | "technical" | "concise" | "casual";
  includeFollowUp?: boolean;
  strictNoInvent?: boolean;
  quickInterview?: boolean;
  targetRole?: string;
  experienceYears?: number;
}

export const SESSION_MODES = ["interview", "coding", "screenshare"] as const;
export type SessionMode = typeof SESSION_MODES[number];

export const MEMORY_SLOT_KEYS = [
  "employer", "client", "role_title", "domain", "tech_stack", "achievements",
] as const;

export type MemorySlotKey = typeof MEMORY_SLOT_KEYS[number];

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documents.$inferSelect;
export type InsertDocumentChunk = z.infer<typeof insertDocumentChunkSchema>;
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type InsertMeeting = z.infer<typeof insertMeetingSchema>;
export type Meeting = typeof meetings.$inferSelect;
export type InsertAssistant = z.infer<typeof insertAssistantSchema>;
export type Assistant = typeof assistants.$inferSelect;
export type InsertResponse = z.infer<typeof insertResponseSchema>;
export type Response = typeof responses.$inferSelect;
export type CreditLog = typeof creditLogs.$inferSelect;
export type InsertCreditLog = z.infer<typeof insertCreditLogSchema>;
export type Announcement = typeof announcements.$inferSelect;
export type InsertAnnouncement = z.infer<typeof insertAnnouncementSchema>;
export type MemorySlot = typeof memorySlots.$inferSelect;
export type InsertMemorySlot = z.infer<typeof insertMemorySlotSchema>;
export type LLMRouterConfig = typeof llmRouterConfig.$inferSelect;
export type InsertLLMRouterConfig = z.infer<typeof insertLLMRouterConfigSchema>;
export type LLMCallMetric = typeof llmCallMetrics.$inferSelect;
export type InsertLLMCallMetric = z.infer<typeof insertLLMCallMetricsSchema>;
export type TranscriptTurn = typeof transcriptTurns.$inferSelect;
export type InsertTranscriptTurn = z.infer<typeof insertTranscriptTurnSchema>;
export type EmailVerificationCode = typeof emailVerificationCodes.$inferSelect;
