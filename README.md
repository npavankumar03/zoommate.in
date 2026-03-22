# Zoom Mate

Real-time interview assistant with Azure Speech live transcription, question-only triggers, SSE streaming answers, and memory-slot recall.

## Required Environment Variables

- `DATABASE_URL` PostgreSQL connection string
- `SESSION_SECRET` session and fallback encryption secret
- `OPENAI_API_KEY` OpenAI API key
- `SETTINGS_ENCRYPTION_KEY` optional, recommended explicit key for at-rest admin setting encryption
- `PORT` optional, default `5000`

## Azure Speech Admin Settings

Configure in Admin Settings:

- `AZURE_SPEECH_REGION` default `eastus`
- `AZURE_SPEECH_KEY` encrypted at rest before DB write; never returned by API

Token endpoint:

- `GET /api/speech/azure/token` (auth required)
  - returns `{ token, region, expires_in_seconds: 600 }`
  - per-user rate limited
  - denied when user credits are exhausted

## STT + Assistant Pipeline

1. Client starts listening on `/meeting/:id`
2. Azure SDK emits `recognizing` partial updates (gray interim line)
3. Azure SDK emits `recognized` final turn (append-only transcript)
4. Client posts final turn:
   - `POST /api/meetings/:id/transcript-turn`
5. Client runs server detection:
   - `POST /api/meetings/:id/detect-turn`
   - pipeline: rule gate -> `QUESTION_CLASSIFIER` -> `QUESTION_NORMALIZER`
6. If `is_question && confidence >= 0.65`:
   - stream clean question only:
   - `POST /api/meetings/:id/assistant/stream`

SSE response headers:

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache, no-transform`
- `Connection: keep-alive`
- `X-Accel-Buffering: no`
- keepalive comments every 15s

## Memory + Prompt Constraints

- Memory slots: `employer`, `client`, `role_title`, `tech_stack`, `achievements`
- Fact fast-path answers are served directly from memory slots when applicable
- Prompt context is bounded to:
  - clean question
  - last 2-4 turns
  - rolling summary
  - memory slots
- Full transcript/history is not sent to LLM.

## Instrumentation

Server logs include:

- `t0 turn_finalized`
- `ttfb`
- `total_latency`

No secret keys are logged.

## Demo Verification Steps

1. In Admin -> Settings, save Azure key + region.
2. Start a meeting and select Azure Speech.
3. Speak continuously:
   - verify smooth gray interim text updates
   - verify append-only final turns on the left panel
4. Speak non-question statements:
   - verify assistant does not auto-answer
5. Ask a direct interview question:
   - verify `detect-turn` marks question
   - verify assistant starts SSE response with clean question only
6. While assistant is answering, start speaking again:
   - verify current stream is cancelled (barge-in).
