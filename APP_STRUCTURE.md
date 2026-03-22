# Zoom Mate - Complete Application Structure

## Table of Contents
1. [Overview](#overview)
2. [Tech Stack](#tech-stack)
3. [Project File Structure](#project-file-structure)
4. [Frontend Architecture](#frontend-architecture)
5. [Backend Architecture](#backend-architecture)
6. [Database Schema](#database-schema)
7. [AI Integration (Multi-Model)](#ai-integration-multi-model)
8. [Speech Recognition & Question Detection](#speech-recognition--question-detection)
9. [Screen Analysis (Vision AI)](#screen-analysis-vision-ai)
10. [Real-Time Streaming (SSE)](#real-time-streaming-sse)
11. [Authentication & Sessions](#authentication--sessions)
12. [Stripe Payment Integration](#stripe-payment-integration)
13. [Admin Panel](#admin-panel)
14. [API Routes Reference](#api-routes-reference)
15. [Application Flow (How It Works)](#application-flow-how-it-works)
16. [Self-Hosted Deployment](#self-hosted-deployment)
17. [Environment Variables](#environment-variables)

---

## Overview

Zoom Mate is a real-time AI interview assistant that listens to meeting conversations via browser-based speech recognition, captures context, and provides instant AI-generated streaming responses. It supports multiple AI models (OpenAI GPT + Google Gemini), includes Stripe subscription billing, a full admin panel, and can be self-hosted on Ubuntu servers with a single install script.

**Key Capabilities:**
- Dual audio capture: Microphone (Web Speech API) + System Audio (getDisplayMedia + Whisper API for Zoom/Teams)
- Enter/Space keyboard triggers for sending transcript to AI
- AI-powered answer generation with SSE streaming (Server-Sent Events), optimized for sub-second perceived latency
- Screen capture analysis using Vision AI (GPT-4o / Gemini)
- Multi-model support: OpenAI (GPT-5, GPT-5-mini, GPT-5-nano, o3, o4-mini, GPT-4.1, GPT-4.1-mini, GPT-4o, GPT-4o-mini) + Google Gemini (gemini-2.5-flash, gemini-2.5-pro, gemini-2.0-flash)
- Response formats: Automatic (AI picks best format), Concise, Detailed, STAR, Bullet, Technical, Short, Custom (user-defined prompt)
- Knowledge base: upload resumes, notes, job descriptions for personalized answers
- Stripe subscription billing (Free / Standard / Enterprise)
- Comprehensive admin panel with user management, analytics, announcements
- Compact/stealth mode for discreet use during live meetings
- Markdown rendering with syntax-highlighted code blocks
- AbortController-based stream cancellation and Deep Re-run capability
- Audio level visualization during listening
- Self-hosted deployment via install.sh (Ubuntu + Nginx + SSL + systemd)

---

## Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| React 18 | UI framework |
| TypeScript | Type safety |
| Tailwind CSS 3 | Utility-first styling |
| Shadcn UI (Radix) | Component library (buttons, cards, dialogs, tabs, forms, etc.) |
| Framer Motion | Animations |
| Wouter | Client-side routing |
| TanStack React Query v5 | Server state management, data fetching, caching |
| React Hook Form + Zod | Form handling with schema validation |
| Lucide React | Icon library |
| React Icons | Company/brand logos |
| Recharts | Charts in admin dashboard |
| Web Speech API | Browser-native speech recognition (microphone mode) |
| Multer | File upload handling for audio transcription |

### Backend
| Technology | Purpose |
|---|---|
| Express.js 5 | HTTP server and API framework |
| TypeScript (tsx) | Runtime and type checking |
| Drizzle ORM | Database queries, schema definition, migrations |
| PostgreSQL (Neon) | Primary database |
| express-session + connect-pg-simple | Session management stored in PostgreSQL |
| bcrypt | Password hashing (10 salt rounds) |
| OpenAI SDK | GPT model access (chat completions + vision + Whisper transcription) |
| @google/generative-ai | Google Gemini model access |
| multer | Multipart file upload handling (audio chunks for Whisper) |
| Stripe SDK + stripe-replit-sync | Payment processing, webhook handling, subscription management |
| Zod | Request body validation |

### Build & Dev
| Technology | Purpose |
|---|---|
| Vite 7 | Frontend bundler + dev server with HMR |
| esbuild | Production build for server |
| drizzle-kit | Database schema push/migrations |
| PostCSS + Autoprefixer | CSS processing |

### Deployment
| Technology | Purpose |
|---|---|
| install.sh | Single-command Ubuntu server installer |
| Nginx | Reverse proxy with SSL termination |
| Certbot (Let's Encrypt) | Free SSL certificates |
| systemd | Process management (auto-restart on crash/reboot) |
| Node.js 20.x | Production runtime |
| PostgreSQL 16 | Production database |

---

## Project File Structure

```
zoom-mate/
├── client/                          # Frontend (React + Vite)
│   └── src/
│       ├── main.tsx                 # App entry point
│       ├── App.tsx                  # Root component, routing setup
│       ├── index.css                # Global styles, Tailwind config, CSS variables
│       ├── pages/
│       │   ├── landing.tsx          # Landing page (hero, features, pricing, FAQ, testimonials)
│       │   ├── auth.tsx             # Login + Signup pages
│       │   ├── dashboard.tsx        # User dashboard (sessions, documents, billing, usage)
│       │   ├── meeting-session.tsx  # Active meeting page (dual audio, AI responses, compact mode)
│       │   ├── admin.tsx            # Admin panel (users, sessions, announcements, settings, activity log)
│       │   ├── download.tsx         # Desktop app download page
│       │   └── not-found.tsx        # 404 page
│       ├── components/
│       │   └── ui/                  # Shadcn UI components (button, card, dialog, tabs, etc.)
│       ├── hooks/
│       │   ├── use-toast.ts         # Toast notification hook
│       │   └── use-mobile.tsx       # Mobile detection hook
│       └── lib/
│           ├── queryClient.ts       # TanStack Query client setup with default fetcher
│           ├── theme-provider.tsx   # Dark/light theme toggle with localStorage
│           └── utils.ts             # Utility functions (cn for class merging)
│
├── server/                          # Backend (Express + TypeScript)
│   ├── index.ts                     # Server entry point, Stripe init, webhook route, middleware
│   ├── routes.ts                    # All API routes (auth, meetings, documents, admin, stripe)
│   ├── storage.ts                   # IStorage interface + DatabaseStorage implementation (all DB operations)
│   ├── openai.ts                    # AI module: OpenAI + Gemini clients, system prompts, streaming, vision
│   ├── db.ts                        # Drizzle ORM + PostgreSQL pool setup
│   ├── stripeClient.ts              # Stripe client factory, publishable key, StripeSync setup
│   ├── webhookHandlers.ts           # Stripe webhook processing
│   ├── vite.ts                      # Vite dev server integration (dev mode only)
│   └── static.ts                    # Static file serving (production mode)
│
├── shared/
│   └── schema.ts                    # Drizzle schema definitions, Zod validation schemas, TypeScript types
│
├── scripts/
│   └── seed-products.ts             # Seed Stripe products/prices
│
├── install.sh                       # Single-command Ubuntu server deployment script
├── TROUBLESHOOT.md                  # Troubleshooting guide for installation & operation
├── drizzle.config.ts                # Drizzle Kit configuration
├── vite.config.ts                   # Vite build configuration
├── tailwind.config.ts               # Tailwind CSS configuration
├── tsconfig.json                    # TypeScript configuration
├── package.json                     # Dependencies and scripts
└── replit.md                        # Project documentation for AI agent context
```

---

## Frontend Architecture

### Routing (Wouter)
```
/               -> Landing page (public)
/login          -> Login page (public)
/signup         -> Signup page (public)
/dashboard      -> User dashboard (authenticated)
/meeting/:id    -> Active meeting session (authenticated)
/admin          -> Admin panel (admin role only)
/download       -> Desktop app download page (public)
```

### State Management
- **Server state**: TanStack React Query v5 handles all API data fetching, caching, and cache invalidation
- **Local state**: React useState/useRef for UI state (transcript, listening status, compact mode, form inputs)
- **Theme**: ThemeProvider with localStorage persistence (dark mode default)
- **No Redux/Zustand** - TanStack Query + local state is sufficient

### Key Frontend Flows

#### Dual Audio Capture Flow (meeting-session.tsx)

**Mode 1: Microphone (Web Speech API)**
```
User clicks "Microphone" button
  -> Browser Web Speech API activates (webkitSpeechRecognition)
  -> Continuous mode, interim results enabled
  -> recognition.onresult fires for each speech segment
  -> Final transcripts accumulate in transcript state
  -> User presses Enter or Space to send transcript to AI
  -> Full transcript sent to /api/meetings/:id/ask-stream (SSE)
  -> Streaming response renders in real-time
  -> Transcript clears, cycle repeats
  -> Auto-restart on recognition end (robust reconnection)
```

**Mode 2: System Audio (getDisplayMedia + Whisper API)**
```
User clicks "System Audio (Zoom/Teams)" button
  -> Browser prompts getDisplayMedia with audio:true
  -> User selects Chrome tab with "Share tab audio" enabled
  -> MediaRecorder captures audio chunks (WebM/Opus format)
  -> Every 5 seconds: chunk sent to POST /api/transcribe
  -> Server forwards audio to OpenAI Whisper API for transcription
  -> Transcribed text appended to transcript state
  -> User presses Enter or Space to send to AI
  -> Audio level visualization via Web Audio API analyser node
```

#### AI Response Streaming (meeting-session.tsx)
```
askStreamingQuestion(question)
  -> AbortController created for cancellation support
  -> POST /api/meetings/:id/ask-stream
  -> SSE connection opens via fetch ReadableStream
  -> Server yields chunks from OpenAI/Gemini
  -> Each chunk appended to streamingAnswer state
  -> Markdown rendered in real-time with syntax-highlighted code blocks
  -> On "done" event: response saved to DB, cache invalidated
  -> On "error" event: error toast shown
  -> Stream can be cancelled via AbortController (new question or user action)
  -> Deep Re-run: regenerate any response with GPT-5 for better quality
```

### Compact/Stealth Mode
- Minimal floating UI for use during live meetings
- Shows only: listen button, text input, streaming answer, recent responses
- Small, unobtrusive overlay the interviewer cannot see

---

## Backend Architecture

### Server Startup Sequence (server/index.ts)
```
1. Create Express app + HTTP server
2. Register Stripe webhook route (BEFORE json body parser - raw buffer required)
3. Configure body parsers (JSON 50mb, URL-encoded 50mb)
4. Initialize Stripe (run migrations, set up webhook, sync backfill)
5. Register all API routes (auth, meetings, documents, admin, stripe)
6. Set up error handler
7. Set up Vite (dev) or static serving (production)
8. Listen on port 5000 (0.0.0.0)
```

### Storage Layer (server/storage.ts)
All database operations go through the `IStorage` interface, implemented by `DatabaseStorage`. This keeps routes thin and testable.

**Operations:**
- User CRUD (create, read, update, delete, bulk status update)
- Document CRUD (create, read, delete per user)
- Meeting CRUD (create, read, update, delete, get all for admin)
- Response CRUD (create, read per meeting)
- Settings key-value store (get, set, get all)
- Credit logs (create, read per user, read all)
- Announcements (create, read, update, delete, get active only)
- Advanced stats (aggregated user/session/revenue metrics)

### Request Validation
- Zod schemas generated from Drizzle schema via `drizzle-zod`
- Request bodies validated before hitting storage layer
- Session-based auth middleware (`requireAuth`) checks `req.session.userId`
- Admin routes have additional `requireAdmin` middleware checking `user.role === "admin"`

---

## Database Schema

### Tables (PostgreSQL via Drizzle ORM)

#### users
| Column | Type | Notes |
|---|---|---|
| id | VARCHAR (UUID) | Primary key, auto-generated |
| username | TEXT | Unique, required |
| password | TEXT | bcrypt hashed |
| email | TEXT | Optional |
| role | TEXT | "user" or "admin" |
| minutesUsed | INTEGER | Usage tracking |
| minutesPurchased | INTEGER | Purchased credits |
| referralCredits | INTEGER | Referral bonus credits |
| stripeCustomerId | TEXT | Stripe customer ID |
| stripeSubscriptionId | TEXT | Stripe subscription ID |
| plan | TEXT | "free", "standard", or "enterprise" |
| status | TEXT | "active", "suspended", or "banned" |
| lastLoginAt | TIMESTAMP | Last login tracking |
| createdAt | TIMESTAMP | Account creation date |

#### documents
| Column | Type | Notes |
|---|---|---|
| id | VARCHAR (UUID) | Primary key |
| userId | VARCHAR | Foreign key to users |
| name | TEXT | Document name |
| content | TEXT | Full text content |
| type | TEXT | "general", "resume", "notes", "job_description" |
| createdAt | TIMESTAMP | Upload date |

#### meetings
| Column | Type | Notes |
|---|---|---|
| id | VARCHAR (UUID) | Primary key |
| userId | VARCHAR | Foreign key to users |
| title | TEXT | Session name |
| type | TEXT | "interview", "technical", "behavioral", "general" |
| responseFormat | TEXT | "automatic", "concise", "detailed", "star", "bullet", "technical", "short", "custom" |
| customInstructions | TEXT | Optional user instructions (includes custom format prompt if format=custom) |
| documentIds | TEXT[] | Array of attached document IDs |
| model | TEXT | AI model to use (e.g., "gpt-5-mini", "gemini-2.5-flash") |
| status | TEXT | "setup", "active", "completed" |
| totalMinutes | INTEGER | Session duration tracking |
| conversationContext | TEXT | Running transcript context |
| createdAt | TIMESTAMP | Session start time |

#### responses
| Column | Type | Notes |
|---|---|---|
| id | VARCHAR (UUID) | Primary key |
| meetingId | VARCHAR | Foreign key to meetings |
| question | TEXT | Transcribed question |
| answer | TEXT | AI-generated answer |
| responseType | TEXT | Format used for this response |
| createdAt | TIMESTAMP | Response timestamp |

#### credit_logs
| Column | Type | Notes |
|---|---|---|
| id | VARCHAR (UUID) | Primary key |
| userId | VARCHAR | Target user |
| adminId | VARCHAR | Admin who performed action |
| type | TEXT | "credit_grant", "referral_grant", "subscription_cancel" |
| amount | INTEGER | Credit amount |
| reason | TEXT | Optional reason |
| createdAt | TIMESTAMP | Action timestamp |

#### announcements
| Column | Type | Notes |
|---|---|---|
| id | VARCHAR (UUID) | Primary key |
| title | TEXT | Announcement title |
| message | TEXT | Announcement body |
| type | TEXT | "info", "warning", "critical", "success" |
| isActive | BOOLEAN | Toggle visibility |
| createdAt | TIMESTAMP | Creation date |

#### app_settings
| Column | Type | Notes |
|---|---|---|
| key | TEXT | Primary key (setting name) |
| value | TEXT | Setting value |

**Common settings stored:** `openai_api_key`, `gemini_api_key`, `default_model`, `maintenance_mode`

### Relationships
```
users -> documents (one-to-many)
users -> meetings (one-to-many)
meetings -> responses (one-to-many)
users -> credit_logs (one-to-many)
```

### Session Storage
- `session` table (auto-created by connect-pg-simple)
- Stores express-session data in PostgreSQL
- Sessions pruned every 15 minutes
- 30-day cookie expiry

---

## AI Integration (Multi-Model)

### Supported Models

**OpenAI (via openai SDK):**
- gpt-5 (most capable, used for Deep Re-run)
- gpt-5-mini (default, fast + capable)
- gpt-5-nano (fastest, lightweight)
- o3 (reasoning model)
- o4-mini (fast reasoning)
- gpt-4.1 (stable, supports temperature)
- gpt-4.1-mini (fast, supports temperature)
- gpt-4o (legacy, supports temperature)
- gpt-4o-mini (legacy fast, supports temperature)

**Google Gemini (via @google/generative-ai SDK):**
- gemini-2.5-flash
- gemini-2.5-pro
- gemini-2.0-flash

### Model API Compatibility
```
Newer models (gpt-5*, o3, o4-mini):
  - Use max_completion_tokens instead of max_tokens
  - Do NOT support custom temperature (only default 1)

Legacy models (gpt-4.1*, gpt-4o*):
  - Use max_tokens
  - Support custom temperature (0.5 for streaming, 0.7 for non-streaming)
```

### How Model Selection Works
```
1. User selects model at meeting creation (set once, shown as read-only badge)
2. Model stored in meetings.model column
3. On each request, server checks if model starts with "gemini"
4. Routes to appropriate client (OpenAI or Gemini)
5. Server auto-selects correct token/temperature params per model
6. Admin can set default model via app_settings
7. API keys managed in Admin > Settings (stored in app_settings table)
8. OpenAI key can also come from OPENAI_API_KEY environment variable
```

### System Prompt Architecture
The AI system prompt is dynamically built with:
1. **Base persona**: "You are Zoom Mate, an elite AI interview copilot..."
2. **Response format instructions**: Varies by format (automatic, concise, detailed, STAR, bullet, technical, short, custom)
3. **User documents** (if available): Resume, notes, job descriptions injected as context (token-capped at 1500)
4. **Conversation history**: Running transcript from the meeting (trimmed to last 3 exchanges)
5. **Custom instructions**: User-provided per-session instructions + custom format prompts
6. **Anti-placeholder rules**: Explicit instructions to never use [bracketed placeholders]

### Response Formats
| Format | Description |
|---|---|
| automatic | AI picks best format per question type (technical -> code, behavioral -> STAR, etc.) |
| concise | 2-3 sentences, direct |
| detailed | Comprehensive with examples |
| star | STAR format (Situation, Task, Action, Result) |
| bullet | Bullet point list |
| technical | Code examples, system design |
| short | 1-2 sentences max |
| custom | User-defined format via custom prompt instructions |

### Dynamic Token Limits
Token limits are dynamically set per format and model speed tier:
- Fast models (gpt-5-mini, gpt-5-nano, o4-mini, gpt-4.1-mini, gpt-4o-mini): Lower token limits for speed
- Full models (gpt-5, o3, gpt-4.1, gpt-4o): Higher token limits for depth

---

## Audio Capture & Speech Recognition

### Dual Audio Modes

**Mode 1: Microphone (Web Speech API)**
- Browser-native `webkitSpeechRecognition`
- No external STT service needed
- Captures user's voice directly
- Requires HTTPS in production

**Mode 2: System Audio (getDisplayMedia + Whisper API)**
- Captures audio from Zoom, Teams, Google Meet, or any browser tab
- Uses `navigator.mediaDevices.getDisplayMedia({ audio: true })`
- User shares a Chrome tab with "Share tab audio" enabled
- MediaRecorder captures WebM/Opus audio in 5-second chunks
- Chunks sent to POST /api/transcribe (multer file upload)
- Server forwards to OpenAI Whisper API for transcription
- Transcribed text appended to live transcript
- Audio level visualization via Web Audio API analyser node with requestAnimationFrame

### How Microphone Mode Works
```
1. User clicks "Microphone" button
2. Browser creates SpeechRecognition instance
   - continuous: true (keeps listening)
   - interimResults: true (shows partial text)
   - lang: "en-US"
3. recognition.onresult fires as user/interviewer speaks
4. Final transcripts accumulate in state
5. Interim transcripts shown in real-time (grey text)
6. User presses Enter or Space to send transcript to AI
7. Full transcript sent to /api/meetings/:id/ask-stream
8. Transcript clears, cycle repeats
9. Recognition auto-restarts on end (robust reconnection with recognitionAlive flag)
```

### How System Audio Mode Works
```
1. User clicks "System Audio (Zoom/Teams)" button
2. getDisplayMedia prompts for tab selection
3. User selects Chrome tab running Zoom/Teams with "Share tab audio"
4. MediaRecorder starts with WebM/Opus codec
5. Every 5 seconds:
   a. Recorder stops -> onstop fires
   b. Audio blob sent to /api/transcribe via FormData
   c. Server saves temp file, sends to Whisper API
   d. Transcription text returned and appended to transcript
   e. Recorder restarts for next 5-second chunk
6. User presses Enter/Space to send accumulated transcript to AI
7. Timer refs properly cleaned up on stop to prevent orphaned recordings
```

### Important Notes
- **No WebRTC** is used for audio capture - Web Speech API + getDisplayMedia
- **No TTS (Text-to-Speech)** - answers are displayed as text for the user to read/speak
- **Enter/Space triggers** replaced automatic silence-based sending for better control
- Speech recognition restarts automatically on `onend` (handles browser timeouts)
- System audio timer refs cleaned up properly on stopListening to prevent leaks

---

## Screen Analysis (Vision AI)

### How It Works
```
1. User clicks "Analyze Screen" button in meeting
2. Browser captures screen via screenshot/paste/upload
3. Image sent as base64 to POST /api/meetings/:id/analyze-screen
4. Server sends image + question to Vision AI:
   - OpenAI: Uses image_url content type in chat completion
   - Gemini: Uses inlineData with image/png mime type
5. AI analyzes what's on screen (code, diagrams, questions)
6. Response returned as text for user to reference
```

### Supported by
- OpenAI GPT-4o (has vision capabilities)
- Google Gemini models (native multimodal)
- Not supported by GPT-3.5-turbo (text only)

---

## Real-Time Streaming (SSE)

### Technology
- **Server-Sent Events (SSE)** - not WebSocket
- One-way server-to-client streaming over HTTP
- No WebSocket library used for AI responses

### How SSE Streaming Works

**Server Side (routes.ts):**
```
POST /api/meetings/:id/ask-stream
  -> Set headers: Content-Type: text/event-stream
  -> Set X-Accel-Buffering: no (for Nginx compatibility)
  -> Call generateStreamingResponse() which yields chunks
  -> For each chunk: res.write(`data: ${JSON.stringify({chunk, type:"chunk"})}\n\n`)
  -> On complete: save full response to DB
  -> Send final event: data: {type: "done", response: savedResponse}
  -> res.end()
```

**Client Side (meeting-session.tsx):**
```
fetch(url, { method: "POST", body: JSON.stringify({question, format}) })
  -> Read response.body as ReadableStream
  -> TextDecoderStream decodes chunks
  -> Parse SSE format (data: {...}\n\n)
  -> type: "chunk" -> append to streamingAnswer state
  -> type: "done" -> clear streaming, invalidate query cache
  -> type: "error" -> show error toast
```

### WebSocket Usage
- **ws** library is listed as a dependency but is used by Vite's HMR (Hot Module Replacement) during development
- The application itself does NOT use WebSocket for any feature
- All real-time communication uses SSE (Server-Sent Events)

---

## Authentication & Sessions

### Technology
- **express-session** for session management
- **connect-pg-simple** stores sessions in PostgreSQL
- **bcrypt** for password hashing (10 salt rounds)
- Session-based auth (no JWT)

### Auth Flow
```
Signup:
  POST /api/auth/signup {username, password, email}
  -> Validate inputs (username required, password >= 6 chars)
  -> Check username uniqueness
  -> Hash password with bcrypt
  -> Create user in DB
  -> Set session.userId
  -> Return user object

Login:
  POST /api/auth/login {username, password}
  -> Find user by username
  -> Check user status (banned/suspended -> reject)
  -> Compare password with bcrypt
  -> Update lastLoginAt
  -> Set session.userId
  -> Return user object

Auth Check:
  GET /api/auth/me
  -> Read session.userId
  -> Fetch user from DB
  -> Return user object (or 401)

Logout:
  POST /api/auth/logout
  -> Destroy session
  -> Clear cookie
```

### Session Configuration
- Cookie: httpOnly, sameSite: lax, 30-day expiry
- Secure cookie in production (auto-detect)
- Trust proxy enabled for reverse proxy deployments
- COOKIE_SECURE=false override for HTTP-only setups

### Route Protection
```typescript
requireAuth middleware:
  -> Check req.session.userId exists
  -> Fetch user from DB
  -> Attach req.userId to request
  -> 401 if not authenticated

requireAdmin middleware:
  -> Runs after requireAuth
  -> Check user.role === "admin"
  -> 403 if not admin
```

---

## Stripe Payment Integration

### Plans
| Plan | Price | Features |
|---|---|---|
| Free | $0/mo | Basic access, limited usage |
| Standard | $14.99/mo | Extended features |
| Enterprise | $49.99/mo | Full access, priority support |

### Integration Architecture
```
stripe-replit-sync library handles:
  -> Schema migrations (Stripe tables in PostgreSQL)
  -> Webhook registration and management
  -> Data sync (products, prices, subscriptions)
  -> Backfill on startup

Stripe Client (stripeClient.ts):
  -> Gets credentials from Replit Connectors API
  -> Creates Stripe SDK instance per request (uncacheable for key rotation)
  -> Provides publishable key for frontend

Webhook Handler (webhookHandlers.ts):
  -> Receives raw Buffer (before JSON parsing)
  -> Validates Stripe signature
  -> Delegates to stripe-replit-sync for processing
```

### Stripe API Routes
```
GET  /api/stripe/products      -> List products with prices
POST /api/stripe/checkout      -> Create Stripe Checkout session
GET  /api/stripe/subscription  -> Get current user's subscription
POST /api/stripe/portal        -> Create Stripe Customer Portal session
```

### Webhook Setup
- Webhook URL auto-registered at `/api/stripe/webhook`
- Registered BEFORE express.json() middleware (needs raw body)
- Handles subscription events (created, updated, cancelled)

---

## Admin Panel

### Access
- Route: `/admin`
- Requires `role: "admin"` in user record
- Frontend redirects non-admins to dashboard

### Tabs & Features

#### Dashboard Tab
- Total users, paid users, MRR estimate
- Total sessions, active sessions, total responses
- New users today, new users this week
- Total credits granted

#### Users Tab
- Search by username/email
- Filter by plan (free/standard/enterprise) and status (active/suspended/banned)
- Expandable user rows with full details
- Inline role/plan/status selectors
- User actions: grant credits, grant referral credits, cancel subscription, view credit history, delete user
- Bulk actions: select multiple users, bulk activate/suspend/ban

#### Sessions Tab
- All meetings across all users
- Shows user info, model used, status
- CSV export

#### Announcements Tab
- Create announcements (info/warning/critical/success types)
- Toggle active/inactive
- Delete announcements
- Active announcements shown to all users on dashboard

#### Activity Log Tab
- Full audit trail of all admin actions (credit grants, status changes, subscription cancellations)
- Shows admin who performed action, target user, amount, reason

#### Settings Tab
- API key management (OpenAI + Gemini keys)
- Default model configuration
- Maintenance mode toggle

### Admin API Routes
```
GET    /api/admin/stats                    -> Advanced dashboard stats
GET    /api/admin/users                    -> List all users
PATCH  /api/admin/users/:id               -> Update user (role, plan, status)
DELETE /api/admin/users/:id               -> Delete user
POST   /api/admin/users/bulk-status       -> Bulk update user status
POST   /api/admin/users/:id/grant-credits -> Grant usage credits
POST   /api/admin/users/:id/grant-referral-credits -> Grant referral credits
POST   /api/admin/users/:id/cancel-subscription    -> Cancel Stripe subscription
GET    /api/admin/users/:id/credit-logs   -> User's credit history
GET    /api/admin/credit-logs             -> All credit logs
GET    /api/admin/announcements           -> List announcements
POST   /api/admin/announcements           -> Create announcement
PATCH  /api/admin/announcements/:id       -> Update announcement
DELETE /api/admin/announcements/:id       -> Delete announcement
POST   /api/admin/maintenance             -> Toggle maintenance mode
GET    /api/admin/export/users            -> CSV export of users
GET    /api/admin/export/sessions         -> CSV export of sessions
GET    /api/admin/settings                -> Get app settings
PATCH  /api/admin/settings                -> Update app settings
GET    /api/admin/meetings                -> List all meetings
```

---

## API Routes Reference

### Authentication
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | /api/auth/signup | Public | Create account |
| POST | /api/auth/login | Public | Login |
| POST | /api/auth/logout | User | Logout |
| GET | /api/auth/me | User | Get current user |

### Documents (Knowledge Base)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | /api/documents | User | List user's documents |
| POST | /api/documents | User | Upload document |
| DELETE | /api/documents/:id | User | Delete document |

### Meetings
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | /api/meetings | User | List user's meetings |
| POST | /api/meetings | User | Create meeting |
| GET | /api/meetings/:id | User | Get meeting details |
| PATCH | /api/meetings/:id | User | Update meeting |
| DELETE | /api/meetings/:id | User | Delete meeting |

### AI Responses
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | /api/meetings/:id/responses | User | Get meeting responses |
| POST | /api/meetings/:id/ask | User | Ask question (non-streaming) |
| POST | /api/meetings/:id/ask-stream | User | Ask question (SSE streaming) |
| POST | /api/meetings/:id/analyze-screen | User | Analyze screen capture |
| POST | /api/transcribe | User | Transcribe audio via Whisper API (multipart form) |

### Models
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | /api/models | Public | List available AI models |

### Announcements
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | /api/announcements | User | Get active announcements |

### Stripe
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | /api/stripe/products | User | List subscription products |
| POST | /api/stripe/checkout | User | Create checkout session |
| GET | /api/stripe/subscription | User | Get user's subscription |
| POST | /api/stripe/portal | User | Create customer portal |
| POST | /api/stripe/webhook | Public | Stripe webhook receiver |

---

## Application Flow (How It Works)

### End-to-End User Journey

```
1. USER LANDS ON WEBSITE
   Landing page -> Features, pricing, testimonials, FAQ
   
2. SIGNS UP / LOGS IN
   POST /api/auth/signup or /api/auth/login
   Session created in PostgreSQL
   
3. UPLOADS DOCUMENTS (Knowledge Base)
   Dashboard -> Documents tab
   Upload resume, job description, notes
   PDF text extraction (client-side) or plain text
   Stored in documents table

4. CREATES MEETING SESSION
   Dashboard -> "New Session" button
   Selects: title, type, format (automatic/custom/etc.), model, documents to attach
   For custom format: enters custom format instructions
   POST /api/meetings -> creates meeting record
   Model and format locked at creation (read-only during session)

5. ENTERS MEETING
   /meeting/:id page loads
   Fetches meeting details + responses
   Model and format shown as read-only badges in header

6. STARTS LISTENING (Choice of two modes)
   Option A: Clicks "Microphone" -> Web Speech API activates
   Option B: Clicks "System Audio (Zoom/Teams)" -> getDisplayMedia captures tab audio
   Audio level indicator shows real-time volume

7. CONVERSATION CAPTURED
   Microphone mode: Speech recognition transcribes locally
   System Audio mode: 5-second audio chunks -> Whisper API transcription
   Both modes: Transcript accumulates in "Live Transcript" panel
   
8. USER TRIGGERS AI (Enter/Space)
   User presses Enter or Space (or clicks "Get Answer")
   POST /api/meetings/:id/ask-stream
   Server builds system prompt with:
     - User's resume/documents as context (token-capped)
     - Conversation history (trimmed to last 3 exchanges)
     - Response format preference (automatic/custom/etc.)
     - Custom format instructions (if applicable)
     - Model selection with correct API params
   
9. AI GENERATES STREAMING RESPONSE
   OpenAI/Gemini generates answer token by token
   SSE stream sends chunks to frontend
   Frontend renders markdown with syntax-highlighted code blocks
   User reads and speaks the answer naturally
   Stream cancellable via AbortController
   
10. RESPONSE SAVED
    Full answer saved to responses table
    Conversation context updated
    Query cache invalidated

11. CYCLE REPEATS
    Next question detected -> new AI response
    Full conversation context maintained

12. SCREEN ANALYSIS (optional)
    User captures screen (code challenge, diagram)
    Image sent to Vision AI (GPT-4o or Gemini)
    AI analyzes and provides guidance

13. SESSION ENDS
    User clicks "End Session"
    Meeting status -> "completed"
    All responses preserved for review
```

### Compact Mode Flow
```
User toggles compact mode
  -> Full UI replaced with minimal floating panel
  -> Shows: mic button, text input, current streaming answer, recent responses
  -> Designed to overlay on top of Zoom/Meet window
  -> Interviewer cannot see it (separate window/overlay)
```

---

## Self-Hosted Deployment

### install.sh (Single Command Installer)
```bash
chmod +x install.sh
sudo ./install.sh
```

**What it does:**
1. Installs Node.js 20.x from NodeSource
2. Installs PostgreSQL 16
3. Installs Nginx and Certbot
4. Creates system user `zoommate` and directory `/opt/zoommate`
5. Sets up PostgreSQL database and user
6. Prompts for configuration (domain, API keys, session secret)
7. Creates `.env` file with all settings
8. Runs `npm install` and `npm run build`
9. Runs database migrations (`npm run db:push`)
10. Creates systemd service (`zoommate.service`) for auto-start
11. Configures Nginx reverse proxy
12. Optionally sets up SSL with Let's Encrypt

### Production Architecture
```
Internet
  |
  v
Nginx (port 80/443)
  |-- SSL termination
  |-- Reverse proxy to localhost:5000
  |-- X-Accel-Buffering: no (for SSE)
  |
  v
Node.js Express (port 5000)
  |-- Serves React frontend (static files)
  |-- API routes
  |-- SSE streaming
  |
  v
PostgreSQL (port 5432)
  |-- Users, sessions, documents
  |-- Express sessions
  |-- Stripe sync tables
```

### TROUBLESHOOT.md
Covers common issues:
- Port conflicts
- PostgreSQL connection errors
- Nginx configuration problems
- SSL certificate issues
- Session/cookie problems behind reverse proxy
- Stripe webhook verification failures
- Speech recognition requiring HTTPS

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| DATABASE_URL | Yes | PostgreSQL connection string |
| SESSION_SECRET | Yes | Express session encryption key |
| OPENAI_API_KEY | Yes* | OpenAI API key (*or set in admin panel) |
| NODE_ENV | Yes | "development" or "production" |
| PORT | No | Server port (default: 5000) |
| COOKIE_SECURE | No | Set to "false" for HTTP-only deployments |
| REPLIT_DOMAINS | Auto | Set by Replit for domain detection |
| REPLIT_CONNECTORS_HOSTNAME | Auto | Set by Replit for Stripe connector |

**Admin-configurable settings (stored in app_settings table):**
- `openai_api_key` - Override OpenAI key
- `gemini_api_key` - Google Gemini API key
- `default_model` - Default AI model
- `maintenance_mode` - System-wide maintenance toggle

---

## What We Are NOT Using

For clarity, these technologies are NOT part of this application:

| Technology | Status | Notes |
|---|---|---|
| WebRTC | NOT USED | No peer-to-peer audio/video. Uses Web Speech API + getDisplayMedia |
| TTS (Text-to-Speech) | NOT USED | Answers displayed as text, user reads them aloud |
| WebSocket | NOT USED for features | Only used internally by Vite HMR in development |
| JWT | NOT USED | Session-based auth with PostgreSQL session store |
| Redis | NOT USED | Sessions stored in PostgreSQL |
| Docker | NOT USED | Direct systemd deployment on Ubuntu |
| Next.js | NOT USED | Vite + React SPA |
| Socket.io | NOT USED | SSE (Server-Sent Events) for streaming |
| External STT service | PARTIAL | Whisper API used for system audio only; microphone uses browser-native Web Speech API |
| OAuth/Social login | NOT USED | Username/password auth only |
