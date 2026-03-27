# CLAUDE.md — Zoom Mate

## What is this project?

Zoom Mate is a real-time AI interview assistant. It captures meeting audio (mic via Web Speech API + system audio via Whisper), detects questions, and streams AI-generated answers in real-time via SSE. Supports web and desktop (Tauri/Electron).

## Tech Stack

- **Frontend:** React 18 + TypeScript, Tailwind CSS 3, Shadcn/Radix UI, Wouter routing, TanStack React Query v5, Framer Motion
- **Backend:** Express 5 + TypeScript, Drizzle ORM, PostgreSQL (Neon), express-session
- **AI:** OpenAI (GPT-5/4.1/o3/o4-mini), Google Gemini (2.5-flash/pro), Whisper API
- **Payments:** Stripe (Free/Standard/Enterprise plans)
- **Build:** Vite 7 (frontend) + esbuild (backend), tsx for dev
- **Desktop:** Tauri (Rust) + Electron alternative
- **Deploy:** Nginx + systemd on Ubuntu, install.sh auto-installer

## Commands

```bash
npm run dev          # Start dev server (tsx server/index.ts, port 5000)
npm run build        # Production build (script/build.ts → dist/)
npm start            # Run production (NODE_ENV=production node dist/index.cjs)
npm run check        # TypeScript type check
npm run db:push      # Push Drizzle schema migrations
npm run eval         # Run evaluation suite
npm run eval:cases   # Run evaluation with test cases
```

## Project Structure

```
client/src/           # React SPA
  pages/              # Route pages (landing, auth, dashboard, meeting-session, admin, etc.)
  components/ui/      # Shadcn UI components
  hooks/              # Custom React hooks
  lib/                # Utilities, query client, theme provider

server/               # Express backend
  index.ts            # Entry point, middleware setup
  routes.ts           # All API routes (large file ~123KB)
  storage.ts          # Database operations (IStorage interface)
  db.ts               # Drizzle + PostgreSQL connection
  openai.ts           # AI model integration, streaming, vision
  prompt.ts           # System prompts and formatting
  assist/             # AI assist pipeline (orchestrator, streaming, question detection, etc.)
  speech/             # Azure/Deepgram speech token providers
  cache/              # LRU+TTL caching layer
  eval/               # Evaluation/testing suite

shared/               # Shared between client & server
  schema.ts           # Drizzle tables + Zod validation schemas
  questionDetection.ts # Question detection logic
  followup.ts         # Follow-up handling

desktop/              # Tauri + Electron desktop apps
migrations/           # Drizzle database migrations
```

## Key Architecture

- **Auth:** Session-based (express-session + connect-pg-simple), bcrypt passwords, no JWT
- **API pattern:** Express routes → storage layer (DatabaseStorage) → Drizzle ORM → PostgreSQL
- **AI streaming:** SSE via `POST /api/meetings/:id/ask-stream`, AbortController for cancellation
- **Assist pipeline:** `server/assist/` — orchestrator → question detection → retrieval gate → answer streaming → refine pass
- **Audio capture:** Dual mode — mic (Web Speech API) + system audio (getDisplayMedia → Whisper)
- **Response formats:** Automatic, Concise, Detailed, STAR, Bullet, Technical, Short, Custom
- **Path aliases:** `@/*` → `client/src/*`, `@shared/*` → `shared/*`

## Notable Large Files

- `client/src/pages/meeting-session.tsx` (~619KB) — Main meeting UI with audio capture + AI streaming
- `server/assist/streamAssistantAnswer.ts` (~87KB) — Core streaming response handler
- `server/routes.ts` (~123KB) — All API route definitions
- `shared/questionDetection.ts` (~46KB) — Question classification logic
- `server/assist/sessionState.ts` (~37KB) — Session state management

## Environment Variables

**Required:** `DATABASE_URL`, `SESSION_SECRET`, `OPENAI_API_KEY`, `NODE_ENV`
**Optional:** `PORT` (default 5000), `COOKIE_SECURE`
**Admin-configurable (app_settings table):** `openai_api_key`, `gemini_api_key`, `default_model`, `maintenance_mode`, `azure_speech_region`, `azure_speech_key`

## Database

PostgreSQL via Drizzle ORM. Key tables: `users`, `documents`, `document_chunks`, `meetings`, `responses`, `assistants`, `credit_logs`, `announcements`, `app_settings`, `session`. Schema in `shared/schema.ts`.

## Conventions

- Zod schemas generated from Drizzle schema via `drizzle-zod` for request validation
- Dark mode default (class-based toggle)
- Admin routes use `requireAdmin` middleware (`user.role === "admin"`)
- Newer AI models use `max_completion_tokens` instead of `max_tokens`
- Token cap of 1500 for document context injection
- Memory slots: employer, client, role_title, tech_stack, achievements
- No unit test framework — testing via eval suite in `server/eval/`
