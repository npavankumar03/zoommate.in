# Zoom Mate - AI Interview Assistant

## Overview
Zoom Mate is a real-time AI interview assistant. It listens to meeting conversations via server-side speech-to-text (OpenAI Whisper or Google Cloud STT), captures context, and provides instant AI-generated streaming responses using OpenAI or Google Gemini models. Built as a full-stack TypeScript application with production-level admin panel and self-hosted deployment support.

## Recent Changes
- 2026-02-21: Azure Speech SDK integration for real-time streaming STT. Server-side token minting (server/speech/azureToken.ts) with 540s TTL cache, rate limiting (10/min/user), STS token exchange — subscription key never sent to client. AzureRecognizer client module (client/src/lib/stt/azureRecognizer.ts) with partial/final callbacks, 500ms silence endpointing, AudioWorklet/ScriptProcessor fallback, mic + system audio via PushAudioInputStream. Multi-tier STT fallback: Azure → Browser Web Speech → Server Whisper. Admin Azure Speech key/region config in Settings tab (key masked, last 4 chars shown). Transcription Engine selector in meeting pre-listen UI with localStorage persistence. Enhanced question detection prompts: detailed classification rules with confidence calibration, ASR artifact cleanup in normalizer, filler stripping.
- 2026-02-20: Answer locking via questionHash (SHA-256 dedup prevents duplicate LLM calls for same question). Fact lookup fast path (memory slots answered directly for simple employer/role/stack queries). Interview Style settings (framework: bullets/STAR/CAR/concise, answer length: 30s-90s, tone: confident/technical/casual, follow-up line, strict no-invent) injected into system prompts via buildInterviewStyleBlock. Session Mode selector (interview/coding/screenshare) at meeting creation. Live Coding mode with CodeMirror 6 editor panel (JS/TS/Python syntax highlighting, Ask AI button for code review via CODING_ASSIST use case). AudioWorklet PCM streaming client (16kHz mono capture → binary WebSocket → Google Cloud STT streaming recognition). WsMicStreamer class with reconnection and ScriptProcessor fallback.
- 2026-02-20: Phase 2 infrastructure: Per-use-case LLM Router (llmRouter2.ts) with DB-configurable models per use case (QUESTION_CLASSIFIER, LIVE_INTERVIEW_ANSWER, SUMMARY_UPDATER, FACT_EXTRACTOR, QUESTION_NORMALIZER, CODING_ASSIST), fallback logic, TTL cache, metrics tracking (latency/TTFT/success). WebSocket /ws/stt endpoint for real-time STT with session auth, silence endpointing, question detection pipeline (rule gate → LLM classifier → LLM normalizer). SSE assistant streaming with barge-in/cancel (AbortController per session, 15s keepalive). Admin LLM Router tab with per-use-case editing, metrics dashboard. New tables: llm_router_config, llm_call_metrics, transcript_turns.
- 2026-02-19: Hybrid transcription: Mic mode uses instant browser Web Speech API (real-time, zero latency) with automatic server-side Whisper fallback for unsupported browsers. System Audio mode uses server-side Whisper/Google Cloud STT (configurable). Language selector (20+ languages including Indian English variants). Separate micStreamRef from systemAudioStreamRef to prevent stream ref collision. Better Google STT error handling with auto-fallback to Whisper when credentials not configured.
- 2026-02-19: Privacy-first Memory Layer: memory_slots table for structured fact extraction (employer, role, tech_stack, domain, achievements, etc.), rolling session summaries (900 char cap, updated every 3 turns), incognito mode toggle, save transcript/facts toggles, memory panel UI in meeting session. Anti-feedback loop protection for system audio capture. Memory context injected into AI prompts. Admin retention policy settings (memory_retention_days, transcript_retention_days) with cleanup route. User data export endpoint. Async extraction via gpt-4o-mini after each answer.
- 2026-02-19: Fixed document upload: server-side PDF parsing (pdf-parse), DOCX parsing (mammoth), proper file upload via multipart/form-data endpoint. Dashboard shows file preview, handles binary files correctly.
- 2026-02-19: Advanced meeting listening: auto-answer cooldown reduced to 2s, question queuing during streaming (queued questions auto-fire when current answer completes), real-time interim text question detection (shows detected question while user is still speaking). Prominent "Question Detected" banner with Answer Now CTA, streaming question header above response, transcript segments highlighted with MessageSquare icons. Full-width Generate Answer button, improved keyboard hints.
- 2026-02-19: Segmented transcript redesign: speech recognition now creates individual line segments instead of continuous blob. Smart question detection extracts clean questions from segments (strips filler prefixes like "ok so", "question is"). Auto-answer scans last 3 segments + merged pairs for questions. Generate button extracts and sends only the detected question. Questions highlighted in transcript. Non-substantive segments filtered out. Matches HuddleMate-style listening behavior.
- 2026-02-19: Quick Response Flow: Tier-0 minimal prompt for instant TTFT, parallel doc/context fetch (doesn't block first token), server-side TTL caching for API keys/settings (10min), assistant_start SSE event, client-side Quick Response Mode toggle, throttled chunk rendering (80ms buffer), immediate "Answering..." UI state, performance instrumentation logging (TTFT/total/model/quickMode)
- 2026-02-18: Fixed GPT-5/o-series streaming (reasoning token budget fix - 8x multiplier for max_completion_tokens). Simplified meeting UI: pre-listening shows centered audio source picker, post-listening hides controls and shows split-panel (transcript left, AI responses right) with inline manual question input. Node.js fetch stream parsing fix (for await + async iterator).
- 2026-02-18: AI refactor into modular architecture (server/prompt.ts, server/llmRouter.ts, server/llmStream.ts), raw fetch OpenAI streaming, provider router with fallback logic. Auto-answer with question detection (shared/questionDetection.ts), cooldown/dedup, toggleable via UI. Google Cloud STT integration as alternative transcription engine (ffmpeg webm->wav conversion + @google-cloud/speech), admin credentials management, provider selector in meeting UI.
- 2026-02-18: System audio capture via getDisplayMedia + Whisper API for Zoom/Teams audio, new model support (GPT-5, GPT-5-mini, GPT-5-nano, o3, o4-mini, GPT-4.1), Automatic response format, removed model/format selectors from active meeting (set at creation only), audio level indicator, fixed response format reset bug
- 2026-02-18: Enter/Space key trigger for sending transcript questions (replaces auto-send), robust speech recognition restart, custom response format with user prompt, markdown/code block rendering with syntax highlighting, Gemini API key validation, speed optimizations (shorter prompts, reduced tokens)
- 2026-02-17: Full rebrand from AceMate to Zoom Mate across all pages, backend, system prompt, meta tags
- 2026-02-17: Advanced admin panel: bulk user actions, user status management (active/suspended/banned), delete user, CSV data export, announcements system, maintenance mode toggle, enhanced stats (revenue estimate, new users today/week, active sessions)
- 2026-02-17: Added install.sh for single-command Ubuntu server deployment and TROUBLESHOOT.md
- 2026-02-17: New schema: announcements table, users.status field, users.lastLoginAt tracking
- 2026-02-14: Added multi-model support (OpenAI + Gemini), API key management in admin portal, model selector per session, Stripe billing integration
- 2026-02-14: Full rebrand to Zoom Mate with Zap icon, streaming SSE responses, admin panel, download page, compact/stealth mode
- 2026-02-13: Initial MVP build - Landing page, auth, dashboard, meeting session with AI responses

## Architecture
- **Frontend**: React + TypeScript + Tailwind CSS + Shadcn UI + Framer Motion
- **Backend**: Express.js + TypeScript
- **Database**: PostgreSQL via Drizzle ORM
- **AI**: OpenAI (GPT-5, GPT-5-mini, GPT-5-nano, o3, o4-mini, GPT-4.1, GPT-4.1-mini, GPT-4o, GPT-4o-mini) + Google Gemini (gemini-2.5-flash, gemini-2.5-pro, gemini-2.0-flash) with SSE streaming via raw fetch (OpenAI) + SDK (Gemini). Whisper + Google Cloud STT for system audio transcription. Modular architecture: server/prompt.ts, server/llmRouter.ts, server/llmStream.ts. Per-use-case LLM Router (server/llmRouter2.ts) with DB-configurable model routing, fallback, metrics. Question detection pipeline: server/assist/questionDetect.ts (rule gate → LLM classifier → normalizer). WebSocket STT: server/realtime/wsStt.ts. Streaming with barge-in: server/assist/answerStream.ts
- **Auth**: Session-based with express-session + connect-pg-simple
- **Payments**: Stripe subscriptions (Free, Standard $14.99/mo, Enterprise $49.99/mo)

## Key Pages
- `/` - Landing page with hero, pain points, how-it-works, features, comparison, pricing, testimonials, FAQ, download CTA
- `/login` - Login page
- `/signup` - Signup page
- `/dashboard` - Dashboard with sessions list, documents/knowledge base management, usage stats, billing tab
- `/meeting/:id` - Active meeting session with streaming AI responses, speech recognition, compact mode, model selector
- `/admin` - Advanced admin panel (see Admin Features below)
- `/download` - Desktop app download page for Windows/Mac/Linux

## Database Tables
- `users` - User accounts (id, username, password, email, role, minutesUsed, minutesPurchased, referralCredits, stripeCustomerId, stripeSubscriptionId, plan, status, lastLoginAt, createdAt)
- `documents` - Knowledge base documents (resume, notes, job descriptions)
- `meetings` - Meeting sessions with type, format, model, instructions, conversationContext, documentIds, rollingSummary, saveTranscript, saveFacts, incognito, turnCount
- `responses` - AI-generated responses per meeting
- `memory_slots` - Structured fact extraction per user/meeting (slotKey: employer/role/tech_stack/domain/achievements/etc, slotValue, confidence, sourceType, isActive)
- `credit_logs` - Admin credit/referral/subscription action audit logs
- `announcements` - System announcements (title, message, type, isActive)
- `app_settings` - Key-value store for API keys and config
- `llm_router_config` - Per-use-case LLM model routing config (useCase, primaryProvider, primaryModel, fallbackProvider, fallbackModel, timeoutMs, temperature, maxTokens, streamingEnabled)
- `llm_call_metrics` - LLM call tracking (sessionId, useCase, provider, model, latencyMs, ttftMs, success, errorCode, tokensEstimate)
- `transcript_turns` - Append-only finalized transcript turns (meetingId, turnIndex, speaker, text, startMs, endMs, confidence, isQuestion, questionType, cleanQuestion)

## API Routes
- POST /api/auth/signup, /api/auth/login, /api/auth/logout, GET /api/auth/me
- GET/POST /api/documents, DELETE /api/documents/:id
- GET/POST /api/meetings, GET/PATCH/DELETE /api/meetings/:id
- GET /api/meetings/:id/responses, POST /api/meetings/:id/ask, POST /api/meetings/:id/ask-stream (SSE)
- POST /api/meetings/:id/analyze-screen
- GET /api/models
- GET /api/memory/slots, DELETE /api/memory/all (user memory management)
- GET/DELETE /api/meetings/:id/memory (session memory)
- GET /api/export/data (user data export)
- GET /api/announcements (active announcements for users)
- **Admin Routes:**
  - GET /api/admin/stats (advanced stats with revenue, new users, active sessions)
  - GET /api/admin/users, PATCH /api/admin/users/:id, DELETE /api/admin/users/:id
  - POST /api/admin/users/bulk-status (bulk activate/suspend/ban)
  - POST /api/admin/users/:id/grant-credits, POST /api/admin/users/:id/grant-referral-credits
  - POST /api/admin/users/:id/cancel-subscription, GET /api/admin/users/:id/credit-logs
  - GET /api/admin/credit-logs
  - GET/POST /api/admin/announcements, PATCH/DELETE /api/admin/announcements/:id
  - POST /api/admin/maintenance (toggle maintenance mode)
  - GET /api/admin/export/users, GET /api/admin/export/sessions (CSV export)
  - GET /api/admin/settings, PATCH /api/admin/settings
  - POST /api/admin/memory/cleanup (retention policy cleanup)
  - GET /api/admin/meetings
- **Stripe:** GET /api/stripe/products, POST /api/stripe/checkout, GET /api/stripe/subscription, POST /api/stripe/portal

## Admin Panel Features
- **Dashboard Stats**: Total users, paid users (with MRR estimate), sessions, responses, new users today/this week, total credits
- **User Management**: Search/filter by plan/status, expandable user rows with full details, role/plan/status selectors
- **Bulk Actions**: Select multiple users, bulk activate/suspend/ban
- **User Actions**: Grant credits, grant referral credits, cancel subscription, view credit history, delete user
- **Sessions Tab**: All sessions with user info, model, status; CSV export
- **Announcements**: Create/toggle/delete system announcements (info/warning/critical/success types)
- **Activity Log**: Full audit trail of all admin actions
- **Settings**: API key management (OpenAI + Gemini + Google STT), default model configuration
- **Maintenance Mode**: Toggle system-wide maintenance mode
- **Data Export**: CSV export for users and sessions

## Deployment
- **install.sh**: Single-command Ubuntu server installer (Node.js, PostgreSQL, Nginx, SSL, systemd service)
- **TROUBLESHOOT.md**: Comprehensive troubleshooting guide for installation and operation

## User Preferences
- Dark mode by default
- Inter font family
