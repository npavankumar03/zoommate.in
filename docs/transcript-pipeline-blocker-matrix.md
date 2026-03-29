# Transcript Pipeline Blocker Matrix

Generated during the pattern-correct framing stabilization pass.

| Blocker ID | Severity | Subsystem | Trigger | Expected | Previous Wrong Behavior | Fix Location | Release Gate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TP-001 | High | `wsAnswer` Enter flow | Fresh transcript window plus stale queued question history | Current Enter window wins | Old unanswered queue/history could beat fresh transcript | `server/realtime/wsAnswer.ts` | Closed |
| TP-002 | High | `meetingStore` / `sessionState` | Incomplete prompt followed by fuller prompt | Fuller prompt supersedes fragment | `Tell me about?` and `Tell me about yourself?` could coexist | `server/realtime/meetingStore.ts`, `server/assist/sessionState.ts` | Closed |
| TP-003 | High | Shared detector / routes | One-word tech prompts like `Python` | Treat as fragment until completed | Bare tech terms were upgraded into experience questions | `shared/questionDetection.ts`, `server/assist/questionDetect.ts`, `server/routes.ts` | Closed |
| TP-004 | High | Client transcript UI | Similar transcript rows repeated or merged | Question rewrite stays attached to the correct row | Clean question labels were keyed by normalized text, not stable row ids | `client/src/pages/meeting-session.tsx` | Closed |
| TP-005 | High | Enter repeat behavior | Second Enter with no new transcript | Reuse same last answered question only | Could emit `Continue answering` or drift to stale prompt | `server/realtime/wsAnswer.ts` | Closed |
| TP-006 | High | Prompt / answer framing | Concept question with sparse/no profile | Stay conceptual, do not invent experience facts | Concept questions could become fabricated experience answers | Existing prompt hardening plus current Enter-window gating | Closed |
| TP-007 | Medium | HTTP detect-turn vs backend framing | `/detect-turn` response consumed by client | Structured framed-question payload with answerability and hash | Only boolean-like fields were returned, causing client/server drift | `server/routes.ts` | Closed |
| TP-008 | Medium | Validation coverage | Regression around fragments, repeat Enter, supersession | Automated regression script exists | No dedicated transcript/question framing regression harness | `scripts/transcriptFramingRegression.ts`, `package.json` | Closed |
| TP-009 | Medium | Desktop build | `npm --prefix desktop run build` | Desktop build passes | Existing Tauri module/type imports missing, plus bridge typing gaps | `desktop/src/components/OverlayWindow.tsx`, `desktop/src/components/SettingsPanel.tsx`, `desktop/src/hooks/useTypingPlayback.ts`, `desktop/src/lib/bridge.ts` | Open (non-pipeline) |

## Open Non-Pipeline Blocker

### TP-009 Desktop build

- Missing module/type bindings:
  - `@tauri-apps/api/core`
  - `@tauri-apps/api/window`
  - `@tauri-apps/api/event`
- Additional type issues:
  - `bridge.getAssistants` missing from the bridge type surface
  - implicit `any` parameters in desktop settings/bridge code

This blocker does not invalidate the transcript/question pipeline, but it remains open for full repo desktop build health.
